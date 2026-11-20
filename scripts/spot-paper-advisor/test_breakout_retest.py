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

        for key, entry_price in [('original', 103), ('confirmed', 102)]:
            arm = report['arms'][key]
            buy = entry_price * 1.0001 * 1.0005
            sell = 97 * .9999 * .9995
            expected = 10000 * (sell - buy) / (buy + sell)
            self.assertAlmostEqual(arm['breakEvenSlippageBpsPerSide'], expected)
            self.assertLess(arm['net'], arm['netZeroSlippage'])

    def test_no_trades_have_no_slippage_threshold(self):
        with patch('breakout_retest.load_market', return_value=({}, {}, {})), patch('breakout_retest.candles', return_value=[]):
            report = evaluate(['fixture'], None)
        for arm in report['arms'].values():
            self.assertIsNone(arm['breakEvenSlippageBpsPerSide'])
            self.assertEqual(arm['slippageCostPerBp'], 0)

    def test_opening_direction_uses_first_hour_only(self):
        for first_close, qualifies in [(99, False), (100, False), (101, True)]:
            with self.subTest(first_close=first_close):
                bars = [[i*STEP, 100, 101, 99, 100] for i in range(6)]
                bars[-1][4] = first_close
                bars.extend([[6*STEP, 100, 103, 99, 102],
                             [7*STEP, 103, 104, 97, 98],
                             [8*STEP, 97, 99, 96, 98]])
                prices = {b[0]: b[1] for b in bars}
                boundaries = dict.fromkeys(range(0, DAY, 8*3600), 100)
                market = prices, boundaries, dict.fromkeys(boundaries, 0)
                with patch('breakout_retest.load_market', return_value=market), patch('breakout_retest.candles', return_value=bars):
                    report = evaluate(['fixture'], None, bullish_opening_hour=True)
                trade, = report['events']
                self.assertEqual(report['arms']['bullishOpeningHour']['closed'], int(qualifies))
                if qualifies:
                    self.assertEqual(trade['bullishOpeningHour'], trade['original'])
                else:
                    self.assertNotIn('bullishOpeningHour', trade)
