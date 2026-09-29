# Self-History Perpetual Factor V3 — Frozen Research Protocol

Status: **FROZEN BEFORE RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `PERPETUAL-FACTOR-DATA-V1`
- `PERPETUAL-FACTOR-ROW-CONTINUITY-V1`
- immutable failed lineage `SELF-HISTORY-PERP-FACTOR-V2-FROZEN`

## Why V3

V2 never reached economic evaluation. It failed closed because its global row validator required every 4h premium row to exist across the full collected history.

The independent row-continuity audit then showed:
- 0 source transport errors;
- 0 funding gaps >12h across all 14 assets;
- sparse premium gaps, predominantly synchronized/archive-specific;
- approximately 99% factor-ready eligible Monday coverage for long-history assets;
- no authorization to interpolate or repair missing rows.

V3 changes **only the predeclared handling of sparse missing factor inputs**. V2's factor definitions, costs, portfolio construction, universes, validation windows and economic gates remain unchanged.

## Fixed universes

Discovery / temporal:
- BTC
- ETH
- BNB
- SOL
- XRP
- ADA
- DOGE
- LINK
- DOT
- SUI

Reserved transfer:
- LTC
- BCH
- AVAX
- HBAR

Objective first eligibility remains:
- BTC/ETH/BNB/SOL/XRP/ADA/DOGE/LINK/DOT/LTC/BCH/AVAX: 2023-01
- HBAR: 2023-03
- SUI: 2025-05

No asset may move between groups.

## Official data

Binance Vision public USD-M monthly archives:
- 4h perpetual klines
- 4h premiumIndexKlines
- fundingRate

No private API, no synthetic rows and no interpolation.

## Time windows

Discovery:
- entry anchors 2023-04-03 <= t < 2024-12-30
- final exit 2024-12-30

Temporal holdout, only after discovery pass:
- entry anchors 2025-01-06 <= t < 2026-08-31
- final exit 2026-08-31

Transfer holdout, only after temporal pass:
- LTC/BCH/AVAX/HBAR
- entry anchors 2023-04-03 <= t < 2026-08-31
- final exit 2026-08-31

Weekly anchors are Monday 00:00 UTC.

## Factor books — unchanged from V2

Three books are constructed and traded independently.

### F1 MOMENTUM_12W
- raw = exact preceding 4h close at t / exact preceding 4h close at t-12 weeks - 1
- high = LONG
- low = SHORT

### F2 FUNDING_CARRY_7D
- raw = negative sum of realized funding in [t-7d,t)
- high = LONG
- low = SHORT

### F3 PREMIUM_REVERSION_7D
- raw = negative arithmetic mean of completed 4h premium closes in [t-7d,t)
- high = LONG
- low = SHORT

## New V3 sparse-input rule

This is the only material redesign from V2.

### Current factor validity

For asset i, factor f, week t:

- MOMENTUM valid only when both exact required price marks exist.
- FUNDING_CARRY valid only when the 7d funding window has finite values and no boundary/inter-event gap >12h.
- PREMIUM_REVERSION valid only when all 42 expected 4h premium rows exist in the prior 7d window.

No nearest-neighbor substitution.

### Own-history validity

For each asset/factor:
- inspect at most the **60 prior weekly anchors**;
- keep only valid raw factor observations;
- use the most recent **52 valid observations**;
- if fewer than 52 valid observations exist inside those 60 anchors, that asset/factor is unavailable for the current week.

Current observation is never included in its own reference set.

### Matched benchmark universe

For a given factor/week, Own-History and Cross-Sectional use the **same factor-valid asset set**.

This prevents the benchmark from receiving a broader data universe than Own-History.

### Factor-book breadth

Discovery/temporal:
- factor book may trade only with >=8 factor-valid objectively eligible assets;
- otherwise that factor book is FLAT for the week.

Transfer:
- factor book may trade only with >=3 factor-valid objectively eligible assets;
- otherwise that factor book is FLAT.

Moving active -> flat or flat -> active incurs normal turnover costs.

Missing inputs never cause another independent factor book to inherit or synthesize a signal.

### Holding-period integrity

Once a position is entered:
- exact entry price required;
- exact next-week exit price required;
- active holding funding coverage required with no gap >12h.

If an active selected position lacks any of these, the stage fails closed with `DATA_INTEGRITY_FAILURE`.

## Own-history ranking — unchanged

For each factor-valid asset:
- empirical percentile against its 52 valid own-history observations;
- LONG if percentile >=0.80;
- SHORT if percentile <=0.20;
- otherwise FLAT.

Discovery/temporal factor book requires >=2 longs and >=2 shorts.
Transfer requires >=1 long and >=1 short.

No threshold grid.

## Cross-sectional benchmark — unchanged

Per factor/week on the matched factor-valid set:
- discovery/temporal side count = max(2, floor(N/5));
- transfer side count = 1;
- highest raw factors LONG;
- lowest raw factors SHORT;
- same costs/funding/holding period.

## Portfolio construction — unchanged

Each active factor book:
- gross 1.00
- +0.50 long
- -0.50 short
- equal weight inside each side
- net dollar exposure 0
- no leverage beyond 1.0 gross
- weekly rebalance only
- no stops, TP, pyramiding or discretionary override

Combined strategy:
- 1/3 capital F1
- 1/3 capital F2
- 1/3 capital F3
- combine returns, never raw scores

## Price, funding and costs — unchanged

Weekly price contribution:
- w_i × (P_i(t+1w)/P_i(t)-1)

Funding:
- -w_i × sum(realized funding in (t,t+1w]

Base cost:
- 8 bps × portfolio turnover

Stress:
- 32 bps × turnover

Final stage anchor:
- all books forced flat
- full terminal turnover charged

No rebates or VIP discounts.

## Metrics — unchanged

Report:
- completed periods
- active combined weeks
- factor active weeks
- net compounded return
- price-only compounded return
- funding contribution
- costs
- Profit Factor
- annualized Sharpe using sample stdev × sqrt(52)
- max drawdown
- 5 chronological windows
- long/short gross contributions
- per-asset attribution
- positive asset count/concentration
- turnover
- 4x cost stress
- factor-book returns
- Own-History vs matched Cross-Sectional combined and per-factor results
- factor-valid breadth and flat-by-missing-input counts

## Discovery gate — unchanged from V2

All must pass:
- >=85 completed weekly periods
- >=55 active combined weeks
- each factor book active >=40 weeks
- combined net return >0
- combined price-only return >0
- PF >=1.15
- Sharpe >=0.75
- max DD <=20%
- >=4/5 positive chronological windows
- long contribution >0
- short contribution >0
- >=6 positive-PnL discovery assets
- max positive-PnL concentration <=35%
- 4x stress return >0
- >=2/3 Own-History factor books positive
- Own-History combined return > Cross-Sectional combined return
- Own-History beats Cross-Sectional in >=2/3 factor books
- no holding-period data-integrity failure

PASS => `DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED`  
FAIL => `DISCOVERY_FAIL_RESEARCH_REDESIGN`

## Temporal holdout gate — unchanged from V2

- >=75 periods
- >=45 active combined weeks
- each factor active >=30 weeks
- net return >0
- price-only >0
- PF >=1.05
- Sharpe >=0.50
- max DD <=20%
- >=3/5 positive windows
- long >0
- short >0
- >=6 positive assets
- 4x stress >0
- >=2/3 factors positive
- Own-History combined > Cross-Sectional
- Own-History beats Cross-Sectional in >=2/3 factors

PASS => `TEMPORAL_HOLDOUT_PASS_TRANSFER_HOLDOUT_REQUIRED`

## Transfer gate — unchanged from V2

- >=150 periods
- >=70 active combined weeks
- each factor active >=45 weeks
- net return >0
- price-only >0
- PF >=1.05
- Sharpe >=0.50
- max DD <=25%
- >=3/5 positive windows
- long >0
- short >0
- >=3/4 positive assets
- 4x stress >0
- >=2/3 factors positive
- Own-History combined > Cross-Sectional
- Own-History beats Cross-Sectional in >=2/3 factors

PASS => `TRANSFER_HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

No holdout pass authorizes live execution.

## Anti-overfitting

- V1/V2 remain immutable.
- Sparse-input rule frozen before V3 result.
- No interpolation.
- No asset removal.
- No factor removal/addition.
- No direction flip.
- No threshold/lookback/cost change.
- No date-window change.
- No post-result widening of the 60-week history window.
- No post-result lowering of valid-breadth requirements.
- Any redesign becomes V4.

## Safety

Research only. No credentials, live orders, leverage, liquidation model, account mutation or automatic promotion.
