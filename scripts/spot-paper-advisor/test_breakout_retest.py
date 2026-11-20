import unittest
from unittest.mock import patch
from breakout_retest import evaluate
from worker import DAY, STEP


class RetestTest(unittest.TestCase):
    def test_confirmation_fills_next_open_and_shares_original_exit(self):
        bars = [[i*STEP, 100, 101, 99, 100] for i in range(6)]
        bars += [[6*STEP, 100, 103, 99, 102], [7*STEP, 103, 104, 100, 102],
                 [8*STEP, 102, 103, 97, 98], [9*STEP, 97, 99, 96, 98]]
        prices = {b[0]: b[1] for b in bars}
        boundaries = dict.fromkeys(range(0, DAY, 8*3600), 100)
        with patch('breakout_retest.load_market', return_value=(prices, boundaries, boundaries)), patch('breakout_retest.candles', return_value=bars):
            report = evaluate(['fixture'], None)
        trade, = report['events']
        self.assertEqual((trade['original']['entry'], trade['confirmed']['entry'], trade['exit']),
                         (7*STEP, 8*STEP, 9*STEP))
        self.assertEqual(report['improvedEntries'], 1)
