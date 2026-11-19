import json
import sqlite3
import unittest
from decimal import Decimal

from cost_filter_audit import STAGES, audit
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
