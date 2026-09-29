# Adaptive Cross-Venue Funding Spread V3 — Frozen Discovery Result

Workflow run: **36578604075**  
Artifact: **11039125957**  
Summary prehash SHA-256: `69ae60701938dee35c28e67685cd2c00bd778e47c14b20a5661e005e1b79d90f`  
Full evidence SHA-256: `a5b987d7779543878ec67a5521d46ad4d32eebe09aa1201d42ef6448cf777ade`  
Markdown SHA-256: `feeb9f18eda4a47050a7882bc3e01aaf5343b60e375b59f3c99fc36064013be6`

This records the first untouched strategy result of `ADAPTIVE-CROSS-VENUE-FUNDING-SPREAD-V3-FROZEN`.

## Frozen discovery window

- raw data: 2024-09-01 through 2025-09-01
- September 2024: signal warm-up only
- trade months: 2024-10 through 2025-08
- universe: HBAR, SUI, NEAR, FIL, UNI, AAVE, ATOM, ARB
- NO-TRADE threshold: 0.78% prior-month realized funding differential
- $10,000 per leg
- fixed reserved strategy capital: $160,000/month
- base cost: $32 per active asset-month
- stress cost: $52 per active asset-month

No holdout data were loaded by the final discovery runner.

## Discovery result

- decision slots: **88**
- active cycles: **35**
- NO TRADE cycles: **53**
- LONG Binance / SHORT Hyperliquid: **34**
- SHORT Binance / LONG Hyperliquid: **1**
- data-integrity failure: **false**

### Economics

- compounded net return: **+1.2386%**
- net PnL: **+$1,973.96**
- Profit Factor: **20.003**
- max closed-equity drawdown: **0.0649%**
- positive chronological windows: **4/5**
- funding PnL: **+$3,113.05**
- basis PnL: **-$19.09**
- modeled base costs: **$1,120**
- funding / cost ratio: **2.7795**
- stress return: **+0.7975%**
- positive assets: **8/8**
- positive-PnL concentration: **32.07%**
- prior-spread/current-spread sign agreement: **97.14%**

### Signal diagnostics

- mean absolute trailing spread: **0.7882%**
- median absolute trailing spread: **0.6671%**
- mean active trailing spread: **1.3847%**
- median active trailing spread: **1.3139%**

## Asset attribution

| Asset | Active | Binance-long | Hyperliquid-long | Net PnL | Stress PnL | Funding PnL | Basis PnL |
|---|---:|---:|---:|---:|---:|---:|---:|
| HBAR | 5 | 5 | 0 | +$420.87 | +$320.87 | +$590.25 | -$9.38 |
| SUI | 4 | 4 | 0 | +$141.16 | +$61.16 | +$280.51 | -$11.35 |
| NEAR | 5 | 5 | 0 | +$262.28 | +$162.28 | +$427.51 | -$5.23 |
| FIL | 2 | 2 | 0 | +$130.53 | +$90.53 | +$184.56 | +$9.97 |
| UNI | 5 | 5 | 0 | +$236.30 | +$136.30 | +$401.27 | -$4.97 |
| AAVE | 7 | 7 | 0 | +$633.06 | +$493.06 | +$840.69 | +$16.38 |
| ATOM | 3 | 3 | 0 | +$144.71 | +$84.71 | +$241.35 | -$0.64 |
| ARB | 4 | 3 | 1 | +$5.05 | -$74.95 | +$146.92 | -$13.87 |

## Frozen gate result

**FAIL**

Reasons:
- `SHORT_BINANCE_LONG_HYPERLIQUID:CYCLES_LT_4`
- `SHORT_BINANCE_LONG_HYPERLIQUID:PNL_NOT_POSITIVE`

Every other preregistered discovery gate passed.

## Decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

No V3 temporal holdout is authorized.

## Interpretation

The cost-derived prior-month spread filter produced strong discovery economics, low drawdown, broad positive asset attribution and high persistence of funding-spread sign.

However, the discovery sample overwhelmingly occupied only one direction: LONG Binance / SHORT Hyperliquid. The reverse direction occurred once and was not profitable. Therefore the preregistered **adaptive two-direction** hypothesis was not sufficiently exercised and fails exactly as intended by the independent-review gate.

This does not invalidate the observed selective fixed-direction pattern; it may generate a new separately frozen hypothesis, but that successor must be validated only on untouched data.

## Anti-overfitting decision

- no V3 holdout;
- no removal of the bidirectional gate;
- no 0.78% threshold change;
- no asset removal;
- no basis filter;
- no direction exception inside V3;
- no fee/slippage reduction;
- no discovery-window extension;
- no gate relaxation;
- no Paper/live promotion.

Any successor must use a new ruleset and must freeze before any 2025-09 through 2026-08 strategy result is observed.
