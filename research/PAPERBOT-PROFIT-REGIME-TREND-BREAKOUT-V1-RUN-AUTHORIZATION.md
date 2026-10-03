# Regime-Gated Trend / Breakout V1 — Discovery Run Authorization

Status: **DISCOVERY RUN AUTHORIZED — HOLDOUT BLOCKED**  
Implementation commit: `b45e021ec29d4c53b9878dd74ccad84482fdf3be`  
Implementation PR: **#461**  
Execution impact: **false**  
Paper/live authorization: **false**

## Authorization

This file authorizes exactly one first historical **Discovery** evaluation of the frozen ruleset:

`PAPER-PROFIT-REGIME-TREND-BREAKOUT-V1`

using the implementation merged at commit `b45e021ec29d4c53b9878dd74ccad84482fdf3be`.

Before this authorization:
- PR #461 Exact-Head Release Safety passed;
- Regime Trend Breakout synthetic invariants passed;
- Frozen Research Guard passed;
- PR source/evaluate jobs were skipped;
- no historical candidate return or PnL was inspected.

## Frozen source

- Binance Spot public 1D klines only;
- fixed source window 2021-08-08T00:00:00.000Z through 2026-09-30T23:59:59.999Z;
- BTC, ETH, SOL, XRP, HBAR, LINK, AVAX, SUI;
- exact source package must be uploaded and SHA-256 identified by the result.

## Allowed result

Only the frozen 70% Discovery segment may be evaluated.

Possible decisions:
- `REGIME_TREND_BREAKOUT_V1_DISCOVERY_FAIL`;
- `REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED`;
- `INSUFFICIENT_SPLIT_SAMPLE`.

Even if Discovery passes:
- Holdout must remain `null`;
- no Holdout PnL may be computed in this run;
- no Paper/live settings may change;
- no threshold, universe, source window, cost or sizing parameter may be retuned.

A separate post-Discovery authorization is required for any Holdout evaluation.
