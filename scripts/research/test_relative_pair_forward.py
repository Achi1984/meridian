import unittest
from relative_pair_forward import select


class PairTests(unittest.TestCase):
    def test_relative_rank_and_direction(self):
        s={i:dict(side=d,return24h=r) for i,d,r in [('BTC-USDT-SWAP',0,.1),('A',1,.3),('B',1,.2),('C',-1,-.7)]}
        self.assertEqual(select(s)[1],[('A',1),('B',-1)])
        s['B']['return24h']=.3
        self.assertEqual(select(s)[1],[])
        del s['A']['return24h']
        with self.assertRaises(ValueError):select(s)
