import unittest
from kelly_diagnostic import chronological_check, SIZE, quarter_kelly, score


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

    def test_cutoff_freezes_fraction_and_excludes_repeated_mint(self):
        def session(at, mint, closed):
            position = dict(mint=mint, arm='early', qty=5)
            rows = [dict(event='cohortSelection', mint=mint, band='strong', entryLiquidityUsd=30000),
                    dict(event='cohort', mints=[mint], holdingPolicy='tenMinutesFromEntry'),
                    dict(event='entry', usdc=20, **position),
                    dict(event='resaleMark', tick=0, usdcRaw=21100000, **position)]
            if closed:
                rows.append(dict(event='exit', netUsdc=1, usdcRaw=21100000, **position))
            rows.extend([dict(event='summary', arm='early', entries=1, closed=int(closed),
                              unresolved=int(not closed)),
                         dict(event='summary', arm='wave', entries=0, closed=0, unresolved=0)])
            return [dict(row, at=at+i) for i, row in enumerate(rows)]

        runs = [session(10,'a',True), session(20,'b',True), session(30,'a',True), session(40,'c',False)]
        arms = chronological_check(runs[::-1], 30)['arms']
        self.assertAlmostEqual(arms['early']['frozenFraction'], .25)
        self.assertEqual(arms['early']['laterClosed'], 0)
        self.assertEqual(arms['early']['laterZeroRecoveryNetUsdc'], -20.05)
        self.assertLess(arms['early']['meanStressLogGrowthPerEntry'], 0)
        self.assertIsNone(arms['wave']['meanStressLogGrowthPerEntry'])
        with self.assertRaisesRegex(ValueError, 'overlaps'):
            chronological_check(runs, 31)
        with self.assertRaisesRegex(ValueError, 'both sides'):
            chronological_check(runs, 90)
