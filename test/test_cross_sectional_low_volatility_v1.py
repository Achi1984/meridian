#!/usr/bin/env python3
import hashlib
import math
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

import cross_sectional_low_volatility_v1 as v1


def git_blob_sha(path):
    body=Path(path).read_bytes()
    return hashlib.sha1(f"blob {len(body)}\0".encode()+body).hexdigest()


class StubAsset:
    def __init__(self,signal,outcome):
        self.signal=signal
        self.outcome=outcome
    def lowvol_signal(self,t):
        return self.signal
    def entry_exit_return(self,t):
        return self.outcome


class CrossSectionalLowVolatilityV1Tests(unittest.TestCase):
    def test_preregistration_is_exactly_frozen_input(self):
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"CROSS-SECTIONAL-LOW-VOLATILITY-V1-PREREGISTRATION.md"),
            v1.PREREGISTRATION_BLOB
        )

    def test_frozen_calendars_have_exact_anchor_counts(self):
        self.assertEqual(len(list(v1.weekly_anchors(v1.DISCOVERY_START,v1.DISCOVERY_END))),48)
        self.assertEqual(len(list(v1.weekly_anchors(v1.HOLDOUT_START,v1.HOLDOUT_END))),34)
        self.assertEqual(v1.DISCOVERY_EXPECTED_WEEKS,48)
        self.assertEqual(v1.HOLDOUT_EXPECTED_WEEKS,34)
        self.assertEqual(v1.REQUIRED_ASSETS,12)

    def test_lowvol_signal_uses_672_returns_and_ends_strictly_before_anchor(self):
        t=v1.DISCOVERY_START
        first=t-(v1.FORMATION_RETURNS+2)*v1.HOUR
        rows=[]
        for i in range(v1.FORMATION_ROWS):
            ts=first+i*v1.HOUR
            px=100.0*math.exp(0.001*i)
            rows.append([ts,px,px,px,px])
        series=v1.HourlySeries(rows)
        expected=-math.sqrt(v1.FORMATION_RETURNS*(0.001**2))
        self.assertAlmostEqual(series.lowvol_signal(t),expected,12)
        self.assertEqual(max(series.by_ts),t-2*v1.HOUR)
        self.assertNotIn(t-v1.HOUR,series.by_ts)

    def test_using_t_minus_1h_as_last_bar_cannot_rescue_missing_strict_window(self):
        t=v1.DISCOVERY_START
        wrong_first=t-v1.FORMATION_ROWS*v1.HOUR
        rows=[]
        for i in range(v1.FORMATION_ROWS):
            ts=wrong_first+i*v1.HOUR
            rows.append([ts,100,100,100,100])
        series=v1.HourlySeries(rows)
        with self.assertRaisesRegex(ValueError,"MISSING_FORMATION_HOUR"):
            series.lowvol_signal(t)

    def test_feature_is_cross_sectional_low2_minus_high2(self):
        dataset={}
        for i,asset in enumerate(v1.ASSETS):
            dataset[asset]=StubAsset(signal=float(i),outcome=float(i)/100.0)
        row=v1.feature_week(dataset,v1.DISCOVERY_START)
        self.assertEqual(row["assetCount"],12)
        self.assertAlmostEqual(row["rankIc"],1.0,12)
        self.assertGreater(row["low2MinusHigh2"],0)
        self.assertEqual(row["low2"],["AVAX","BCH"])
        self.assertEqual(row["high2"],["ETH","BTC"])

    def test_ties_use_alphabetical_asset_symbol_order(self):
        dataset={asset:StubAsset(1.0,0.01) for asset in v1.ASSETS}
        row=v1.feature_week(dataset,v1.DISCOVERY_START)
        self.assertEqual(row["low2"],["ADA","AVAX"])
        self.assertEqual(row["high2"],["SOL","XRP"])

    def test_discovery_gate_passes_only_stable_positive_feature(self):
        rows=[]
        for i in range(48):
            rows.append({
                "t":v1.DISCOVERY_START+i*v1.WEEK,
                "assetCount":12,
                "rankIc":0.20+(0.01 if i%2 else -0.01),
                "low2MinusHigh2":0.01+(0.001 if i%2 else -0.001),
            })
        metrics,gate=v1.summarize_discovery_rows(rows)
        self.assertTrue(gate["pass"])
        self.assertEqual(gate["reasons"],[])
        self.assertEqual(metrics["positiveIcBlocks"],4)
        self.assertEqual(metrics["positiveSpreadBlocks"],4)

    def test_wrong_sample_size_and_negative_feature_fail(self):
        rows=[{
            "t":v1.DISCOVERY_START+i*v1.WEEK,
            "assetCount":12,
            "rankIc":-0.10,
            "low2MinusHigh2":-0.005,
        } for i in range(47)]
        _,gate=v1.summarize_discovery_rows(rows)
        self.assertFalse(gate["pass"])
        self.assertIn("WEEKS_NE_48",gate["reasons"])
        self.assertIn("MEAN_RANK_IC_NOT_POSITIVE",gate["reasons"])
        self.assertIn("MEAN_LOW2_MINUS_HIGH2_NOT_POSITIVE",gate["reasons"])

    def test_engine_contains_no_holdout_evaluator_strategy_pnl_or_execution_path(self):
        body=(ROOT/"research"/"cross_sectional_low_volatility_v1.py").read_text()
        banned=[
            "run_holdout","HOLDOUT_PASS_STRATEGY_DESIGN_ALLOWED",
            "submitOrder","placeOrder","createOrder","cancelOrder","transferFunds",
            "funding_sum(","turnover(","terminal_close(","profitFactor","maxDrawdown",
        ]
        for token in banned:
            self.assertNotIn(token,body)
        self.assertIn('"strategyPnlCalculated":False',body.replace(" ",""))
        self.assertIn('"holdoutEvaluated":False',body.replace(" ",""))

    def test_collector_and_runner_are_discovery_only(self):
        collector=(ROOT/"scripts"/"collect-cross-sectional-low-volatility-v1-discovery.py").read_text()
        runner=(ROOT/"research"/"run-cross-sectional-low-volatility-v1-discovery.py").read_text()
        self.assertIn('START="2025-01"',collector)
        self.assertIn('END="2026-01"',collector)
        self.assertIn('SOURCE_START_MS=1735941600000',collector)
        self.assertIn('SOURCE_END_MS=1767398400000',collector)
        self.assertIn('"holdoutRowsRetained":False',collector)
        self.assertNotIn("2026-08",collector)
        self.assertIn('manifest.get("holdoutRowsRetained") is not False',runner)
        self.assertIn('len(hourly)!=8739',runner)
        self.assertIn('run_discovery',runner)
        self.assertIn('"holdoutEvaluated":False',runner)


if __name__=="__main__":
    unittest.main()
