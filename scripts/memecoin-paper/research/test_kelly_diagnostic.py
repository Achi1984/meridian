import unittest
from kelly_diagnostic import SIZE, quarter_kelly, score


class KellyDiagnosticTests(unittest.TestCase):
    def test_even_odds_known_optimum(self):
        self.assertAlmostEqual(quarter_kelly([1, 1, 1, -1]), .125)

    def test_nonpositive_and_empty(self):
        self.assertIsNone(quarter_kelly([]))
        self.assertEqual(quarter_kelly([1, -1.005]), 0)
        self.assertEqual(score([SIZE], 1)['quarterWithoutBestAndZeroRecovery'], 0)

    def test_removing_one_winner_and_stressing_inventory(self):
        result = score([SIZE, SIZE//2, -SIZE//4], 1)
        self.assertGreater(result['quarterWithoutBest'], 0)
        self.assertEqual(result['quarterWithoutBestAndZeroRecovery'], 0)
        self.assertAlmostEqual(quarter_kelly([.1]), .25)
