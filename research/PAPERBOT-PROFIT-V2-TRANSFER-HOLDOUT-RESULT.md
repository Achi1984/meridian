# Paper Bot Profit V2 — Frozen Transfer Holdout Result

Workflow run: **36483552041**  
Artifact: **10997806303**  
Artifact SHA-256: `b4fb83ba93f733a4be1da72e78063ef7e1878ba4c985c19ad68b65d2365f3b22`

This file records the first untouched result of the frozen `UP_REGIME_DONCHIAN_V2` transfer-universe holdout.

Trade universe: `BNB DOGE ADA DOT LTC BCH TRX XLM`  
BTC role: market-regime filter only; BTC was not traded in holdout PnL.

| Periods | Net return | PnL | PF | Max DD | Positive windows | Positive assets | Positive-PnL concentration | Gate |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 16 | +5.84% | +$583.90 | 2.231 | 1.53% | 2/5 | 4 | 49.8% | FAIL |

## Frozen decision

**HOLDOUT_FAIL_RESEARCH_REDESIGN.**

The transfer universe was profitable and showed a Profit Factor above 2 with low drawdown, but it fails two pre-committed acceptance criteria:
- `PERIODS_LT_24`
- `POSITIVE_WINDOWS_LT_3`

The gate is not relaxed.

## Interpretation

The same frozen hypothesis produced positive net return in both:
- discovery universe: +11.93%, PF 2.334, max DD 2.80%, 4/5 positive windows;
- non-overlapping traded-asset transfer universe: +5.84%, PF 2.231, max DD 1.53%, 2/5 positive windows.

This is promising cross-asset evidence, but the transfer sample is too sparse to establish a robust holdout pass. The result does not authorize paper-shadow promotion or live execution.

## Next allowed step

Per protocol, V2 is not rescued by changing its gate, asset list or parameters. A separately named V3 hypothesis may target higher observation density while preserving the research-only boundary.

The already identified V3 research direction is a shorter-horizon adaptive/regime-aware trend model on intraday bars, frozen before its first result.

Research only. No live execution impact. No auto-promotion.
