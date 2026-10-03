# Quarter-Hour Boundary Imbalance — Strategy V1 Result Lock

Status: **FROZEN NEGATIVE RESULT — STRATEGY_V1_FAIL**  
Historical evidence run: **37029699996**  
Source shards: **120 / 120 PASS**  
Paper authorization: **false**  
Live authorization: **false**

## Immutable evidence identity

- Strategy run: `37029699996`
- Aggregate job: `110951917303`
- Result artifact: `11241728193` (`qh-boundary-imbalance-strategy-v1-result`)
- Result JSON SHA-256: `3b0a14d70067afb2bd429accdfa3079de4d16da9b58c7828b5f27a4c0d2cb9a7`
- Artifact ZIP SHA-256: `171d73d9cd4172c0e9e4032ca106f3b95fad45b72280a9313c57b453c710fee8`

Frozen Data V1.3 dependency:
- Data full run: `36690368732`
- Data aggregate artifact: `11090766829`
- Data aggregate digest: `sha256:49211d4059f8cecc38133f8bea9ac5b4ce9bf23a041c242440cb25b335dbb344`
- expected / observed source shards: **120 / 120**

## Primary 12h / 6 bp result

Starting equity: **100,000.00**  
Ending equity: **65,253.70**  
Net return: **-34.7463%**  
Gross price return before funding/costs: **+2.5332%**  
Gross price PnL: **+2,533.19**  
Funding PnL: **-204.80**  
Price + funding before costs: **+2,328.39**  
Transaction costs: **-37,074.69**  
Maximum drawdown: **35.2903%**  
Daily profit factor: **0.41796**  
Turnover / starting equity: **617.9115x**  
Rebalance count: **350,202**  
Average gross exposure: **7.5061%**

The sign signal therefore produced a small positive gross price/funding contribution, but the continuously rebalanced overlapping-cohort implementation generated transaction costs roughly **15.9x larger** than the pre-cost price+funding edge.

## Asset attribution

| Asset | Price + funding before costs | Transaction costs | Net PnL |
|---|---:|---:|---:|
| BTCUSDT | -943.98 | -6,365.94 | -7,309.91 |
| ETHUSDT | +522.59 | -5,670.58 | -5,147.99 |
| XRPUSDT | +270.62 | -6,078.91 | -5,808.29 |
| SOLUSDT | +1,337.09 | -5,897.01 | -4,559.92 |
| DOGEUSDT | +408.00 | -6,197.97 | -5,789.97 |
| ADAUSDT | +734.07 | -6,864.28 | -6,130.21 |

Positive net assets: **0 / 6**.

## Side attribution

- Long price + funding PnL: **-423.25**
- Short price + funding PnL: **+2,751.65**
- Transaction costs: **-37,074.69**

The short side was the stronger gross contributor, but Strategy V1 is **not** rescued by switching to short-only. The preregistration explicitly prohibited post-result side selection.

## Chronological blocks

| Block | Net return | Net PnL | Daily PF |
|---|---:|---:|---:|
| B1 | -7.8071% | -7,807.10 | 0.524 |
| B2 | -7.7055% | -7,103.91 | 0.470 |
| B3 | -10.0405% | -8,543.39 | 0.470 |
| B4 | -14.7519% | -11,291.90 | 0.181 |

All four chronological blocks were negative and the final block deteriorated materially.

## Predeclared robustness diagnostics

| Diagnostic | Net return | Max DD | Daily PF | Turnover / start |
|---|---:|---:|---:|---:|
| Primary 12h / 6 bp | -34.75% | 35.29% | 0.418 | 617.91x |
| 4h / 6 bp | -70.18% | 70.37% | 0.243 | 1300.09x |
| 8h / 6 bp | -43.50% | 43.87% | 0.402 | 870.03x |
| 12h / 3 bp | -18.46% | 19.39% | 0.646 | 687.19x |
| 12h / 10 bp | -51.52% | 51.74% | 0.251 | 539.68x |
| Suppress funding-coincident new cohorts | -34.21% | 34.68% | 0.414 | 610.49x |

No predeclared robustness diagnostic rescues the strategy.

## Frozen primary gate result

All six primary gates failed:

- full-window net return > 0: **FAIL**
- max drawdown < 15%: **FAIL**
- at least 3 of 4 blocks positive: **FAIL**
- final block B4 positive: **FAIL**
- at least 4 of 6 assets positive: **FAIL**
- positive-PnL concentration <= 40%: **FAIL / undefined because no asset was net positive**

Decision: **STRATEGY_V1_FAIL**.

## Interpretation boundary

This result freezes V1. No V1 rule may be changed and rerun under the same label.

The strongest actionable engineering observation is structural rather than directional: the small pre-cost signal contribution is overwhelmed by quarter-hour target churn. A successor may therefore test a separately preregistered execution/overlap hypothesis, but it must:

- keep V1 as an immutable negative control;
- use a new strategy version;
- freeze the new mechanics before inspecting successor PnL;
- not cherry-pick the short side, assets, blocks or cost case;
- remain research-only until an untouched post-August-2026 holdout is completed.
