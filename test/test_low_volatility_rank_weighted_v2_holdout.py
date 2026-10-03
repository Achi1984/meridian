#!/usr/bin/env python3
import hashlib
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

import low_volatility_rank_weighted_v2_holdout as h


def git_blob_sha(path):
    body=Path(path).read_bytes()
    return hashlib.sha1(f"blob {len(body)}\0".encode()+body).hexdigest()


class HoldoutV2Tests(unittest.TestCase):
    def test_frozen_parent_lineage_is_exact(self):
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"low_volatility_rank_weighted_v2.py"),
            h.PARENT_V2_ENGINE_BLOB
        )
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"LOW-VOLATILITY-RANK-WEIGHTED-V2-DEVELOPMENT-EVIDENCE.md"),
            h.DEVELOPMENT_EVIDENCE_BLOB
        )
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"results"/"low-volatility-rank-weighted-v2-development-frozen-summary.json"),
            h.DEVELOPMENT_SUMMARY_BLOB
        )

    def test_frozen_development_lineage_authorizes_only_holdout(self):
        summary=h.verify_development_lineage()
        self.assertEqual(summary["decision"],"DEVELOPMENT_PASS_HOLDOUT_REQUIRED")
        self.assertTrue(summary["gate"]["pass"])
        self.assertFalse(summary["holdoutEvaluated"])
        self.assertFalse(summary["dataIntegrityFailure"])

    def test_holdout_calendar_is_exactly_34_periods(self):
        anchors=list(h.v2.parent.weekly_anchors(h.HOLDOUT_START,h.HOLDOUT_END))
        self.assertEqual(len(anchors),34)
        self.assertEqual(anchors[0],1767398400000)
        self.assertEqual(anchors[-1],1787356800000)
        self.assertEqual(anchors[-1]+h.WEEK,1787961600000)

    def test_holdout_gate_passes_only_full_frozen_gate(self):
        base={
          "periods":34,
          "minEligibleAssets":12,
          "maxEligibleAssets":12,
          "maxGrossDeviation":0.0,
          "maxAbsNetExposure":0.0,
          "returnPct":10.0,
          "profitFactor":1.5,
          "sharpe":1.0,
          "maxDrawdownPct":10.0,
          "positiveBlocks":4,
          "meanRankIc":0.2,
          "rankIcNeweyWestT":2.0,
        }
        gate=h.holdout_gate(base,{"returnPct":5.0})
        self.assertTrue(gate["pass"])
        self.assertEqual(gate["reasons"],[])

    def test_holdout_gate_fails_any_relaxed_metric(self):
        base={
          "periods":34,
          "minEligibleAssets":12,
          "maxEligibleAssets":12,
          "maxGrossDeviation":0.0,
          "maxAbsNetExposure":0.0,
          "returnPct":1.0,
          "profitFactor":1.1,
          "sharpe":0.7,
          "maxDrawdownPct":21.0,
          "positiveBlocks":2,
          "meanRankIc":0.01,
          "rankIcNeweyWestT":1.0,
        }
        gate=h.holdout_gate(base,{"returnPct":-1.0})
        self.assertFalse(gate["pass"])
        for reason in [
          "PF_LT_1_15","SHARPE_LT_0_75","DD_GT_20",
          "POSITIVE_BLOCKS_LT_3_OF_4",
          "STRESS_20BPS_RETURN_NOT_POSITIVE",
          "RANK_IC_NW_T_LT_1_645",
        ]:
            self.assertIn(reason,gate["reasons"])

    def test_holdout_uses_same_costs_and_exposure_invariants_as_development(self):
        self.assertEqual(h.BASE_COST_BPS,h.v2.BASE_COST_BPS)
        self.assertEqual(h.STRESS_COST_BPS,h.v2.STRESS_COST_BPS)
        self.assertEqual(h.GROSS_TARGET,h.v2.GROSS_TARGET)
        self.assertEqual(h.MAX_NET_ABS,h.v2.MAX_NET_ABS)
        self.assertEqual(h.MIN_PROFIT_FACTOR,h.v2.MIN_PROFIT_FACTOR)
        self.assertEqual(h.MIN_SHARPE,h.v2.MIN_SHARPE)
        self.assertEqual(h.MAX_DRAWDOWN_PCT,h.v2.MAX_DRAWDOWN_PCT)

    def test_holdout_module_has_no_execution_or_parameter_tuning_path(self):
        body=(ROOT/"research"/"low_volatility_rank_weighted_v2_holdout.py").read_text()
        banned=[
          "submitOrder","placeOrder","createOrder","cancelOrder","transferFunds",
          "optimize","grid_search","parameter_search","retune",
        ]
        for token in banned:
            self.assertNotIn(token,body)
        self.assertIn('"autoPromotion":False',body.replace(" ",""))
        self.assertIn('"researchOnly":True',body.replace(" ",""))

    def test_collector_is_holdout_only(self):
        collector=(ROOT/"scripts"/"collect-low-volatility-rank-weighted-v2-holdout.py").read_text()
        runner=(ROOT/"research"/"run-low-volatility-rank-weighted-v2-holdout.py").read_text()
        self.assertIn('START="2025-12"',collector)
        self.assertIn('END="2026-08"',collector)
        self.assertIn('KLINE_START_MS=1764975600000',collector)
        self.assertIn('HOLDOUT_START_MS=1767398400000',collector)
        self.assertIn('HOLDOUT_END_MS=1787961600000',collector)
        self.assertIn('"developmentMetricsIncluded":False',collector)
        self.assertIn('len(hourly)!=6386',runner)
        self.assertIn('run_holdout',runner)
        self.assertNotIn("DEVELOPMENT_START",collector)

    def test_holdout_engine_reuses_frozen_development_mechanics(self):
        body=(ROOT/"research"/"low_volatility_rank_weighted_v2_holdout.py").read_text()
        for call in [
          "v2.prepare_dataset(","v2.period_row(","v2.terminal_close(",
          "v2._compound(","v2._profit_factor(","v2._sharpe(","v2._max_drawdown(",
        ]:
            self.assertIn(call,body)


if __name__=="__main__":
    unittest.main()
