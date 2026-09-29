import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))

from high_volatility_perpetual_cross_sectional_reversal_v2 import (
    ASSETS, BASE_COST_BPS, DAY, EXPECTED_PERIODS, RULESET, STRESS_COST_BPS, WEEK,
    VolAssetData, select_weights, validation_gate
)

class FakeAsset:
    def __init__(self,formation,vol,holding=.01,funding=0.0):
        self.f=formation;self.v=vol;self.h=holding;self.fd=funding
    def formation_return(self,t):return self.f
    def formation_volatility(self,t):return self.v
    def entry_exit_return(self,t):return self.h
    def funding_sum(self,start,end):return self.fd

def daily_rows(start,n,close_fn):
    rows=[]
    for i in range(n):
        ot=start+i*DAY
        c=float(close_fn(i))
        rows.append([ot,ot+DAY-1,c,c*1.001,c*.999,c])
    return rows

def funding_rows(start,end):
    out=[];t=start+8*60*60*1000
    while t<=end:
        out.append([t,0.0]);t+=8*60*60*1000
    return out

def good_metrics(**kw):
    x={
      'periods':EXPECTED_PERIODS,'minEligibleAssets':23,'minHighVolAssets':12,'sideCounts':[2],
      'returnPct':8.0,'priceOnlyReturnPct':7.0,'profitFactor':1.3,'sharpe':.8,
      'maxDrawdownPct':12.0,'positiveWindows':4,'longContribution':.08,'shortContribution':.05,
      'positiveAssets':15,'positiveConcentrationPct':18.0,'meanLoserMinusWinnerNextWeek':.01
    }
    x.update(kw);return x

class HighVolReversalV2Tests(unittest.TestCase):
    def test_frozen_identity_and_costs(self):
        self.assertEqual(RULESET,'HIGH-VOLATILITY-PERPETUAL-CROSS-SECTIONAL-REVERSAL-V2-FROZEN')
        self.assertEqual(len(ASSETS),23)
        self.assertEqual(EXPECTED_PERIODS,86)
        self.assertEqual(BASE_COST_BPS,8.0)
        self.assertEqual(STRESS_COST_BPS,13.0)

    def test_volatility_uses_formation_window_and_excludes_skip_week(self):
        t=100*DAY
        start=t-80*DAY
        # Formation close marks t-63d..t-7d have small alternating moves.
        # Skip-week prices explode but must not change the V2 volatility estimate.
        def p1(i):
            mark=start+(i+1)*DAY
            if mark<=t-7*DAY:
                return 100.0*(1.01 if i%2 else .99)
            return 500.0 if i%2 else 50.0
        def p2(i):
            mark=start+(i+1)*DAY
            if mark<=t-7*DAY:
                return 100.0*(1.01 if i%2 else .99)
            return 5000.0 if i%2 else 5.0
        a=VolAssetData('X',daily_rows(start,90,p1),funding_rows(start,start+90*DAY))
        b=VolAssetData('Y',daily_rows(start,90,p2),funding_rows(start,start+90*DAY))
        self.assertAlmostEqual(a.formation_volatility(t),b.formation_volatility(t),places=12)

    def test_upper_half_volatility_then_same_quintile_reversal(self):
        data={}
        for i,a in enumerate(ASSETS):
            data[a]=FakeAsset(float(i),float(i+1))
        w,formation,holding,vols,high,longs,shorts=select_weights(data,0)
        self.assertEqual(len(high),12)
        self.assertEqual(set(high),set(ASSETS[11:]))
        self.assertEqual(len(longs),2)
        self.assertEqual(len(shorts),2)
        self.assertEqual(set(longs),set(ASSETS[11:13]))
        self.assertEqual(set(shorts),set(ASSETS[-2:]))
        self.assertAlmostEqual(sum(w.values()),0.0)
        self.assertAlmostEqual(sum(abs(x) for x in w.values()),1.0)

    def test_validation_gate_passes_only_complete_strong_case(self):
        r=good_metrics();s=good_metrics(returnPct=2.0)
        g=validation_gate(r,s)
        self.assertTrue(g['pass'],g['reasons'])
        self.assertEqual(g['decision'],'VALIDATION_PASS_TRANSFER_REQUIRED')

    def test_validation_gate_rejects_short_side_and_concentration(self):
        r=good_metrics(shortContribution=-.01,positiveConcentrationPct=30.0)
        s=good_metrics(returnPct=2.0)
        g=validation_gate(r,s)
        self.assertIn('SHORT_CONTRIBUTION_NOT_POSITIVE',g['reasons'])
        self.assertIn('POSITIVE_CONCENTRATION_GT_25.0',g['reasons'])

    def test_validation_gate_rejects_weak_stress_and_signal_spread(self):
        r=good_metrics(meanLoserMinusWinnerNextWeek=-.01)
        s=good_metrics(returnPct=-1.0)
        g=validation_gate(r,s)
        self.assertIn('STRESS_RETURN_NOT_POSITIVE',g['reasons'])
        self.assertIn('LOSER_MINUS_WINNER_SPREAD_NOT_POSITIVE',g['reasons'])

if __name__=='__main__':
    unittest.main()
