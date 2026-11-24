import unittest
from runner_persistence_audit import assess


class AuditTests(unittest.TestCase):
    def test_dust_liquidity_and_absent_confirmation_remain_visible(self):
        result = assess([dict(at=0,price=1,liquidity=10000),dict(at=420,price=1000,liquidity=.01)])
        self.assertEqual(result['hitLiquidity'],.01)
        self.assertIsNone(result['followMultiple'])

    def test_first_followup_in_window_includes_reversal(self):
        rows = [dict(at=t,price=p,liquidity=liq) for t,p,liq in
                [(0,1,10000),(60,4,0),(120,3,12000),(150,5,15000),(180,.1,50),(200,4,20000)]]
        result = assess(rows)
        self.assertEqual(result['hitAfter'],120)
        self.assertEqual(result['followMultiple'],.1)
