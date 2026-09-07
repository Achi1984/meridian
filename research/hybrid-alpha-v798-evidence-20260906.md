# MERIDIAN v7.98 — OKX Funding Crowding Evidence

Status: REJECTED / RESEARCH ONLY / NO PROMOTION  
Evidence date: 2026-09-06  
Predeclaration commit: `46cabbe497dae8b1795da8b0a2c97a9a117ba8ba`

## Exact first result

- Workflow: Hybrid Alpha v7.98 OKX Funding Evidence, run #1
- Run ID: `34052981068`
- Tested head: `b196fc7859067f4ffd4fcc706dcecb982c972d5f`
- Artifact ID: `9995131529`
- Digest: `sha256:03bbd60cce2d8a26eaed7dccf7fcc20eaf53123ded83ceade49bd64a01adcb49`
- Cutoff: `2026-09-06T18:30:00.000Z`
- Release Safety #816: success
- Unit tests: 4/4 passed

All seven official OKX funding requests returned HTTP 200 / code 0 on the first attempt. Each provided 287 finite observations in the 120-day warm-up range. Raw and normalized SHA-256 hashes are retained per asset in the artifact.

## Locked hypothesis

On top of frozen v7.97, direction-aligned extreme realized OKX funding used a 30-observation z-score boundary of +/-2.00 and multiplied risk by 0.60. Funding was aligned strictly at or before each decision timestamp. No OI or taker-flow data was used. Missing evidence left risk unchanged.

## Primary 24h comparison

PF / expectancy / max drawdown / opportunities:

| Window | v7.93 | v7.96 | v7.97 | v7.98 | Attenuated / missing |
|---|---|---|---|---|---:|
| 30d | 1.82 / +1.473R / 46.753R / 131 | 1.96 / +1.490R / 37.511R / 131 | 2.04 / +1.533R / 34.327R / 131 | 2.04 / +1.522R / 34.327R / 131 | 3 / 0 |
| 60d | 1.11 / +0.233R / 144.889R / 274 | 1.15 / +0.281R / 123.038R / 274 | 1.19 / +0.334R / 112.477R / 274 | 1.20 / +0.353R / 106.623R / 274 | 12 / 0 |
| 90d | 1.25 / +0.470R / 125.899R / 421 | 1.32 / +0.502R / 112.760R / 421 | 1.36 / +0.544R / 101.560R / 421 | 1.37 / +0.551R / 97.071R / 421 | 16 / 24 |

Opportunity count is unchanged. v7.98 improves 60d and 90d, but violates the predeclared non-degradation rule because 30d expectancy declines from +1.533R to +1.522R.

## 90d chronological folds: v7.97 -> v7.98

- Fold 1: PF 2.00 -> 1.99; expectancy +0.937R -> +0.921R; DD 28.751R -> 28.581R; 4 attenuated, 24 missing.
- Fold 2: PF 0.63 -> 0.65; expectancy -0.782R -> -0.736R; DD 118.013R -> 115.983R; 9 attenuated, 0 missing.
- Fold 3: PF 2.03 -> 2.03; expectancy +1.500R -> +1.490R; DD 111.254R -> 113.139R; 3 attenuated, 0 missing.

The failing middle fold improves modestly but remains materially negative. Fold 1 expectancy/PF degrades and Fold 3 expectancy/DD degrades. Chronological robustness fails.

## 90d concentration and sample adequacy

- Only 16/421 trades (3.8%) are attenuated; 15 are SHORT and 1 is LONG.
- LONG: PF 1.72, EXP +1.206R, n 212, attenuated 1.
- SHORT: PF 0.91, EXP -0.113R, n 209, attenuated 15.
- Funding attenuation is concentrated in TRANSITION (11) and BEAR (5); RANGE and BULL have none.
- By asset, attenuation counts are BTC 0, ETH 1, SOL 1, XRP 3, ADA 5, AVAX 4, LINK 2.
- AVAX remains negative (PF 0.40, EXP -1.681R, n 47) and is not removed.
- SHORT x TRANSITION remains negative (PF 0.49, EXP -0.685R, n 111) despite 10 attenuations.

The effect is too sparse and asymmetric to establish robust funding alpha.

## Horizon specificity

- 4h remains negative; v7.98 does not create an edge.
- 12h improves marginally, including 60d PF 0.98 -> 1.00, but remains mixed.
- 24h is still the only positive aggregate direction, without stable fold improvement.

## Decision

REJECT v7.98. No promotion and no parameter search. Do not tune the +/-2.00 boundary, 30-observation lookback, 0.60 factor, asset universe, side or regime.

OKX funding remains a valid, leakage-safe data source, but this isolated extreme-crowding rule does not meet robustness or sample-adequacy requirements. If research continues, test one separately predeclared structural hypothesis using OI or taker flow; do not combine all microstructure inputs into an opaque composite and do not optimize directly against Fold 2.

No Baseline, Paper, live execution, Pionex, `server.js`, entry, exit or production behavior changed.
