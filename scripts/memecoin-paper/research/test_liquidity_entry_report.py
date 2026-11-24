import unittest
from liquidity_entry_report import realized, select_arm, summarize


class LiquidityEntryTests(unittest.TestCase):
    def test_frozen_threshold_and_missing_liquidity(self):
        self.assertEqual(select_arm(19999.99), 'wave')
        self.assertEqual(select_arm(20000), 'early')
        for value in (True, float('nan'), None, -1):
            with self.assertRaises(ValueError):
                select_arm(value)

    def test_flat_cash_is_distinct_from_unpriced_inventory(self):
        skipped = dict(state='noEntryWithGap', marks=0)
        open_sale = dict(state='unresolved', zeroRecoveryNetUsdc=-20.05,
                         marks=1, sampledDrawdownUsdc=0.9)
        self.assertEqual(realized(skipped), 0)
        self.assertIsNone(realized(open_sale))
        totals = summarize([skipped, open_sale])
        self.assertEqual(totals['states'], {'noEntryWithGap': 1, 'unresolved': 1})
        self.assertEqual(totals['zeroRecoveryUsdc'], -20.05)
        self.assertEqual(totals['realizedUsdc'], 0)
