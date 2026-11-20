import json
import sqlite3
import unittest

from usd_pullback import iso, paper_slot, pnl_parts, replay, signal
from worker import DAY, STEP, initial


START = DAY*100 + 4*3600


def quote(slot, bid=100, ask=101):
    return dict(bid=bid, ask=ask, bidSize=10, askSize=10,
                received=slot+2, bidAt=slot+2, askAt=slot+2)


def snapshot(slot):
    hour = slot-slot % 3600
    hourly = [[hour-(3-i)*3600, 99+i, 110, 97, 99+i] for i in range(3)]
    ten = [[slot-2*STEP, 101, 102, 98, 99], [slot-STEP, 99, 104, 98, 103]]
    return dict(hour=hourly, ten=ten, book=quote(slot))


class PullbackTest(unittest.TestCase):
    def test_requires_rising_trend_recovery_and_room_after_cost(self):
        data = snapshot(START)
        state = initial()
        self.assertEqual(signal(state, data, START), ('BUY', 'PULLBACK_RECOVERY', 98, 110))
        data['ten'][1][4] = 102
        self.assertEqual(signal(state, data, START)[1], 'WAIT_RECOVERY')
        data = snapshot(START)
        data['hour'][0][4] = 100
        self.assertEqual(signal(state, data, START)[1], 'NO_UPTREND')
        data = snapshot(START)
        data['hour'][-1][2] = 101.1
        self.assertEqual(signal(state, data, START)[1], 'TARGET_BELOW_COST')
        data = snapshot(START)
        data['ten'][0][0] += STEP
        self.assertEqual(signal(state, data, START)[1], 'CANDLES_UNAVAILABLE')

    def test_fill_cost_freshness_size_and_execution_window(self):
        data = snapshot(START)
        state = initial()
        for book, delay, cause in [
            (quote(START, 108, 109), 3, 'HOLD'),
            (quote(START), 9, 'NO_FRESH_BOOK'),
            (dict(quote(START), askSize=0.00001), 3, 'INSUFFICIENT_ASK_SIZE'),
            (None, 100, 'DECISION_WINDOW_EXPIRED'),
        ]:
            with self.subTest(cause=cause):
                result = paper_slot(state, data, book, START, START+delay)
                self.assertEqual(result['execution'], cause)
                self.assertIsNone(state['opened'])
        opened = paper_slot(state, data, quote(START), START, START+3)
        self.assertEqual(opened['execution'], 'PAPER_BUY')
        self.assertLess(opened['equityUsd'], 1000)
        for close, reason in [(98, 'PULLBACK_FAILED'), (110, 'TARGET_REACHED')]:
            data = snapshot(START+STEP)
            data['ten'][-1][2] = 110
            data['ten'][-1][4] = close
            self.assertEqual(signal(state, data, START+STEP)[:2], ('SELL', reason))
        self.assertEqual(signal(state, None, START+3600)[:2], ('SELL', 'TIME_EXIT'))
        self.assertEqual(signal(state, None, DAY*101-STEP)[:2], ('SELL', 'DAY_CLOSE'))

    def test_entry_signal_cannot_use_a_later_quote_than_its_fill(self):
        data = snapshot(START)
        data['book'] = dict(data['book'], received=START+4)
        state = initial()
        result = paper_slot(state, data, quote(START), START, START+5)
        self.assertEqual((result['execution'], result['reason']), ('HOLD', 'SIGNAL_AFTER_FILL_BOOK'))
        self.assertIsNone(state['opened'])

    def test_read_only_replay_counts_missing_reserved_slots_and_observed_fills(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.executescript('CREATE TABLE pilot(id, start); CREATE TABLE slots(slot PRIMARY KEY, record);')
        db.execute('INSERT INTO pilot VALUES (1, ?)', (START,))
        arms = {key: {'equityUsd': 1000} for key in ('v3','v4','cash','btcHold')}
        for slot in (START, START+3600):
            report = dict(schema='MERIDIAN_USD_ROUND_V1', pair='BTC/USD', start=iso(START),
                          at=iso(slot), publishedAt=iso(slot+3), arms=arms)
            record = dict(report=report, snapshot=snapshot(slot), fillBook=quote(slot))
            db.execute('INSERT INTO slots VALUES (?, ?)', (slot, json.dumps(record)))
        db.execute('INSERT INTO slots VALUES (?, NULL)', (START+4200,))
        db.execute('PRAGMA query_only=ON')
        result = replay(db)
        self.assertEqual(result, replay(db))
        self.assertEqual(result['missingSlots'], 6)
        self.assertEqual(result['modeledSlots'], 2)
        self.assertEqual(result['closed'], 1)
        trade, = result['closedTrades']
        self.assertEqual((trade['entryAt'], trade['exitAt']), (iso(START), iso(START+3600)))
        self.assertAlmostEqual(trade['quotePnlUsd'], -trade['btc'])
        self.assertGreater(trade['feesUsd'], 0)
        self.assertGreater(trade['slippageUsd'], 0)
        self.assertAlmostEqual(trade['quotePnlUsd']-trade['feesUsd']-trade['slippageUsd'], result['netUsd'])
        self.assertAlmostEqual(trade['netUsd'], result['realizedUsd'])
        self.assertEqual(result['signalReasonCounts'], {'BUY': {'PULLBACK_RECOVERY': 1},
                                                       'SELL': {'TIME_EXIT': 1}, 'HOLD': {}})
        self.assertEqual(result['executionCounts'], {'PAPER_BUY': 1, 'PAPER_SELL': 1})
        self.assertEqual(result['last']['at'], iso(START+3600))
        self.assertEqual(result['through'], iso(START+4200))
        self.assertEqual(result['activeDays'], 1)
        self.assertLess(result['equityUsd'], 1000)
        self.assertAlmostEqual(result['realizedUsd'], result['netUsd'])
        self.assertEqual(result['openPnlUsd'], 0)
        self.assertGreater(result['maxObservedDrawdownPct'], 0)
        self.assertEqual(result['sameSlotBaselineEquityUsd']['v3'], 1000)

    def test_first_day_excludes_day_two_trades_and_costs_and_marks_missing_endpoint(self):
        from usd_pullback import first_day
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.executescript('CREATE TABLE pilot(id, start); CREATE TABLE slots(slot PRIMARY KEY, record);'
                         'CREATE TABLE calls(slot, charge, settled);')
        db.execute('INSERT INTO pilot VALUES (1,?)', (START,))
        arm = dict(equityUsd=999, netUsd=-1, action='BUY', execution='PAPER_BUY', reason='TEST')
        for slot in (START, START+DAY):
            report = dict(schema='MERIDIAN_USD_ROUND_V1', pair='BTC/USD', start=iso(START),
                          at=iso(slot), publishedAt=iso(slot+3),
                          arms={k: arm for k in ('v3','v4','cash','btcHold')})
            db.execute('INSERT INTO slots VALUES (?,?)', (slot, json.dumps(dict(report=report))))
            db.execute('INSERT INTO calls VALUES (?,1000000,1)', (slot,))
        self.assertIsNone(first_day(db, START)['v5Replay'])
        self.assertEqual(first_day(db, START+STEP)['arms']['v3']['equityUsd'], 999)
        report = first_day(db, START+2*DAY)
        self.assertEqual((report['expectedSlots'], report['observedSlots'], report['missingSlots']), (144,1,143))
        self.assertEqual(report['modelCostUsd'], 0.1)
        self.assertEqual(report['arms']['v3']['buys'], 1)
        self.assertIsNone(report['arms']['v3']['equityUsd'])
        self.assertIsNone(report['v5Replay']['equityUsd'])

    def test_realized_and_open_pnl_after_reentry_and_with_missing_quote(self):
        state = dict(cash='905.25', btc='0.001', entryCostUsd='99.75')
        self.assertEqual(pnl_parts(state, 1003.5), dict(realizedUsd=5.0, openPnlUsd=-1.5))
        self.assertEqual(pnl_parts(state, None), dict(realizedUsd=5.0, openPnlUsd=None))
        self.assertEqual(pnl_parts(dict(cash='1003.5', btc='0', entryCostUsd='99.75'), 1003.5),
                         dict(realizedUsd=3.5, openPnlUsd=0.0))
        self.assertEqual(pnl_parts(None, 1000), dict(realizedUsd=None, openPnlUsd=None))
