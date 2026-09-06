# MERIDIAN v7.99 — OKX Relative Open-Interest Expansion Evidence

Status: REJECTED / RESEARCH ONLY / NO PROMOTION  
Evidence date: 2026-09-06  
Predeclaration commit: `409569b56a503e339cb3ce3dbcface79f7d36d65`

## Exact first result

- Workflow: Hybrid Alpha v7.99 OKX OI Evidence, run #1
- Run ID: `34053529086`
- Tested head: `a2125a0f1cdc39c34b68a7186fd662b413b99d4a`
- Artifact ID: `9995323219`
- Digest: `sha256:7343cc2a64f573244fbd5592539a87b683ce52c764945bae7f2fcb7c23d8625a`
- Cutoff: `2026-09-06T18:45:00.000Z`
- Release Safety #818: success
- Unit tests: 4/4 passed

## Source finding

All seven official OKX OI requests completed and returned identical hourly range characteristics:

- 1,424 unique rows per asset
- returned range: 2026-07-08 20:00Z through 2026-09-06 17:00Z
- duplicates: 0

Although 92 days were requested, the endpoint returned only about 60 days. Consequently, the earliest 153 of 421 primary 90d decisions lack a complete seven-asset OI cross-section. Missing evidence correctly leaves v7.97 risk unchanged. This retention limitation must not be hidden by shortening the post-result evaluation window.

## Locked hypothesis

On top of frozen v7.97, each asset's leakage-safe 24h USD-OI percentage change was standardized across all seven assets at each decision. A positive relative outlier at z >= 1.50 multiplied risk by 0.60. Funding and taker flow were excluded. Opportunity count and side selection stayed unchanged.

## Primary 24h comparison: v7.97 -> v7.99

| Window | PF | Expectancy | Max DD | Trades | Attenuated / missing |
|---|---:|---:|---:|---:|---:|
| 30d | 2.04 -> 1.96 | +1.533R -> +1.375R | 34.327R -> 37.118R | 131 -> 131 | 12 / 0 |
| 60d | 1.19 -> 1.14 | +0.334R -> +0.247R | 112.477R -> 113.273R | 274 -> 274 | 25 / 6 |
| 90d | 1.36 -> 1.33 | +0.544R -> +0.488R | 101.560R -> 101.037R | 421 -> 421 | 25 / 153 |

PF and expectancy degrade on every primary window. Drawdown worsens on 30d and 60d. The predeclared decision rule fails decisively.

## 90d chronological folds: v7.97 -> v7.99

- Fold 1: unchanged because all 147 decisions lack retained OI evidence.
- Fold 2: PF 0.63 -> 0.62; expectancy -0.782R -> -0.800R; DD 118.013R -> 118.614R; 12 attenuated, 6 missing.
- Fold 3: PF 2.03 -> 1.95; expectancy +1.500R -> +1.341R; DD 111.254R -> 110.508R; 13 attenuated.

The failing middle fold becomes worse, and the profitable third fold loses substantial expectancy. Chronological robustness fails.

## 90d concentration

- LONG: PF 1.64, EXP +1.066R, n 212, attenuated 13.
- SHORT: PF 0.92, EXP -0.098R, n 209, attenuated 12.
- TRANSITION loses expectancy; LONG x TRANSITION remains profitable but drops to +3.803R.
- AVAX remains materially negative: PF 0.37, EXP -1.763R, n 47; it is not removed.
- Asset attenuation counts: BTC 3, ETH 4, SOL 4, XRP 2, ADA 3, AVAX 7, LINK 2.
- The largest attenuation concentration is AVAX, yet AVAX performance worsens.

## Decision

REJECT v7.99. Do not tune z threshold, 24h change horizon, factor, universe, side or regime. Do not shorten the 90d robustness window to conceal public OI retention.

The public OKX OI source is usable for roughly 60-day research but does not support a complete 90-day plus warm-up test from this endpoint at the current cutoff. More importantly, the predeclared relative OI-expansion rule degrades the available evidence.

If research continues, use one separately predeclared taker-flow hypothesis. Do not combine funding, OI and taker flow into an opaque composite and do not optimize directly against Fold 2.

No Baseline, Paper, live execution, Pionex, `server.js`, entry, exit or production behavior changed.
