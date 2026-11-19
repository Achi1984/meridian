import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from unittest.mock import patch

from pair_report import BREAKOUT_START, breakout_duel, breakout_reason, breakout_signal, comparison, describe, iso
from feeds import COST_VERSION
from pilot import publish_pair


class PairReportTest(unittest.TestCase):
    def test_breakout_duel_uses_closed_bars_costs_and_one_position(self):
        start = BREAKOUT_START
        bars = [[start-i*3600, 100, 108, 90, 100] for i in (4, 3, 2, 1)]
        bars[-1][2:4] = [102, 98]
        with sqlite3.connect(':memory:') as db:
            db.execute("ATTACH DATABASE ':memory:' AS v3")
            db.execute('CREATE TABLE v3.slots(slot, record)')
            for i in range(-1, 8):
                slot = start+i*600
                book = dict(bid=100 if i<7 else 110, ask=101 if i<7 else 111, bidSize=5, askSize=5)
                row = dict(promptVersion=COST_VERSION, executionBook=book,
                           states={'model': dict(cash='1000', btc='0')},
                           inputs=dict(hour=bars, ten=[[slot-600,100,104,99,103]]),
                           report=dict(last=dict(at=iso(slot+2), execution='HOLD'),
                                       arms={'model': dict(equityEur=1000)}))
                db.execute('INSERT INTO v3.slots VALUES(?,?)', (slot,json.dumps(row)))
            result = breakout_duel(db, slot)
            self.assertEqual(result['v4']['closed'], 1)
            self.assertEqual(result['v4']['reason'], 'TIME_EXIT')
            self.assertGreater(result['v4']['netEur'], 0)
            self.assertEqual(result['onlyV4']['closed'], 1)
            self.assertGreater(result['onlyV4']['costsEur'], 0)
            self.assertEqual(result['v3']['netEur'], 0)
            db.execute('DELETE FROM v3.slots WHERE slot=?', (start+1200,))
            self.assertEqual(breakout_duel(db, slot)['onlyV4']['closed'], 0)
            self.assertFalse(breakout_signal(row, slot))
            self.assertIsNone(breakout_duel(db, start-600))

    def test_v4_wait_reasons_and_strict_breakout(self):
        hour = BREAKOUT_START
        bars = [[hour-i*3600,100,106,94,100] for i in (4,3,2,1)]
        ten = [[hour,100,106,99,106]]
        row = dict(inputs=dict(hour=bars, ten=ten))
        self.assertEqual(breakout_reason(row, hour), 'WAIT_FIRST_CLOSE')
        self.assertEqual(breakout_reason(row, hour+600), 'NO_COMPRESSION')
        bars[-1][3] = 98
        self.assertEqual(breakout_reason(row, hour+600), 'WAIT_BREAKOUT')
        ten[-1][2] = ten[-1][4] = 107
        self.assertEqual(breakout_reason(row, hour+600), 'BREAKOUT')
        self.assertEqual(breakout_reason(row, hour+1200), 'CANDLES_UNAVAILABLE')

    def test_latest_common_slot_and_independent_opening_values(self):
        start = 1200
        with tempfile.TemporaryDirectory() as tmp:
            volume = Path(tmp)
            (volume/'challenger-v2').mkdir()
            for path, epoch, values in [
                (volume/'pilot.sqlite', 600, [(600,998), (1200,999), (1800,997)]),
                (volume/'challenger-v2'/'pilot.sqlite', start, [(1200,1000)])]:
                db = sqlite3.connect(path)
                db.executescript('CREATE TABLE pilot(id,start); CREATE TABLE slots(slot INTEGER PRIMARY KEY, record TEXT);')
                db.execute('INSERT INTO pilot VALUES(1,?)', (epoch,))
                for slot, equity in values:
                    report = dict(arms={'model': {'equityEur': equity}},
                                  last=dict(action='HOLD', reason='MARKET_UNAVAILABLE'))
                    db.execute('INSERT INTO slots VALUES(?,?)', (slot,json.dumps({'report':report})))
                db.commit()
                db.close()
            _, result = comparison(volume)
            self.assertEqual(result['at'], iso(start))
            self.assertEqual(result['v1']['change'], 1)
            self.assertEqual(result['v2']['change'], 0)
            self.assertEqual(result['v2']['action'], 'SKIPPED')

    def test_third_ledger_pending_then_common_start_and_exact_slot(self):
        with tempfile.TemporaryDirectory() as tmp:
            volume = Path(tmp)
            for name, epoch, samples in [
                    ('', 600, [(1200, 990), (1800, 991)]),
                    ('challenger-v2', 1200, [(1200, 995), (1800, 993)]),
                    ('challenger-v3', 1800, [(2400, 1003)])]:
                directory = volume / name
                directory.mkdir(exist_ok=True)
                with sqlite3.connect(directory / 'pilot.sqlite') as db:
                    db.executescript('CREATE TABLE pilot(id,start); CREATE TABLE slots(slot,record);')
                    db.execute('INSERT INTO pilot VALUES(1,?)', (epoch,))
                    for slot, equity in samples:
                        record = dict(report=dict(last=dict(action='HOLD', reason='wait'),
                                                  arms=dict(model=dict(equityEur=equity))))
                        db.execute('INSERT INTO slots VALUES(?,?)', (slot, json.dumps(record)))
            _, pending = comparison(volume)
            self.assertTrue(pending['v3Pending'])
            self.assertNotIn('v3', pending)
            with sqlite3.connect(volume/'challenger-v3'/'pilot.sqlite') as db:
                db.execute('UPDATE slots SET slot=1800 WHERE slot=2400')
            _, row = comparison(volume)
            self.assertEqual((row['at'], row['start']), (iso(1800), iso(1800)))
            self.assertEqual([row[k]['change'] for k in ('v1','v2','v3')], [1,-2,3])
            for path in (volume/'pilot.sqlite', volume/'challenger-v3'/'pilot.sqlite'):
                with sqlite3.connect(path) as db:
                    db.execute('INSERT INTO slots SELECT 2400,record FROM slots WHERE slot=1800')
            _, row = comparison(volume)
            self.assertEqual(row['at'], iso(2400))
            self.assertEqual(row['start'], iso(1800))
            self.assertNotIn('v2', row)
            self.assertEqual((row['v1']['change'], row['v3']['change']), (1, 3))

    def test_later_challenger_commit_publishes_once_without_next_cycle(self):
        old, current = ({'at': iso(slot)} for slot in (1200, 1800))
        with patch('pilot.comparison', side_effect=[(0, old), (0, old), (0, current)]), \
             patch('pilot.time.time', return_value=1810), patch('pilot.time.sleep') as sleep, \
             patch('builtins.print') as output:
            publish_pair(Path('/state'), 1800)
        rows = [json.loads(call.args[0])['pilotAudit']['comparison'] for call in output.call_args_list]
        self.assertEqual(rows, [old, current])
        self.assertEqual(sleep.call_count, 2)

    def test_missing_challenger_stops_at_deadline(self):
        with patch('pilot.comparison', return_value=(0, None)), \
             patch('pilot.time.time', side_effect=[1889, 1890]), patch('pilot.time.sleep') as sleep, \
             patch('builtins.print') as output:
            publish_pair(Path('/state'), 1800)
        sleep.assert_called_once_with(1)
        output.assert_not_called()

    def test_skipped_detail_uses_only_recorded_operational_categories(self):
        for reason, status, expected in (
                ('MARKET_UNAVAILABLE', 'INCOMPLETE_OHLC', 'CANDLES'),
                ('MARKET_UNAVAILABLE', 'BOOK_TIME_INVALID', 'BOOK_TIME'),
                ('MARKET_UNAVAILABLE', 'HTTP_429', 'RATE_LIMIT'),
                ('MARKET_UNAVAILABLE', None, 'MARKET'),
                ('MARKET_UNAVAILABLE', 'unexpected provider detail', 'MARKET'),
                ('MODEL_UNAVAILABLE: provider detail', 'OK', 'MODEL'),
                ('wait for recovery', 'OK', None)):
            with self.subTest(reason=reason, status=status):
                report = dict(arms={'model': {'equityEur': None}}, last=dict(action='HOLD', reason=reason))
                arm = describe(json.dumps(dict(report=report, marketStatus=status)), 1000)
                self.assertEqual(arm.get('skipCause'), expected)
                self.assertEqual(arm['action'], 'SKIPPED' if expected else 'HOLD')
                self.assertIsNone(arm['equity'])
                self.assertIsNone(arm['change'])

    def test_buy_decision_preserves_its_recorded_execution(self):
        for outcome in ('PAPER_BUY', 'POSITION_UNCHANGED', 'NO_FRESH_BOOK',
                        'DECISION_WINDOW_EXPIRED', 'INSUFFICIENT_ASK_SIZE', None, 'unrecognized'):
            with self.subTest(outcome=outcome):
                last = dict(action='BUY', reason='signal')
                if outcome is not None:
                    last['execution'] = outcome
                raw = json.dumps({'report': {'last': last, 'arms': {'model': {'equityEur': 995}}}})
                arm = describe(raw, 1000)
                self.assertEqual(arm['action'], 'BUY')
                self.assertEqual(arm.get('execution'), None if outcome == 'unrecognized' else outcome)
