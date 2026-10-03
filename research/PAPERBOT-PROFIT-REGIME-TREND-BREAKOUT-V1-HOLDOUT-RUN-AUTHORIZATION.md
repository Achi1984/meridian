# Regime-Gated Trend / Breakout V1 — Holdout Run Authorization

Status: **FIRST UNTOUCHED HOLDOUT RUN AUTHORIZED — PAPER/LIVE BLOCKED**  
Holdout implementation merge: `4fc28499e0064985c06cf53d8e84bfd265a52aac`  
Implementation PR: **#463**  
Frozen Discovery result PR: **#462**  
Execution impact: **false**  
Paper/live authorization: **false**

## Authorization

This file authorizes exactly one first historical **Holdout** evaluation of the already frozen ruleset:

`PAPER-PROFIT-REGIME-TREND-BREAKOUT-V1`

using the Holdout implementation merged at commit `4fc28499e0064985c06cf53d8e84bfd265a52aac`.

Before this authorization:
- PR #463 Exact-Head Release Safety passed;
- Holdout synthetic/parity invariants passed;
- Frozen Research Guard passed;
- PR #463 historical `source` and `evaluate` jobs were skipped;
- the frozen Discovery result still records `holdout:null`;
- no Holdout return, PnL, Profit Factor, drawdown or pass/fail decision has been inspected.

## Frozen Discovery provenance

- Discovery workflow run: `37102449505`;
- Discovery decision: `REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED`;
- exact source artifact: `11266308720`;
- source artifact digest: `sha256:51e84ed6eb02fd8ebbb49351d5c4e1ad59555b69f571f807a6d021f6f0473b06`;
- exact extracted source JSON SHA-256: `08fb30cd3c9028920637c71d86035a723be2fdc63ee25607b842dc79211cc69b`;
- frozen Discovery result must reproduce before Holdout PnL may be emitted.

## Frozen Holdout

The first untouched Holdout is exactly the previously reserved 30% common-timestamp segment:

- start: `2025-09-21T00:00:00Z`;
- end: `2026-09-30T00:00:00Z`;
- 375 common timestamps before indicator/evaluation filtering;
- identical universe, ADX/SMA/breakout logic, sizing and turnover mechanics;
- 8 bps baseline cost;
- 16 bps mandatory stress cost;
- identical frozen Stage-B gate.

Possible decisions:
- `REGIME_TREND_BREAKOUT_V1_HOLDOUT_FAIL`;
- `REGIME_TREND_BREAKOUT_V1_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED`.

## Safety boundary

Regardless of outcome:
- no strategy parameter may be retuned in this run;
- no Paper bot may be modified or enabled;
- no live trading/order/transfer path is authorized;
- `researchOnly=true`, `executionImpact=false`, `autoPromotion=false` remain mandatory;
- a PASS authorizes only a later, separately reviewed Paper-shadow/forward-evidence design.
