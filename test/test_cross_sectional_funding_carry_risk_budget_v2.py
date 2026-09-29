import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))

from cross_sectional_funding_carry_risk_budget_v2 import (
    ASSETS, FACTOR, GATE, MAX_ASSET_WEIGHT, MIN_ASSET_WEIGHT, RULESET,
    VOL_BARS, VOL_TARGET, _side_weights, risk_budget_weights,
    select_top2_bottom2, validation_gate
)

class FakeAsset:
    def __init__(self,vol,series):
        self.vol=vol
        self.series=series
    def annualized_vol(self,t):
        return self.vol
    def trailing_log_returns(self,t):
        return list(self.series)

def fake_series(scale,phase=0):
    return [scale*((i%7)-3+phase*.2) for i in range(VOL_BARS)]

def good_metrics(**kw):
    x={
      'periods':178,'activeWeeks':160,'returnPct':30.0,'priceOnlyReturnPct':20.0,
      'fundingContribution':.10,'profitFactor':1.3,'sharpe':.8,'maxDrawdownPct':15.0,
      'positiveWindows':4,'longContribution':.08,'shortContribution':.06,
      'positiveAssets':6,'positiveConcentrationPct':25.0,'meanGrossExposure':.55
    }
    x.update(kw);return x

class FundingCarryRiskBudgetV2Tests(unittest.TestCase):
    def test_ruleset_and_universe_are_new(self):
        self.assertEqual(RULESET,'CROSS-SECTIONAL-FUNDING-CARRY-RISK-BUDGET-V2-FROZEN')
        self.assertEqual(ASSETS,('TRX','ETC','XLM','ATOM','UNI','AAVE','FIL','NEAR'))
        self.assertEqual(FACTOR,'FUNDING_CARRY_7D')
        self.assertEqual(GATE['max_dd_pct'],25.0)

    def test_top2_bottom2_selection_is_deterministic(self):
        vals={a:float(i) for i,a in enumerate(ASSETS)}
        longs,shorts=select_top2_bottom2(vals)
        self.assertEqual(set(longs),{'FIL','NEAR'})
        self.assertEqual(set(shorts),{'TRX','ETC'})

    def test_side_inverse_vol_weights_keep_half_gross_and_bounds(self):
        w=_side_weights({'A':.20,'B':.80},1.0)
        self.assertAlmostEqual(sum(w.values()),.5)
        self.assertTrue(all(MIN_ASSET_WEIGHT<=abs(x)<=MAX_ASSET_WEIGHT for x in w.values()))
        self.assertGreater(w['A'],w['B'])

    def test_risk_budget_never_scales_above_one_and_keeps_dollar_neutrality(self):
        vals={a:float(i) for i,a in enumerate(ASSETS)}
        data={}
        for i,a in enumerate(ASSETS):
            series=[0.002*((j%9)-4)+0.0003*i*((j%5)-2) for j in range(VOL_BARS)]
            data[a]=FakeAsset(.35+.03*i,series)
        w,d=risk_budget_weights(data,vals,0)
        self.assertTrue(w,d)
        self.assertLessEqual(d['riskScale'],1.0)
        self.assertGreater(d['riskScale'],0.0)
        self.assertLessEqual(sum(abs(x) for x in w.values()),1.0+1e-12)
        self.assertAlmostEqual(sum(w.values()),0.0,places=12)
        self.assertEqual(len(w),4)

    def test_missing_selected_vol_data_fails_week_flat_without_substitution(self):
        vals={a:float(i) for i,a in enumerate(ASSETS)}
        data={a:FakeAsset(.4,fake_series(.001,i)) for i,a in enumerate(ASSETS)}
        data['NEAR']=FakeAsset(None,None)
        w,d=risk_budget_weights(data,vals,0)
        self.assertEqual(w,{})
        self.assertEqual(d['reason'],'VOL_DATA')

    def test_validation_gate_rejects_v1_style_drawdown_and_concentration(self):
        r=good_metrics(maxDrawdownPct=48.86,positiveConcentrationPct=61.34)
        s=good_metrics(returnPct=10)
        g=validation_gate(r,s)
        self.assertFalse(g['pass'])
        self.assertIn('DD_GT_25.0',g['reasons'])
        self.assertIn('POSITIVE_CONCENTRATION_GT_35.0',g['reasons'])

    def test_validation_gate_requires_economic_deployment_and_stress(self):
        r=good_metrics(meanGrossExposure=.2)
        s=good_metrics(returnPct=-1)
        g=validation_gate(r,s)
        self.assertIn('MEAN_GROSS_LT_0.35',g['reasons'])
        self.assertIn('STRESS_RETURN_NOT_POSITIVE',g['reasons'])

if __name__=='__main__':
    unittest.main()
