# Grid Path Simulator V1 — Research Foundation

Status: **FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

## Purpose

Provide a deterministic, testable minute-level grid fill engine before MERIDIAN evaluates any Dynamic Grid, Pionex-style Grid, Infinity Grid or bounded DCA/Grid hypothesis.

This file defines execution semantics only. It does not define a profitable strategy, parameters, leverage, bot promotion or live order path.

## Why this foundation is required

Daily/6h OHLC bars cannot determine the order of multiple grid crossings inside one candle. Even 1-minute OHLC retains intrabar ordering ambiguity.

The published Dynamic Grid Trading paper uses minute-level data and describes dynamic grid resets. Its public reference implementation processes an Open/Low/High/Close path, while the paper text describes geometric grids and the reference grid helper uses linear spacing. MERIDIAN therefore must not claim exact replication without making these assumptions explicit.

## Frozen simulator scope

Input:
- completed 1-minute OHLC bars;
- ascending unique grid levels;
- current active grid-level index;
- optional timestamp gap limit.

No synthetic bars and no interpolation.

## Supported grid level modes

### GEOMETRIC
For center price `P`, step `k`, half-level count `h`:
- lower levels: `P / (1+k)^i`
- center: `P`
- upper levels: `P * (1+k)^i`
- `i = 1..h`

### ARITHMETIC
For center `P`, step `k`, half-level count `h`:
- absolute step = `P*k`
- levels = `P + i*(P*k)`, `i=-h..h`.

This mode matches the public DGT reference helper more closely.

## Intrabar path envelope

Every strategy replay using this foundation must be runnable under both deterministic path assumptions:

### PAPER_OLHC
- first bar: Open → Low → High → Close
- subsequent bars: previous Close → Low → High → Close

This mirrors the public DGT backtest's explicit path ordering.

### ALT_OHLC
- first bar: Open → High → Low → Close
- subsequent bars: previous Close → High → Low → Close

This is an alternative plausible ordering.

A future strategy that depends materially on only one ordering must expose that sensitivity. No single OHLC ordering may be presented as known historical fill truth.

## Crossing semantics

For each directed price segment:
- upward movement crosses the next higher grid levels in ascending order and emits `SELL`;
- downward movement crosses the next lower grid levels in descending order and emits `BUY`;
- all crossed levels are emitted sequentially;
- a level reached exactly at a segment endpoint is emitted once;
- a level equal to the segment start is not emitted again;
- state advances after every crossing.

This prevents double counting when adjacent path segments share endpoints.

## Data integrity

- bars must be strictly ordered by `openTime`;
- duplicate timestamps are rejected;
- OHLC values must be finite and positive;
- `high >= max(open, close, low)`;
- `low <= min(open, close, high)`;
- default maximum gap between consecutive 1-minute bars = 120 seconds;
- a gap above the configured limit fails closed;
- no missing-bar reconstruction.

## Reset boundary

The simulator exposes crossing events and grid-boundary state. It does **not** automatically define what happens to wallet balances on a range breakout.

Dynamic reset, capital injection, coin carry-forward, fees and PnL belong to a separately frozen strategy layer. This prevents the fill engine from silently baking in one paper/exchange-specific economic model.

## Safety

- research-only;
- no exchange credentials;
- no order submission;
- no Pionex/OKX/Binance account mutation;
- no leverage or liquidation model;
- no strategy promotion.

## Evidence basis

- Chen, Chen & Jang (2025), *Dynamic Grid Trading Strategy: From Zero Expectation to Market Outperformance*, arXiv:2506.11921.
- Public reference repository: `colachenkc/Dynamic-Grid-Trading`.
- Current Pionex Grid/Futures Grid documentation is used only to understand product behavior; MERIDIAN does not claim exchange-exact fill replication from OHLC data.
