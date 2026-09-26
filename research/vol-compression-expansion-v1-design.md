# MERIDIAN — Volatility Compression Expansion V1 predeclared research design

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first historical result is inspected.

## Objective

Test a genuinely separate short-horizon expansion hypothesis after prior directional families failed robustness. This is not a Challenger threshold revision, not a LONG-only rescue and not a parameter modification of Breakout Trend V1.

## Frozen hypothesis

Crypto markets that spend several 4h bars in unusually compressed volatility may produce tradable expansion bursts when price leaves the frozen compression box with a simultaneous true-range expansion.

### Universe and data

- Universe: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, LINKUSDT.
- Historical source: Binance public spot 1h OHLC, resampled to complete UTC 4h bars.
- Signals are symmetric LONG/SHORT.
- No daily trend filter, RSI, MACD, ADX, volume filter, funding filter, asset filter or discretionary override.

### Compression state

For every completed 4h bar:

- Wilder ATR(14) is normalized by close.
- A 12-bar range width is `(highest high - lowest low) / close`.
- Compare each measure with its own prior 126-bar history, excluding the current bar.
- A bar is compressed only when both normalized ATR and normalized 12-bar range width are at or below their 25th historical percentile.
- Three consecutive compressed bars are required to arm a setup.
- At arming, freeze a box using the highest high and lowest low of the last 12 completed 4h bars.
- The frozen box remains valid for the next 6 completed 4h bars only. It does not expand or move.

### Expansion trigger and entry

During the six-bar armed window:

- LONG trigger: 4h close above the frozen box high.
- SHORT trigger: 4h close below the frozen box low.
- The breakout bar true range must be at least 1.25 × the prior completed bar ATR(14).
- Entry occurs at the next complete 4h bar open. The breakout bar can never fill itself.
- One open position per symbol. No same-symbol pyramiding.

### Risk and exit

- Initial stop distance: 1.50 × the ATR value known at the breakout.
- Profit target: 2.50R.
- When price first reaches +1.00R, stop is tightened to estimated all-in cost break-even and never loosened.
- If stop and target are both touched inside one bar, stop is assumed first.
- A gap through a stop exits at the bar open.
- Maximum holding time: 7 calendar days; remaining position exits at the final completed 4h close.
- Fixed all-in round-trip friction: 16 bps, representing 5 bps fee + 3 bps slippage on each side.
- Results are normalized to initial stop risk (R). No leverage is assumed.

## Frozen evidence windows

Warm-up starts 260 days before the primary start.

- Primary: 2022-09-06T00:00:00Z to 2024-09-06T00:00:00Z.
- Secondary: 2024-09-06T00:00:00Z to 2026-09-06T00:00:00Z.
- Any candles after the secondary end are excluded.

The strategy parameters, dates and gates may not be changed after the first result is inspected.

## Predeclared historical gate

V1 is historically promising only if every condition passes:

1. Primary has at least 150 closed trades.
2. Primary PF >= 1.15 and expectancy >= +0.08R.
3. Primary maximum drawdown <= 18R.
4. Four equal-calendar primary folds each contain at least 20 trades; at least three folds have PF > 1 and positive expectancy; no fold has PF < 0.85.
5. LONG and SHORT each have at least 40 primary trades, PF > 1 and positive expectancy.
6. At least five of seven assets with at least 15 primary trades have PF > 1 and positive expectancy.
7. No asset contributes more than 40% of positive primary net R.
8. Secondary PF >= 1.10 and expectancy >= +0.03R.
9. Secondary maximum drawdown <= 22R.
10. Historical 4h data coverage is complete for every included asset and evaluation window.

A complete pass permits creation of an isolated prospective Paper shadow. It never permits live execution or Pionex changes automatically.

## Failure rule

A failed gate freezes V1 as rejected. Do not use the result to:

- switch to LONG-only or SHORT-only;
- remove losing assets;
- change percentile, lookback, streak, box, expiry, expansion multiple, stop, target, break-even trigger, max hold, costs or evidence dates;
- select only favorable folds.

A successor must begin from a distinct predeclared hypothesis.

## Isolation

This research changes no existing ledger, Paper execution path, live execution path, Pionex integration, Challenger, Directional V4, Funding Carry, FIB V3 or Alpha Lab behavior.
