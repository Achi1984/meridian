import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))

from cross_sectional_perpetual_factor_v1 import (
    FACTORS, RULESET, TEMPORAL_GATE, TRANSFER_GATE,
    validation_gate
)

def metrics(**overrides):
    base={
      'periods':80,
      'activeWeeks':70,
      'returnPct':12.0,
      'priceOnlyReturnPct':9.0,
      'profitFactor':1.3,
      'sharpe':0.9,
      'maxDrawdownPct':10.0,
      'positiveWindows':4,
      'longContribution':0.08,
      'shortContribution':0.05,
      'positiveAssets':8,
      'positiveConcentrationPct':25.0,
      'factorBooks':{f:{'activeWeeks':60,'returnPct':5.0} for f in FACTORS},
    }
    base.update(overrides)
    return base

class CrossSectionalV1Tests(unittest.TestCase):
    def test_ruleset_is_new_and_validation_only(self):
        self.assertEqual(RULESET,'CROSS-SECTIONAL-PERPETUAL-FACTOR-V1-FROZEN')
        self.assertEqual(TEMPORAL_GATE['min_periods'],75)
        self.assertEqual(TRANSFER_GATE['min_periods'],150)

    def test_temporal_gate_passes_only_when_every_frozen_condition_passes(self):
        r=metrics()
        s=metrics(returnPct=3.0)
        g=validation_gate(r,s,TEMPORAL_GATE,'TEMPORAL')
        self.assertTrue(g['pass'],g['reasons'])
        self.assertEqual(g['decision'],'TEMPORAL_VALIDATION_PASS_TRANSFER_REQUIRED')

    def test_temporal_gate_rejects_negative_stress_and_weak_factor_book(self):
        r=metrics()
        r['factorBooks']['PREMIUM_REVERSION_7D']['activeWeeks']=10
        s=metrics(returnPct=-1.0)
        g=validation_gate(r,s,TEMPORAL_GATE,'TEMPORAL')
        self.assertFalse(g['pass'])
        self.assertIn('PREMIUM_REVERSION_7D:ACTIVE_LT_30',g['reasons'])
        self.assertIn('STRESS_RETURN_NOT_POSITIVE',g['reasons'])

    def test_temporal_gate_rejects_concentration_and_negative_short_side(self):
        r=metrics(positiveConcentrationPct=45.0,shortContribution=-0.01)
        s=metrics(returnPct=2.0)
        g=validation_gate(r,s,TEMPORAL_GATE,'TEMPORAL')
        self.assertIn('SHORT_CONTRIBUTION_NOT_POSITIVE',g['reasons'])
        self.assertIn('POSITIVE_CONCENTRATION_GT_40.0',g['reasons'])

    def test_transfer_gate_uses_stricter_sample_but_four_asset_breadth(self):
        r=metrics(periods=160,activeWeeks=100,positiveAssets=3,positiveConcentrationPct=45.0)
        s=metrics(returnPct=2.0)
        g=validation_gate(r,s,TRANSFER_GATE,'TRANSFER')
        self.assertTrue(g['pass'],g['reasons'])
        self.assertEqual(g['decision'],'TRANSFER_VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY')

    def test_factor_book_positivity_gate_is_not_optional(self):
        r=metrics()
        for f in FACTORS:
            r['factorBooks'][f]['returnPct']=-1.0
        s=metrics(returnPct=2.0)
        g=validation_gate(r,s,TEMPORAL_GATE,'TEMPORAL')
        self.assertIn('POSITIVE_FACTOR_BOOKS_LT_2',g['reasons'])

if __name__=='__main__':
    unittest.main()
