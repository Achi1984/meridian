import json
import sqlite3
import unittest
from decimal import Decimal

from cost_filter_audit import FORWARD_START, STAGES, audit, confirmed_breakout, entry_signals, forward_comparison
from feeds import COST_VERSION
from worker import DAY, STEP, iso


class CostFilterAuditTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE slots (slot INTEGER PRIMARY KEY, record TEXT)')

    def record(self, slot, reason, bid, *, size=1, delay=2):
        record = dict(promptVersion=COST_VERSION, states={'model': {'cash': '1000', 'btc': '0', 'opened': None}},
                      report={'last': dict(action='HOLD', execution='HOLD', at=iso(slot+delay), reason=reason)},
                      executionBook=dict(bid=bid, ask=bid+1, bidSize=size, askSize=size))
        self.db.execute('INSERT INTO slots VALUES (?, ?)', (slot, json.dumps(record)))

    def test_fixed_exit_ignores_intermediate_peak_and_accounts_for_costs(self):
        self.record(0, next(iter(STAGES)), 10000)
        self.record(STEP, 'model', 10500)
        self.record(6*STEP, 'model', 10100)
        sample, = audit(self.db)['samples']
        self.assertEqual(sample['stage'], 'beforeModel')
        self.assertEqual(sample['status'], 'MEASURED')
        self.assertLess(Decimal(sample['netEur']), 0)

    def test_breakout_uses_two_closed_bars_and_one_prior_resistance(self):
        slot = 8 * STEP
        bars = [[i*STEP, 100, 102, 99, 101] for i in range(8)]
        record = {'inputs': {'ten': bars}}
        bars[-1][2:] = [110, 99, 105]
        self.assertFalse(confirmed_breakout(record, slot))
        bars[-2][2:] = [111, 99, 102]
        self.assertFalse(confirmed_breakout(record, slot))
        bars[-2][4] = 103
        self.assertTrue(confirmed_breakout(record, slot))
        bars[-1][0] = slot
        self.assertIsNone(confirmed_breakout(record, slot))
        self.assertIsNone(confirmed_breakout({}, slot))

    def test_retest_and_failed_breakdown(self):
        slot = 8*STEP
        bars = [[i*STEP, 100, 102, 98, 100] for i in range(8)]
        record = {'inputs': {'ten': bars}}
        bars[-2][1:] = [100, 104, 99, 103]
        bars[-1][1:] = [103, 104, 102, 103]
        self.assertTrue(entry_signals(record, slot)['breakoutRetest'])
        bars[-1][3] = 103
        self.assertFalse(entry_signals(record, slot)['breakoutRetest'])
        bars[-2][1:] = [99, 101, 97, 99]
        self.assertTrue(entry_signals(record, slot)['failedBreakdown'])
        bars[-1][1:] = [100, 102, 99, 101]
        self.assertFalse(entry_signals(record, slot)['failedBreakdown'])

    def test_forward_comparison_excludes_development_period_and_pending_pnl(self):
        def sample(offset, signal, status):
            return dict(entryAt=iso(FORWARD_START+offset), breakoutRetest=signal,
                        failedBreakdown=False, status=status, netEur='1.25')
        groups = forward_comparison([sample(-STEP, True, 'MEASURED'), sample(0, True, 'MEASURED'),
                                     sample(STEP, True, 'PENDING_EXIT'), sample(2*STEP, None, 'EXIT_MISSING_RECORD')])['groups']
        self.assertEqual(groups['breakoutRetest']['signal'],
                         dict(total=2, measured=1, pending=1, unavailable=0, meanNetEur='1.25'))
        self.assertEqual(groups['breakoutRetest']['unknown']['unavailable'], 1)
        self.assertIsNone(groups['breakoutRetest']['noSignal']['meanNetEur'])

    def test_session_close_and_missing_evidence(self):
        reason = list(STAGES)[1]
        self.record(DAY-3*STEP, reason, 10000)
        self.assertEqual(audit(self.db)['samples'][0]['status'], 'PENDING_EXIT')
        self.record(DAY-STEP, 'DAY_CLOSE', 10500, delay=100)
        sample, = audit(self.db)['samples']
        self.assertEqual(sample['stage'], 'afterBuySignal')
        self.assertEqual(sample['exitAt'], iso(DAY-STEP))
        self.assertGreater(Decimal(sample['netEur']), 0)
        self.record(DAY, reason, 10000, size=0)
        self.record(DAY+STEP, reason, 10000)
        self.record(DAY+8*STEP, 'model', 11000)
        samples = audit(self.db)['samples']
        self.assertEqual(samples[1]['status'], 'ENTRY_INSUFFICIENT_ASK_SIZE')
        self.assertEqual(samples[2]['status'], 'EXIT_MISSING_RECORD')
