# Taker Order Flow Relative Strength V2 — Frozen Independent Validation Evidence

Status: **FEATURE VALIDATION FAIL / STRATEGY DESIGN NOT AUTHORIZED**  
Ruleset: `PERPETUAL-TAKER-ORDER-FLOW-RELATIVE-STRENGTH-V2-FROZEN`  
Research only: **true**  
Execution impact: **false**  
Strategy PnL calculated: **false**

## Provenance

- Implementation merge: `d0cc924fb7abea1eb1d07bf8a85e7ab1f8993a61`
- Implementation PR: **#465**
- Run-authorization commit: `c1d001f558636452f83633522b90a8c5fbcb4280`
- Workflow run: **37115162706 — SUCCESS**
- Invariants job: **111180464047 — SUCCESS**
- Source job: **111180634304 — SUCCESS**
- Evaluate job: **111180669548 — SUCCESS**
- Source artifact: **11271144039**
- Source artifact digest: `sha256:0d31774a1cceef165aa82fd42dfd929749b2eb43e84458da740ff67dadd594ae`
- Result artifact: **11271273871**
- Result artifact digest: `sha256:2b706bcd0490e29f54b10130bed53c37f788856e0144c0ebf4992e6b79100c64`
- Exact result JSON SHA-256: `3a9bc143980661eb00b1f5b4a5464e44d99ca65a4ecd9c56e922e15cb2bc3c4d`
- Exact result Markdown SHA-256: `471ad636736a914d582e617d78860c2310f1bc03709b0c667a6eb4cc451cc5b1`
- Result JSON Git blob: `6494dbfb5760671eadbde7b77ff619acd1f5073d`
- Result Markdown Git blob: `3cec79c16274cdb51a6d55bdf657c5374769adaf`
- Source receipt digest: `ddcefc2fd1f1f0c8c6c66fcb6ec185701f0ccb4b8ae8f11ed31289a2a5a9d1a2`
- Source manifest SHA-256: `d4ebf92c9ad634de721d96a139c6d3996cd907111c92797bdc21c04b722d0c5e`

## Independent source verification

The downloaded source artifact was independently checked after the run:

- exactly 12 frozen assets;
- exactly **14,449** retained hourly rows per asset;
- first retained hour for every asset: `2025-01-04T00:00:00Z`;
- last retained hour for every asset: `2026-08-29T00:00:00Z`;
- every asset JSON SHA-256 matched the manifest;
- `fundingLoaded=false`;
- `strategyPnlCalculated=false`;
- `privateData=false`;
- `syntheticBackfill=false`;
- no post-validation hourly row retained.

## First untouched V2 feature-validation result

Decision:

`FEATURE_VALIDATION_FAIL_RESEARCH_STOP`

| Frozen metric | Result |
|---|---:|
| Weeks | **85** |
| Mean weekly Rank IC | **+0.033896** |
| Median weekly Rank IC | **+0.069930** |
| Positive IC weeks | **50/85** |
| Rank IC Newey-West(4) t | **1.0051** |
| Mean Top2-Bottom2 next-week spread | **+0.9981%** |
| Median Top2-Bottom2 spread | **+0.9962%** |
| Positive spread weeks | **52/85** |
| Spread Newey-West(4) t | **1.8676** |
| Positive IC blocks | **3/5** |
| Positive spread blocks | **4/5** |

The top-vs-bottom diagnostic is positive and clears its frozen Newey-West threshold. The broader 12-asset rank relation does not: `1.0051 < 1.645`.

Frozen gate failure:
- `RANK_IC_NW_T_LT_1_645`

All other preregistered V2 conditions passed.

## Research consequence

Per the preregistration, V2 FAIL closes this line without retuning.

Not authorized:
- long-only rescue;
- portfolio construction;
- alternate basket size;
- alternate Newey-West lag;
- threshold relaxation;
- date extension;
- asset selection;
- strategy PnL;
- Paper bot;
- live trading.

The positive Top2-Bottom2 spread may be retained only as frozen descriptive evidence. It cannot be promoted by ignoring the failed rank-IC gate.
