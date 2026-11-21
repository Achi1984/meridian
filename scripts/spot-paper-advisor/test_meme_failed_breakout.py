import unittest
from meme_failed_breakout import replay


class FailedBreakoutTest(unittest.TestCase):
    def candles(self, entry):
        # 12 completed bars rise, then a wick above 105 closes back below.
        history = [(entry-3900+i*300,100,105,99,104) for i in range(12)]
        return history + [(entry-300,104,106,103,104), (entry,100,101,99,100)]

    def test_stop_executes_at_observed_gap_price(self):
        row = replay(self.candles(7200)+[(7500,104,104,104,104)])[1970]
        self.assertAlmostEqual(row['gross'], -4)
        self.assertLess(row['net'], -4)
        self.assertEqual(row['trades'], 1)

    def test_skip_hour_boundary_and_record_missing_exit(self):
        self.assertEqual(replay(self.candles(9000)), {})
        row = replay(self.candles(7200)+[(7800,103,103,103,103)])[1970]
        self.assertEqual((row['incomplete'], row['trades']), (1,0))
