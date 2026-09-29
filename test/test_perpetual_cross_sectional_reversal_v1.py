import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))

from perpetual_cross_sectional_reversal_v1 import (
    ASSETS, BASE_COST_BPS, DAY, DISCOVERY_EXPECTED_PERIODS, DISCOVERY_GATE,
    FUND_MAX_GAP, RULESET, STRESS_COST_BPS, WEEK, AssetData,
    discovery_gate, funding_coverage, select_weights, turnover, _terminal
)

class FakeAsset:
    def __init__(self,formation,holding=.01,funding=.0):
        self._formation=formation;self._holding=holding;self._funding=funding
    def formation_return(self,t):return self._formation
    def entry_exit_return(self,t):return self._holding
    def funding_sum(self,start,end):return self._funding

def daily_rows(start,n,close_fn=None):
    out=[]
    for i in range(n):
        ot=start+i*DAY
        c=float(close_fn(i) if close_fn else 100+i*.1)
        o=c
        out.append([ot,ot+DAY-1,o,o*1.001,o*.999,c])
    return out

def funding_rows(start,end,rate=.0001):
    out=[];t=start+8*60*60*1000
    while t<=end:
        out.append([t,rate]);t+=8*60*60*1000
    return out

def good_metrics(**kw):
    base={
      'periods':DISCOVERY_EXPECTED_PERIODS,'minEligibleAssets':23,
      'returnPct':10.0,'priceOnlyReturnPct':8.0,'profitFactor':1.4,'sharpe':1.0,
      'maxDrawdownPct':8.0,'positiveWindows':5,'longContribution':.1,'shortContribution':.08,
      'positiveAssets':18,'positiveConcentrationPct':12.0,'meanLoserMinusWinnerNextWeek':.02
    }
    base.update(kw);return base

class ReversalV1Tests(unittest.TestCase):
    def test_frozen_identity_and_costs(self):
        self.assertEqual(RULESET,'PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-FROZEN')
        self.assertEqual(len(ASSETS),23)
        self.assertEqual(BASE_COST_BPS,8.0)
        self.assertEqual(STRESS_COST_BPS,13.0)
        self.assertEqual(DISCOVERY_EXPECTED_PERIODS,51)

    def test_formation_excludes_immediately_preceding_skip_week(self):
        t=100*DAY
        start=t-80*DAY
        # mark at t-63d is row close ending t-63d; mark at t-7d is separate.
        def price(i):
            mark=start+(i+1)*DAY
            if mark<=t-63*DAY:return 100
            if mark<=t-7*DAY:return 90
            return 250  # huge move in skipped week must not alter formation return
        rows=daily_rows(start,90,price)
        f=funding_rows(start,start+90*DAY,0)
        a=AssetData('X',rows,f)
        self.assertAlmostEqual(a.formation_return(t),-.10,places=10)

    def test_quintile_selection_is_bottom4_long_top4_short_for_23_assets(self):
        data={a:FakeAsset(float(i)) for i,a in enumerate(ASSETS)}
        w,values,holding,longs,shorts=select_weights(data,0)
        self.assertEqual(len(longs),4)
        self.assertEqual(len(shorts),4)
        self.assertEqual(set(longs),set(ASSETS[:4]))
        self.assertEqual(set(shorts),set(ASSETS[-4:]))
        self.assertAlmostEqual(sum(w.values()),0.0)
        self.assertAlmostEqual(sum(abs(x) for x in w.values()),1.0)
        self.assertTrue(all(w[a]>0 for a in longs))
        self.assertTrue(all(w[a]<0 for a in shorts))

    def test_funding_coverage_requires_no_boundary_or_internal_gap_over_12h(self):
        h=60*60*1000
        self.assertTrue(funding_coverage([8*h,16*h,24*h],0,24*h))
        self.assertFalse(funding_coverage([13*h,21*h],0,24*h))
        self.assertFalse(funding_coverage([8*h],0,24*h))

    def test_turnover_and_terminal_close_charge_actual_weight_changes(self):
        prev={'ADA':.25,'DOGE':-.25}
        new={'ADA':.10,'LINK':.20,'DOGE':-.10,'DOT':-.20}
        tr=turnover(prev,new)
        self.assertAlmostEqual(tr,.70)
        ttr,cost,attr=_terminal(new,BASE_COST_BPS)
        self.assertAlmostEqual(ttr,.60)
        self.assertAlmostEqual(cost,.60*BASE_COST_BPS/10000)
        self.assertAlmostEqual(sum(attr.values()),-cost)

    def test_discovery_gate_rejects_weak_economics_and_signal_direction(self):
        r=good_metrics(returnPct=-1,meanLoserMinusWinnerNextWeek=-.01)
        s=good_metrics(returnPct=-2)
        g=discovery_gate(r,s)
        self.assertFalse(g['pass'])
        self.assertIn('RETURN_NOT_POSITIVE',g['reasons'])
        self.assertIn('STRESS_RETURN_NOT_POSITIVE',g['reasons'])
        self.assertIn('LOSER_MINUS_WINNER_SPREAD_NOT_POSITIVE',g['reasons'])

    def test_discovery_gate_passes_only_complete_strong_case(self):
        r=good_metrics()
        s=good_metrics(returnPct=3)
        g=discovery_gate(r,s)
        self.assertTrue(g['pass'],g['reasons'])
        self.assertEqual(g['decision'],'DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED')

if __name__=='__main__':
    unittest.main()
