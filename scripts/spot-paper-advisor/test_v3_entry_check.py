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
