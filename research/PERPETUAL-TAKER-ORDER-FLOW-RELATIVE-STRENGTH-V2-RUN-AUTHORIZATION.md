# Taker Order Flow Relative Strength V2 — First Validation Authorization

Status: **FIRST INDEPENDENT FEATURE VALIDATION AUTHORIZED — STRATEGY PNL / PAPER / LIVE BLOCKED**  
Implementation merge: `d0cc924fb7abea1eb1d07bf8a85e7ab1f8993a61`  
Implementation PR: **#465**  
Ruleset: `PERPETUAL-TAKER-ORDER-FLOW-RELATIVE-STRENGTH-V2-FROZEN`  
Execution impact: **false**

## Authorization

This file authorizes exactly one first independent historical feature-validation run of the frozen V2 ruleset.

Before this authorization:
- PR #465 Exact-Head Release Safety passed;
- V2 synthetic invariants passed;
- Frozen Research Guard passed;
- PR #465 historical `source` and `evaluate` jobs were both skipped;
- no 2025–2026 V2 Rank IC, spread, t-statistic, block result, decision or strategy PnL has been inspected;
- the parent V1 engine remains frozen at Git blob `580f8885118aa1bfcccd6c77a431d5b7835e8bba`.

## Authorized public source

Binance Vision USD-M monthly 1h perpetual klines only.

Archive months fetched:
- 2025-01 through 2026-08.

Rows retained in the exact source package:
- from `2025-01-04T00:00:00Z`;
- through `2026-08-29T00:00:00Z` inclusive;
- no later hourly row.

Universe is exactly:
BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX.

No funding data, private data, synthetic history or interpolation is authorized.

## Frozen validation

Exactly 85 Saturday weekly anchors:
- first: `2025-01-11T00:00:00Z`;
- last feature anchor: `2026-08-22T00:00:00Z`;
- final next-week outcome open: `2026-08-29T00:00:00Z`.

The run may calculate only:
- weekly cross-sectional FLOW-vs-next-week-return Spearman Rank IC;
- weekly Top-2 minus Bottom-2 next-week return spread;
- Newey-West(4) t-statistics;
- five frozen chronological-block diagnostics;
- the preregistered feature gate.

It may not form a portfolio or calculate funding, transaction costs, strategy PnL, Profit Factor, Sharpe, drawdown or live/Paper metrics.

Possible decisions:
- `FEATURE_VALIDATION_PASS_STRATEGY_DESIGN_ALLOWED`;
- `FEATURE_VALIDATION_FAIL_RESEARCH_STOP`.

## Safety boundary

Even a PASS:
- does not authorize a long-only strategy;
- does not authorize any portfolio weight or threshold;
- does not authorize Paper bots;
- does not authorize live execution;
- authorizes only a separately named and separately preregistered strategy-design stage.

A FAIL closes this V2 line without retuning.
