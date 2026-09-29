#!/usr/bin/env python3
import json, os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
IN=Path(os.environ.get("QH_V11_SHARDS_DIR",ROOT/"research"/"results"/"qh-v11-shards"))
OUT=ROOT/"research"/"results"
ASSETS=("BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOGEUSDT","ADAUSDT")
MONTHS=tuple(f"{y:04d}-{m:02d}" for y,ms in ((2025,range(1,13)),(2026,range(1,9))) for m in ms)
EXPECTED={(a,m) for a in ASSETS for m in MONTHS}

rows=[];errors=[]
for p in sorted(IN.rglob("*.json")):
    try:x=json.loads(p.read_text())
    except Exception as e: errors.append(f"INVALID_JSON:{p}:{e}");continue
    if x.get("stage")=="INDIVIDUAL_TRADES_DATA_V1_1_SHARD_QUALITY":rows.append(x)

keys=[(x.get("asset"),x.get("month")) for x in rows];seen=set(keys)
duplicates=sorted({k for k in keys if keys.count(k)>1})
missing=sorted(EXPECTED-seen);unexpected=sorted(seen-EXPECTED)

for x in rows:
    key=f"{x.get('asset')}:{x.get('month')}"
    if x.get("family")!="PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1":errors.append(f"{key}:FAMILY")
    if x.get("gate",{}).get("pass") is not True:errors.append(f"{key}:SHARD_GATE_FAIL")
    audits=x.get("audits",{})
    if audits.get("trades",{}).get("coveragePass") is not True:errors.append(f"{key}:TRADES_COVERAGE")
    if audits.get("trades",{}).get("tradeIdsContiguous") is not True:errors.append(f"{key}:TRADE_ID_CONTINUITY")
    if audits.get("trades",{}).get("timestampUnitDetected")!="MILLISECOND":errors.append(f"{key}:TRADES_TIMESTAMP_UNIT")
    if audits.get("klines1m",{}).get("coveragePass") is not True:errors.append(f"{key}:KLINE_COVERAGE")
    if audits.get("fundingRate",{}).get("coveragePass") is not True:errors.append(f"{key}:FUNDING_COVERAGE")
    for f in ("directionalOrderImbalanceCalculated","forwardReturnsCalculated","signalReturnRelationshipCalculated",
              "positionsCalculated","strategyPnlCalculated","executionImpact","paperAuthorized","liveAuthorized","rawArchivesRetained"):
        if x.get(f) is not False:errors.append(f"{key}:{f}_MUST_BE_FALSE")

if duplicates:errors.append(f"DUPLICATES:{duplicates}")
if missing:errors.append(f"MISSING:{missing}")
if unexpected:errors.append(f"UNEXPECTED:{unexpected}")
if len(rows)!=120:errors.append(f"SHARD_COUNT_NE_120:{len(rows)}")

summary={
 "schema":1,"family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
 "stage":"INDIVIDUAL_TRADES_DATA_V1_1_FULL_DATA_QUALITY",
 "expectedShards":120,"observedShards":len(rows),
 "missingShards":[list(x) for x in missing],"duplicateShards":[list(x) for x in duplicates],
 "unexpectedShards":[list(x) for x in unexpected],
 "tradeRows":sum(x.get("audits",{}).get("trades",{}).get("rows",0) for x in rows),
 "emptyQuarterHourBins":sum(x.get("audits",{}).get("trades",{}).get("emptyQuarterHourBins",0) for x in rows),
 "kline1mRows":sum(x.get("audits",{}).get("klines1m",{}).get("rows",0) for x in rows),
 "fundingRows":sum(x.get("audits",{}).get("fundingRate",{}).get("rows",0) for x in rows),
 "downloadedBytes":{
   "trades":sum(x.get("downloads",{}).get("trades",{}).get("bytes",0) for x in rows),
   "klines1m":sum(x.get("downloads",{}).get("klines1m",{}).get("bytes",0) for x in rows),
   "fundingRate":sum(x.get("downloads",{}).get("fundingRate",{}).get("bytes",0) for x in rows)
 },
 "gateReasons":errors,
 "decision":"INDIVIDUAL_TRADES_DATA_V1_1_PASS_PROTOCOL_PREREGISTRATION_REQUIRED" if not errors else "INDIVIDUAL_TRADES_DATA_V1_1_FAIL_DATA_QUALITY",
 "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
 "signalReturnRelationshipCalculated":False,"positionsCalculated":False,"strategyPnlCalculated":False,
 "executionImpact":False,"paperAuthorized":False,"liveAuthorized":False
}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/"qh-individual-trades-data-v1-1-summary.json").write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps(summary,indent=2))
if errors:raise SystemExit(2)
