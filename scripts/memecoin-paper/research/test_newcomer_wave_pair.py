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
        with patch('newcomer_wave_pair.time.monotonic') as clock:
            for i,at in enumerate([0,60,120,720]):
                clock.return_value = at
                s.tick(i,i==3,quotes,fetch)
        self.assertEqual(s.positions['wave'],[98,500-2*FEE])
        self.assertEqual(s.positions['early'],[100,1000-2*FEE])

    def test_unresolved_is_counted_at_cost(self):
        s = Pair({})
        s.positions['early'] = [100,None]
        self.assertEqual(summary([s],'early')['equityIfUnresolvedWorthZero'],979.95)
        self.assertEqual(summary([s],'wave')['entries'],0)

    @patch('newcomer_wave_pair.emit')
    @patch('newcomer_wave_pair.time.monotonic')
    def test_each_arm_has_its_own_deadline(self, clock, emit):
        s = Pair(dict(mint='m'))
        s.reference_qty = 1
        s.positions = {'early':[1,None],'wave':[2,None]}
        s.opened_at = {'early':0,'wave':540}
        clock.return_value = 600
        s.tick(10,False,Mock(return_value=SIZE))
        self.assertEqual(s.positions['early'][1],-2*FEE)
        self.assertIsNone(s.positions['wave'][1])
        clock.return_value = 1140
        s.tick(19,False,Mock(return_value=SIZE))
        self.assertEqual(s.positions['wave'][1],-2*FEE)

    @patch('newcomer_wave_pair.emit')
    @patch('newcomer_wave_pair.time.monotonic',return_value=721)
    def test_late_quote_remains_unpriced(self, clock, emit):
        s = Pair(dict(mint='m'))
        s.reference_qty = 1
        s.positions = {'wave':[2,None]}
        s.opened_at = {'wave':0}
        s.tick(12,False,Mock(return_value=3*SIZE))
        self.assertEqual(summary([s],'wave')['unresolved'],1)
