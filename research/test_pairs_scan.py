import unittest
import numpy as np
from pairs_scan import estimate, validate, SYMBOLS, INTERVAL


class PairsTests(unittest.TestCase):
    def test_known_cointegration_and_no_evaluation_leak(self):
        rng = np.random.default_rng(20260914)
        x = np.cumsum(rng.normal(0, .02, 751)) + 6
        y = 1 + 1.4*x + rng.normal(0, .002, 751)
        before = estimate(y, x, 750)
        y[-1] += .1
        after = estimate(y, x, 750)
        self.assertLess(before['pAdjusted'], .01)
        self.assertAlmostEqual(before['beta'], 1.4, places=2)
        self.assertEqual(before['beta'], after['beta'])
        self.assertEqual(before['pAdjusted'], after['pAdjusted'])
        self.assertGreater(after['z'], before['z'] + 10)

    def test_independent_random_walks_rejected(self):
        rng = np.random.default_rng(42)
        x = np.cumsum(rng.normal(size=751))
        y = np.cumsum(rng.normal(size=751))
        self.assertGreater(estimate(y, x, 750)['pAdjusted'], .01)

    def test_missing_and_future_candles_rejected(self):
        rows = [[i*INTERVAL, 100+i] for i in range(751)]
        data = dict(asOf=751*INTERVAL, series={s:[r[:] for r in rows] for s in SYMBOLS})
        validate(data)
        data['asOf'] -= 1
        with self.assertRaises(ValueError): validate(data)
        data['asOf'] += 1
        data['series'][SYMBOLS[0]][12][0] += 1
        with self.assertRaises(ValueError): validate(data)

    def test_degenerate_pair_rejected(self):
        x = np.arange(751, dtype=float)
        with self.assertRaises(ValueError): estimate(2*x, x, 750)


if __name__ == '__main__': unittest.main()
