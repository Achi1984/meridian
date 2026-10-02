import csv
import importlib.util
import io
import math
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);sys.modules[name]=mod;spec.loader.exec_module(mod)
    return mod

core=load(ROOT/"research"/"qh_boundary_strategy_v1_core.py","qh_strategy_v1_core_test")
os.environ["QH_ASSET"]="BTCUSDT"
os.environ["QH_MONTH"]="2025-01"
extractor=load(ROOT/"scripts"/"extract-qh-boundary-strategy-v1-shard.py","qh_strategy_v1_extract_test")
aggregate=load(ROOT/"scripts"/"aggregate-qh-boundary-strategy-v1.py","qh_strategy_v1_aggregate_test")
source_lock=load(ROOT/"scripts"/"build-qh-v13-source-lock.py","qh_strategy_v1_source_lock_test")

class FakeV13:
    MONTH_START_MS=1_000_000_000_000
    MONTH_END_MS=MONTH_START_MS+30*60_000
    @staticmethod
    def open_csv(path):
        zf=zipfile.ZipFile(path)
        names=[n for n in zf.namelist() if not n.endswith("/")]
        raw=zf.open(names[0],"r")
        text=io.TextIOWrapper(raw,encoding="utf-8",newline="")
        return zf,raw,text,csv.reader(text)
    @staticmethod
    def is_header(row,fam):
        if fam=="trades":return row and row[0].lower()=="id"
        if fam=="fundingRate":return row and "funding" in ",".join(x.lower() for x in row)
        return False
    @staticmethod
    def funding_indices(header):
        idx={x:i for i,x in enumerate(header)}
        return idx["fundingTime"],idx["fundingRate"]
    @staticmethod
    def ts_ms(v):return int(v),"MILLISECOND"
    @staticmethod
    def finite(v,positive=False,nonnegative=False):
        x=float(v)
        if not math.isfinite(x):raise ValueError("non-finite")
        if positive and x<=0:raise ValueError("expected positive")
        if nonnegative and x<0:raise ValueError("expected nonnegative")
        return x
    @staticmethod
    def strict_bool(v):
        s=str(v).lower()
        if s=="true":return True
        if s=="false":return False
        raise ValueError("invalid Boolean")

def write_zip(path,name,rows):
    with zipfile.ZipFile(path,"w",compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(name,"\n".join(rows)+"\n")

class StrategyCoreTests(unittest.TestCase):
    def test_direction_and_imbalance(self):
        self.assertEqual(core.signed_direction(False),1.0)
        self.assertEqual(core.signed_direction(True),-1.0)
        self.assertAlmostEqual(core.normalized_imbalance(1.0,3.0),1/3)
        self.assertIsNone(core.normalized_imbalance(0,0))

    def test_cohort_weight_caps_asset_after_full_48_event_stack(self):
        w=core.cohort_weight(1.0,48)
        self.assertAlmostEqual(w,1/288)
        self.assertAlmostEqual(48*w,1/6)

    def test_build_rebalances_keeps_virtual_cohorts_when_execution_missing(self):
        t=core.utc_ms("2025-01-01T00:00:00Z")
        shards={a:[] for a in core.ASSETS}
        shards["BTCUSDT"]=[{"boundaries":[
            {"boundaryMs":t,"oi":1.0,"executionPrice":None,"executionTimestampMs":None},
            {"boundaryMs":t+core.QUARTER_MS,"oi":1.0,"executionPrice":100.0,"executionTimestampMs":t+core.QUARTER_MS+20_000},
        ],"funding":[]}]
        events,diag=core.build_rebalance_events(shards,48,False)
        self.assertEqual(len(events),1)
        self.assertAlmostEqual(events[0]["targetWeight"],2*core.cohort_weight(1.0,48))
        self.assertEqual(diag["BTCUSDT"]["missingSignalEvents"],0)

    def test_right_edge_censoring_keeps_full_horizon_and_flattens_terminal_target(self):
        q=core.QUARTER_MS
        final=core.FINAL_EXECUTABLE_BOUNDARY_MS
        shards={a:[] for a in core.ASSETS}
        shards["BTCUSDT"]=[{"boundaries":[
            {"boundaryMs":final-2*q,"oi":1.0,"executionPrice":100.0,"executionTimestampMs":final-2*q+20_000},
            {"boundaryMs":final-q,"oi":1.0,"executionPrice":101.0,"executionTimestampMs":final-q+20_000},
            {"boundaryMs":final,"oi":1.0,"executionPrice":102.0,"executionTimestampMs":final+20_000},
        ],"funding":[]}]
        events,diag=core.build_rebalance_events(shards,horizon_events=2,suppress_funding_boundaries=False)
        self.assertEqual(diag["BTCUSDT"]["rightCensoredSignalEvents"],2)
        self.assertAlmostEqual(diag["BTCUSDT"]["terminalTargetWeight"],0.0)
        self.assertAlmostEqual(events[-1]["targetWeight"],0.0)

    def test_rebalance_cost_is_absolute_net_turnover_at_6bp(self):
        state=core.AssetState()
        tr,state=core.rebalance_transition(100_000,state,100,1/6,.0006)
        self.assertAlmostEqual(tr["targetNotional"],100_000/6)
        self.assertAlmostEqual(tr["turnoverNotional"],100_000/6)
        self.assertAlmostEqual(tr["cost"],10.0)
        self.assertAlmostEqual(tr["equityAfter"],99_990.0)

    def test_funding_sign_and_last_mark(self):
        long=core.AssetState(qty=2,last_mark=100,target_weight=.1)
        tr,state=core.funding_transition(100_000,long,110,.001)
        self.assertAlmostEqual(tr["pricePnl"],20)
        self.assertAlmostEqual(tr["fundingPnl"],-0.22)
        self.assertAlmostEqual(tr["equityAfter"],100_019.78)
        short=core.AssetState(qty=-2,last_mark=100,target_weight=-.1)
        tr,_=core.funding_transition(100_000,short,110,.001)
        self.assertAlmostEqual(tr["pricePnl"],-20)
        self.assertAlmostEqual(tr["fundingPnl"],0.22)

    def test_missing_initial_funding_reference_is_allowed_only_flat(self):
        flat=core.AssetState()
        tr,state=core.funding_transition(100_000,flat,None,.001)
        self.assertEqual(tr["equityAfter"],100_000)
        with self.assertRaisesRegex(RuntimeError,"missing"):
            core.funding_transition(100_000,core.AssetState(qty=1,last_mark=100),None,.001)

    def test_block_boundaries_are_frozen(self):
        self.assertEqual(core.block_id(core.utc_ms("2025-05-31T23:59:59Z")),"B1")
        self.assertEqual(core.block_id(core.utc_ms("2025-06-01T00:00:00Z")),"B2")
        self.assertEqual(core.block_id(core.utc_ms("2026-04-01T00:00:00Z")),"B4")

    def test_primary_gate_uses_exact_six_preregistered_rules(self):
        metrics={
          "netReturn":.10,"maxDrawdown":.10,
          "blocks":{k:{"netReturn":.01} for k in ("B1","B2","B3","B4")},
          "assets":{
            "BTCUSDT":{"netPnl":20},"ETHUSDT":{"netPnl":20},"XRPUSDT":{"netPnl":20},
            "SOLUSDT":{"netPnl":20},"DOGEUSDT":{"netPnl":10},"ADAUSDT":{"netPnl":10},
          }
        }
        g=core.evaluate_primary_gate(metrics)
        self.assertTrue(g["pass"])
        self.assertEqual(len(g["gates"]),6)
        metrics["blocks"]["B4"]["netReturn"]=-.01
        self.assertFalse(core.evaluate_primary_gate(metrics)["pass"])

class ExtractorTests(unittest.TestCase):
    def test_timestamp_binning_exec_price_and_funding_reference_are_no_lookahead(self):
        v=FakeV13()
        s=v.MONTH_START_MS
        trades=[
          "id,price,qty,quote_qty,time,is_buyer_maker",
          f"1,100,2,200,{s+1_000},false",
          f"2,101,1,101,{s+2_000},true",
          f"3,103,1,103,{s+20_000},false",
          f"4,102,1,102,{s+15_000},false",
          f"5,110,1,110,{s+14*60_000},false",
          f"6,109,1,109,{s+13*60_000},false",
          f"7,120,1,120,{s+15*60_000+1_000},false",
          f"8,121,1,121,{s+15*60_000+15_000},false",
        ]
        funding=[
          "fundingTime,fundingRate",
          f"{s+15*60_000},0.001",
        ]
        with tempfile.TemporaryDirectory() as td:
            tp=Path(td)/"t.zip";fp=Path(td)/"f.zip"
            write_zip(tp,"trades.csv",trades);write_zip(fp,"funding.csv",funding)
            x=extractor.extract_compact(v,tp,fp)
        self.assertAlmostEqual(x["boundaries"][0]["oi"],1/3)
        self.assertEqual(x["boundaries"][0]["executionTimestampMs"],s+15_000)
        self.assertEqual(x["boundaries"][0]["executionPrice"],102)
        self.assertEqual(x["funding"][0]["referenceTimestampMs"],s+14*60_000)
        self.assertEqual(x["funding"][0]["referencePrice"],110)
        self.assertEqual(x["missingSignalEvents"],0)

    def test_exact_v13_source_lock_mismatch_fails_closed(self):
        downloads={
          "trades":{"sha256":"a"*64,"bytes":100},
          "fundingRate":{"sha256":"b"*64,"bytes":10},
        }
        expected={
          "trades":{"sha256":"c"*64,"bytes":100},
          "fundingRate":{"sha256":"b"*64,"bytes":10},
        }
        with self.assertRaisesRegex(RuntimeError,"source lock mismatch"):
            extractor.verify_source_lock(downloads,expected)

    def test_v13_source_lock_builder_requires_and_emits_exact_120(self):
        with tempfile.TemporaryDirectory() as td:
            evidence=Path(td)/"e";evidence.mkdir()
            out=Path(td)/"lock.json"
            for ai,a in enumerate(core.ASSETS):
                for mi,m in enumerate(source_lock.MONTHS):
                    x={
                      "stage":"INDIVIDUAL_TRADES_DATA_V1_3_SHARD_QUALITY",
                      "asset":a,"month":m,
                      "gate":{"pass":True},
                      "strategyPnlCalculated":False,"positionsCalculated":False,
                      "downloads":{
                        "trades":{"sha256":f"{ai:02x}{mi:02x}".ljust(64,"a"),"bytes":100+mi},
                        "fundingRate":{"sha256":f"{mi:02x}{ai:02x}".ljust(64,"b"),"bytes":10+mi},
                      }
                    }
                    (evidence/f"{a}-{m}.json").write_text(__import__("json").dumps(x))
            old_in,old_out=source_lock.IN,source_lock.OUT
            source_lock.IN,source_lock.OUT=evidence,out
            try:source_lock.build()
            finally:source_lock.IN,source_lock.OUT=old_in,old_out
            lock=__import__("json").loads(out.read_text())
        self.assertEqual(lock["observedShards"],120)
        self.assertEqual(len(lock["records"]),120)
        self.assertIn("BTCUSDT:2025-01",lock["records"])

    def test_cross_month_funding_reference_uses_previous_month_last_trade_only(self):
        by={"BTCUSDT":[
          {"month":"2025-01","funding":[{"timestampMs":100,"referencePrice":None,"referenceTimestampMs":None}],
           "lastTrade":{"timestampMs":999,"price":10,"sourceRecordOrdinal":5}},
          {"month":"2025-02","funding":[{"timestampMs":1000,"referencePrice":None,"referenceTimestampMs":None}],
           "lastTrade":{"timestampMs":1999,"price":11,"sourceRecordOrdinal":6}},
        ]}
        for a in core.ASSETS:
            by.setdefault(a,[])
        unresolved=aggregate.fill_cross_month_funding_refs(by)
        self.assertEqual(unresolved,[("BTCUSDT","2025-01",100)])
        self.assertEqual(by["BTCUSDT"][1]["funding"][0]["referencePrice"],10)
        self.assertEqual(by["BTCUSDT"][1]["funding"][0]["referenceSource"],"PREVIOUS_MONTH_LAST_TRADE")

if __name__=="__main__":
    unittest.main()
