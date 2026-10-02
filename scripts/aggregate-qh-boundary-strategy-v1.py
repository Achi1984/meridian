#!/usr/bin/env python3
"""Aggregate 120 compact Strategy V1 source shards into the preregistered research result.

This script is intended for a separately authorized historical evidence run only.
It has no Paper/live execution path.
"""
from __future__ import annotations
import importlib.util
import json
import math
import os
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
IN=Path(os.environ.get("QH_STRATEGY_SHARDS_DIR",ROOT/"research"/"results"/"qh-strategy-v1-shards"))
OUT=Path(os.environ.get("QH_STRATEGY_RESULT_DIR",ROOT/"research"/"results"))
ASSETS=("BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOGEUSDT","ADAUSDT")
MONTHS=tuple(f"{y:04d}-{m:02d}" for y,ms in ((2025,range(1,13)),(2026,range(1,9))) for m in ms)
EXPECTED={(a,m) for a in ASSETS for m in MONTHS}

def load_core():
    path=ROOT/"research"/"qh_boundary_strategy_v1_core.py"
    spec=importlib.util.spec_from_file_location("qh_strategy_v1_core",path)
    mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod;spec.loader.exec_module(mod)
    return mod

def load_shards():
    rows=[];errors=[]
    for p in sorted(IN.rglob("*.json")):
        try:x=json.loads(p.read_text())
        except Exception as exc:
            errors.append(f"INVALID_JSON:{p}:{exc}");continue
        if x.get("stage")=="STRATEGY_V1_COMPACT_SOURCE_SHARD":
            rows.append(x)
    keys=[(x.get("asset"),x.get("month")) for x in rows]
    seen=set(keys)
    duplicates=sorted({k for k in keys if keys.count(k)>1})
    missing=sorted(EXPECTED-seen)
    unexpected=sorted(seen-EXPECTED)
    if errors or duplicates or missing or unexpected or len(rows)!=120:
        raise RuntimeError(json.dumps({
            "errors":errors,"duplicates":duplicates,"missing":missing,
            "unexpected":unexpected,"observed":len(rows)
        }))
    by_asset={a:[] for a in ASSETS}
    for x in rows:
        if x.get("dataDependency")!="INDIVIDUAL_TRADES_DATA_V1_3_120_OF_120_PASS":
            raise RuntimeError(f"{x.get('asset')}:{x.get('month')}:wrong data dependency")
        if x.get("exactV13SourceLockVerified") is not True:
            raise RuntimeError(f"{x.get('asset')}:{x.get('month')}:exact V1.3 source lock not verified")
        if x.get("forwardReturnsCalculated") is not False or x.get("positionsCalculated") is not False or x.get("strategyPnlCalculated") is not False:
            raise RuntimeError(f"{x.get('asset')}:{x.get('month')}:pre-aggregate leakage flag")
        if x.get("paperAuthorized") is not False or x.get("liveAuthorized") is not False or x.get("executionImpact") is not False:
            raise RuntimeError(f"{x.get('asset')}:{x.get('month')}:unsafe authorization flag")
        by_asset[x["asset"]].append(x)
    for a in ASSETS:
        by_asset[a].sort(key=lambda x:x["month"])
    return by_asset

def fill_cross_month_funding_refs(by_asset):
    unresolved=[]
    for asset,shards in by_asset.items():
        prior_last=None
        for shard in shards:
            funding=shard.get("funding",[])
            for f in funding:
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
        if month!="2025-01":
            raise RuntimeError(f"unresolved funding reference after first month: {asset}:{month}:{ts}")
    return unresolved

def json_safe(x):
    if isinstance(x,float) and not math.isfinite(x):
        if math.isinf(x):return "+Infinity" if x>0 else "-Infinity"
        return None
    if isinstance(x,dict):return {k:json_safe(v) for k,v in x.items()}
    if isinstance(x,list):return [json_safe(v) for v in x]
    return x

def run():
    core=load_core()
    by_asset=load_shards()
    unresolved=fill_cross_month_funding_refs(by_asset)
    report=core.build_full_report(by_asset)
    primary=report["primary"]
    report.update({
        "dataDependency":{
            "version":"V1.3",
            "fullRun":36690368732,
            "aggregateArtifactId":11090766829,
            "aggregateDigest":"sha256:49211d4059f8cecc38133f8bea9ac5b4ce9bf23a041c242440cb25b335dbb344",
            "expectedShards":120,
            "observedShards":120
        },
        "sourceShardCount":120,
        "unresolvedZeroExposureInitialFundingReferences":[
            {"asset":a,"month":m,"timestampMs":t} for a,m,t in unresolved
        ],
        "directionalOrderImbalanceCalculated":True,
        "forwardReturnsCalculated":False,
        "positionsCalculated":True,
        "strategyPnlCalculated":True,
        "executionImpact":False,
        "paperAuthorized":False,
        "liveAuthorized":False,
        "decision":primary["primaryGate"]["decision"],
    })
    OUT.mkdir(parents=True,exist_ok=True)
    path=OUT/"quarter-hour-boundary-imbalance-strategy-v1-result.json"
    path.write_text(json.dumps(json_safe(report),indent=2,allow_nan=False)+"\n")
    print(json.dumps({
        "decision":report["decision"],
        "netReturn":primary["netReturn"],
        "maxDrawdown":primary["maxDrawdown"],
        "dailyProfitFactor":primary["dailyProfitFactor"],
        "positiveAssetCount":primary["primaryGate"]["positiveAssetCount"],
        "positivePnlConcentration":primary["primaryGate"]["positivePnlConcentration"],
        "output":str(path),
        "paperAuthorized":False,
        "liveAuthorized":False
    },indent=2))

if __name__=="__main__":
    run()
