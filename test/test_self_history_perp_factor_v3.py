import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))

from self_history_perp_factor_v3 import (
    AssetData, FOUR_H, WEEK, FACTORS, HISTORY_MAX_WEEKS, OWN_HISTORY_WEEKS,
    _factor_snapshot, empirical_percentile, cross_section_weights,
    own_history_weights, evaluate_book
)

def bars(n,start=0,price=100.0):
    out=[];p=price
    for i in range(n):
        ot=start+i*FOUR_H
        c=p*(1.0002 if i%2==0 else .9998)
        out.append([ot,ot+FOUR_H-1,p,max(p,c)*1.001,min(p,c)*.999,c])
        p=c
    return out

def premium(n,start=0):
    return [[start+i*FOUR_H,start+(i+1)*FOUR_H-1,0.0001*((i%7)-3)] for i in range(n)]

def funding(n,start=0,step=8*60*60*1000,rate=.0001):
    return [[start+i*step,rate] for i in range(n)]

class SelfHistoryV3Tests(unittest.TestCase):
    def test_sparse_historical_kline_gap_is_preserved_not_global_failure(self):
        k=bars(100)
        missing=k.pop(20)
        d=AssetData('X',k,premium(100),funding(80))
        missing_anchor=missing[0]+FOUR_H
        self.assertIsNone(d.price_at(missing_anchor))
        self.assertIsNotNone(d.price_at(k[10][0]+FOUR_H))

    def test_sparse_premium_gap_makes_only_required_window_unavailable(self):
        p=premium(100)
        p.pop(20)
        d=AssetData('X',bars(100),p,funding(80))
        # anchor after 42 bars includes the removed openTime in its prior 7d window
        t=42*FOUR_H
        self.assertIsNone(d.premium_factor(t))

    def test_52_valid_of_prior_60_is_accepted(self):
        t=100*WEEK
        panel={'A':{f:{} for f in FACTORS}}
        f='MOMENTUM_12W'
        panel['A'][f][t]=1.0
        # 60 prior anchors, exactly 8 missing -> 52 valid
        for k in range(1,HISTORY_MAX_WEEKS+1):
            if k<=8:continue
            panel['A'][f][t-k*WEEK]=float(k)
        values,pcts=_factor_snapshot(panel,['A'],f,t)
        self.assertIn('A',values)
        self.assertIn('A',pcts)

    def test_51_valid_of_prior_60_is_unavailable(self):
        t=100*WEEK
        panel={'A':{f:{} for f in FACTORS}}
        f='MOMENTUM_12W'
        panel['A'][f][t]=1.0
        for k in range(1,HISTORY_MAX_WEEKS+1):
            if k<=9:continue
            panel['A'][f][t-k*WEEK]=float(k)
        values,pcts=_factor_snapshot(panel,['A'],f,t)
        self.assertNotIn('A',values)
        self.assertNotIn('A',pcts)

    def test_ranking_books_remain_dollar_neutral(self):
        vals={f'A{i}':float(i) for i in range(9)}
        x=cross_section_weights(vals,False)
        self.assertAlmostEqual(sum(x.values()),0.0)
        self.assertAlmostEqual(sum(abs(v) for v in x.values()),1.0)
        p={f'A{i}':(.9 if i<2 else .1 if i<4 else .5) for i in range(9)}
        o=own_history_weights(p,False)
        self.assertAlmostEqual(sum(o.values()),0.0)
        self.assertAlmostEqual(sum(abs(v) for v in o.values()),1.0)

    def test_active_holding_funding_gap_still_fails_closed(self):
        k=bars(120)
        p=premium(120)
        # strict ordering but a >12h gap around the holding interval
        f=[[0,0.0],[8*60*60*1000,0.0],[16*60*60*1000,0.0],
           [40*60*60*1000,0.0],[48*60*60*1000,0.0],
           [56*60*60*1000,0.0],[64*60*60*1000,0.0],
           [72*60*60*1000,0.0],[80*60*60*1000,0.0],
           [88*60*60*1000,0.0],[96*60*60*1000,0.0],
           [104*60*60*1000,0.0],[112*60*60*1000,0.0],
           [120*60*60*1000,0.0],[128*60*60*1000,0.0],
           [136*60*60*1000,0.0],[144*60*60*1000,0.0],
           [152*60*60*1000,0.0],[160*60*60*1000,0.0],
           [168*60*60*1000,0.0],[176*60*60*1000,0.0],
           [184*60*60*1000,0.0],[192*60*60*1000,0.0],
           [200*60*60*1000,0.0],[208*60*60*1000,0.0],
           [216*60*60*1000,0.0],[224*60*60*1000,0.0],
           [232*60*60*1000,0.0],[240*60*60*1000,0.0],
           [248*60*60*1000,0.0],[256*60*60*1000,0.0],
           [264*60*60*1000,0.0],[272*60*60*1000,0.0],
           [280*60*60*1000,0.0],[288*60*60*1000,0.0],
           [296*60*60*1000,0.0],[304*60*60*1000,0.0],
           [312*60*60*1000,0.0],[320*60*60*1000,0.0],
           [328*60*60*1000,0.0],[336*60*60*1000,0.0]]
        d=AssetData('X',k,p,f)
        t=16*60*60*1000
        with self.assertRaisesRegex(ValueError,'holding funding coverage'):
            evaluate_book({'X':d},{'X':.5},{},t,0)

if __name__=='__main__':
    unittest.main()
