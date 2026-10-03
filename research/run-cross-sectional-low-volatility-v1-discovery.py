#!/usr/bin/env python3
"""Run the first authorized Cross-Sectional Low-Volatility V1 Discovery gate."""
import hashlib
import json
import os
import sys
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

from cross_sectional_low_volatility_v1 import (
    ASSETS,HOUR,RULESET,DISCOVERY_EXPECTED_WEEKS,run_feature_validation,
)

DATA=Path(os.environ.get("LOWVOL_V1_DISCOVERY_DATA_DIR","/tmp/meridian-lowvol-v1-discovery"))
OUT=ROOT/"research"/"results"


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path):
    return sha256_bytes(path.read_bytes())


manifest_path=DATA/"manifest.json"
if not manifest_path.exists():
    raise RuntimeError("discovery manifest missing")
manifest=json.loads(manifest_path.read_text())

if manifest.get("schemaVersion")!="MERIDIAN-LOWVOL-V1-DISCOVERY-SOURCE-1":
    raise RuntimeError("unexpected discovery source schema")
if manifest.get("stage")!="DISCOVERY_FEATURE_VALIDATION_SOURCE":
    raise RuntimeError("runner refuses wrong stage")
if manifest.get("range")!={"start":"2025-01","end":"2026-01"}:
    raise RuntimeError("unexpected discovery raw-data range")
if list(manifest.get("assets",[]))!=list(ASSETS):
    raise RuntimeError("discovery asset universe mismatch")
if manifest.get("fundingLoaded") is not False:
    raise RuntimeError("feature validation forbids funding data")
if manifest.get("strategyPnlCalculated") is not False:
    raise RuntimeError("source claims strategy PnL")
if manifest.get("privateData") is not False:
    raise RuntimeError("discovery source must be public")
if manifest.get("syntheticBackfill") is not False:
    raise RuntimeError("discovery forbids synthetic backfill")
if manifest.get("holdoutRowsRetained") is not False:
    raise RuntimeError("holdout rows are forbidden before discovery pass")
if manifest.get("requiredHourlyStart")!="2025-01-03T22:00:00Z":
    raise RuntimeError("unexpected discovery warmup boundary")
if manifest.get("requiredHourlyEndInclusive")!="2026-01-03T00:00:00Z":
    raise RuntimeError("unexpected discovery terminal boundary")

raw={}
file_hashes={}
for asset in ASSETS:
    p=DATA/(asset+".json")
    if not p.exists():
        raise RuntimeError(f"missing discovery asset file {asset}")
    observed=file_sha256(p)
    expected=str(manifest.get("files",{}).get(asset,{}).get("jsonSha256",""))
    if not expected or observed!=expected:
        raise RuntimeError(f"source file hash mismatch {asset}")
    file_hashes[asset]=observed
    raw[asset]=json.loads(p.read_text())
    hourly=raw[asset].get("hourly",[])
    if len(hourly)!=8739:
        raise RuntimeError(f"unexpected hourly row count {asset}:{len(hourly)}")
    if int(hourly[0][0])!=1735941600000 or int(hourly[-1][0])!=1767398400000:
        raise RuntimeError(f"unexpected hourly source bounds {asset}")
    for i,row in enumerate(hourly):
        if int(row[0])!=1735941600000+i*HOUR:
            raise RuntimeError(f"non-contiguous hourly source {asset}:{i}")

source_receipt={"manifestSha256":file_sha256(manifest_path),"files":file_hashes}
source_digest=sha256_bytes(json.dumps(source_receipt,sort_keys=True,separators=(",",":")).encode())

result=run_feature_validation(raw,stage="DISCOVERY")
summary={
  "schemaVersion":"MERIDIAN-LOWVOL-V1-DISCOVERY-RESULT-1",
  "generatedAt":datetime.now(timezone.utc).isoformat(),
  "ruleset":RULESET,
  "stage":"DISCOVERY_FEATURE_VALIDATION",
  "source":"Binance Vision official public USD-M monthly archives",
  "sourceRange":"2025-01..2026-01",
  "sourceDigestSha256":source_digest,
  "sourceReceipt":source_receipt,
  "assets":list(ASSETS),
  "expectedWeeks":DISCOVERY_EXPECTED_WEEKS,
  "fundingLoaded":False,
  "strategyPnlCalculated":False,
  "holdoutEvaluated":False,
  "researchOnly":True,
  "executionImpact":False,
  "autoPromotion":False,
  "dataIntegrityFailure":result.get("dataIntegrityFailure",False),
  "error":result.get("error"),
  "metrics":result.get("metrics"),
  "gate":result.get("gate"),
  "decision":result.get("decision"),
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/"cross-sectional-low-volatility-v1-discovery-result.json"
mp=OUT/"cross-sectional-low-volatility-v1-discovery-result.md"
sp.write_text(json.dumps(summary,indent=2)+"\n")

if summary["dataIntegrityFailure"]:
    md=f"""# Cross-Sectional Low-Volatility V1 — Discovery Feature Validation

Generated: {summary['generatedAt']}

Decision: **{summary['decision']}**

DATA INTEGRITY FAILURE: {summary['error']}

Holdout evaluated: **false**. Strategy PnL calculated: **false**. No Paper/live authorization.
"""
else:
    m=summary["metrics"];g=summary["gate"]
    block_lines="\n".join(
      f"| {x['i']} | {x['weeks']} | {x['meanRankIc']:.5f} | {x['meanSpread']*100:.4f}% |"
      for x in m["blocks"]
    )
    reasons=", ".join(g.get("reasons",[])) or "none"
    md=f"""# Cross-Sectional Low-Volatility V1 — Discovery Feature Validation

Generated: {summary['generatedAt']}

Decision: **{summary['decision']}**

Source digest SHA-256: `{summary['sourceDigestSha256']}`

Holdout evaluated: **false**. Strategy PnL calculated: **false**.

| Feature metric | Discovery |
|---|---:|
| Weeks | {m['weeks']} |
| Mean weekly Rank IC | {m['meanRankIc']:.6f} |
| Median weekly Rank IC | {m['medianRankIc']:.6f} |
| Positive IC weeks | {m['positiveIcWeeks']}/{m['weeks']} |
| Rank IC Newey-West(4) t | {m['rankIcNeweyWestT']:.4f} |
| Mean Low2-High2 next-week spread | {m['meanLow2MinusHigh2']*100:.4f}% |
| Median Low2-High2 spread | {m['medianLow2MinusHigh2']*100:.4f}% |
| Positive spread weeks | {m['positiveSpreadWeeks']}/{m['weeks']} |
| Spread Newey-West(4) t | {m['spreadNeweyWestT']:.4f} |
| Positive IC blocks | {m['positiveIcBlocks']}/4 |
| Positive spread blocks | {m['positiveSpreadBlocks']}/4 |

## Chronological Discovery blocks

| Block | Weeks | Mean Rank IC | Mean Low2-High2 spread |
|---|---:|---:|---:|
{block_lines}

Gate: **{'PASS' if g.get('pass') else 'FAIL'}**

Gate reasons: {reasons}

A PASS authorizes only one untouched Holdout evaluation under the already-frozen V1 ruleset. It does not authorize strategy PnL, Paper, or live execution.
"""
mp.write_text(md)

summary["artifactHashes"]={
  "resultPrehashSha256":file_sha256(sp),
  "markdownSha256":file_sha256(mp)
}
sp.write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps(summary,indent=2))
