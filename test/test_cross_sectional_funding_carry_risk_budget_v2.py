import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))

from cross_sectional_funding_carry_risk_budget_v2 import (
    ASSETS, FOUR_H, GATE, TARGET_ANNUAL_VOL,
    factor_snapshot, pre_risk_weights, risk_budget, validation_gate
)

class PriceData:
    def __init__(self, prices):
        self.prices=prices
    def price_at(self,t):
        return self.prices.get(t)

def price_series(t,amp=0.01):
    start=t-28*24*60*60*1000
    out={}
    p=100.0
    for i in range(169):
        at=start+i*FOUR_H
        if i:
            p*=math.exp(amp if i%2 else -amp*.8)
        out[at]=p
    return out

def good_metrics(**overrides):
    base={
      'periods':178,'activeWeeks':150,'returnPct':30.0,'priceOnlyReturnPct':20.0,
      'fundingContribution':.12,'profitFactor':1.3,'sharpe':1.0,'maxDrawdownPct':12.0,
      'positiveWindows':4,'longContribution':.12,'shortContribution':.10,
      'positiveAssets':6,'positiveConcentrationPct':25.0,'meanGrossExposure':.6
    }
    base.update(overrides)
    return base

class RiskBudgetV2Tests(unittest.TestCase):
    def test_top2_bottom2_are_equal_weight_and_dollar_neutral(self):
        values={a:float(i) for i,a in enumerate(ASSETS)}
        w=pre_risk_weights(values)
        self.assertEqual(len([x for x in w.values() if x>0]),2)
        self.assertEqual(len([x for x in w.values() if x<0]),2)
        self.assertTrue(all(abs(abs(x)-.25)<1e-12 for x in w.values()))
        self.assertAlmostEqual(sum(w.values()),0.0)
        self.assertAlmostEqual(sum(abs(x) for x in w.values()),1.0)

    def test_breadth_below_six_is_flat(self):
        values={a:float(i) for i,a in enumerate(ASSETS[:5])}
        self.assertEqual(pre_risk_weights(values),{})

    def test_risk_budget_only_downscales_and_never_leverages(self):
        t=200*7*24*60*60*1000
        selected={ASSETS[0]:.25,ASSETS[1]:.25,ASSETS[2]:-.25,ASSETS[3]:-.25}
        data={
          ASSETS[0]:PriceData(price_series(t,.035)),
          ASSETS[1]:PriceData(price_series(t,.025)),
          ASSETS[2]:PriceData(price_series(t,.030)),
          ASSETS[3]:PriceData(price_series(t,.020)),
        }
        w,scale,ann=risk_budget(data,selected,t)
        self.assertTrue(0<scale<=1)
        self.assertTrue(ann>0)
        self.assertAlmostEqual(scale,min(1.0,TARGET_ANNUAL_VOL/ann))
        self.assertLessEqual(sum(abs(x) for x in w.values()),1.0+1e-12)
        self.assertAlmostEqual(sum(w.values()),0.0,places=12)

    def test_missing_risk_mark_flattens_whole_week_without_substitution(self):
        t=200*7*24*60*60*1000
        selected={ASSETS[0]:.25,ASSETS[1]:.25,ASSETS[2]:-.25,ASSETS[3]:-.25}
        data={a:PriceData(price_series(t,.02)) for a in selected}
        missing=t-10*FOUR_H
        data[ASSETS[2]].prices.pop(missing)
        w,scale,ann=risk_budget(data,selected,t)
        self.assertEqual(w,{})
        self.assertIsNone(scale)
        self.assertIsNone(ann)

    def test_history_availability_is_52_of_prior_60(self):
        t=100*7*24*60*60*1000
        panel={a:{} for a in ASSETS}
        for a in ASSETS:
            for k in range(1,53):
                panel[a][t-k*7*24*60*60*1000]=float(k)
            panel[a][t]=float(100+ASSETS.index(a))
        vals=factor_snapshot(panel,list(ASSETS),t)
        self.assertEqual(set(vals),set(ASSETS))
        del panel[ASSETS[-1]][t-10*7*24*60*60*1000]
        vals=factor_snapshot(panel,list(ASSETS),t)
        self.assertNotIn(ASSETS[-1],vals)

    def test_frozen_gate_requires_risk_and_breadth_quality(self):
        r=good_metrics()
        s=good_metrics(returnPct=8.0)
        g=validation_gate(r,s)
        self.assertTrue(g['pass'],g['reasons'])
        self.assertEqual(g['decision'],'VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY')

    def test_gate_rejects_dd_concentration_and_low_gross(self):
        r=good_metrics(maxDrawdownPct=21.0,positiveConcentrationPct=36.0,meanGrossExposure=.2)
        s=good_metrics(returnPct=8.0)
        g=validation_gate(r,s)
        self.assertIn('DD_GT_20.0',g['reasons'])
        self.assertIn('POSITIVE_CONCENTRATION_GT_35.0',g['reasons'])
        self.assertIn('MEAN_GROSS_LT_0.25',g['reasons'])

    def test_gate_rejects_non_positive_stress(self):
        g=validation_gate(good_metrics(),good_metrics(returnPct=-1.0))
        self.assertIn('STRESS_RETURN_NOT_POSITIVE',g['reasons'])

if __name__=='__main__':
    unittest.main()
