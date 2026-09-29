#!/usr/bin/env python3
"""Aggregate 120 strategy-neutral Quarter-Hour Data V1 shard manifests."""
import json
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
IN=Path(os.environ.get("QH_V1_SHARD_RESULTS_DIR",ROOT/"research"/"results"/"qh-v1-shards"))
OUT=ROOT/"research"/"results"
ASSETS=("BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOGEUSDT","ADAUSDT")
MONTHS=tuple(
    f"{y:04d}-{m:02d}"
    for y, months in ((2025,range(1,13)),(2026,range(1,9)))
    for m in months
)
EXPECTED={(a,m) for a in ASSETS for m in MONTHS}

files=sorted(IN.rglob("*.json"))
rows=[]
errors=[]
for p in files:
    try:
        x=json.loads(p.read_text())
    except Exception as e:
        errors.append(f"INVALID_JSON:{p}:{e}")
        continue
    if x.get("stage")!="DATA_V1_SHARD_QUALITY":
        continue
    rows.append(x)

keys=[(x.get("asset"),x.get("month")) for x in rows]
seen=set(keys)
duplicates=sorted({k for k in keys if keys.count(k)>1})
missing=sorted(EXPECTED-seen)
unexpected=sorted(seen-EXPECTED)

for x in rows:
    key=f"{x.get('asset')}:{x.get('month')}"
    if x.get("family")!="PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1":
        errors.append(f"{key}:FAMILY_MISMATCH")
    if x.get("gate",{}).get("pass") is not True:
        errors.append(f"{key}:SHARD_GATE_FAIL")
    for flag in (
        "directionalOrderImbalanceCalculated",
        "forwardReturnsCalculated",
        "signalReturnRelationshipCalculated",
        "positionsCalculated",
        "strategyPnlCalculated",
        "executionImpact",
        "paperAuthorized",
        "liveAuthorized",
        "rawArchivesRetained",
    ):
        if x.get(flag) is not False:
            errors.append(f"{key}:{flag}_MUST_BE_FALSE")

    audits=x.get("audits",{})
    for fam in ("aggTrades","klines1m","fundingRate"):
        if audits.get(fam,{}).get("coveragePass") is not True:
            errors.append(f"{key}:{fam}_COVERAGE_FAIL")

    if audits.get("aggTrades",{}).get("timestampUnitDetected")!="MILLISECOND":
        errors.append(f"{key}:UNEXPECTED_AGGTRADES_TIMESTAMP_UNIT")
    if audits.get("klines1m",{}).get("timestampUnitsDetected")!=["MILLISECOND"]:
        errors.append(f"{key}:UNEXPECTED_KLINE_TIMESTAMP_UNIT")

if duplicates:
    errors.append(f"DUPLICATE_SHARDS:{duplicates}")
if missing:
    errors.append(f"MISSING_SHARDS:{missing}")
if unexpected:
    errors.append(f"UNEXPECTED_SHARDS:{unexpected}")
if len(rows)!=120:
    errors.append(f"SHARD_COUNT_NE_120:{len(rows)}")

agg_bytes=sum(x["downloads"]["aggTrades"]["bytes"] for x in rows if "downloads" in x)
kline_bytes=sum(x["downloads"]["klines1m"]["bytes"] for x in rows if "downloads" in x)
funding_bytes=sum(x["downloads"]["fundingRate"]["bytes"] for x in rows if "downloads" in x)
agg_rows=sum(x["audits"]["aggTrades"]["rows"] for x in rows if "audits" in x)
empty_qh=sum(x["audits"]["aggTrades"]["emptyQuarterHourBins"] for x in rows if "audits" in x)
kline_rows=sum(x["audits"]["klines1m"]["rows"] for x in rows if "audits" in x)
funding_rows=sum(x["audits"]["fundingRate"]["rows"] for x in rows if "audits" in x)

summary={
  "schema":1,
  "family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
  "stage":"DATA_V1_SHARDED_FULL_DATA_QUALITY",
  "assets":list(ASSETS),
  "months":list(MONTHS),
  "expectedShards":120,
  "observedShards":len(rows),
  "missingShards":[list(x) for x in missing],
  "duplicateShards":[list(x) for x in duplicates],
  "unexpectedShards":[list(x) for x in unexpected],
  "aggregateTradeRows":agg_rows,
  "emptyQuarterHourBins":empty_qh,
  "kline1mRows":kline_rows,
  "fundingRows":funding_rows,
  "downloadedBytes":{
    "aggTrades":agg_bytes,
    "klines1m":kline_bytes,
    "fundingRate":funding_bytes
  },
  "gateReasons":errors,
  "decision":"FOUNDATION_DATA_V1_PASS_PROTOCOL_PREREGISTRATION_REQUIRED" if not errors else "FOUNDATION_DATA_V1_FAIL_DATA_QUALITY",
  "directionalOrderImbalanceCalculated":False,
  "forwardReturnsCalculated":False,
  "signalReturnRelationshipCalculated":False,
  "positionsCalculated":False,
  "strategyPnlCalculated":False,
  "executionImpact":False,
  "paperAuthorized":False,
  "liveAuthorized":False
}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/"quarter-hour-boundary-imbalance-v1-data-v1-summary.json").write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps(summary,indent=2))
if errors:
    raise SystemExit(2)
