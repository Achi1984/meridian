# MERIDIAN — Multi-Timeframe Pullback Continuation V1 predeclared research design

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first historical result is inspected.

## Objective

Test a genuinely separate continuation hypothesis: instead of chasing fresh highs/lows, wait for a 4h pullback inside a confirmed Daily trend and enter only after 4h momentum resumes.

This is not a rescue variant of Breakout Trend V1 or Volatility Compression Expansion V1. No asset, side or cohort observed in those tests is used here.

## Frozen hypothesis

### Universe and data

- Universe: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, LINKUSDT.
- Historical source: OKX public confirmed 4h spot candles (`*-USDT`).
- UTC daily candles are built from completed 4h candles.
- LONG and SHORT are symmetric.
- No RSI, MACD, ADX, volume, funding or discretionary filter.

### Trend state

- Daily EMA50 and EMA200 use completed UTC daily closes only.
- 4h EMA20 and EMA50 use completed 4h closes.
- LONG trend requires Daily EMA50 > EMA200 and 4h EMA20 > EMA50.
- SHORT trend requires Daily EMA50 < EMA200 and 4h EMA20 < EMA50.

### Pullback and confirmation

LONG:
- Arm when trend is LONG and the completed 4h close is at or below EMA20 but at or above EMA50.
- Freeze the lowest low of the pullback bar.
- Setup remains valid for the next 6 completed 4h bars.
- Cancel if 4h EMA20 <= EMA50 or a completed close falls below EMA50.
- Trigger when a later completed 4h candle closes above EMA20 and above the prior completed candle high.

SHORT mirrors LONG:
- arm when close is at or above EMA20 but at or below EMA50;
- freeze the highest high of the pullback bar;
- cancel if EMA20 >= EMA50 or a completed close rises above EMA50;
- trigger when a later close is below EMA20 and below the prior candle low.

Entry occurs at the next complete 4h bar open. The confirmation bar can never fill itself.

### Risk and exit

- Initial stop distance: 1.50 × Wilder ATR(14) known at confirmation.
- Profit target: 2.50R.
- At +1.00R favorable excursion, stop tightens to estimated all-in cost break-even from the next bar onward.
- If stop and target are both touched in one bar, stop is assumed first.
- Gap through stop exits at bar open.
- Maximum hold: 10 calendar days.
- Fixed all-in round-trip friction: 16 bps (5 bps fee + 3 bps slippage on each side).
- Results are normalized to initial stop risk (R). No leverage is assumed.

## Frozen evidence windows

Warm-up begins 260 days before the primary start.

- Primary: 2022-09-06T00:00:00Z to 2024-09-06T00:00:00Z.
- Secondary: 2024-09-06T00:00:00Z to 2026-09-06T00:00:00Z.
- Any candles after the secondary end are excluded.

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

A complete pass permits creation of an isolated prospective Paper shadow only. It never permits live execution or Pionex changes automatically.

## Failure rule

A failed gate freezes V1 as rejected. Do not use the result to:
- switch to one side only;
- remove losing assets;
- tune EMA lengths, pullback band, validity window, confirmation rule, ATR stop, target, break-even trigger, max hold, costs or evidence dates;
- select favorable folds or market years.

A successor must begin from a distinct predeclared hypothesis.

## Isolation

This research changes no existing ledger, Paper execution path, live execution path, Pionex integration, Challenger, Directional V4, Funding Carry, FIB V3 or Alpha Lab behavior.
