#!/usr/bin/env python3
import hashlib
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

import low_volatility_rank_weighted_v2_prospective as p


def git_blob_sha(path):
    body=Path(path).read_bytes()
    return hashlib.sha1(f"blob {len(body)}\0".encode()+body).hexdigest()


class ProspectiveV2Tests(unittest.TestCase):
    def test_frozen_lineage_is_exact(self):
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"low_volatility_rank_weighted_v2.py"),
            p.PARENT_V2_ENGINE_BLOB
        )
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-EVIDENCE.md"),
            p.HOLDOUT_EVIDENCE_BLOB
        )
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"results"/"low-volatility-rank-weighted-v2-holdout-frozen-summary.json"),
            p.HOLDOUT_SUMMARY_BLOB
        )
        self.assertEqual(
            git_blob_sha(ROOT/"research"/"LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-REVIEW-PREREGISTRATION.md"),
            p.PROSPECTIVE_PREREGISTRATION_BLOB
        )
        summary=p.verify_frozen_lineage()
        self.assertEqual(summary["decision"],"HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY")

    def test_start_and_gate_end_are_frozen_before_any_outcome(self):
        self.assertEqual(p.PROSPECTIVE_START,1791590400000)
        self.assertEqual(p.GATE_END,1798848000000)
        self.assertEqual(p.MIN_COMPLETED_OBSERVATIONS,12)
        self.assertEqual(p.GATE_END-p.PROSPECTIVE_START,12*p.WEEK)

    def test_saturday_cutoff_is_utc_saturday_midnight(self):
        # 2026-10-03T17:00Z -> 2026-10-03T00:00Z
        self.assertEqual(p.saturday_cutoff(1791046800000),1790985600000)
        # 2026-10-09T12:00Z -> prior Saturday 2026-10-03T00:00Z
        self.assertEqual(p.saturday_cutoff(1791547200000),1790985600000)
        # 2026-10-10T00:15Z -> new Saturday boundary
        self.assertEqual(p.saturday_cutoff(1791591300000),1791590400000)

    def test_completed_anchors_are_strictly_post_start_outcomes(self):
        self.assertEqual(p.completed_anchors(p.PROSPECTIVE_START),[])
        self.assertEqual(p.completed_anchors(p.PROSPECTIVE_START+p.WEEK),[p.PROSPECTIVE_START])
        xs=p.completed_anchors(p.GATE_END)
        self.assertEqual(len(xs),12)
        self.assertEqual(xs[0],p.PROSPECTIVE_START)
        self.assertEqual(xs[-1]+p.WEEK,p.GATE_END)

    def test_prestart_and_start_snapshots_cannot_emit_performance(self):
        before=p.evaluate({},1791046800000,1791046800000)
        self.assertEqual(before["decision"],p.WAITING)
        self.assertEqual(before["completedObservations"],0)
        self.assertIsNone(before["monitoring"])

        at_start=p.evaluate({},p.PROSPECTIVE_START,p.PROSPECTIVE_START+30*60*1000)
        self.assertEqual(at_start["decision"],p.COLLECTING)
        self.assertEqual(at_start["completedObservations"],0)
        self.assertIsNone(at_start["monitoring"])

    def test_funding_coverage_accepts_official_millisecond_jitter(self):
        start=p.PROSPECTIVE_START
        rows=[
          [start+8*p.HOUR+16,8,0.0001],
          [start+16*p.HOUR+1,8,0.0002],
          [start+24*p.HOUR,8,-0.0001],
        ]
        f=p.ProspectiveFundingSeries("BTC",rows)
        self.assertAlmostEqual(f.sum_for_hold(start,start+24*p.HOUR),0.0002,12)

    def test_funding_coverage_fails_real_missing_eight_hour_event(self):
        start=p.PROSPECTIVE_START
        rows=[
          [start+8*p.HOUR,8,0.0001],
          [start+24*p.HOUR,8,0.0001],
        ]
        f=p.ProspectiveFundingSeries("BTC",rows)
        with self.assertRaisesRegex(ValueError,"INTERNAL_GAP"):
            f.sum_for_hold(start,start+24*p.HOUR)

    def test_fixed_twelve_week_gate_uses_frozen_thresholds(self):
        base={
          "periods":12,
          "minEligibleAssets":12,
          "maxEligibleAssets":12,
          "maxGrossDeviation":0.0,
          "maxAbsNetExposure":0.0,
          "returnPct":5.0,
          "profitFactor":1.3,
          "sharpe":1.0,
          "maxDrawdownPct":8.0,
          "positiveBlocks":2,
          "meanRankIc":0.1,
          "rankIcNeweyWestT":2.0,
        }
        gate=p.performance_gate(base,{"returnPct":2.0})
        self.assertTrue(gate["pass"])
        self.assertEqual(gate["minProfitFactor"],1.15)
        self.assertEqual(gate["minSharpe"],0.75)
        self.assertEqual(gate["rankIcTMin"],1.645)
        self.assertEqual(gate["blocks"],3)
        self.assertEqual(gate["minPositiveBlocks"],2)

    def test_gate_fails_stress_or_statistical_weakness(self):
        base={
          "periods":12,
          "minEligibleAssets":12,
          "maxEligibleAssets":12,
          "maxGrossDeviation":0.0,
          "maxAbsNetExposure":0.0,
          "returnPct":1.0,
          "profitFactor":1.2,
          "sharpe":0.8,
          "maxDrawdownPct":10.0,
          "positiveBlocks":2,
          "meanRankIc":0.1,
          "rankIcNeweyWestT":1.0,
        }
        gate=p.performance_gate(base,{"returnPct":-0.1})
        self.assertFalse(gate["pass"])
        self.assertIn("STRESS_20BPS_RETURN_NOT_POSITIVE",gate["reasons"])
        self.assertIn("RANK_IC_NW_T_LT_1_645",gate["reasons"])

    def test_no_order_account_or_live_execution_path(self):
        paths=[
          ROOT/"research"/"low_volatility_rank_weighted_v2_prospective.py",
          ROOT/"scripts"/"collect-low-volatility-rank-weighted-v2-prospective.py",
          ROOT/"research"/"run-low-volatility-rank-weighted-v2-prospective.py",
        ]
        banned=[
          "submitOrder","placeOrder","createOrder","cancelOrder","transferFunds",
          "/fapi/v1/order","/fapi/v2/account","X-MBX-APIKEY","apiKey",
          "paperAuthorized\":True","liveAuthorized\":True",
        ]
        body="\n".join(x.read_text() for x in paths)
        for token in banned:
            self.assertNotIn(token,body)

    def test_collector_is_public_market_data_only_and_start_bounded(self):
        body=(ROOT/"scripts"/"collect-low-volatility-rank-weighted-v2-prospective.py").read_text()
        self.assertIn('BASE="https://data.binance.vision/data/futures/um"',body)
        self.assertIn('/daily/klines/',body)
        self.assertIn('/daily/fundingRate/',body)
        self.assertIn('/monthly/klines/',body)
        self.assertIn('/monthly/fundingRate/',body)
        self.assertIn("PROSPECTIVE_START=1791590400000",body)
        self.assertIn("WARMUP_START=1789167600000",body)
        self.assertIn('"credentialsUsed":False',body)
        self.assertIn('"ordersPlaced":False',body)
        self.assertEqual(p.CANONICAL_SNAPSHOT_MAX_LAG_MS,36*p.HOUR)


if __name__=="__main__":
    unittest.main()
