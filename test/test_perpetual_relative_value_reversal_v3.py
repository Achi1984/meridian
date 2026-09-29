import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from perpetual_relative_value_reversal_v3 import (
    RULESET, BENCHMARKS, QUALIFIED_ASSETS, PRIMARY_ASSETS, TRANSFER_ASSETS,
    EXPECTED_ANCHORS, BETA_OBSERVATIONS, SIDE_COUNT, MIN_SIDE_GROSS, MAX_SIDE_GROSS,
    ols_beta_stats, vasicek_shrink, market_factor_log_returns, beta_neutral_weights,
    stage_gate
)


class FakePrice:
    def __init__(self, values):
        self.values=list(values)
    def log_returns_between_marks(self,start,end):
        return list(self.values)


def good_metrics(stage="PRIMARY_VALIDATION", **kw):
    x={
      "stage":stage,
      "periods":86,
      "activeWeeks":80,
      "maxAbsEstimatedBetaExposure":1e-14,
      "returnPct":8.0,
      "priceOnlyReturnPct":7.0,
      "profitFactor":1.25,
      "sharpe":0.75,
      "maxDrawdownPct":14.0,
      "positiveWindows":4,
      "positiveAssets":6 if stage=="PRIMARY_VALIDATION" else 5,
      "positiveConcentrationPct":28.0,
      "meanSelectedLoserMinusWinnerNextWeek":0.01,
      "realizedMarketBeta":0.05,
      "longContribution":-0.02,
      "shortContribution":0.10,
    }
    x.update(kw)
    return x


class RelativeValueReversalV3Tests(unittest.TestCase):
    def test_frozen_identity_split_and_protocol_match(self):
        self.assertEqual(RULESET,"PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-FROZEN")
        self.assertEqual(BENCHMARKS,("BTC","ETH","BNB","SOL","XRP"))
        self.assertEqual(len(QUALIFIED_ASSETS),19)
        self.assertEqual(len(PRIMARY_ASSETS),10)
        self.assertEqual(len(TRANSFER_ASSETS),9)
        self.assertFalse(set(PRIMARY_ASSETS)&set(TRANSFER_ASSETS))
        self.assertEqual(set(PRIMARY_ASSETS)|set(TRANSFER_ASSETS),set(QUALIFIED_ASSETS))
        ranked=sorted(
            QUALIFIED_ASSETS,
            key=lambda a:hashlib.sha256(("MERIDIAN-RV-V3|"+a).encode()).hexdigest()
        )
        self.assertEqual(tuple(ranked[:10]),PRIMARY_ASSETS)
        self.assertEqual(tuple(ranked[10:]),TRANSFER_ASSETS)
        self.assertEqual(EXPECTED_ANCHORS,86)
        self.assertEqual(BETA_OBSERVATIONS,360)
        self.assertEqual(SIDE_COUNT,2)
        self.assertEqual((MIN_SIDE_GROSS,MAX_SIDE_GROSS),(0.20,0.80))

        protocol=json.loads((ROOT/'research'/'perpetual-relative-value-reversal-v3-protocol.json').read_text())
        self.assertEqual(protocol["ruleset"],RULESET)
        self.assertEqual(tuple(protocol["split"]["primary"]),PRIMARY_ASSETS)
        self.assertEqual(tuple(protocol["split"]["transfer"]),TRANSFER_ASSETS)
        self.assertFalse(protocol["transferLoadedBeforePrimaryPass"])
        self.assertFalse(protocol["paperAuthorized"])
        self.assertFalse(protocol["liveAuthorized"])

    def test_ols_beta_exact_linear_relation(self):
        x=[(i-180)/100000.0 for i in range(360)]
        y=[0.0003+1.5*v for v in x]
        s=ols_beta_stats(y,x)
        self.assertAlmostEqual(s["betaOls"],1.5,places=12)
        self.assertAlmostEqual(s["alpha"],0.0003,places=12)
        self.assertAlmostEqual(s["seBeta2"],0.0,places=20)

    def test_vasicek_shrink_moves_noisy_beta_toward_cross_sectional_mean(self):
        raw={
          "A":{"betaOls":0.5,"alpha":0.0,"seBeta2":0.01},
          "B":{"betaOls":1.0,"alpha":0.0,"seBeta2":0.01},
          "C":{"betaOls":2.0,"alpha":0.0,"seBeta2":100.0},
        }
        out=vasicek_shrink(raw)
        beta_bar=sum(v["betaOls"] for v in raw.values())/3
        self.assertLess(abs(out["C"]["beta"]-beta_bar),abs(raw["C"]["betaOls"]-beta_bar))
        self.assertTrue(0.0<=out["C"]["shrinkWeight"]<=1.0)

    def test_market_factor_is_equal_weight_mean(self):
        bench={
          "BTC":FakePrice([1.0,2.0]),
          "ETH":FakePrice([2.0,3.0]),
          "BNB":FakePrice([3.0,4.0]),
          "SOL":FakePrice([4.0,5.0]),
          "XRP":FakePrice([5.0,6.0]),
        }
        self.assertEqual(market_factor_log_returns(bench,0,1),[3.0,4.0])

    def test_beta_neutral_weights_are_two_by_two_and_zero_beta(self):
        scores={"A":-4.0,"B":-3.0,"C":0.0,"D":2.0,"E":3.0,"F":4.0}
        betas={a:{"beta":b} for a,b in {
          "A":1.0,"B":1.2,"C":0.9,"D":1.0,"E":0.8,"F":1.0
        }.items()}
        s=beta_neutral_weights(scores,betas)
        self.assertTrue(s["active"])
        self.assertEqual(s["longs"],["A","B"])
        self.assertEqual(s["shorts"],["E","F"])
        self.assertEqual(len(s["weights"]),4)
        self.assertAlmostEqual(sum(abs(w) for w in s["weights"].values()),1.0,places=12)
        self.assertAlmostEqual(sum(s["weights"][a]*betas[a]["beta"] for a in s["weights"]),0.0,places=12)

    def test_beta_side_guard_can_make_week_inactive_without_leverage(self):
        scores={"A":-4.0,"B":-3.0,"C":0.0,"D":2.0,"E":3.0,"F":4.0}
        betas={a:{"beta":b} for a,b in {
          "A":4.0,"B":4.0,"C":1.0,"D":1.0,"E":0.2,"F":0.2
        }.items()}
        s=beta_neutral_weights(scores,betas)
        self.assertFalse(s["active"])
        self.assertEqual(s["inactiveReason"],"SIDE_GROSS_GUARD")
        self.assertEqual(s["weights"],{})

    def test_primary_gate_does_not_require_each_absolute_leg_to_profit(self):
        base=good_metrics(longContribution=-1.0,shortContribution=2.0)
        stress=good_metrics(returnPct=2.0)
        g=stage_gate(base,stress)
        self.assertTrue(g["pass"],g["reasons"])
        self.assertEqual(g["decision"],"PRIMARY_VALIDATION_PASS_TRANSFER_REQUIRED")

    def test_primary_gate_rejects_market_beta_and_low_activity(self):
        base=good_metrics(activeWeeks=64,realizedMarketBeta=0.21)
        stress=good_metrics(returnPct=2.0)
        g=stage_gate(base,stress)
        self.assertIn("ACTIVE_WEEKS_LT_65",g["reasons"])
        self.assertIn("ABS_REALIZED_MARKET_BETA_GT_0.20",g["reasons"])

    def test_transfer_gate_uses_same_economic_thresholds_and_five_positive_assets(self):
        base=good_metrics(stage="ASSET_TRANSFER_HOLDOUT",positiveAssets=5)
        stress=good_metrics(stage="ASSET_TRANSFER_HOLDOUT",returnPct=2.0,positiveAssets=5)
        g=stage_gate(base,stress)
        self.assertTrue(g["pass"],g["reasons"])
        self.assertEqual(g["decision"],"TRANSFER_PASS_PAPER_REVIEW_ELIGIBLE")
        bad=stage_gate(good_metrics(stage="ASSET_TRANSFER_HOLDOUT",positiveAssets=4),stress)
        self.assertIn("POSITIVE_ASSETS_LT_5",bad["reasons"])


if __name__=="__main__":
    unittest.main()
