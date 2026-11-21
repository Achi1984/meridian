import unittest
from unittest.mock import patch
from newcomer_wave_pair import scan


class DiscoveryTest(unittest.TestCase):
    @patch('newcomer_wave_pair.time.time',return_value=180)
    @patch('newcomer_wave_pair.snapshot',side_effect=lambda x:x)
    @patch('newcomer_wave_pair.get')
    @patch('newcomer_wave_pair.discover')
    def test_refresh_after_pool_leaves_listing(self, discover, fetch, snapshot, clock):
        row = dict(pool='p',mint='m',quote='q',created='1970-01-01T00:00:00Z',dex='pumpswap',
                   liquidity=6000,volume=200,buys=4,sells=3)
        discover.side_effect = [[row],[],[]]
        fetch.side_effect = [dict(data=[dict(row,buys=7)]),dict(data=[dict(row,mint='different',buys=10)])]
        watch = {}
        self.assertEqual(scan(watch),[])
        self.assertEqual(scan(watch),[dict(row,buys=7)])
        self.assertEqual(scan({'p':('m','q')}),[])

    @patch('newcomer_wave_pair.emit')
    @patch('newcomer_wave_pair.flow')
    def test_wave_can_enter_after_cost_rejection(self, flow, emit):
        from unittest.mock import Mock
        from newcomer_wave_pair import Pair, SIZE
        s = Pair(dict(mint='m',pool='p',quote='q'))
        flow.side_effect = [dict(netUsd=[0,-10]),dict(netUsd=[0,10],newRecentBuyers=4,largestRecentBuyerShare=.4)]
        quote = Mock(side_effect=[100,.9*SIZE,.85*SIZE,.96*SIZE,99,.98*SIZE])
        for i in range(3):
            s.tick(i,False,quote,lambda *args:{'data':[]})
        self.assertNotIn('early',s.positions)
        self.assertIn('wave',s.positions)

    @patch('newcomer_wave_pair.emit')
    @patch('newcomer_wave_pair.time.time')
    def test_triple_recheck_is_not_a_second_exit(self, clock, emit):
        from unittest.mock import Mock
        from newcomer_wave_pair import Pair, SIZE, FEE
        pair = Pair(dict(mint='m',pool='p'))
        pair.reference_qty = 100
        pair.positions['wave'] = [100,None]
        clock.return_value = 1000
        quote = Mock(side_effect=[3*SIZE+2*FEE,2*SIZE])
        pair.tick(1,False,quote)
        clock.return_value = 1060
        pair.tick(2,True,quote)
        self.assertEqual(pair.positions['wave'][1],2*SIZE)
        self.assertEqual(emit.call_args.args[0],'tripleRecheck')
        self.assertFalse(emit.call_args.kwargs['stillTriple'])
