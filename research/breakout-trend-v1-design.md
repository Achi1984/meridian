# MERIDIAN — Breakout Trend V1 predeclared research design

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first historical result is inspected.

## Objective

Test a genuinely separate directional hypothesis after the legacy scanner family, rank momentum, residual pairs and regime variants failed to establish a robust net edge. This is not a Challenger threshold revision and does not reuse its score.

## Frozen hypothesis

Crypto trends that break a recent 4h price channel in the direction of a slow Daily trend may retain enough continuation to overcome realistic fees and slippage when losses are bounded and winners use a trailing exit.

### Signals

- Universe: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, LINKUSDT.
- Source for evidence: Coinbase Exchange public 1h OHLC, resampled to complete UTC 4h bars.
- Daily regime uses completed UTC daily bars only.
- LONG regime: Daily EMA50 > Daily EMA200.
- SHORT regime: Daily EMA50 < Daily EMA200.
- LONG signal: completed 4h close is above the highest high of the prior 20 complete 4h bars.
- SHORT signal: completed 4h close is below the lowest low of the prior 20 complete 4h bars.
- Entry occurs at the next complete 4h bar open; the signal bar can never fill itself.
- One position per symbol. No asset, side, RSI, MACD, ADX, volume or discretionary filters.

### Risk and exits

- Initial stop: 2.0 × Wilder ATR(14) from entry.
- Trailing protection: prior 10 complete 4h bars; LONG uses their lowest low, SHORT their highest high.
- The active stop can only tighten, never loosen.
- A gap through the stop exits at the next bar open; otherwise the stop price is used.
- Maximum holding period: 60 calendar days.
- Fixed all-in round-trip friction: 16 bps, representing 5 bps fee + 3 bps slippage on each side.
- Results are normalized to initial stop risk (R). No leverage is assumed.
- There is no profit target. The hypothesis depends on asymmetric trend winners rather than a tuned target.

## Frozen evidence windows

Warm-up begins 260 days before the primary start.

- Primary: 2022-09-06T00:00:00Z to 2024-09-06T00:00:00Z.
- Secondary: 2024-09-06T00:00:00Z to 2026-09-06T00:00:00Z.
- Any candles after the secondary end are excluded.

The strategy parameters, windows and gates may not be altered after inspecting the first result.

## Predeclared gate

Historical research is considered promising only if all conditions pass:

1. Primary has at least 120 closed trades.
2. Primary PF >= 1.15 and expectancy >= +0.05R.
3. Primary maximum drawdown <= 20R.
4. Four equal-calendar chronological primary folds each have at least 20 trades; at least three folds have PF > 1 and positive expectancy; no fold has PF < 0.80.
5. LONG and SHORT each have at least 30 primary trades and PF > 1.
6. At least five of seven assets with at least 12 primary trades have PF > 1 and positive expectancy.
7. No asset contributes more than 40% of positive primary net R.
8. Secondary PF >= 1.05 and positive expectancy.
9. Secondary maximum drawdown <= 25R.
10. Data coverage is complete enough for each included 4h bar to be reproducible.

Passing these gates permits creation of an isolated prospective Paper shadow only. It never permits live execution or Pionex changes automatically.

## Failure rule

If the gate fails, V1 is frozen as rejected. Do not optimize channel lengths, EMA lengths, ATR multiple, trailing length, cost assumption, dates, assets or side selection using this result. A successor requires a genuinely new predeclared hypothesis.

## Isolation

This research does not change Baseline 6.2, Challenger V3, Directional V4, Funding Carry, Alpha Lab, existing ledgers, Paper execution, live execution, Pionex or any exchange API integration.
