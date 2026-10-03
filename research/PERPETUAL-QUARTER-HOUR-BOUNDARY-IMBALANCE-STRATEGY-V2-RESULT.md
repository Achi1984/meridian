# Quarter-Hour Boundary Imbalance — Strategy V2 Development Result Lock

Status: **FROZEN NEGATIVE DEVELOPMENT RESULT — STRATEGY_V2_DEV_FAIL**  
Development evidence run: **37101396355**  
Frozen source shards: **120 / 120 PASS**  
Holdout authorization: **false**  
Paper authorization: **false**  
Live authorization: **false**

## Immutable evidence identity

- V2 development run: `37101396355`
- aggregate job: `111141623200`
- result artifact: `11266935745` (`qh-boundary-imbalance-strategy-v2-development-result`)
- source-package artifact: `11266741213` (`qh-strategy-v2-source`)
- result JSON SHA-256: `7bfd0687fc00bed0d15a55241729e5c525a69c922691ad76c9767b795454e74c`
- result artifact ZIP SHA-256: `3d56a999365d255e78c36ee1db0e6ae0f8e771adee4e41c7866350ad32514a99`
- source-package ZIP SHA-256: `f12b16f13828585c33c1ef3b700c72060bdad37909cf70034688b971c07cb3fe`
- frozen implementation PR: **#459**
- implementation exact head: `6b1abb80120c1d7a267cc6bb930ea512c7962c8d`
- implementation merge commit: `07ffa7a2e3f60dac31006cc1ef122fc06ae643e8`
- run authorization commit: `a6436bc7a9ed88ced825ced09565c3ab6604fa1e`

Frozen V1 negative control:
- V1 run: `37029699996`
- V1 result JSON SHA-256: `3b0a14d70067afb2bd429accdfa3079de4d16da9b58c7828b5f27a4c0d2cb9a7`
- V1 decision: **STRATEGY_V1_FAIL**
- V1 turnover / starting equity: **617.911513x**
- V1 rebalance count: **350,202**

## Primary V2 result — 12h sample-and-hold / 6 bp

Starting equity: **100,000.00**  
Ending equity: **91,882.37**  
Net return: **-8.1176%**  
Gross price return: **-0.4792%**  
Gross price PnL: **-479.24**  
Funding PnL: **-128.61**  
Price + funding before transaction costs: **-607.85**  
Transaction costs: **-7,509.78**  
Maximum drawdown: **8.7702%**  
Daily profit factor: **0.84023**  
Turnover / starting equity: **125.162972x**  
Turnover reduction vs V1: **79.7442%**  
Rebalance count: **7,290**  
Rebalance-count reduction vs V1: **97.9183%**  
Average gross exposure: **7.6424%**  
Average net exposure: **0.1123%**

## Core interpretation

V2 successfully reduced **event count** from 350,202 to 7,290, but it did not preserve a positive gross edge.

The primary price + funding contribution is already **-607.85 before transaction costs**. Therefore the V2 failure is no longer explainable as a transaction-cost problem alone.

This distinguishes V2 from V1:

- V1: small positive pre-cost price+funding edge, destroyed by extreme churn;
- V2: materially lower churn, but sampled execution produces negative pre-cost price+funding PnL.

A further successor cannot be justified merely by lowering execution frequency again.

## Asset attribution

| Asset | Price PnL | Funding PnL | Pre-cost PnL | Costs | Net PnL |
|---|---:|---:|---:|---:|---:|
| BTCUSDT | -914.70 | -18.91 | -933.62 | -1,260.67 | -2,194.29 |
| ETHUSDT | -1,448.97 | -13.11 | -1,462.08 | -1,124.71 | -2,586.79 |
| XRPUSDT | -847.22 | -11.54 | -858.76 | -1,249.77 | -2,108.53 |
| SOLUSDT | +563.92 | -30.64 | +533.28 | -1,180.90 | -647.62 |
| DOGEUSDT | -859.24 | -14.29 | -873.52 | -1,255.68 | -2,129.21 |
| ADAUSDT | +3,026.96 | -40.12 | +2,986.85 | -1,438.05 | +1,548.80 |

Positive net assets: **1 / 6**.

ADA is the only positive net asset. It may not be isolated or promoted under V2 because asset selection after observing this result is prohibited.

## Side attribution

- Long price + funding PnL: **-457.90**
- Short price + funding PnL: **-149.96**
- Transaction costs: **-7,509.78**

Unlike V1, neither side provides positive pre-cost attribution under the V2 sampling rule.

## Chronological blocks

| Block | Net return | Net PnL | Daily PF |
|---|---:|---:|---:|
| B1 | -4.0349% | -4,034.93 | 0.755 |
| B2 | -0.7194% | -690.35 | 0.940 |
| B3 | +1.1960% | +1,139.44 | 1.101 |
| B4 | -4.7003% | -4,531.80 | 0.609 |

Only **1 / 4** chronological blocks is positive. The final block B4 is negative.

## Frozen development gate result

Seven preregistered V2 development gates:

- full-window net return > 0: **FAIL**
- maximum drawdown < 15%: **PASS**
- at least 3 of 4 blocks positive: **FAIL**
- final block B4 positive: **FAIL**
- at least 4 of 6 assets positive: **FAIL**
- positive-PnL concentration <= 40%: **FAIL** — only ADA is positive, concentration 100%
- turnover / starting equity <= 61.7911513x: **FAIL** — observed 125.162972x

Decision: **STRATEGY_V2_DEV_FAIL**.

## Cost diagnostics

| Cost case | Net return | Pre-cost price+funding | Max DD | Daily PF | Turnover/start |
|---|---:|---:|---:|---:|---:|
| 3 bp | -4.4279% | -598.52 | 6.1742% | 0.911 | 127.6445x |
| 6 bp primary | -8.1176% | -607.85 | 8.7702% | 0.840 | 125.1630x |
| 10 bp | -12.8169% | -621.59 | 13.3783% | 0.755 | 121.9535x |

The 3 bp diagnostic remains negative and cannot rescue the primary result.

## Execution-reference integrity

Across all six assets:
- scheduled samples per asset: **1,216**
- warm-up samples per asset: **1**
- executable samples per asset: **1,215**
- skipped scheduled execution references: **0**
- terminal target weight: **0**

The result is therefore not explained by missing scheduled fills or failed terminal flattening.

## Research decision

The V2 development failure does **not** authorize the locked 2026-09 through 2027-02 prospective holdout.

The holdout remains untouched by this research line and must not be run for V2.

The Quarter-Hour Boundary Imbalance strategy family is placed in:

**PAUSED AFTER V2 DEVELOPMENT FAIL**

No Strategy V3 is authorized by this result lock.

A future successor would require a genuinely new, separately motivated hypothesis and preregistration. It must not:
- isolate ADA;
- select B3;
- switch side after attribution;
- lower primary costs;
- tune sample times or cadence from this result;
- add a threshold merely to rescue turnover;
- inspect the frozen future holdout before a new protocol is locked.

Paper and live trading remain disabled.
