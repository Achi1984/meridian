#!/usr/bin/env python3
"""Build one immutable prospective Low-Volatility V2 shadow snapshot."""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

from low_volatility_rank_weighted_v2_prospective import (
    ASSETS,HOUR,PROSPECTIVE_START,evaluate,
)

DATA=Path(os.environ.get("LOWVOL_V2_PROSPECTIVE_DATA_DIR","/tmp/meridian-lowvol-v2-prospective"))
OUT=Path(os.environ.get("LOWVOL_V2_PROSPECTIVE_OUT_DIR","/tmp/meridian-lowvol-v2-prospective-output"))


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path):
    return sha256(path.read_bytes())


def iso(ms):
    return datetime.fromtimestamp(int(ms)/1000,timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


manifest_path=DATA/"manifest.json"
if not manifest_path.exists():
    raise RuntimeError("prospective manifest missing")
manifest=json.loads(manifest_path.read_text())

if manifest.get("schemaVersion")!="MERIDIAN-LOWVOL-RANK-WEIGHTED-V2-PROSPECTIVE-SOURCE-1":
    raise RuntimeError("unexpected prospective source schema")
if manifest.get("stage")!="PROSPECTIVE_PAPER_SHADOW_SOURCE":
    raise RuntimeError("runner refuses wrong prospective stage")
if list(manifest.get("assets",[]))!=list(ASSETS):
    raise RuntimeError("prospective asset universe mismatch")
for k in ("privateData","credentialsUsed","ordersPlaced","exchangeMutation","syntheticBackfill"):
    if manifest.get(k) is not False:
        raise RuntimeError(f"prospective source safety flag failed: {k}")
if int(manifest.get("prospectiveStart",-1))!=PROSPECTIVE_START:
    raise RuntimeError("prospective start mismatch")

cutoff=int(manifest["cutoff"])
collected_at=int(manifest["collectedAt"])
warmup=int(manifest["warmupStart"])
if cutoff>int(manifest["serverTime"]):
    raise RuntimeError("source cutoff exceeds Binance server time")
if collected_at<0:
    raise RuntimeError("invalid collectedAt")

raw={}
file_hashes={}
for asset in ASSETS:
    meta=(manifest.get("files") or {}).get(asset) or {}
    p=DATA/(asset+".json")
    if not p.exists():
        raise RuntimeError(f"missing prospective asset file {asset}")
    observed=file_sha256(p)
    if observed!=str(meta.get("jsonSha256","")):
        raise RuntimeError(f"prospective source hash mismatch {asset}")
    payload=json.loads(p.read_text())
    hourly=payload.get("hourly",[])
    funding=payload.get("funding",[])

    expected=((cutoff-warmup)//HOUR)+1
    if len(hourly)!=expected:
        raise RuntimeError(f"{asset}:hourly rows {len(hourly)} != {expected}")
    if int(hourly[0][0])!=warmup or int(hourly[-1][0])!=cutoff:
        raise RuntimeError(f"{asset}:unexpected hourly bounds")
    for i,row in enumerate(hourly):
        if int(row[0])!=warmup+i*HOUR:
            raise RuntimeError(f"{asset}:hourly continuity failure {i}")

    last=None
    for row in funding:
        if len(row)<3:
            raise RuntimeError(f"{asset}:malformed funding")
        t=int(row[0]);interval=int(row[1]);rate=float(row[2])
        if t<PROSPECTIVE_START or t>cutoff:
            raise RuntimeError(f"{asset}:funding outside prospective boundary")
        if interval<=0 or interval>24:
            raise RuntimeError(f"{asset}:invalid funding interval")
        if last is not None and t<=last:
            raise RuntimeError(f"{asset}:nonmonotonic funding")
        if not (-0.1<rate<0.1):
            raise RuntimeError(f"{asset}:implausible funding rate")
        last=t

    raw[asset]=payload
    file_hashes[asset]=observed

source_receipt={
    "manifestSha256":file_sha256(manifest_path),
    "files":file_hashes,
    "manifestPayloadSha256":manifest.get("manifestPayloadSha256"),
}
source_digest=sha256(json.dumps(source_receipt,sort_keys=True,separators=(",",":")).encode())

result=evaluate(raw,cutoff,collected_at)

snapshot_id=datetime.fromtimestamp(cutoff/1000,timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
snapshot={
    "schemaVersion":"MERIDIAN-LOWVOL-RANK-WEIGHTED-V2-PROSPECTIVE-SNAPSHOT-1",
    "snapshotId":snapshot_id,
    "sourceDigestSha256":source_digest,
    "sourceReceipt":source_receipt,
    "binanceServerTime":int(manifest["serverTime"]),
    "sourceCollectedAt":collected_at,
    "cutoff":cutoff,
    "cutoffIso":iso(cutoff),
    "prospectiveStart":PROSPECTIVE_START,
    "prospectiveStartIso":iso(PROSPECTIVE_START),
    "result":result,
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/"snapshot.json"
mp=OUT/"snapshot.md"
sp.write_text(json.dumps(snapshot,indent=2)+"\n")

decision=result.get("decision")
monitoring=result.get("monitoring")
gate=result.get("gate")
lines=[
    "# Low-Volatility Rank-Weighted V2 — Prospective Shadow Snapshot",
    "",
    f"Snapshot: **{snapshot_id}**",
    f"Decision/status: **{decision}**",
    f"Cutoff: **{iso(cutoff)}**",
    f"Prospective start: **{iso(PROSPECTIVE_START)}**",
    f"Completed prospective observations: **{result.get('completedObservations',0)}**",
    f"Timely snapshot: **{str(bool(result.get('timely'))).lower()}**",
    "",
]
if monitoring:
    b=monitoring["base"]
    lines += [
      "| Monitoring metric | Current prospective value |",
      "|---|---:|",
      f"| Weeks | {b['periods']} |",
      f"| Net compounded return | {b['returnPct']:.4f}% |",
      f"| Profit Factor | {b['profitFactor']:.4f} |",
      f"| Annualized weekly Sharpe | {b['sharpe']:.4f} |",
      f"| Max drawdown | {b['maxDrawdownPct']:.4f}% |",
      f"| 20-bps stress return | {monitoring['stressReturnPct']:.4f}% |",
      f"| Mean Rank IC | {b['meanRankIc']:.6f} |",
      f"| Rank IC Newey-West(4) t | {b['rankIcNeweyWestT']:.4f} |",
      "",
    ]
if gate:
    lines += [
      f"Fixed 12-week performance gate: **{'PASS' if gate.get('pass') else 'FAIL'}**",
      f"Gate reasons: {', '.join(gate.get('reasons',[])) or 'none'}",
      "",
    ]
lines += [
    "Research/shadow only. No Paper or live order was created. No automatic promotion.",
    f"Source digest SHA-256: {source_digest}",
]
mp.write_text("\n".join(lines)+"\n")

(OUT/"snapshot-id.txt").write_text(snapshot_id+"\n")
print(json.dumps({
    "snapshotId":snapshot_id,
    "decision":decision,
    "cutoff":cutoff,
    "completedObservations":result.get("completedObservations",0),
    "timely":result.get("timely"),
    "dataIntegrityFailure":result.get("dataIntegrityFailure",False),
    "sourceDigestSha256":source_digest,
},indent=2))
