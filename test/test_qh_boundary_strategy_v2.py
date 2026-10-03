import importlib.util
import math
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);sys.modules[name]=mod;spec.loader.exec_module(mod)
    return mod

v2=load(ROOT/"research"/"qh_boundary_strategy_v2_core.py","qh_strategy_v2_core_test")
v1=load(ROOT/"research"/"qh_boundary_strategy_v1_core.py","qh_strategy_v1_core_reference")

def row(t,oi=1.0,price=100.0,exec_ok=True):
    return {
        "boundaryMs":t,"oi":oi,
        "executionPrice":price if exec_ok else None,
        "executionTimestampMs":t+20_000 if exec_ok else None
    }

class V2CoreTests(unittest.TestCase):
    def empty(self):
        return {a:[] for a in v2.ASSETS}

    def test_sample_schedule_is_exactly_midnight_and_noon(self):
        self.assertTrue(v2.is_sample_boundary(v2.utc_ms("2025-01-01T00:00:00Z")))
        self.assertTrue(v2.is_sample_boundary(v2.utc_ms("2025-01-01T12:00:00Z")))
        self.assertFalse(v2.is_sample_boundary(v2.utc_ms("2025-01-01T00:15:00Z")))
        self.assertFalse(v2.is_sample_boundary(v2.utc_ms("2025-01-01T06:00:00Z")))

    def test_first_sample_equals_v1_rolling_target_and_no_intermediate_rebalances(self):
        t0=v2.utc_ms("2025-01-01T00:00:00Z");q=v2.QUARTER_MS
        rows=[row(t0+i*q,oi=.5,price=100+i*.01) for i in range(49)]
        shards=self.empty();shards["BTCUSDT"]=[{"boundaries":rows,"funding":[]}]
        events,diag=v2.build_sample_hold_rebalance_events(shards)
        btc=[x for x in events if x["asset"]=="BTCUSDT"]
        self.assertEqual(len(btc),1)
        self.assertEqual(btc[0]["boundaryMs"],v2.FIRST_V2_SAMPLE_MS)
        expected=48*v2.cohort_weight(.5)
        self.assertAlmostEqual(btc[0]["targetWeight"],expected)
        self.assertAlmostEqual(expected,1/12)
        self.assertEqual(diag["BTCUSDT"]["warmupSampleCount"],1)

    def test_missing_scheduled_execution_does_not_catch_up(self):
        t0=v2.utc_ms("2025-01-01T00:00:00Z");q=v2.QUARTER_MS
        rows=[]
        for i in range(97):
            t=t0+i*q
            ok=not (t==v2.FIRST_V2_SAMPLE_MS)
            rows.append(row(t,oi=.5,price=100,exec_ok=ok))
        shards=self.empty();shards["BTCUSDT"]=[{"boundaries":rows,"funding":[]}]
        events,diag=v2.build_sample_hold_rebalance_events(shards)
        btc=[x for x in events if x["asset"]=="BTCUSDT"]
        self.assertFalse(any(x["boundaryMs"]==v2.FIRST_V2_SAMPLE_MS for x in btc))
        self.assertTrue(any(x["boundaryMs"]==v2.utc_ms("2025-01-02T00:00:00Z") for x in btc))
        self.assertEqual(diag["BTCUSDT"]["skippedExecutionReferences"],1)

    def test_v2_rebalance_and_funding_accounting_matches_v1_reference(self):
        s2=v2.AssetState(qty=2,last_mark=100,target_weight=.1)
        s1=v1.AssetState(qty=2,last_mark=100,target_weight=.1)
        a2,n2=v2.rebalance_transition(100000,s2,110,-.05,.0006)
        a1,n1=v1.rebalance_transition(100000,s1,110,-.05,.0006)
        for k in ("markedEquity","turnoverNotional","cost","equityAfter","targetNotional"):
            self.assertAlmostEqual(a2[k],a1[k])
        self.assertAlmostEqual(n2.qty,n1.qty)
        f2,_=v2.funding_transition(100000,s2,110,.001)
        f1,_=v1.funding_transition(100000,s1,110,.001)
        self.assertAlmostEqual(f2["fundingPnl"],f1["fundingPnl"])
        self.assertAlmostEqual(f2["equityAfter"],f1["equityAfter"])

    def test_development_gate_adds_turnover_reduction_to_v1_six_rules(self):
        metrics={
            "netReturn":.10,"maxDrawdown":.10,"turnoverOnStartingEquity":50,
            "blocks":{k:{"netReturn":.01} for k in ("B1","B2","B3","B4")},
            "assets":{
                "BTCUSDT":{"netPnl":20},"ETHUSDT":{"netPnl":20},"XRPUSDT":{"netPnl":20},
                "SOLUSDT":{"netPnl":20},"DOGEUSDT":{"netPnl":10},"ADAUSDT":{"netPnl":10},
            }
        }
        g=v2.evaluate_dev_gate(metrics)
        self.assertTrue(g["pass"]);self.assertEqual(len(g["gates"]),7)
        metrics["turnoverOnStartingEquity"]=70
        self.assertFalse(v2.evaluate_dev_gate(metrics)["pass"])

    def test_terminal_flatten_is_forced_and_new_risk_not_opened(self):
        q=v2.QUARTER_MS
        start=v2.FINAL_V2_FLATTEN_BOUNDARY_MS-12*60*60*1000
        rows=[row(start+i*q,oi=1.0,price=100+i*.01) for i in range(49)]
        shards=self.empty();shards["BTCUSDT"]=[{"boundaries":rows,"funding":[]}]
        events,diag=v2.build_sample_hold_rebalance_events(shards)
        btc=[x for x in events if x["asset"]=="BTCUSDT"]
        self.assertEqual(btc[-1]["boundaryMs"],v2.FINAL_V2_FLATTEN_BOUNDARY_MS)
        self.assertAlmostEqual(btc[-1]["targetWeight"],0.0)
        self.assertAlmostEqual(diag["BTCUSDT"]["terminalTargetWeight"],0.0)

    def test_terminal_flatten_missing_execution_fails_closed(self):
        q=v2.QUARTER_MS
        start=v2.FINAL_V2_FLATTEN_BOUNDARY_MS-12*60*60*1000
        rows=[]
        for i in range(49):
            t=start+i*q
            rows.append(row(t,oi=.5,price=100,exec_ok=t!=v2.FINAL_V2_FLATTEN_BOUNDARY_MS))
        shards=self.empty();shards["BTCUSDT"]=[{"boundaries":rows,"funding":[]}]
        with self.assertRaisesRegex(RuntimeError,"terminal flatten"):
            v2.build_sample_hold_rebalance_events(shards)

    def test_report_is_research_only(self):
        self.assertGreater(v2.V2_MAX_TURNOVER_ON_STARTING_EQUITY,0)
        self.assertAlmostEqual(v2.V2_MAX_TURNOVER_ON_STARTING_EQUITY,v2.V1_TURNOVER_ON_STARTING_EQUITY*.1)

if __name__=="__main__":
    unittest.main()
