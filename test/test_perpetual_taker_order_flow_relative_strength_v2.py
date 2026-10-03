#!/usr/bin/env python3
import hashlib
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

import perpetual_taker_order_flow_relative_strength_v2 as v2


def git_blob_sha(path):
    body=Path(path).read_bytes()
    return hashlib.sha1(f"blob {len(body)}\0".encode()+body).hexdigest()


class StubAsset:
    def __init__(self,signal,outcome):
        self.signal=signal
        self.outcome=outcome
    def flow_signal(self,t):
        return self.signal
    def entry_exit_return(self,t):
        return self.outcome


class TakerFlowRelativeStrengthV2Tests(unittest.TestCase):
    def test_parent_v1_signal_engine_is_exactly_the_frozen_input(self):
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"perpetual_taker_order_flow_v1.py"),
            v2.PARENT_V1_ENGINE_BLOB
        )

    def test_validation_calendar_is_exactly_85_non_overlapping_weeks(self):
        self.assertEqual(
            (v2.VALIDATION_END-v2.VALIDATION_START)//v2.WEEK,
            v2.EXPECTED_WEEKS
        )
        self.assertEqual(v2.EXPECTED_WEEKS,85)
        self.assertEqual(v2.REQUIRED_ASSETS,12)

    def test_average_ranks_and_spearman_handle_ties_deterministically(self):
        self.assertEqual(v2.average_ranks([1,1,3,4]),[1.5,1.5,3.0,4.0])
        self.assertAlmostEqual(v2.spearman([1,2,3,4],[10,20,30,40]),1.0,12)
        self.assertAlmostEqual(v2.spearman([1,2,3,4],[40,30,20,10]),-1.0,12)

    def test_weekly_feature_is_cross_sectional_only(self):
        dataset={}
        for i,a in enumerate(v2.ASSETS):
            dataset[a]=StubAsset(signal=float(i),outcome=float(i)/100.0)
        row=v2.feature_week(dataset,v2.VALIDATION_START)
        self.assertEqual(row["assetCount"],12)
        self.assertAlmostEqual(row["rankIc"],1.0,12)
        self.assertGreater(row["top2MinusBottom2"],0)
        self.assertEqual(row["top2"],["AVAX","BCH"])
        self.assertEqual(row["bottom2"],["BTC","ETH"])

    def test_missing_signal_or_outcome_fails_closed(self):
        dataset={a:StubAsset(i,i/100.0) for i,a in enumerate(v2.ASSETS)}
        dataset["BTC"]=StubAsset(None,0.01)
        with self.assertRaisesRegex(ValueError,"MISSING_SIGNAL_OR_OUTCOME"):
            v2.feature_week(dataset,v2.VALIDATION_START)

    def test_preregistered_gate_passes_only_stable_positive_factor_series(self):
        rows=[]
        for i in range(85):
            rows.append({
                "t":v2.VALIDATION_START+i*v2.WEEK,
                "assetCount":12,
                "rankIc":0.20 + (0.01 if i%2 else -0.01),
                "top2MinusBottom2":0.01 + (0.001 if i%2 else -0.001)
            })
        metrics,gate=v2.summarize_feature_rows(rows)
        self.assertTrue(gate["pass"])
        self.assertEqual(gate["reasons"],[])
        self.assertEqual(metrics["positiveIcBlocks"],5)
        self.assertEqual(metrics["positiveSpreadBlocks"],5)
        self.assertGreaterEqual(metrics["rankIcNeweyWestT"],1.645)
        self.assertGreaterEqual(metrics["spreadNeweyWestT"],1.645)

    def test_negative_or_unstable_factor_cannot_pass(self):
        rows=[]
        for i in range(85):
            rows.append({
                "t":v2.VALIDATION_START+i*v2.WEEK,
                "assetCount":12,
                "rankIc":-0.1,
                "top2MinusBottom2":-0.005
            })
        _,gate=v2.summarize_feature_rows(rows)
        self.assertFalse(gate["pass"])
        self.assertIn("MEAN_RANK_IC_NOT_POSITIVE",gate["reasons"])
        self.assertIn("MEAN_TOP2_MINUS_BOTTOM2_NOT_POSITIVE",gate["reasons"])

    def test_wrong_sample_size_fails_even_with_perfect_feature(self):
        rows=[{
            "t":v2.VALIDATION_START+i*v2.WEEK,
            "assetCount":12,"rankIc":1.0,"top2MinusBottom2":0.02
        } for i in range(84)]
        _,gate=v2.summarize_feature_rows(rows)
        self.assertFalse(gate["pass"])
        self.assertIn("WEEKS_NE_85",gate["reasons"])

    def test_v2_engine_contains_no_portfolio_pnl_or_execution_path(self):
        body=(ROOT/"research"/"perpetual_taker_order_flow_relative_strength_v2.py").read_text()
        banned=[
            "funding_sum(","turnover(","terminal_close(","period_row(","run_method(",
            "submitOrder","placeOrder","createOrder","cancelOrder","transferFunds"
        ]
        for token in banned:
            self.assertNotIn(token,body)
        self.assertIn('"strategyPnlCalculated": False',body)
        self.assertIn('"executionImpact": False',body)

    def test_collector_and_runner_are_feature_only_and_validation_scoped(self):
        collector=(ROOT/"scripts"/"collect-perpetual-taker-order-flow-relative-strength-v2-validation.py").read_text()
        runner=(ROOT/"research"/"run-perpetual-taker-order-flow-relative-strength-v2-validation.py").read_text()
        self.assertIn('START="2025-01"',collector)
        self.assertIn('END="2026-08"',collector)
        self.assertIn('/klines/',collector)
        self.assertNotIn('/fundingRate/',collector)
        self.assertIn('"fundingLoaded":False',collector)
        self.assertIn('"strategyPnlCalculated":False',collector)
        self.assertIn('feature validation forbids funding data',runner)
        self.assertIn('"strategyPnlCalculated":False',runner)


if __name__=="__main__":
    unittest.main()
