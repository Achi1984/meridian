#!/usr/bin/env python3
"""Run the first authorized Cross-Sectional Low-Volatility V1 discovery gate."""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))

from cross_sectional_low_volatility_v1 import (
    ASSETS,
    RULESET,
    DISCOVERY_EXPECTED_WEEKS,
    DISCOVERY_PASS,
    DISCOVERY_FAIL,
    run_feature_validation,
)

DATA=Path(os.environ.get("LOWVOL_V1_DISCOVERY_DATA_DIR","/tmp/meridian-lowvol-v1-discovery"))
OUT=ROOT/"research"/"results"

EXPECTED_SOURCE_ROWS=8738
SOURCE_START_MS=1735945200000
SOURCE_END_MS=1767398400000


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path):
    return sha256_bytes(path.read_bytes())


manifest_path=DATA/"manifest.json"
if not manifest_path.exists():
    raise RuntimeError("discovery manifest missing")
manifest=json.loads(manifest_path.read_text())

if manifest.get("schemaVersion")!="MERIDIAN-CROSS-SECTIONAL-LOW-VOLATILITY-V1-SOURCE-1":
    raise RuntimeError("unexpected discovery source schema")
if manifest.get("ruleset")!=RULESET:
    raise RuntimeError("discovery source ruleset mismatch")
if manifest.get("stage")!="DISCOVERY_SOURCE":
    raise RuntimeError("discovery runner refuses wrong stage")
if manifest.get("range")!={"start":"2025-01","end":"2026-01"}:
    raise RuntimeError("unexpected discovery archive range")
if list(manifest.get("assets",[]))!=list(ASSETS):
    raise RuntimeError("discovery asset universe mismatch")
if manifest.get("fundingLoaded") is not False:
    raise RuntimeError("feature discovery forbids funding data")
if manifest.get("strategyPnlCalculated") is not False:
    raise RuntimeError("feature discovery source claims strategy PnL")
if manifest.get("privateData") is not False:
    raise RuntimeError("feature discovery source must be public")
if manifest.get("syntheticBackfill") is not False:
    raise RuntimeError("feature discovery forbids synthetic backfill")
if manifest.get("holdoutRowsRetained") is not False:
    raise RuntimeError("untouched holdout rows are forbidden during discovery")
if manifest.get("requiredHourlyStart")!="2025-01-03T23:00:00Z":
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
    payload=json.loads(p.read_text())
    hourly=payload.get("hourly",[])
    if len(hourly)!=EXPECTED_SOURCE_ROWS:
        raise RuntimeError(f"unexpected hourly row count {asset}:{len(hourly)}")
    if int(hourly[0][0])!=SOURCE_START_MS or int(hourly[-1][0])!=SOURCE_END_MS:
        raise RuntimeError(f"unexpected discovery source bounds {asset}")
    for i in range(1,len(hourly)):
        if int(hourly[i][0])-int(hourly[i-1][0])!=3600000:
            raise RuntimeError(f"non-contiguous discovery source {asset}")
    if any(int(row[0])>SOURCE_END_MS for row in hourly):
        raise RuntimeError("holdout source row retained during discovery")
    file_hashes[asset]=observed
    raw[asset]=payload

source_receipt={
    "manifestSha256":file_sha256(manifest_path),
    "files":file_hashes,
}
source_digest=sha256_bytes(json.dumps(source_receipt,sort_keys=True,separators=(",",":")).encode())

result=run_feature_validation(raw,stage="DISCOVERY")
metrics=result.get("metrics")
gate=result.get("gate") or {}

summary={
    "schemaVersion":"MERIDIAN-CROSS-SECTIONAL-LOW-VOLATILITY-V1-DISCOVERY-RESULT-1",
    "generatedAt":datetime.now(timezone.utc).isoformat(),
    "ruleset":RULESET,
    "stage":"DISCOVERY",
    "source":"Binance Vision official public USD-M monthly archives",
    "sourceRange":"2025-01..2026-01 retained through 2026-01-03T00:00:00Z only",
    "sourceDigestSha256":source_digest,
    "sourceReceipt":source_receipt,
    "assets":list(ASSETS),
    "expectedWeeks":DISCOVERY_EXPECTED_WEEKS,
    "fundingLoaded":False,
    "strategyPnlCalculated":False,
    "researchOnly":True,
    "executionImpact":False,
    "autoPromotion":False,
    "holdoutEvaluated":False,
    "dataIntegrityFailure":result.get("dataIntegrityFailure",False),
    "error":result.get("error"),
    "metrics":metrics,
    "gate":gate,
    "decision":result.get("decision"),
}

if summary["decision"] not in (DISCOVERY_PASS,DISCOVERY_FAIL):
    raise RuntimeError("unexpected discovery decision")

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/"cross-sectional-low-volatility-v1-discovery-result.json"
mp=OUT/"cross-sectional-low-volatility-v1-discovery-result.md"
sp.write_text(json.dumps(summary,indent=2)+"\n")

if summary["dataIntegrityFailure"]:
    md=f"""# Cross-Sectional Low-Volatility V1 — Discovery

Generated: {summary['generatedAt']}

Decision: **{summary['decision']}**

DATA INTEGRITY FAILURE: {summary['error']}

No holdout was evaluated. No strategy PnL was calculated. No Paper or live authorization.
"""
else:
    m=summary["metrics"];g=summary["gate"]
    block_lines="\n".join(
        f"| {x['i']} | {x['weeks']} | {x['meanRankIc']:.5f} | {x['meanSpread']*100:.4f}% |"
        for x in m["blocks"]
    )
    reasons=", ".join(g.get("reasons",[])) or "none"
    md=f"""# Cross-Sectional Low-Volatility V1 — Discovery

Generated: {summary['generatedAt']}

Decision: **{summary['decision']}**

Source digest SHA-256: `{summary['sourceDigestSha256']}`

No holdout was evaluated. Strategy PnL calculated: **false**.

| Feature metric | Discovery |
|---|---:|
| Weeks | {m['weeks']} |
| Mean weekly Rank IC | {m['meanRankIc']:.6f} |
| Median weekly Rank IC | {m['medianRankIc']:.6f} |
| Positive IC weeks | {m['positiveIcWeeks']}/{m['weeks']} |
| Rank IC Newey-West(4) t | {m['rankIcNeweyWestT']:.4f} |
| Mean Low-2 minus High-2 next-week spread | {m['meanLow2MinusHigh2']*100:.4f}% |
| Median Low-2 minus High-2 spread | {m['medianLow2MinusHigh2']*100:.4f}% |
| Positive spread weeks | {m['positiveSpreadWeeks']}/{m['weeks']} |
| Spread Newey-West(4) t | {m['spreadNeweyWestT']:.4f} |
| Positive IC blocks | {m['positiveIcBlocks']}/4 |
| Positive spread blocks | {m['positiveSpreadBlocks']}/4 |

## Chronological discovery blocks

| Block | Weeks | Mean Rank IC | Mean Low-2 minus High-2 spread |
|---|---:|---:|---:|
{block_lines}

Gate: **{'PASS' if g.get('pass') else 'FAIL'}**

Gate reasons: {reasons}

A PASS authorizes only the separately controlled untouched holdout stage. A FAIL closes V1 without retuning. No Paper or live authorization.
"""
mp.write_text(md)

summary["artifactHashes"]={
    "resultPrehashSha256":file_sha256(sp),
    "markdownSha256":file_sha256(mp),
}
sp.write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps(summary,indent=2))
