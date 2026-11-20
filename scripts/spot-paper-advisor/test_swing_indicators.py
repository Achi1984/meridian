import unittest

from swing_indicators import DailyIndicators, EMA


class SwingIndicatorTests(unittest.TestCase):
    def test_ema_sma_seed_and_recursive_update(self):
        ema = EMA(3)
        self.assertEqual([ema.update(x) for x in (1, 2, 3, 8)], [None, None, 2, 5])

    def test_flat_warmup_prior_range_and_rsi_direction(self):
        model = DailyIndicators()
        for i in range(35):
            model.update(100., (90, 110))
        self.assertEqual(list(model.targets(1).values()), [0]*6)
        # Today's extreme cannot move the range used for today's close.
        model.update(103., (89, 200))
        self.assertEqual(model.votes, dict(momentum=1, rsi=1, macd=1, fib=1))
        self.assertEqual(model.targets(-1)['trendThreeOfFour'], 0)
        model.update(None, None)
        self.assertEqual(list(model.targets(1).values()), [0]*6)

    def test_incomplete_range_abstains_and_three_votes_can_be_bearish(self):
        model = DailyIndicators()
        for i in range(40):
            model.update(100., None)
        model.update(95., (95, 100))
        self.assertEqual(model.votes['fib'], 0)
        self.assertEqual(model.targets(-1)['trendThreeOfFour'], -1)
