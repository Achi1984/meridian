import unittest
from unittest.mock import patch
from breakout_indicators import HOUR, bandwidth, flags, indicator_values, wilder_rsi
from top100_paper import bars_for


class Indicators(unittest.TestCase):
    def test_rsi(self):
        self.assertEqual(wilder_rsi([5]*120),50)
        self.assertEqual(wilder_rsi(list(range(120))),100)
        self.assertEqual(wilder_rsi(list(reversed(range(120)))),0)
        self.assertEqual(bandwidth([20]*20),0)

    def test_no_future_close_and_direction(self):
        closes={i*HOUR:100+i*.2 for i in range(120)}
        s={'side':1,'rangeHigh':122,'rangeLow':112}
        v=indicator_values(closes,120*HOUR,s)
        self.assertAlmostEqual(v['extension'],.18)
        closes[120*HOUR]=999
        self.assertEqual(v,indicator_values(closes,120*HOUR,s))
        self.assertFalse(flags(v,1)['RSI not extended'])
        self.assertTrue(flags(v,1)['before Fib 1.272'])

    @patch('top100_paper.ok')
    def test_short_history_preserves_breakout(self, api):
        rows=[[str(i*HOUR*1000),'10','11','9','10','10','1'] for i in range(25)]
        rows[-1][2:5]=['13','9','12']
        api.return_value=rows
        _,s=bars_for(('test',25*HOUR))
        self.assertEqual(s['side'],1)
        self.assertIn('indicatorStatus',s)
