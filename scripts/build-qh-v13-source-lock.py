#!/usr/bin/env python3
"""Build an exact source checksum lock from the successful Data V1.3 shard evidence."""
from __future__ import annotations
import json
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
IN=Path(os.environ.get("QH_V13_EVIDENCE_DIR",ROOT/"research"/"results"/"qh-v13-source-evidence"))
OUT=Path(os.environ.get("QH_V13_SOURCE_LOCK_OUTPUT",ROOT/"research"/"results"/"qh-v13-source-lock.json"))
ASSETS=("BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOGEUSDT","ADAUSDT")
MONTHS=tuple(f"{y:04d}-{m:02d}" for y,ms in ((2025,range(1,13)),(2026,range(1,9))) for m in ms)
EXPECTED={(a,m) for a in ASSETS for m in MONTHS}

def build():
    rows=[]
    for p in sorted(IN.rglob("*.json")):
        x=json.loads(p.read_text())
        if x.get("stage")=="INDIVIDUAL_TRADES_DATA_V1_3_SHARD_QUALITY":
            rows.append(x)
    keys=[(x.get("asset"),x.get("month")) for x in rows]
    seen=set(keys)
    duplicates=sorted({k for k in keys if keys.count(k)>1})
    missing=sorted(EXPECTED-seen)
    unexpected=sorted(seen-EXPECTED)
    if len(rows)!=120 or duplicates or missing or unexpected:
        raise RuntimeError(json.dumps({
            "observed":len(rows),"duplicates":duplicates,"missing":missing,"unexpected":unexpected
        }))
    lock={}
    for x in rows:
        key=f"{x['asset']}:{x['month']}"
        if x.get("gate",{}).get("pass") is not True:
            raise RuntimeError(f"{key}: Data V1.3 shard gate is not PASS")
        if x.get("strategyPnlCalculated") is not False or x.get("positionsCalculated") is not False:
            raise RuntimeError(f"{key}: unexpected Data V1.3 leakage flag")
        d=x.get("downloads",{})
        record={}
        for fam in ("trades","fundingRate"):
            item=d.get(fam,{})
            sha=str(item.get("sha256",""))
            size=item.get("bytes")
            if len(sha)!=64 or any(ch not in "0123456789abcdef" for ch in sha.lower()):
                raise RuntimeError(f"{key}:{fam}: invalid sha256")
            if not isinstance(size,int) or size<=0:
                raise RuntimeError(f"{key}:{fam}: invalid byte count")
            record[fam]={"sha256":sha.lower(),"bytes":size}
        lock[key]=record
    result={
        "schema":1,
        "stage":"INDIVIDUAL_TRADES_DATA_V1_3_EXACT_SOURCE_LOCK",
        "sourceRun":36690368732,
        "sourceAggregateArtifactId":11090766829,
        "sourceAggregateDigest":"sha256:49211d4059f8cecc38133f8bea9ac5b4ce9bf23a041c242440cb25b335dbb344",
        "expectedShards":120,
        "observedShards":120,
        "records":lock,
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"output":str(OUT),"records":len(lock),"sourceRun":36690368732},indent=2))

if __name__=="__main__":
    build()
