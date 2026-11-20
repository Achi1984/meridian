import unittest

from breakout_perp_history import FUNDING_STEP, paired_trade


class PairedHistoryTests(unittest.TestCase):
    def test_boundary_funding_and_missing_coverage(self):
        at = FUNDING_STEP
        prices = {0: 100, at: 100, at+600: 100}
        marks, rates = {at: 101}, {at: .001}
        trade = paired_trade((0, 100, 1), at, 100, prices, marks, rates)
        self.assertAlmostEqual(trade['fundingPaid'], .101)
        self.assertLess(trade['futuresNet'], 0)
        self.assertEqual(paired_trade((at, 100, 1), at+600, 100, prices, {}, {})['fundingPaid'], 0)
        self.assertIsNone(paired_trade((0, 100, 1), at, 100, prices, marks, {}))
