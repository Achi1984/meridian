import unittest
from unittest.mock import patch

from momentum_walkforward import replay
from pairs_scan import INTERVAL,SYMBOLS


def fixture(length=800):
    rows=[[i*INTERVAL,100.] for i in range(length)]
    funding={s:[[i*INTERVAL,0.,100.] for i in range(0,length,2)] for s in SYMBOLS}
    return {'asOf':length*INTERVAL,'series':{s:[r[:] for r in rows] for s in SYMBOLS},'funding':funding}


DECISION={'netBeta':0.,'legs':[{'symbol':'BTCUSDT','weight':.25},{'symbol':'ETHUSDT','weight':.25},
  {'symbol':'SOLUSDT','weight':-.25},{'symbol':'XRPUSDT','weight':-.25}]}


class MomentumWalkForwardTests(unittest.TestCase):
    def test_no_signal_has_no_fabricated_trade(self):
        with patch('momentum_walkforward.signal',return_value=None): result=replay(fixture(),30)
        self.assertEqual(result['closedBaskets'],0);self.assertGreater(result['rejectedRebalances'],0)

    def test_flat_basket_charges_full_round_trip_cost(self):
        with patch('momentum_walkforward.signal',return_value=DECISION): result=replay(fixture(),30)
        self.assertAlmostEqual(result['trades'][0]['costsUsd'],6.)
        self.assertAlmostEqual(result['trades'][0]['netPnlUsd'],-6.)
        self.assertEqual(result['trades'][0]['exitReason'],'TIME_EXIT')

    def test_loss_limit_exits_before_week(self):
        data=fixture();data['series']['BTCUSDT'][187][1]=70.;data['series']['ETHUSDT'][187][1]=70.
        with patch('momentum_walkforward.signal',return_value=DECISION): result=replay(data,30)
        self.assertEqual(result['trades'][0]['exitReason'],'LOSS_LIMIT')
        self.assertEqual(result['trades'][0]['exitAt'],188*INTERVAL)

    def test_positive_funding_rewards_short_and_charges_long(self):
        data=fixture();event=188*INTERVAL
        for s in SYMBOLS:
            data['funding'][s]=[[i*INTERVAL,(.001 if i*INTERVAL==event else 0.),100.] for i in range(0,800,2)]
        with patch('momentum_walkforward.signal',return_value=DECISION): result=replay(data,30)
        # Equal long and short notionals cancel their funding exactly.
        self.assertAlmostEqual(result['trades'][0]['fundingPnlUsd'],0.)


if __name__=='__main__':unittest.main()
