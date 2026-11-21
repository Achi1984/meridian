import unittest

from overnight_setup import candidate, simulate, STEP


class OvernightTest(unittest.TestCase):
    def test_breakout_uses_next_open(self):
        bars = [[t, 100, 101, 100, 100] for t in range(0, 28800, STEP)]
        self.assertIsNone(candidate(0, bars))
        bars.append([28800, 100, 103, 99, 102])
        self.assertEqual(candidate(0, bars), ('breakout', 1, 28800 + STEP))
        self.assertIsNone(candidate(0, bars[1:]))

    def test_reversal_requires_failed_extension(self):
        bars = [[t, 100, 104, 100, 104] for t in range(0, 28800, STEP)]
        self.assertIsNone(candidate(0, bars + [[28800, 104, 105, 103, 105]]))
        self.assertEqual(candidate(0, bars + [[28800, 104, 105, 102, 103]]),
                         ('reversal', -1, 28800 + STEP))

    def test_stop_charges_funding_before_exit(self):
        entry = 28800 - STEP
        prices = {entry: 100, 28800: 98}
        self.assertIsNone(simulate(1, entry, prices, {}, {}))
        account = simulate(1, entry, prices, {28800: 100}, {28800: .001})
        self.assertAlmostEqual(account.net + account.cost + account.funding, -2)
        self.assertAlmostEqual(account.funding, .1)
