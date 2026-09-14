import unittest
from unittest.mock import patch

from pairs_scan import INTERVAL, SYMBOLS
from pairs_walkforward import funding_map, replay


def fixture(length=900):
    rows=[[i*INTERVAL,100+i*.01] for i in range(length)]
    return {'asOf':length*INTERVAL,'series':{s:[r[:] for r in rows] for s in SYMBOLS},
            'funding':{s:[[i*INTERVAL,.001,101.0] for i in range(0,length,2)] for s in SYMBOLS}}


class WalkForwardTests(unittest.TestCase):
    def test_no_signal_means_no_trades(self):
        with patch('pairs_walkforward.candidate',return_value=None):
            result=replay(fixture(),40)
        self.assertEqual(result['closedTrades'],0)
        self.assertFalse(result['openAtEnd'])

    def test_round_trip_cost_and_mean_exit(self):
        signal={'a':'BTCUSDT','b':'ETHUSDT','alpha':0.,'beta':1.,'scale':.01,'entryZ':3.,'signalStrength':3.}
        data=fixture()
        # Same prices yield z=0 and a mean exit on the following candle.
        with patch('pairs_walkforward.candidate',return_value=signal):
            result=replay(data,40)
        trade=result['trades'][0]
        self.assertEqual(trade['reason'],'MEAN')
        self.assertAlmostEqual(trade['costsUsd'],8.)
        self.assertAlmostEqual(trade['netPnlUsd'],-8.)

    def test_funding_requires_mark_price(self):
        data=fixture(); data['funding']['BTCUSDT']=[[1,.001]]
        with self.assertRaises((ValueError,IndexError)): funding_map(data)

    def test_short_receives_positive_funding(self):
        # Funding sign is exercised through an open at bar 750 and exit after the event.
        data=fixture(904); at=data['series']['BTCUSDT'][751][0]+INTERVAL
        data['funding']={s:[[i*INTERVAL,0.,100.] for i in range(0,904,2)] for s in SYMBOLS}
        data['funding']['BTCUSDT']=[[t,(.001 if t==at else rate),mark] for t,rate,mark in data['funding']['BTCUSDT']]
        signal={'a':'BTCUSDT','b':'ETHUSDT','alpha':0.,'beta':1.,'scale':.01,'entryZ':3.,'signalStrength':3.}
        with patch('pairs_walkforward.candidate',return_value=signal): result=replay(data,40)
        self.assertGreater(result['trades'][0]['fundingPnlUsd'],0)


if __name__=='__main__': unittest.main()
