# MERIDIAN — Range Reversion V1 predeclared research design

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first historical result is inspected.

## Objective

Test a strategy family that is structurally different from the rejected directional scanner variants, relative momentum and Breakout Trend V1. The hypothesis is short-horizon mean reversion after statistically unusual 4h moves during low-trend-strength regimes.

This is not a parameter repair of any prior bot. No result from Breakout Trend V1 is used to choose assets, sides or thresholds.

## Frozen hypothesis

- Universe: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, LINKUSDT.
- Evidence source: Binance public 4h spot OHLC from the official data.binance.vision archive.
- Signals use completed 4h candles only.
- Mean and dispersion: 20-bar simple moving average and population standard deviation of closes.
- Trend-strength filter: Wilder ADX(14) < 20.
- LONG signal: close <= SMA20 - 2.0 × standard deviation while ADX < 20.
- SHORT signal: close >= SMA20 + 2.0 × standard deviation while ADX < 20.
- Entry: next complete 4h bar open. The signal bar can never fill itself.
- If the next bar opens at or beyond the fixed mean-reversion target, the setup expires without a trade.
- One open position per symbol. No Daily trend, asset, side, RSI, MACD, volume or discretionary filter.

## Risk and exits

- Fixed target: the signal bar's SMA20.
- Initial stop: 2.0 × Wilder ATR(14) from the actual next-bar entry.
- Stop-first handling if stop and target are both touched in the same 4h candle.
- Gap through a stop exits at the gap open; favorable target gaps receive only the frozen target price.
- Maximum holding period: 7 calendar days, then exit at the completed bar close.
- Fixed all-in round-trip friction: 16 bps, representing 5 bps fee + 3 bps slippage on each side.
- Results normalized to initial stop risk (R). No leverage is assumed.

## Frozen evidence windows

Warm-up begins 60 days before the primary start.

- Primary: 2022-09-06T00:00:00Z to 2024-09-06T00:00:00Z.
- Secondary: 2024-09-06T00:00:00Z to 2026-09-06T00:00:00Z.
- Any candles after the secondary end are excluded.
- Four primary stability folds are equal-calendar slices.

No strategy parameter, period or gate may be altered after the first historical result is inspected.

## Predeclared gate

Because this is a second independently attempted new family in the same research cycle, the hurdle is deliberately strict. All must pass:

1. Primary has at least 150 closed trades.
2. Primary PF >= 1.20 and expectancy >= +0.08R.
3. Primary maximum drawdown <= 15R.
4. Each of four equal-calendar primary folds has at least 25 closed trades; at least three folds have PF > 1 and positive expectancy; no fold has PF < 0.90.
5. LONG and SHORT each have at least 40 primary trades, PF >= 1.05 and positive expectancy.
6. At least five of seven assets with at least 15 primary trades have PF > 1 and positive expectancy.
7. No asset contributes more than 35% of positive primary net R.
8. Secondary PF >= 1.15 and expectancy >= +0.05R.
9. Secondary maximum drawdown <= 20R.
10. Evaluation-period 4h coverage is complete and reproducible for all seven assets.

Passing permits creation of an isolated prospective Paper shadow. It does not permit live execution or Pionex changes.

## Failure rule

If any gate fails, Range Reversion V1 is frozen as rejected. Do not tune the z-score, ADX threshold, SMA length, ATR stop, hold time, cost assumption, dates, assets or side selection from the observed result. A successor requires a genuinely different predeclared hypothesis.

## Isolation

No Baseline, Challenger, V4, Funding Carry, Alpha Lab, R42 ledger, Paper/live execution, API sync or Pionex path is changed by this research.
