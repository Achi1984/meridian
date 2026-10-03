#!/usr/bin/env python3
"""Run the first authorized Taker Flow Relative Strength V2 feature validation."""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

from perpetual_taker_order_flow_relative_strength_v2 import (
    ASSETS,
    RULESET,
    EXPECTED_WEEKS,
    run_feature_validation,
)

DATA=Path(os.environ.get("TAKER_FLOW_RS_V2_VALIDATION_DATA_DIR","/tmp/meridian-taker-flow-rs-v2-validation"))
OUT=ROOT/"research"/"results"


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path):
    return sha256_bytes(path.read_bytes())


manifest_path=DATA/"manifest.json"
if not manifest_path.exists():
    raise RuntimeError("validation manifest missing")
manifest=json.loads(manifest_path.read_text())

if manifest.get("schemaVersion")!="MERIDIAN-TAKER-FLOW-RS-V2-SOURCE-1":
    raise RuntimeError("unexpected validation source schema")
if manifest.get("stage")!="INDEPENDENT_FEATURE_VALIDATION_SOURCE":
    raise RuntimeError("validation runner refuses wrong stage")
if manifest.get("range")!={"start":"2025-01","end":"2026-08"}:
    raise RuntimeError("unexpected validation raw-data range")
if list(manifest.get("assets",[]))!=list(ASSETS):
    raise RuntimeError("validation asset universe mismatch")
if manifest.get("fundingLoaded") is not False:
    raise RuntimeError("feature validation forbids funding data")
if manifest.get("strategyPnlCalculated") is not False:
    raise RuntimeError("feature validation source claims strategy PnL")
if manifest.get("privateData") is not False:
    raise RuntimeError("feature validation source must be public")
if manifest.get("syntheticBackfill") is not False:
    raise RuntimeError("feature validation forbids synthetic backfill")
if manifest.get("requiredHourlyStart")!="2025-01-04T00:00:00Z":
    raise RuntimeError("unexpected source warmup boundary")
if manifest.get("requiredHourlyEndInclusive")!="2026-08-29T00:00:00Z":
    raise RuntimeError("unexpected source terminal boundary")
if manifest.get("rowsAfterValidationEndpointRetained") is not False:
    raise RuntimeError("post-validation source rows are forbidden")

raw={}
file_hashes={}
for asset in ASSETS:
    p=DATA/(asset+".json")
    if not p.exists():
        raise RuntimeError(f"missing validation asset file {asset}")
    observed=file_sha256(p)
    expected=str(manifest.get("files",{}).get(asset,{}).get("jsonSha256",""))
    if not expected or observed!=expected:
        raise RuntimeError(f"source file hash mismatch {asset}")
    file_hashes[asset]=observed
    raw[asset]=json.loads(p.read_text())
    hourly=raw[asset].get("hourly",[])
    if len(hourly)!=14449:
        raise RuntimeError(f"unexpected hourly row count {asset}:{len(hourly)}")
    if int(hourly[0][0])!=1735948800000 or int(hourly[-1][0])!=1787961600000:
        raise RuntimeError(f"unexpected hourly source bounds {asset}")

source_receipt={
  "manifestSha256":file_sha256(manifest_path),
  "files":file_hashes
}
source_digest=sha256_bytes(json.dumps(source_receipt,sort_keys=True,separators=(",",":")).encode())

result=run_feature_validation(raw)
metrics=result.get("metrics")
gate=result.get("gate") or {}

summary={
  "schemaVersion":"MERIDIAN-TAKER-FLOW-RS-V2-RESULT-1",
  "generatedAt":datetime.now(timezone.utc).isoformat(),
  "ruleset":RULESET,
  "stage":"INDEPENDENT_FEATURE_VALIDATION",
  "source":"Binance Vision official public USD-M monthly archives",
  "sourceRange":"2025-01..2026-08",
  "sourceDigestSha256":source_digest,
  "sourceReceipt":source_receipt,
  "assets":list(ASSETS),
  "expectedWeeks":EXPECTED_WEEKS,
  "fundingLoaded":False,
  "strategyPnlCalculated":False,
  "researchOnly":True,
  "executionImpact":False,
  "autoPromotion":False,
  "dataIntegrityFailure":result.get("dataIntegrityFailure",False),
  "error":result.get("error"),
  "metrics":metrics,
  "gate":gate,
  "decision":result.get("decision"),
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/"perpetual-taker-order-flow-relative-strength-v2-result.json"
mp=OUT/"perpetual-taker-order-flow-relative-strength-v2-result.md"
sp.write_text(json.dumps(summary,indent=2)+"\n")

if summary["dataIntegrityFailure"]:
    md=f"""# Taker Order Flow Relative Strength V2 — Independent Feature Validation

Generated: {summary['generatedAt']}

Decision: **{summary['decision']}**

DATA INTEGRITY FAILURE: {summary['error']}

No strategy PnL was calculated. No Paper or live authorization.
"""
else:
    m=summary["metrics"];g=summary["gate"]
    block_lines="\n".join(
      f"| {x['i']} | {x['weeks']} | {x['meanRankIc']:.5f} | {x['meanSpread']*100:.4f}% |"
      for x in m["blocks"]
    )
    reasons=", ".join(g.get("reasons",[])) or "none"
    md=f"""# Taker Order Flow Relative Strength V2 — Independent Feature Validation

Generated: {summary['generatedAt']}

Decision: **{summary['decision']}**

Source digest SHA-256: `{summary['sourceDigestSha256']}`

No portfolio was formed. Strategy PnL calculated: **false**.

| Feature metric | Validation |
|---|---:|
| Weeks | {m['weeks']} |
| Mean weekly Rank IC | {m['meanRankIc']:.6f} |
| Median weekly Rank IC | {m['medianRankIc']:.6f} |
| Positive IC weeks | {m['positiveIcWeeks']}/{m['weeks']} |
| Rank IC Newey-West(4) t | {m['rankIcNeweyWestT']:.4f} |
| Mean Top2-Bottom2 next-week spread | {m['meanTop2MinusBottom2']*100:.4f}% |
| Median Top2-Bottom2 spread | {m['medianTop2MinusBottom2']*100:.4f}% |
| Positive spread weeks | {m['positiveSpreadWeeks']}/{m['weeks']} |
| Spread Newey-West(4) t | {m['spreadNeweyWestT']:.4f} |
| Positive IC blocks | {m['positiveIcBlocks']}/5 |
| Positive spread blocks | {m['positiveSpreadBlocks']}/5 |

## Chronological blocks

| Block | Weeks | Mean Rank IC | Mean Top2-Bottom2 spread |
|---|---:|---:|---:|
{block_lines}

Gate: **{'PASS' if g.get('pass') else 'FAIL'}**

Gate reasons: {reasons}

A PASS authorizes only a separately preregistered strategy-design stage. A FAIL stops this V2 line. No Paper or live authorization.
"""
mp.write_text(md)

summary["artifactHashes"]={
  "resultPrehashSha256":file_sha256(sp),
  "markdownSha256":file_sha256(mp)
}
sp.write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps(summary,indent=2))
