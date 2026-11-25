import unittest
from breakout_signal_audit import HOUR,audit


class Audit(unittest.TestCase):
    def test_sides_clusters_missing_and_capacity(self):
        obs=[dict(slot=0,signals={
            'A':dict(side=1,close=10,rangeHigh=9,volumeRatio=1,relativeToBtc24h=.1),
            'B':dict(side=-1,close=20,rangeLow=21),
            'C':dict(side=1,close=10,rangeHigh=9)},skips=[['direct','A','entry','capacity']])]
        for n in (1,2,3):
            obs.append(dict(slot=n*HOUR,signals={'A':{'close':9 if n==1 else 11},'B':{'close':18}}))
        result=audit(obs)
        group=result['groups']['all']
        self.assertEqual((group['n'],group['positive'],group['hours'],group['backInsideOrBeyond']),(2,2,1,1))
        self.assertAlmostEqual(group['meanPct'],10)
        self.assertEqual(result['unresolved'],1)
        with self.assertRaises(ValueError):
            audit(obs+obs)
