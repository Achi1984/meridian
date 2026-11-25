import unittest
from unittest.mock import patch
from top100_paper import HOUR, features, retest, fill, D


class Rules(unittest.TestCase):
    def test_range_excludes_signal_and_unclosed_candle(self):
        rows=[[str(i*HOUR*1000),'10','11','9','10','100','1'] for i in range(25)]
        rows[-1][2:5]=['13','9','12']
        rows.append([str(25*HOUR*1000),'12','100','1','2','100','0'])
        f=features(rows,25*HOUR)
        self.assertEqual((f['side'],f['rangeHigh'],f['rangeLow']),(1,11,9))
        with self.assertRaises(KeyError):
            features(rows[1:],25*HOUR)

    def test_retests(self):
        for sign,close in ((1,11),(-1,9)):
            p=dict(slot=HOUR,level=10,side=sign)
            f=dict(high=12,low=8,close=close)
            self.assertTrue(retest(f,p,2*HOUR))
            self.assertFalse(retest(f,p,HOUR))
            self.assertFalse(retest(f,p,5*HOUR))
            self.assertFalse(retest(dict(f,close=10),p,2*HOUR))

    @patch('top100_paper.time.time',return_value=10.)
    @patch('top100_paper.ok')
    def test_book_and_depth(self,api,clock):
        api.return_value=[dict(ts='9900',asks=[['101','30']],bids=[['100','30']])]
        spec=['1','1','.01','.01']
        self.assertGreater(D(fill('x',spec,True,9)['price']),101)
        self.assertLess(D(fill('x',spec,False,9)['price']),100)
        with self.assertRaises(ValueError):
            fill('x',spec,False,9,D(31))
