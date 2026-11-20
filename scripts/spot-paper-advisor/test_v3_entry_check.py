import unittest
from decimal import Decimal
from test_usd_pullback import START, snapshot, quote
from worker import iso, execute, initial
from v3_entry_check import entry_check, filter_outcomes, delayed_exit


class EntryCheckTest(unittest.TestCase):
    def test_conflicting_breakout_claim_overrides_recovery(self):
        data = snapshot(START)
        self.assertEqual(entry_check('Bodenbildung über Stundenhoch (62835)', data, START),
                         ('blocked', 'BREAKOUT_UNCONFIRMED'))
        self.assertEqual(entry_check('Rebound', data, START), ('confirmed', 'ENTRY_CONFIRMED'))
        data['ten'][-1][4] = 99
        self.assertEqual(entry_check('Rebound', data, START)[1], 'RECOVERY_UNCONFIRMED')

    def test_missing_or_expensive_evidence(self):
        data = snapshot(START)
        self.assertEqual(entry_check('Momentum', data, START)[0], 'unverified')
        data['book']['ask'] = 110
        self.assertEqual(entry_check('Rebound', data, START)[1], 'TARGET_BELOW_COST')
        self.assertEqual(entry_check('Rebound', None, START)[0], 'unverified')

    def test_design_trade_and_later_missed_winners_are_kept_separate(self):
        def entry(at, pnl, verdict='blocked'):
            return dict(at='2026-11-19T'+at+'+00:00', realizedUsd=pnl, verdict=verdict)
        result = filter_outcomes([entry('20:30:00', -0.67), entry('21:00:00', -2),
                                  entry('21:10:00', -1), entry('21:20:00', 3),
                                  entry('21:30:00', None), entry('21:40:00', 12, 'unverified')])
        self.assertEqual(result['designTrade']['avoidedLossUsd'], 0.67)
        self.assertEqual(result['otherHistorical']['avoidedLossUsd'], 2)
        self.assertIsNone(filter_outcomes([])['afterRulePublication']['retainedEntryPct'])
        later = result['afterRulePublication']
        self.assertEqual((later['retainedEntries'], later['retainedEntryPct']), (1, 25))
        self.assertEqual((later['entries'], later['blockedClosed'], later['blockedWithoutExit']), (4, 2, 1))
        self.assertEqual((later['avoidedLossUsd'], later['missedProfitUsd'], later['differenceOnClosedTradesUsd']),
                         (1, 3, -2))

    def test_delayed_exit_uses_executable_bid_and_preserves_original_lot(self):
        slot = START+1200
        state = initial()
        execute(state, 'BUY', quote(START), START)
        state['entryCostUsd'] = str(Decimal(1000)-Decimal(state['cash']))
        report = dict(publishedAt=iso(slot+3), arms={'v3': {'execution':'HOLD'}})
        record = dict(report=report, fillBook=quote(slot, 105, 106))
        result = delayed_exit(state, record, slot, Decimal(999))
        expected = state.copy()
        execute(expected, 'SELL', record['fillBook'], slot)
        self.assertAlmostEqual(result['differenceUsd'], float(Decimal(expected['cash'])-999))
        self.assertAlmostEqual(result['realizedUsd'], result['differenceUsd']-1)
        self.assertNotEqual(state['btc'], '0')
        record['fillBook']['bidSize'] = 0.00001
        self.assertEqual(delayed_exit(state, record, slot, Decimal(999))['status'], 'INSUFFICIENT_BID_SIZE')
        report['arms']['v3']['execution'] = 'PAPER_BUY'
        self.assertEqual(delayed_exit(state, record, slot, Decimal(999))['status'], 'REENTRY_CONFLICT')


    def test_retry_has_independent_entry_and_exit(self):
        import sqlite3
        import json
        from worker import STEP
        from v3_entry_check import audit
        from contextlib import closing
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute('CREATE TABLE pilot (id, start)')
            db.execute('INSERT INTO pilot VALUES (1, ?)', (START,))
            db.execute('CREATE TABLE slots (slot, record)')
            for i, execution in enumerate(('PAPER_BUY', 'PAPER_SELL', 'HOLD')):
                slot = START+i*STEP
                arm = dict(reason='Ausbruch', execution=execution)
                report = dict(pair='BTC/USD', schema='MERIDIAN_USD_ROUND_V1', start=iso(START),
                              at=iso(slot), publishedAt=iso(slot+3), arms={'v3': arm})
                data = snapshot(slot)
                if i == 2:
                    data['ten'][-1][2:5] = [112, 98, 111]
                record = dict(report=report, snapshot=data, fillBook=quote(slot, 111, 112) if i==2 else quote(slot),
                              states={'v3': dict(btc='1', cash='900', entryCostUsd='100', opened=START)})
                db.execute('INSERT INTO slots VALUES (?,?)', (slot, json.dumps(record)))
            result = audit(db)['entries'][0]['nextSlotPullback']
            self.assertEqual(result['execution'], 'PAPER_BUY')
            self.assertEqual(result['exitReason'], 'TARGET_REACHED')
            self.assertGreater(result['realizedUsd'], 0)
            row = db.execute('SELECT record FROM slots WHERE slot=?', (START+STEP,)).fetchone()
            retry_record = json.loads(row[0])
            retry_record['snapshot']['hour'][0][4] = 101
            db.execute('UPDATE slots SET record=? WHERE slot=?', (json.dumps(retry_record), START+STEP))
            strict = audit(db)['entries'][0]['nextSlotPullback']
            relaxed = audit(db, require_uptrend=False)['entries'][0]['nextSlotPullback']
            self.assertEqual(strict['reason'], 'NO_UPTREND')
            self.assertEqual(relaxed, result)
            db.execute('DELETE FROM slots WHERE slot=?', (START+STEP,))
            self.assertEqual(audit(db)['entries'][0]['nextSlotPullback']['status'], 'NEXT_SLOT_UNAVAILABLE')

    def test_cost_attribution_keeps_lot_fixed_and_checks_cash(self):
        from v3_entry_check import trade_costs
        ask, bid, qty = map(Decimal, ('100', '101', '2'))
        # Cash equals slipped exit proceeds less entry basis including both fees.
        ledger = qty * (bid*Decimal('.999')*Decimal('.995') - ask*Decimal('1.001')*Decimal('1.005'))
        row = trade_costs(ask, bid, qty, ledger)
        self.assertEqual(row['quotePnlUsd'], 2)
        self.assertAlmostEqual(row['slippageUsd'], .402)
        self.assertAlmostEqual(row['net20bpsUsd'], 1.598 - .002*401.998)
        self.assertLess(row['ledgerNetUsd'], 0)
        self.assertIsNone(trade_costs(ask, bid, qty, ledger+1))
