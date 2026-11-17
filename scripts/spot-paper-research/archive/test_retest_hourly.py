import unittest
from retest_hourly import signals, date, D


class SessionTest(unittest.TestCase):
    def test_confirmation_fill_and_cutoff(self):
        start, end = date(2018,1,1), date(2018,1,2)
        t = 1514764800
        candles = {t+3600*h:(95,100,96,99) for h in range(-24,19)}
        candles[t+5*3600]=(99,103,100,101)
        candles[t+6*3600]=(99,106,102,105)
        candles[t+7*3600]=(102,105,104,103)
        self.assertEqual(signals(candles,start,end)[0],[(start,102,104,96)])
        for h in range(6,17):
            candles[t+h*3600]=(102,106,104,105)
        candles[t+17*3600]=(98,105,102,104)
        self.assertIsNone(signals(candles,start,end)[0][0][2])
        del candles[t+6*3600]
        self.assertEqual(signals(candles,start,end),([],[str(start)]))
