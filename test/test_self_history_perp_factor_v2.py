import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))

from self_history_perp_factor_v2 import (
    AssetData, BASE_COST_BPS, FOUR_H, FUND_MAX_GAP, OWN_HISTORY_WEEKS,
    cross_section_weights, empirical_percentile, evaluate_book,
    own_history_weights, _terminal_close
)

def bars(n,start=0,price=100.0):
    out=[]
    p=price
    for i in range(n):
        ot=start+i*FOUR_H
        c=p*(1.0001 if i%2==0 else .9999)
        out.append([ot,ot+FOUR_H-1,p,max(p,c)*1.001,min(p,c)*.999,c])
        p=c
    return out

def premium(n,start=0):
    return [[start+i*FOUR_H,start+(i+1)*FOUR_H-1,0.0002*((i%5)-2)] for i in range(n)]

def funding(n,start=0,step=8*60*60*1000,rate=.0001):
    return [[start+i*step,rate] for i in range(n)]

class SelfHistoryV2Tests(unittest.TestCase):
    def test_empirical_percentile_uses_exact_prior_52(self):
        h=list(range(OWN_HISTORY_WEEKS))
        self.assertEqual(empirical_percentile(h,51),1.0)
        self.assertEqual(empirical_percentile(h,-1),0.0)
        with self.assertRaises(ValueError):
            empirical_percentile(h[:-1],10)

    def test_cross_section_is_dollar_neutral_and_deterministic(self):
        values={f'A{i}':float(i) for i in range(10)}
        w=cross_section_weights(values,False)
        self.assertAlmostEqual(sum(w.values()),0.0)
        self.assertAlmostEqual(sum(abs(x) for x in w.values()),1.0)
        self.assertEqual(set(a for a,x in w.items() if x>0),{'A8','A9'})
        self.assertEqual(set(a for a,x in w.items() if x<0),{'A0','A1'})

    def test_own_history_thresholds_require_both_sides(self):
        p={'A':.95,'B':.85,'C':.10,'D':.15,'E':.5}
        w=own_history_weights(p,False)
        self.assertAlmostEqual(sum(w.values()),0.0)
        self.assertEqual(set(a for a,x in w.items() if x>0),{'A','B'})
        self.assertEqual(set(a for a,x in w.items() if x<0),{'C','D'})
        self.assertEqual(own_history_weights({'A':.9,'B':.1},False),{})

    def test_funding_cashflow_sign_rewards_short_when_funding_positive(self):
        n=100
        d=AssetData('X',bars(n),premium(n),funding(60,rate=.001))
        t=7*24*60*60*1000
        end=t+7*24*60*60*1000
        long=evaluate_book({'X':d},{'X':.5},{},t,0)
        short=evaluate_book({'X':d},{'X':-.5},{},t,0)
        self.assertLess(long['funding'],0)
        self.assertGreater(short['funding'],0)
        self.assertAlmostEqual(long['funding'],-short['funding'])

    def test_turnover_cost_and_terminal_close_are_fully_charged(self):
        n=100
        d=AssetData('X',bars(n),premium(n),funding(60,rate=0.0))
        t=7*24*60*60*1000
        r=evaluate_book({'X':d},{'X':.5},{},t,BASE_COST_BPS)
        self.assertAlmostEqual(r['turnover'],.5)
        self.assertAlmostEqual(r['cost'],.5*BASE_COST_BPS/10000)
        tr,cost,attr=_terminal_close({'X':.5},['X'],BASE_COST_BPS)
        self.assertAlmostEqual(tr,.5)
        self.assertAlmostEqual(cost,.5*BASE_COST_BPS/10000)
        self.assertAlmostEqual(attr['X'],-cost)

    def test_kline_gap_fails_closed(self):
        k=bars(10)
        k.pop(4)
        with self.assertRaisesRegex(ValueError,'KLINE_GAP'):
            AssetData('X',k,premium(10),funding(10,rate=0))

    def test_funding_gap_fails_closed(self):
        f=[[0,0.0],[8*60*60*1000,0.0],[30*60*60*1000,0.0]]
        with self.assertRaisesRegex(ValueError,'FUNDING_GAP'):
            AssetData('X',bars(20),premium(20),f)

if __name__=='__main__':
    unittest.main()
