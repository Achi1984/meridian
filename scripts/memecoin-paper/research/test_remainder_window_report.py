import unittest
from remainder_window_report import shorter_window


class RemainderWindowTests(unittest.TestCase):
    def rows(self, held):
        return [dict(event='entry', arm='early', qty=101),
                dict(event='runnerPartialSale', qty=50, usdcRaw=10000000),
                dict(event='runnerMark', qty=51, usdcRaw=11000000, heldSeconds=held)]

    def test_sell_on_first_eligible_bid(self):
        rows = self.rows(899)
        rows.extend([dict(rows[-1], heldSeconds=901), dict(rows[-1], heldSeconds=950, usdcRaw=15000000)])
        result = shorter_window(rows, {})
        self.assertEqual((result['heldSeconds'], result['netUsdc']), (901, .85))

    def test_deadline_and_partial_cash(self):
        self.assertEqual(shorter_window(self.rows(1020), {})['state'], 'splitClosed')
        result = shorter_window(self.rows(1021), {})
        self.assertEqual((result['remainingQty'], result['zeroRecoveryUsdc']), (51, -10.1))

    def test_shared_early_barrier(self):
        rows = self.rows(800)
        rows[-1]['usdcRaw'] = 5000000
        self.assertEqual(shorter_window(rows, {})['netUsdc'], -5.15)
