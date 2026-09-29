# Perpetual Relative-Value Reversal V3 Data V2 — Broad-Market Benchmark Foundation

Status: **DATA FOUNDATION EXTENSION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- `PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-DATA-V1-FROZEN`
- canonical Data V1 result: FOUNDATION_PASS, 19/20 transfer candidates qualified, EOS failed and is not replaced
- MERIDIAN main after PR #318

## Purpose

Extend the already-passed V3 strategy-neutral data foundation with a broader fixed crypto-market benchmark before any beta, residual-return or strategy calculation is allowed.

Data V1 audited BTC as a sole possible benchmark. External 2025 evidence shows that crypto beta estimates and hedge effectiveness depend materially on market-index specification, while standard crypto betas are unstable and difficult to forecast.

Data V2 therefore checks only whether a fixed five-asset broad-market benchmark can be supported by complete official public daily perpetual-price data over the same canonical V3 transfer interval.

## Frozen benchmark basket

Frozen before Data V2 coverage inspection:

- BTC
- ETH
- BNB
- SOL
- XRP

Count: **5**

No benchmark may be added, removed or replaced after results.

These assets are benchmark-only. They are not added to the 20-asset V3 transfer-candidate universe and are not ranked or traded by this foundation.

## Inherited candidate universe

Data V2 does not reopen candidate qualification.

Canonical Data V1 candidate universe remains exactly:

SAND, MANA, ALGO, EOS, ZEC, IOTA, ZIL, COMP, SNX, KSM, 1INCH, CHZ, RUNE, SUSHI, DYDX, APE, ARB, SUI, WLD, SEI.

Canonical Data V1 qualified assets remain the 19 assets recorded in its immutable result. EOS remains a documented failure and is not replaced.

## Public source

Binance Vision USD-M monthly archives only:

- `klines/{SYMBOL}/1d`

No authenticated API, account state, credentials, synthetic backfill, interpolation or nearest-neighbor reconstruction.

## Frozen audit interval

Exactly the same common interval as canonical Data V1:

- 2024-01 through 2026-08 inclusive
- **32 completed calendar months**

No pre-2024 month is required by Data V2.

A later V3 protocol must choose an earliest strategy anchor that leaves its entire frozen beta-estimation lookback inside this audited benchmark interval.

## Daily-price validation

For every benchmark asset-month:

- finite positive OHLC;
- internally consistent OHLC;
- strictly increasing open timestamps;
- no duplicate timestamps;
- exact 24-hour cadence;
- row count equals the number of UTC calendar days;
- first row opens exactly at UTC month start;
- last row opens at the final daily UTC slot.

Any missing archive or continuity failure remains visible and fails that asset-month.

## Benchmark qualification

A benchmark asset is `V3_BROAD_MARKET_BENCHMARK_READY` only when:

- all 32 monthly price audits pass;
- zero unexpected transport errors occur for that asset.

## Foundation gate

PASS requires all:

- all five frozen benchmark assets represented;
- all **5/5** benchmark assets are V3_BROAD_MARKET_BENCHMARK_READY;
- zero unexpected/unrecorded transport errors;
- inherited Data V1 candidate universe/result is unchanged;
- no market-factor return calculated;
- no beta calculated;
- no residual return calculated;
- no reversal rank calculated;
- no portfolio weight calculated;
- no strategy PnL calculated;
- no synthetic backfill.

PASS => `FOUNDATION_PASS_BROAD_MARKET_BENCHMARK`

FAIL => `FOUNDATION_FAIL_BROAD_MARKET_DATA_REDESIGN`

A PASS authorizes only a separately frozen V3 strategy protocol.

## What remains forbidden after PASS

A Data V2 pass does not itself choose:

- equal-weight versus alternative benchmark weighting;
- simple versus log benchmark return;
- OLS versus winsorized versus Bayesian-shrunk beta;
- beta lookback;
- residual-return formation;
- skip/hold periods;
- portfolio-neutralization method;
- transaction costs;
- funding accounting;
- development/transfer split;
- promotion gates.

All of those must be preregistered before first V3 strategy PnL.

## External design motivation

- Sila, Mark, Kristoufek et al. (2025), *Crypto market betas: the limits of predictability and hedging*, Financial Innovation 11:107: crypto beta predictability is low, robust/shrunk estimators can improve forecasts, and market-index choice materially affects results.
- Liu, Tsyvinski & Wu (2022), *Common Risk Factors in Cryptocurrency*, Journal of Finance 77(2): market, size and momentum factors explain substantial cross-sectional crypto return variation.

Data V2 uses these findings only to justify benchmark breadth. It does not claim replication and does not inspect strategy economics.

## Anti-overfitting

- benchmark basket frozen before coverage results;
- interval inherited unchanged from Data V1;
- 5/5 completeness gate frozen before results;
- candidate universe not reopened;
- failed EOS not replaced;
- no strategy calculation in Data V2;
- any further data redesign receives a new ruleset.

## Safety

Research/data only. No credentials, exchange mutation, orders, leverage automation, liquidation model, wallet state, Paper promotion or live promotion.
