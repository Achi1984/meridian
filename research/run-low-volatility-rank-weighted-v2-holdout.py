#!/usr/bin/env python3
"""Run the first authorized untouched Low-Volatility Rank-Weighted V2 Holdout."""
import hashlib
import json
import os
import sys
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

from low_volatility_rank_weighted_v2_holdout import (
    ASSETS,HOUR,RULESET,HOLDOUT_EXPECTED_PERIODS,
    BASE_COST_BPS,STRESS_COST_BPS,run_holdout,
)

DATA=Path(os.environ.get("LOWVOL_RANK_V2_HOLDOUT_DATA_DIR","/tmp/meridian-lowvol-rank-v2-holdout"))
OUT=ROOT/"research"/"results"


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path):
    return sha256_bytes(path.read_bytes())


manifest_path=DATA/"manifest.json"
if not manifest_path.exists():
    raise RuntimeError("holdout manifest missing")
manifest=json.loads(manifest_path.read_text())

if manifest.get("schemaVersion")!="MERIDIAN-LOWVOL-RANK-WEIGHTED-V2-HOLDOUT-SOURCE-1":
    raise RuntimeError("unexpected holdout source schema")
if manifest.get("stage")!="UNTOUCHED_HOLDOUT_SOURCE":
    raise RuntimeError("runner refuses wrong stage")
if manifest.get("range")!={"start":"2025-12","end":"2026-08"}:
    raise RuntimeError("unexpected holdout archive range")
if list(manifest.get("assets",[]))!=list(ASSETS):
    raise RuntimeError("holdout asset universe mismatch")
if manifest.get("privateData") is not False:
    raise RuntimeError("holdout source must be public")
if manifest.get("syntheticBackfill") is not False:
    raise RuntimeError("holdout synthetic backfill forbidden")
if manifest.get("developmentMetricsIncluded") is not False:
    raise RuntimeError("holdout source must not embed development metrics")
if manifest.get("paperOrLiveData") is not False:
    raise RuntimeError("holdout source must not include Paper/live data")
if manifest.get("requiredHourlyStart")!="2025-12-05T23:00:00Z":
    raise RuntimeError("unexpected holdout warmup boundary")
if manifest.get("requiredHourlyEndInclusive")!="2026-08-29T00:00:00Z":
    raise RuntimeError("unexpected holdout terminal boundary")
if manifest.get("holdoutFundingRetainedFrom")!="2026-01-03T00:00:00Z":
    raise RuntimeError("unexpected holdout funding start")
if manifest.get("holdoutFundingRetainedThrough")!="2026-08-29T00:00:00Z":
    raise RuntimeError("unexpected holdout funding end")

raw={}
file_hashes={}
for asset in ASSETS:
    p=DATA/(asset+".json")
    if not p.exists():
        raise RuntimeError(f"missing holdout asset file {asset}")
    observed=file_sha256(p)
    expected=str(manifest.get("files",{}).get(asset,{}).get("jsonSha256",""))
    if not expected or observed!=expected:
        raise RuntimeError(f"holdout source file hash mismatch {asset}")
    file_hashes[asset]=observed
    payload=json.loads(p.read_text())
    hourly=payload.get("hourly",[])
    funding=payload.get("funding",[])

    if len(hourly)!=6386:
        raise RuntimeError(f"unexpected holdout hourly row count {asset}:{len(hourly)}")
    if int(hourly[0][0])!=1764975600000 or int(hourly[-1][0])!=1787961600000:
        raise RuntimeError(f"unexpected holdout hourly bounds {asset}")
    for i,row in enumerate(hourly):
        if int(row[0])!=1764975600000+i*HOUR:
            raise RuntimeError(f"non-contiguous holdout hourly source {asset}:{i}")

    if not funding:
        raise RuntimeError(f"missing holdout funding rows {asset}")
    last=None
    for row in funding:
        if len(row)<3:
            raise RuntimeError(f"malformed holdout funding row {asset}")
        t=int(row[0]);interval=int(float(row[1]));rate=float(row[2])
        if t<1767398400000 or t>1787961600000:
            raise RuntimeError(f"funding outside holdout boundary {asset}")
        if interval<=0 or interval>24:
            raise RuntimeError(f"invalid holdout funding interval {asset}")
        if last is not None and t<=last:
            raise RuntimeError(f"nonmonotonic holdout funding {asset}")
        if not (-0.1<rate<0.1):
            raise RuntimeError(f"implausible holdout funding rate {asset}")
        last=t

    raw[asset]=payload

source_receipt={"manifestSha256":file_sha256(manifest_path),"files":file_hashes}
source_digest=sha256_bytes(json.dumps(source_receipt,sort_keys=True,separators=(",",":")).encode())

evaluation=run_holdout(raw)
summary={
  "schemaVersion":"MERIDIAN-LOWVOL-RANK-WEIGHTED-V2-HOLDOUT-RESULT-1",
  "generatedAt":datetime.now(timezone.utc).isoformat(),
  "ruleset":RULESET,
  "stage":"UNTOUCHED_HOLDOUT",
  "source":"Binance Vision official public USD-M monthly 1h klines + fundingRate archives",
  "sourceRange":"2025-12..2026-08 retained only through 2026-08-29T00:00:00Z",
  "sourceDigestSha256":source_digest,
  "sourceReceipt":source_receipt,
  "assets":list(ASSETS),
  "expectedPeriods":HOLDOUT_EXPECTED_PERIODS,
  "baseCostBps":BASE_COST_BPS,
  "stressCostBps":STRESS_COST_BPS,
  "researchOnly":True,
  "executionImpact":False,
  "autoPromotion":False,
  "dataIntegrityFailure":evaluation.get("dataIntegrityFailure",False),
  "error":evaluation.get("error"),
  "developmentDecision":evaluation.get("developmentDecision"),
  "developmentCanonicalWorkflowRun":evaluation.get("developmentCanonicalWorkflowRun"),
  "result":evaluation.get("result"),
  "stress":evaluation.get("stress"),
  "gate":evaluation.get("gate"),
  "decision":evaluation.get("decision"),
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/"low-volatility-rank-weighted-v2-holdout-result.json"
mp=OUT/"low-volatility-rank-weighted-v2-holdout-result.md"
sp.write_text(json.dumps(summary,indent=2)+"\n")

if summary["dataIntegrityFailure"]:
    md=f"""# Low-Volatility Rank-Weighted V2 — Untouched Holdout

Generated: {summary['generatedAt']}

Decision: **{summary['decision']}**

DATA INTEGRITY FAILURE: {summary['error']}

Research only. No Paper/live authorization.
"""
else:
    b=summary["result"];s=summary["stress"];g=summary["gate"]
    reasons=", ".join(g.get("reasons",[])) or "none"
    blocks=", ".join(f"{x:+.2f}%" for x in b["blocksPct"])
    md=f"""# Low-Volatility Rank-Weighted V2 — First Untouched Holdout

Generated: {summary['generatedAt']}

Decision: **{summary['decision']}**

Source digest SHA-256: `{summary['sourceDigestSha256']}`

Frozen Development decision: **{summary['developmentDecision']}**

| Metric | Frozen Holdout |
|---|---:|
| Periods | {b['periods']} |
| Baseline cost | {summary['baseCostBps']:.0f} bps |
| Net compounded return | {b['returnPct']:.4f}% |
| Profit Factor | {b['profitFactor']:.4f} |
| Annualized weekly Sharpe | {b['sharpe']:.4f} |
| Max drawdown | {b['maxDrawdownPct']:.4f}% |
| Positive chronological blocks | {b['positiveBlocks']}/4 |
| 20-bps stress return | {s['returnPct']:.4f}% |
| Mean weekly Rank IC | {b['meanRankIc']:.6f} |
| Rank IC Newey-West(4) t | {b['rankIcNeweyWestT']:.4f} |
| Total turnover | {b['turnover']:.4f} |
| Baseline cost contribution | {b['costContribution']*100:.4f}% |
| Funding contribution | {b['fundingContribution']*100:.4f}% |
| Price contribution | {b['priceContribution']*100:.4f}% |

Chronological Holdout block returns: {blocks}

Gate: **{'PASS' if g.get('pass') else 'FAIL'}**

Gate reasons: {reasons}

A Holdout PASS authorizes only a later prospective Paper-review decision. It does not authorize automatic Paper deployment or live execution.
"""
mp.write_text(md)

summary["artifactHashes"]={
  "resultPrehashSha256":file_sha256(sp),
  "markdownSha256":file_sha256(mp),
}
sp.write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps({
 "decision":summary["decision"],
 "dataIntegrityFailure":summary["dataIntegrityFailure"],
 "developmentDecision":summary["developmentDecision"],
 "gate":summary["gate"],
 "result":None if summary["result"] is None else {
   k:summary["result"][k] for k in (
     "periods","returnPct","profitFactor","sharpe","maxDrawdownPct",
     "positiveBlocks","blocksPct","turnover","costContribution",
     "priceContribution","fundingContribution","meanRankIc","rankIcNeweyWestT",
     "maxGrossDeviation","maxAbsNetExposure"
   )
 },
 "stressReturnPct":None if summary["stress"] is None else summary["stress"]["returnPct"],
 "sourceDigestSha256":summary["sourceDigestSha256"],
},indent=2))
