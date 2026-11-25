import unittest
from btc_eth_relative_breakout import HOUR,study


class RelativeBreakout(unittest.TestCase):
    def test_later_open_and_equal_notionals(self):
        btc={i*HOUR:(100,100) for i in range(-25,8)}
        eth=btc.copy()
        eth[-HOUR]=(90,110)
        eth[HOUR]=(120,119)
        eth[7*HOUR]=(132,132)
        r=study(btc,eth,0,6*HOUR)
        self.assertEqual(r['signals'],1)
        self.assertEqual(r['trades'][0]['long'],'ETH')
        self.assertAlmostEqual(r['meanGrossPct'],5)
        self.assertAlmostEqual(r['meanAfterModeledCostsPct'],4.7)

    def test_no_ratio_breakout(self):
        bars={i*HOUR:(100,100) for i in range(-25,8)}
        self.assertEqual(study(bars,bars,0,6*HOUR)['signals'],0)
