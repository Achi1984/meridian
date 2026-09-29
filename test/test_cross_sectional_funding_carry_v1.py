import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))

from cross_sectional_funding_carry_v1 import (
    ASSETS, FACTOR, FUND_MAX_GAP, FOUR_H, GATE, WEEK,
    FundingAssetData, _snapshot, cross_section_weights, validation_gate
)

def kline(ot,price=100.0):
    return [ot,ot+FOUR_H-1,price,price*1.01,price*.99,price]

def continuous_funding(start,end,step=8*60*60*1000,rate=.0001):
    out=[];t=start
    while t<=end:
        out.append([t,rate]);t+=step
    return out

def metrics(**overrides):
    base={
      'periods':160,'activeWeeks':100,'returnPct':12.0,'priceOnlyReturnPct':5.0,
      'fundingContribution':0.08,'profitFactor':1.3,'sharpe':0.9,'maxDrawdownPct':10.0,
      'positiveWindows':4,'longContribution':0.04,'shortContribution':0.05,
      'positiveAssets':3,'positiveConcentrationPct':40.0
    }
    base.update(overrides)
    return base

class FundingCarryTransferV1Tests(unittest.TestCase):
    def test_history_snapshot_requires_52_valid_prior_observations(self):
        t=100*WEEK
        panel={a:{} for a in ASSETS}
        for a in ASSETS:
            for k in range(1,53):
                panel[a][t-k*WEEK]=float(k)
            panel[a][t]=float(100+ASSETS.index(a))
        vals=_snapshot(panel,list(ASSETS),t)
        self.assertEqual(set(vals),set(ASSETS))
        del panel['HBAR'][t-10*WEEK]
        vals=_snapshot(panel,list(ASSETS),t)
        self.assertNotIn('HBAR',vals)

    def test_transfer_ranking_is_one_long_one_short_and_dollar_neutral(self):
        values={'LTC':4.0,'BCH':1.0,'AVAX':3.0,'HBAR':2.0}
        w=cross_section_weights(values,True)
        self.assertEqual(w,{'LTC':.5,'BCH':-.5})
        self.assertAlmostEqual(sum(w.values()),0.0)
        self.assertAlmostEqual(sum(abs(x) for x in w.values()),1.0)

    def test_irrelevant_kline_gap_is_not_interpolated_or_globally_rejected(self):
        ks=[kline(0),kline(FOUR_H),kline(3*FOUR_H)]
        fs=continuous_funding(0,30*60*60*1000)
        d=FundingAssetData('LTC',ks,fs)
        self.assertIsNone(d.price_at(3*FOUR_H))
        self.assertIsNotNone(d.price_at(4*FOUR_H))

    def test_duplicate_kline_and_funding_fail_closed(self):
        fs=continuous_funding(0,30*60*60*1000)
        with self.assertRaisesRegex(ValueError,'duplicate/nonmonotonic kline'):
            FundingAssetData('LTC',[kline(0),kline(0)],fs)
        with self.assertRaisesRegex(ValueError,'duplicate/nonmonotonic funding'):
            FundingAssetData('LTC',[kline(0),kline(FOUR_H)],[[0,.0],[0,.0]])

    def test_transfer_gate_passes_only_when_all_conditions_pass(self):
        r=metrics();s=metrics(returnPct=3.0)
        g=validation_gate(r,s)
        self.assertTrue(g['pass'],g['reasons'])
        self.assertEqual(g['decision'],'TRANSFER_VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY')

    def test_transfer_gate_rejects_negative_price_only_or_funding(self):
        r=metrics(priceOnlyReturnPct=-1.0,fundingContribution=-.01)
        s=metrics(returnPct=2.0)
        g=validation_gate(r,s)
        self.assertIn('PRICE_ONLY_NOT_POSITIVE',g['reasons'])
        self.assertIn('FUNDING_CONTRIBUTION_NOT_POSITIVE',g['reasons'])

    def test_transfer_gate_rejects_concentration_and_stress_failure(self):
        r=metrics(positiveConcentrationPct=55.0)
        s=metrics(returnPct=-2.0)
        g=validation_gate(r,s)
        self.assertIn('POSITIVE_CONCENTRATION_GT_50.0',g['reasons'])
        self.assertIn('STRESS_RETURN_NOT_POSITIVE',g['reasons'])

if __name__=='__main__':
    unittest.main()
