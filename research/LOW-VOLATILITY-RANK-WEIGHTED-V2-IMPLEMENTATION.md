# Low-Volatility Rank-Weighted V2 — Deterministic Implementation Contract

Status: **IMPLEMENTED FOR REVIEW / HISTORICAL DEVELOPMENT RUN BLOCKED / HOLDOUT SEALED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Preregistration: `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PREREGISTRATION.md`  
Execution impact: **false**  
Paper/live authorization: **false**

## Frozen lineage

V2 is a separately named strategy family. It does not reopen the failed V1 extreme-basket line.

The implementation imports the exact frozen V1 Low-Volatility feature engine and verifies its Git blob before any Development evaluation:

`d161b6b4553d5a18fc7064570f4a4e956178d0c9`

No V2 Development strategy result is calculated on pull requests.

## Portfolio construction

At each frozen Saturday anchor:

- compute the unchanged 12 V1 `LOWVOL` signals;
- assign ascending average ranks;
- center ranks at 6.5;
- divide centered ranks by the sum of their absolute values;
- fail closed if the rank cross-section is degenerate.

The resulting target is exactly dollar-neutral and normalized to gross 1.0.

No top/bottom basket selection, leverage multiplier, stop, take-profit, DCA, martingale, volatility scaling, or regime filter is implemented.

## Price and funding accounting

The implementation uses:

- V1 open-to-open next-week price returns;
- official public funding rows represented as `[timestamp_ms, interval_hours, rate]`;
- funding timestamps in `(t, t+7d]`;
- asset funding contribution `-weight * funding_sum`.

Funding coverage fails closed when:

- no event is present for a weekly hold;
- the first event is too far from the anchor for its declared funding interval;
- an internal gap exceeds the maximum declared interval across adjacent events;
- the terminal gap exceeds the final event's declared interval.

## Costs and turnover

Target turnover is the absolute weight change across all 12 assets.

Frozen costs:

- baseline **10 bps** one-way per unit of turnover;
- stress **20 bps** one-way per unit of turnover.

The initial opening trade is charged from a zero portfolio. A mandatory terminal close is charged after the final Development week.

## Development source

The collector is historical-source-only and never runs on a pull request.

Authorized public source families:

- Binance Vision USD-M monthly 1h `klines`;
- Binance Vision USD-M monthly `fundingRate`.

Archive months:

- 2025-01 through 2026-01.

Retained hourly source:

- first: **2025-01-03T23:00:00Z**;
- last: **2026-01-03T00:00:00Z**;
- exact rows per asset: **8,738**.

Retained funding source:

- from **2025-02-01T00:00:00Z**;
- through **2026-01-03T00:00:00Z**.

Every downloaded archive is SHA-256 receipted. Every retained per-asset JSON file is independently hashed in the source manifest. The result runner checks exact kline bounds, one-hour kline continuity, funding monotonicity, funding interval bounds, source hashes, and the frozen Development boundary.

No post-Development Holdout data are collected.

## Development engine

Exactly 48 weekly periods are evaluated from 2025-02-01 through the week ending 2026-01-03.

For both baseline and stress costs the implementation records:

- weekly net returns;
- compounded return;
- Profit Factor;
- annualized weekly Sharpe;
- maximum drawdown;
- four chronological compounded-return blocks;
- total turnover;
- transaction-cost contribution;
- price contribution;
- funding contribution;
- per-asset attribution;
- mean weekly Rank IC;
- Rank IC Newey-West(4) t-statistic;
- gross/net exposure invariants.

The gate is the exact preregistered gate. It produces only:

- `DEVELOPMENT_PASS_HOLDOUT_REQUIRED`
- `DEVELOPMENT_FAIL_RESEARCH_STOP`

## Holdout seal

The frozen Holdout calendar remains present only as constants/invariants:

- 34 periods;
- first anchor 2026-01-03;
- last feature anchor 2026-08-22;
- terminal open 2026-08-29.

This implementation includes no Holdout collector and no Holdout evaluator.

If Development fails, V2 closes without touching Holdout.

If Development passes, a separate implementation/review and separate run-authorization sequence is required before any Holdout data can be evaluated.

## Current authorization

Authorized in this PR:

- deterministic V2 Development engine;
- public Development-only collector;
- Development result runner;
- synthetic/structural tests;
- gated GitHub workflow;
- frozen lineage registration.

Not authorized in this PR:

- historical Development execution;
- Holdout evaluation;
- Paper execution;
- live execution.
