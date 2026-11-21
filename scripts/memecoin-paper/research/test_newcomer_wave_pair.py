import unittest
from unittest.mock import Mock, patch
from newcomer_wave_pair import FEE, SIZE, Pair, summary


class WaveTest(unittest.TestCase):
    @patch('newcomer_wave_pair.emit')
    @patch('newcomer_wave_pair.flow')
    def test_recovery_only_after_observed_selling(self, flow, emit):
        flow.side_effect = [dict(netUsd=[1,-1]),dict(netUsd=[1,1],newRecentBuyers=4,largestRecentBuyerShare=.4)]
        quotes = Mock(side_effect=[100,SIZE,SIZE-100,SIZE+100,98,SIZE,SIZE+1000,SIZE+500])
        fetch = lambda url,age: {'data':[]}
        s = Pair(dict(mint='m',pool='p',quote='q'))
        for i in range(4):
            s.tick(i,i==3,quotes,fetch)
        self.assertEqual(s.positions['wave'],[98,500-2*FEE])
        self.assertEqual(s.positions['early'],[100,1000-2*FEE])

    def test_unresolved_is_counted_at_cost(self):
        s = Pair({})
        s.positions['early'] = [100,None]
        self.assertEqual(summary([s],'early')['equityIfUnresolvedWorthZero'],979.95)
        self.assertEqual(summary([s],'wave')['entries'],0)
