#!/usr/bin/env python3
import hashlib
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

import low_volatility_rank_weighted_v2 as v2


def git_blob_sha(path):
    body=Path(path).read_bytes()
    return hashlib.sha1(f"blob {len(body)}\0".encode()+body).hexdigest()


class StubPrice:
    def __init__(self,signal,outcome):
        self.signal=signal
        self.outcome=outcome
    def lowvol_signal(self,t):
        return self.signal
    def entry_exit_return(self,t):
        return self.outcome


class StubFunding:
    def __init__(self,rate=0.0):
        self.rate=rate
    def sum_for_hold(self,start,end):
        return self.rate


class LowVolRankWeightedV2Tests(unittest.TestCase):
    def test_parent_v1_engine_is_exactly_frozen(self):
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"cross_sectional_low_volatility_v1.py"),
            v2.PARENT_V1_ENGINE_BLOB
        )

    def test_frozen_stage_calendars_remain_48_and_34(self):
        self.assertEqual(
            len(list(v2.parent.weekly_anchors(v2.DEVELOPMENT_START,v2.DEVELOPMENT_END))),48
        )
        self.assertEqual(
            len(list(v2.parent.weekly_anchors(v2.HOLDOUT_START,v2.HOLDOUT_END))),34
        )
        self.assertEqual(v2.DEVELOPMENT_EXPECTED_PERIODS,48)
        self.assertEqual(v2.HOLDOUT_EXPECTED_PERIODS,34)

    def test_rank_weights_are_dollar_neutral_gross_one_and_continuous(self):
        signals={a:float(i) for i,a in enumerate(v2.ASSETS)}
        w=v2.rank_weights(signals)
        self.assertAlmostEqual(sum(w.values()),0.0,12)
        self.assertAlmostEqual(sum(abs(x) for x in w.values()),1.0,12)
        self.assertGreater(w["AVAX"],0)
        self.assertLess(w["BTC"],0)
        self.assertEqual(len([x for x in w.values() if abs(x)>0]),12)

    def test_average_rank_ties_remain_neutral_and_deterministic(self):
        signals={a:1.0 for a in v2.ASSETS}
        with self.assertRaisesRegex(ValueError,"DEGENERATE_RANK_CROSS_SECTION"):
            v2.rank_weights(signals)

    def test_period_row_accounts_price_funding_and_turnover_cost(self):
        price={}
        funding={}
        for i,a in enumerate(v2.ASSETS):
            price[a]=StubPrice(float(i),float(i)/100.0)
            funding[a]=StubFunding(0.001)
        row=v2.period_row(price,funding,v2.DEVELOPMENT_START,{},v2.BASE_COST_BPS)
        self.assertEqual(row["eligibleAssets"],12)
        self.assertAlmostEqual(row["grossExposure"],1.0,12)
        self.assertAlmostEqual(row["netExposure"],0.0,12)
        self.assertAlmostEqual(row["turnover"],1.0,12)
        self.assertAlmostEqual(row["cost"],0.001,12)
        self.assertGreater(row["price"],0)
        self.assertAlmostEqual(row["funding"],0.0,12)
        self.assertGreater(row["rankIc"],0)

    def test_funding_coverage_detects_missing_event(self):
        start=v2.DEVELOPMENT_START
        rows=[
            [start+8*v2.HOUR,8,0.0001],
            [start+16*v2.HOUR,8,0.0001],
            [start+32*v2.HOUR,8,0.0001],
        ]
        f=v2.FundingSeries("BTC",rows)
        with self.assertRaisesRegex(ValueError,"FUNDING_INTERNAL_GAP"):
            f.sum_for_hold(start,start+40*v2.HOUR)

    def test_funding_coverage_accepts_regular_eight_hour_events(self):
        start=v2.DEVELOPMENT_START
        rows=[[start+i*8*v2.HOUR,8,0.0001] for i in range(1,22)]
        f=v2.FundingSeries("BTC",rows)
        self.assertAlmostEqual(f.sum_for_hold(start,start+v2.WEEK),21*0.0001,12)

    def test_funding_coverage_accepts_subsecond_official_timestamp_jitter(self):
        start=v2.DEVELOPMENT_START
        rows=[]
        for i in range(1,22):
            jitter=16 if i%3==0 else (1 if i%2==0 else 0)
            rows.append([start+i*8*v2.HOUR+jitter,8,0.0001])
        f=v2.FundingSeries("BTC",rows)
        self.assertAlmostEqual(f.sum_for_hold(start,start+v2.WEEK),20*0.0001,12)
        self.assertEqual(v2.FUNDING_TIME_TOLERANCE_MS,1000)

    def test_funding_tolerance_does_not_hide_a_missing_interval(self):
        start=v2.DEVELOPMENT_START
        rows=[
            [start+8*v2.HOUR+16,8,0.0001],
            [start+16*v2.HOUR+1,8,0.0001],
            [start+32*v2.HOUR+16,8,0.0001],
        ]
        f=v2.FundingSeries("BTC",rows)
        with self.assertRaisesRegex(ValueError,"FUNDING_INTERNAL_GAP"):
            f.sum_for_hold(start,start+40*v2.HOUR)

    def test_development_gate_passes_only_when_all_frozen_conditions_pass(self):
        base={
          "periods":48,
          "minEligibleAssets":12,
          "maxEligibleAssets":12,
          "maxGrossDeviation":0.0,
          "maxAbsNetExposure":0.0,
          "returnPct":12.0,
          "profitFactor":1.5,
          "sharpe":1.0,
          "maxDrawdownPct":10.0,
          "positiveBlocks":4,
          "meanRankIc":0.2,
          "rankIcNeweyWestT":2.0,
        }
        stress={"returnPct":5.0}
        gate=v2.development_gate(base,stress)
        self.assertTrue(gate["pass"])
        self.assertEqual(gate["reasons"],[])

    def test_development_gate_fails_cost_stress_or_rank_significance(self):
        base={
          "periods":48,
          "minEligibleAssets":12,
          "maxEligibleAssets":12,
          "maxGrossDeviation":0.0,
          "maxAbsNetExposure":0.0,
          "returnPct":5.0,
          "profitFactor":1.2,
          "sharpe":0.8,
          "maxDrawdownPct":10.0,
          "positiveBlocks":3,
          "meanRankIc":0.1,
          "rankIcNeweyWestT":1.0,
        }
        gate=v2.development_gate(base,{"returnPct":-1.0})
        self.assertFalse(gate["pass"])
        self.assertIn("STRESS_20BPS_RETURN_NOT_POSITIVE",gate["reasons"])
        self.assertIn("RANK_IC_NW_T_LT_1_645",gate["reasons"])

    def test_no_holdout_evaluator_or_execution_path_is_present(self):
        body=(ROOT/"research"/"low_volatility_rank_weighted_v2.py").read_text()
        banned=[
          "run_holdout","HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY",
          "submitOrder","placeOrder","createOrder","cancelOrder","transferFunds",
          "martingale","pyramiding",
        ]
        for token in banned:
            self.assertNotIn(token,body)
        self.assertIn('"holdoutEvaluated":False',body.replace(" ",""))

    def test_collector_is_public_development_only_with_funding_archives(self):
        collector=(ROOT/"scripts"/"collect-low-volatility-rank-weighted-v2-development.py").read_text()
        runner=(ROOT/"research"/"run-low-volatility-rank-weighted-v2-development.py").read_text()
        self.assertIn('/fundingRate/',collector)
        self.assertIn('START="2025-01"',collector)
        self.assertIn('END="2026-01"',collector)
        self.assertIn('DEV_END_MS=1767398400000',collector)
        self.assertNotIn("2026-08",collector)
        self.assertIn('len(hourly)!=8738',runner)
        self.assertIn('"holdoutEvaluated":False',runner)
        self.assertIn('run_development',runner)


if __name__=="__main__":
    unittest.main()
