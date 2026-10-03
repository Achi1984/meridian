#!/usr/bin/env python3
"""Aggregate frozen Strategy V1 compact source shards into Strategy V2 development evidence.

This script has no Paper/live execution path. It consumes only the 120 compact
source shards produced by historical Strategy V1 run 37029699996.
"""
from __future__ import annotations
import importlib.util
import json
import math
import os
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
IN=Path(os.environ.get("QH_STRATEGY_V2_SOURCE_DIR",ROOT/"research"/"results"/"qh-strategy-v2-source"))
OUT=Path(os.environ.get("QH_STRATEGY_V2_RESULT_DIR",ROOT/"research"/"results"))
V1_SUMMARY=ROOT/"research"/"quarter-hour-boundary-imbalance-strategy-v1-result-summary.json"
ASSETS=("BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOGEUSDT","ADAUSDT")
MONTHS=tuple(f"{y:04d}-{m:02d}" for y,ms in ((2025,range(1,13)),(2026,range(1,9))) for m in ms)
EXPECTED={(a,m) for a in ASSETS for m in MONTHS}

def load_core():
    path=ROOT/"research"/"qh_boundary_strategy_v2_core.py"
    spec=importlib.util.spec_from_file_location("qh_strategy_v2_core",path)
    mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod;spec.loader.exec_module(mod)
    return mod

def load_v1_summary():
    x=json.loads(V1_SUMMARY.read_text())
    if x.get("decision")!="STRATEGY_V1_FAIL":raise RuntimeError("V1 result lock decision changed")
    if x.get("paperAuthorized") is not False or x.get("liveAuthorized") is not False:raise RuntimeError("unsafe V1 result lock")
    if int(x.get("evidence",{}).get("strategyRun",0))!=37029699996:raise RuntimeError("unexpected V1 strategy run")
    return x

def load_shards():
    rows=[];errors=[]
    for p in sorted(IN.rglob("*.json")):
        try:x=json.loads(p.read_text())
        except Exception as exc:
            errors.append(f"INVALID_JSON:{p}:{exc}");continue
        if x.get("stage")=="STRATEGY_V1_COMPACT_SOURCE_SHARD":rows.append(x)
    keys=[(x.get("asset"),x.get("month")) for x in rows];seen=set(keys)
    duplicates=sorted({k for k in keys if keys.count(k)>1});missing=sorted(EXPECTED-seen);unexpected=sorted(seen-EXPECTED)
    if errors or duplicates or missing or unexpected or len(rows)!=120:
        raise RuntimeError(json.dumps({"errors":errors,"duplicates":duplicates,"missing":missing,"unexpected":unexpected,"observed":len(rows)}))
    by_asset={a:[] for a in ASSETS}
    for x in rows:
        if x.get("family")!="PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1":raise RuntimeError("wrong source family")
        if x.get("ruleset")!="QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V1-FROZEN":raise RuntimeError("wrong source ruleset")
        if x.get("dataDependency")!="INDIVIDUAL_TRADES_DATA_V1_3_120_OF_120_PASS":raise RuntimeError("wrong data dependency")
        if x.get("exactV13SourceLockVerified") is not True:raise RuntimeError("source lock not verified")
        if x.get("forwardReturnsCalculated") is not False or x.get("positionsCalculated") is not False or x.get("strategyPnlCalculated") is not False:
            raise RuntimeError("source shard contains forbidden outcome state")
        if x.get("paperAuthorized") is not False or x.get("liveAuthorized") is not False or x.get("executionImpact") is not False:
            raise RuntimeError("unsafe source shard")
        by_asset[x["asset"]].append(x)
    for a in ASSETS:by_asset[a].sort(key=lambda x:x["month"])
    return by_asset

def fill_cross_month_funding_refs(by_asset):
    unresolved=[]
    for asset,shards in by_asset.items():
        prior_last=None
        for shard in shards:
            for f in shard.get("funding",[]):
                if f.get("referencePrice") is None:
                    if prior_last is not None and prior_last["timestampMs"]<=f["timestampMs"]:
                        f["referenceTimestampMs"]=prior_last["timestampMs"]
                        f["referenceSourceRecordOrdinal"]=prior_last.get("sourceRecordOrdinal")
                        f["referencePrice"]=prior_last["price"]
                        f["referenceSource"]="PREVIOUS_MONTH_LAST_TRADE"
                    else:
                        unresolved.append((asset,shard["month"],f["timestampMs"]))
            prior_last=shard.get("lastTrade")
    for asset,month,ts in unresolved:
        if month!="2025-01":raise RuntimeError(f"unresolved funding reference after first month: {asset}:{month}:{ts}")
    return unresolved

def json_safe(x):
    if isinstance(x,float) and not math.isfinite(x):
        if math.isinf(x):return "+Infinity" if x>0 else "-Infinity"
        return None
    if isinstance(x,dict):return {k:json_safe(v) for k,v in x.items()}
    if isinstance(x,list):return [json_safe(v) for v in x]
    return x

def run():
    core=load_core();v1=load_v1_summary();by_asset=load_shards();unresolved=fill_cross_month_funding_refs(by_asset)
    report=core.build_full_report(by_asset);primary=report["primary"]
    report.update({
        "sourceDependency":{
            "strategyV1Run":37029699996,
            "strategyV1ResultArtifactId":11241728193,
            "strategyV1ResultJsonSha256":"3b0a14d70067afb2bd429accdfa3079de4d16da9b58c7828b5f27a4c0d2cb9a7",
            "strategyV1ResultSummaryGitBlobSha":"0d85a4d5d728c52c813e3a7a69d416efcbbd53e9",
            "dataV13Run":36690368732,
            "expectedShards":120,"observedShards":120
        },
        "v1ResultLockDecision":v1["decision"],
        "sourceShardCount":120,
        "unresolvedZeroExposureInitialFundingReferences":[{"asset":a,"month":m,"timestampMs":t} for a,m,t in unresolved],
        "directionalOrderImbalanceCalculated":True,
        "forwardReturnsCalculated":False,
        "positionsCalculated":True,
        "strategyPnlCalculated":True,
        "executionImpact":False,"paperAuthorized":False,"liveAuthorized":False,
        "decision":primary["developmentGate"]["decision"],
        "holdoutRequired":primary["developmentGate"]["pass"] is True,
        "holdoutWindow":"2026-09-01/2027-02-28"
    })
    OUT.mkdir(parents=True,exist_ok=True)
    path=OUT/"quarter-hour-boundary-imbalance-strategy-v2-development-result.json"
    path.write_text(json.dumps(json_safe(report),indent=2,allow_nan=False)+"\n")
    print(json.dumps({
        "decision":report["decision"],
        "netReturn":primary["netReturn"],
        "maxDrawdown":primary["maxDrawdown"],
        "dailyProfitFactor":primary["dailyProfitFactor"],
        "turnoverOnStartingEquity":primary["turnoverOnStartingEquity"],
        "turnoverReductionVsV1":primary["turnoverReductionVsV1"],
        "rebalanceCount":primary["rebalanceCount"],
        "output":str(path),"paperAuthorized":False,"liveAuthorized":False
    },indent=2))

if __name__=="__main__":
    run()
