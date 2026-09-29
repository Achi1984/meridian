# Regime-Gated Grid V2 — Frozen Research Protocol

Status: **FROZEN BEFORE RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after Dynamic Grid Proxy V1 failure  
Foundation: `GRID-PATH-SIMULATOR-V1-FROZEN` + `DYNAMIC-GRID-PROXY-V1-FROZEN`

## Objective

Test whether the V1 self-financing Dynamic Grid becomes economically viable when it is activated only in a predeclared range / moderate-volatility regime.

This is a new ruleset. It does **not** change or rescue the V1 discovery result. V1 remains immutable and failed.

## Evidence fixed before results

Independent rationale used before V2:
- grid strategies are intended for range-bound markets and are vulnerable to sustained trends;
- recent regime-gated grid research reports materially different outcomes across market regimes;
- low-/moderate-volatility filtering is a documented design lever in crypto strategy construction;
- transaction costs remain a first-order constraint, so V2 keeps the full V1 cost model unchanged.

## Data

Official Binance Vision Spot data only.

Assets:
- BTCUSDT
- ETHUSDT

Minute execution data:
- 1-minute Spot klines.

Regime feature data:
- 1-day Spot klines.
- only completed daily bars strictly before the tested month.

No synthetic bars and no interpolation.

## Time split

### Regime warm-up
- 2023-06-01 through 2023-12-31 daily bars.

### Discovery
- 2024-01-01 through 2025-12-31.
- 24 calendar months × 2 assets = 48 possible asset-month cycles before regime gating.

### Frozen temporal holdout
Allowed **only if discovery passes**:
- 2026-01-01 through 2026-08-31.
- no retuning.

The V2 discovery/holdout periods are temporally disjoint from the V1 discovery window.

## Range / moderate-volatility gate

The regime gate is evaluated separately for BTC and ETH at each calendar-month start using data available before that month.

A month is **ELIGIBLE** only if all three frozen conditions pass.

### 1 · 30-day Efficiency Ratio

Using the last 31 completed daily closes before month start:

`ER30 = abs(C_t - C_{t-30}) / sum(abs(C_i - C_{i-1}))`

Requirement:
- `ER30 <= 0.30`

Interpretation: low net directional progress relative to total path movement.

### 2 · 30-day range position

Using the previous 30 completed daily bars:

`rangePosition = (C_t - Low30) / (High30 - Low30)`

Requirement:
- `0.20 <= rangePosition <= 0.80`

Interpretation: do not start a new grid when price is already sitting at a 30-day range edge.

### 3 · Relative 30-day realized volatility

Compute annualized 30-day realized volatility from daily log returns.

Reference:
- median of the prior 180 available daily `RV30` observations, all known before month start.

Requirement:
- `0.60 <= RV30 / medianRV30_180 <= 1.05`

Interpretation:
- reject very quiet regimes with too few expected fills;
- reject elevated-volatility regimes where range breaks are more likely;
- keep moderate volatility relative to the asset's own recent history.

If any input is missing or non-finite, the month is INELIGIBLE.

The regime gate is independent of grid candidate parameters. Every candidate sees exactly the same eligible month set.

## Candidate space

Unchanged external paper-motivated geometric candidates:
- step: 0.5%, 1.0%, 1.5%, 2.0%
- half-levels: 2, 3, 5
- level mode: GEOMETRIC only for gating

Total: 12 candidates.

No candidate is added or removed after the first result.

## Wallet / execution semantics

Exactly preserve V1:
- $10,000 fresh capital per eligible asset-month;
- no leverage;
- no borrowing;
- no capital injection;
- initial and reset rebalance to approximately 50% quote / 50% base;
- fixed base order quantity between resets;
- reset only after an outer boundary is reached;
- reset at the next minute open;
- ignore remaining intrabar segments after a reset-triggering boundary event;
- same deterministic path envelope:
  - PAPER_OLHC
  - ALT_OHLC
- same static-grid benchmark;
- same 120-second minute-gap failure rule.

Ineligible months:
- no strategy starts;
- return is not counted as a zero-return trading month;
- they are reported as regime-skipped observations.

## Costs

Unchanged from V1:
- fee: 8 bps per fill/rebalance;
- base slippage: 2 bps adverse per fill/rebalance.

Stress:
- +5 bps additional adverse slippage.

No maker rebates, VIP discounts or fee-token assumptions.

## Discovery sample gate

Before strategy performance is considered:
- >=16 eligible paired asset-month cycles in aggregate;
- >=8 eligible cycles for BTC;
- >=8 eligible cycles for ETH.

If the regime gate produces a smaller sample, V2 fails for insufficient evidence. Thresholds are not relaxed.

## Frozen discovery performance gate

A candidate passes only if all are true under **both** path modes:

- eligible sample gate passes;
- compounded equal-weight eligible-month portfolio return > 0;
- monthly Profit Factor >= 1.10;
- max minute-close marked drawdown <= 25%;
- >=3 of 5 chronological eligible-period windows positive;
- BTC compounded eligible-month return > 0;
- ETH compounded eligible-month return > 0;
- stressed portfolio return > 0;
- Dynamic Grid return > same-parameter Static Grid return;
- absolute PAPER vs ALT portfolio-return difference <= 10 percentage points;
- zero insufficient-wallet events;
- identical dynamic/static coverage.

Leader selection among passing candidates:
1. highest worst-path compounded portfolio return;
2. lower worst-path max drawdown as tie-breaker.

A discovery pass authorizes only the frozen temporal holdout.

## Frozen holdout gate

Selected discovery leader only, unchanged parameters.

Holdout sample:
- >=6 eligible paired asset-month cycles total;
- >=3 eligible cycles per asset.

Performance requirements under both path modes:
- portfolio net return > 0;
- Profit Factor >= 1.05;
- max marked drawdown <= 25%;
- BTC and ETH each net positive;
- stressed portfolio return > 0;
- Dynamic > same-parameter Static;
- path return difference <= 10 percentage points;
- zero insufficient-wallet events.

PASS => `HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`  
FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`

Even a holdout pass does not authorize live execution.

## Anti-overfitting

- This protocol is committed before any V2 result is observed.
- V1 parameters/results remain untouched.
- No regime threshold may be changed after V2 results.
- No ineligible month may be reclassified after results.
- No candidate may be added after results.
- No cost reduction.
- No path-mode removal.
- No sample threshold relaxation.
- No holdout date change.
- Any successor gets a new ruleset.

## Safety

Research only. No exchange credentials, no order submission, no Pionex/OKX/Binance account mutation, no leverage, no liquidation model and no automatic promotion.
