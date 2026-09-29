# Dynamic Grid Proxy V1 — Frozen Research Protocol

Status: **FROZEN BEFORE RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #263  
Foundation: `GRID-PATH-SIMULATOR-V1-FROZEN`

## Objective

Test whether a self-financing dynamic-reset Spot Grid can produce robust net profit after explicit costs and outperform an otherwise identical static Spot Grid.

This is a **MERIDIAN proxy**, not an exact replication of Chen, Chen & Jang (2025). The paper describes geometric grids and minute data, while the public reference code exposes implementation assumptions that are not identical to the paper text. MERIDIAN therefore freezes its own economic model and evaluates both supported intrabar path assumptions instead of presenting one OHLC ordering as historical truth.

## External evidence fixed before results

- Chen, Chen & Jang (2025), *Dynamic Grid Trading Strategy: From Zero Expectation to Market Outperformance*, arXiv:2506.11921.
- Public reference repository: `colachenkc/Dynamic-Grid-Trading`.
- The public repository uses BTC/ETH minute data, grid sizes 0.5%, 1.0%, 1.5%, 2.0%, half-grid counts 2/3/5, principal 100 and fee 8 bps.
- Current Pionex Spot Grid documentation is used only as a product-behavior reference: fixed-range grids pause outside their range and resume when price returns. It is not used as exchange-exact fill evidence.

## Data

Official Binance Vision Spot 1-minute klines:
- BTCUSDT
- ETHUSDT

No synthetic bars and no interpolation.

### Discovery window

- 2022-01-01 00:00 UTC through 2023-12-31 23:59 UTC.
- Each calendar asset-month is an independent research cycle with fresh $10,000 starting capital.
- Target sample: 48 asset-month cycles.
- Minimum valid sample: 40 cycles total and >=20 per asset.

### Temporal holdout

Allowed **only if discovery passes**:
- 2024-01-01 00:00 UTC through 2024-07-31 23:59 UTC.
- Same assets, parameters, costs, execution model and reset rules.
- No retuning.
- Minimum valid sample: 12 asset-month cycles total and >=6 per asset.

Monthly independence is intentional: it prevents capital-path carryover from turning a short data outage in one month into an invented multi-year wallet history.

## Candidate space

Primary, gating grid type: **GEOMETRIC**.

Frozen paper-motivated parameter grid:
- grid step: 0.5%, 1.0%, 1.5%, 2.0%
- half-level count: 2, 3, 5

Total gating candidates: 12.

`ARITHMETIC` is diagnostic-only after a geometric leader is selected. It may never rescue a failed geometric discovery.

## Intrabar path requirement

Every candidate is evaluated under both frozen path modes from the simulator:
- `PAPER_OLHC`
- `ALT_OHLC`

Candidate metrics are judged on the **worse** of the two path results unless explicitly stated otherwise.

A strategy that is profitable under only one path ordering fails.

## Economic model

### Starting wallet per asset-month

- starting equity: $10,000
- no leverage
- no borrowing
- no external capital injection after start
- no staking/yield/collateral return

At the first valid minute open:
- mark wallet equity at that price;
- rebalance to approximately 50% quote / 50% base;
- pay the same modeled transaction costs as every other trade;
- center the initial grid at that minute open.

### Grid order size

At each reset:
- base allocated to the sell side is the post-reset base inventory;
- fixed order quantity = reset base inventory / half-level count;
- that same fixed base quantity is used for each BUY or SELL crossing until the next reset.

The quote reserve must fund every lower-grid BUY including modeled costs. A cycle fails closed on insufficient cash or base inventory; order size is never silently reduced.

### Fill model

A grid crossing is executed at the crossed grid level with:
- fee: 8 bps of executed notional;
- slippage: 2 bps adverse to the strategy.

BUY:
- execution price = level × (1 + slippage)
- fee is added to cash outflow.

SELL:
- execution price = level × (1 - slippage)
- fee is deducted from cash proceeds.

### Dynamic reset

A reset is triggered when a crossing reaches either outer grid boundary.

To avoid invented recursive resets inside one 1-minute OHLC bar:
- remaining path segments in that minute are ignored after the boundary event;
- reset occurs at the **next minute open**;
- wallet is marked at that open;
- wallet is rebalanced to approximately 50% quote / 50% base;
- rebalancing pays the same fee/slippage model;
- a new geometric grid is centered on that open;
- no external capital is added.

This is deliberately more conservative and deterministic than assuming instantaneous multiple resets inside one minute.

### Static benchmark

For every dynamic candidate, run an otherwise identical **STATIC** grid:
- same initial wallet;
- same grid;
- same path mode;
- same costs;
- no dynamic resets.

At an outer boundary, the static grid simply remains at that boundary and may resume crossing inner levels if price later re-enters the original range.

## Stress model

Stress adds **+5 bps adverse slippage per fill/rebalance** on top of the base 8 bps fee + 2 bps slippage.

No fee rebate, maker discount or VIP tier is assumed.

## Metrics

For each candidate/path:
- compounded equal-weight monthly portfolio return across BTC + ETH;
- monthly Profit Factor;
- maximum marked drawdown across asset-month cycles;
- positive chronological windows out of 5;
- BTC compounded return;
- ETH compounded return;
- reset count;
- fill count;
- modeled costs;
- stressed return;
- same-parameter static-grid return;
- path-order sensitivity.

Buy-and-hold for the same monthly cycles is diagnostic only, not gating.

## Frozen discovery gate

A geometric candidate passes only if **all** are true under both path modes:

- >=40 valid asset-month cycles total;
- >=20 valid cycles for BTC and >=20 for ETH;
- compounded portfolio net return > 0;
- Profit Factor >= 1.10;
- max marked drawdown <= 35%;
- >=3 of 5 chronological windows positive;
- BTC net return > 0;
- ETH net return > 0;
- stressed portfolio return > 0;
- dynamic-grid portfolio return > same-parameter static-grid return;
- absolute difference between the two path-mode portfolio returns <= 15 percentage points;
- zero insufficient-wallet events;
- data gate passes without synthetic reconstruction.

If multiple candidates pass, discovery leader = highest **worst-path** compounded portfolio return. Tie-breaker = lower worst-path max drawdown.

A discovery pass authorizes only the frozen temporal holdout.

## Frozen holdout gate

The selected discovery leader must pass the same methodology on 2024-01 through 2024-07 with:

- >=12 valid asset-month cycles total;
- >=6 valid cycles per asset;
- portfolio net return > 0 under both path modes;
- Profit Factor >= 1.05 under both path modes;
- max marked drawdown <= 35%;
- BTC and ETH each net positive;
- stressed portfolio return > 0;
- dynamic return > same-parameter static return;
- path-mode return difference <= 15 percentage points;
- zero insufficient-wallet events.

PASS => `HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`.

FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`.

Even a holdout PASS does not authorize live trading.

## Data integrity

Each monthly cycle:
- completed 1-minute OHLC only;
- timestamps strictly increasing;
- duplicate timestamps rejected;
- OHLC validity checked by the existing simulator;
- maximum timestamp gap = 120 seconds;
- a month with a larger gap fails closed and is excluded from candidate metrics;
- no missing-minute reconstruction.

The same valid/rejected month set is used across every candidate. Candidate selection may not depend on dropping inconvenient months.

## Anti-overfitting

- This protocol is committed before the first real Dynamic Grid result.
- No candidate parameter is added after observing results.
- No losing asset/month is removed after results.
- No cost reduction after results.
- No path mode may be discarded.
- No discovery gate may be relaxed.
- No temporal holdout date may be changed.
- Arithmetic diagnostics cannot rescue a failed geometric candidate.
- Any redesign gets a new ruleset/name.

## Safety

Research only. No exchange credentials, no live orders, no Pionex/OKX/Binance account mutation, no leverage, no liquidation path and no automatic bot promotion.
