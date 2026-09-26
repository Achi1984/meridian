# MERIDIAN — Elliott ABC Reversal V1 predeclared research design

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first historical result is inspected.

## Objective

Test a genuinely separate Elliott-family hypothesis after Wave-3 remained sample-gated and Wave-5 failed on opportunity count.

V1 tests a mechanical ABC correction-completion reversal in the direction of a confirmed Daily structural context. It does not modify or rescue Wave-3 or Wave-5 and does not use their winning assets or sides as filters.

## Frozen universe and data

- BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, LINKUSDT.
- OKX public confirmed 4h spot candles.
- 1D context is built only from completed UTC 4h candles.
- LONG and SHORT are exact mirrors.
- No RSI, MACD, EMA, ADX, volume, funding, asset or discretionary filter.

## Structural context

Daily pivots:
- two complete bars on the left and two complete bars on the right;
- a pivot is usable only after the second right-hand daily bar closes;
- latest confirmed alternating Daily LOW→HIGH swing = LONG context;
- latest confirmed alternating Daily HIGH→LOW swing = SHORT context.

4h pivots:
- three complete bars left and three complete bars right;
- a pivot is usable only after the third right-hand 4h bar closes;
- equal highs/lows use the earliest occurrence;
- confirmed pivots never repaint.

## ABC structure

### LONG

Required four-pivot sequence in LONG Daily context:

1. P0 = confirmed pivot HIGH;
2. A = next confirmed pivot LOW;
3. B = next confirmed pivot HIGH;
4. C = next confirmed pivot LOW.

Rules:
- P0→A absolute move must be at least 2× the median complete 4h true range of the preceding 30 days.
- B retraces 0.382–0.786 of P0→A.
- C must be below A.
- B→C length must be 0.800–1.618 × the P0→A length.
- C confirmation must occur while Daily context is still LONG.

### SHORT

Exact mirror:
- P0 LOW → A HIGH → B LOW → C HIGH;
- same noise floor and ratios;
- C must be above A;
- C confirms while Daily context is SHORT.

## Entry

After C is confirmed:

- LONG stop-entry trigger = C + 0.236 × (B - C).
- SHORT stop-entry trigger = C - 0.236 × (C - B).
- Entry may occur only on a later complete 4h bar.
- If price crossed the trigger before C confirmation, there is no retroactive fill; a later fresh cross is required.
- If price invalidates C before entry, the setup is cancelled.
- One pending setup and one open position per symbol. A competing confirmed ABC while pending invalidates both rather than choosing hindsight.

## Risk and exits

- Initial stop = C.
- TP1 = B; exit 50%.
- TP2 = P0; exit remaining 50%.
- After TP1, the remaining stop moves to entry only from the next complete 4h bar.
- Stop-first handling if stop and target are both reachable in one bar.
- Gap through a stop exits at the worse bar open.
- Fixed execution cost: 0.05R per completed basket.
- No time exit, trailing stop or discretionary relabelling.

## Frozen evidence windows

Warm-up starts 180 days before the primary period.

- Primary: 2022-09-06T00:00:00Z to 2024-09-06T00:00:00Z.
- Secondary: 2024-09-06T00:00:00Z to 2026-09-06T00:00:00Z.
- Four equal-calendar primary folds.
- No candle after the secondary end is included.

No strategy parameter, window or gate may change after the first result is inspected.

## Predeclared gate

All conditions must pass before an isolated prospective Paper shadow may be created:

1. Primary >= 120 closed baskets.
2. Primary PF >= 1.15 and expectancy >= +0.08R.
3. Primary max drawdown <= 15R.
4. Four primary folds each >= 20 baskets; at least three folds PF > 1 and positive expectancy; no fold PF < 0.85.
5. LONG and SHORT each >= 30 baskets, PF > 1 and positive expectancy.
6. At least five of seven assets with >= 12 baskets have PF > 1 and positive expectancy.
7. No asset contributes > 40% of positive primary net R.
8. Secondary PF >= 1.10 and expectancy >= +0.03R.
9. Secondary max drawdown <= 20R.
10. Complete reproducible 4h data coverage for all included assets and windows.

Passing permits a separate prospective Paper shadow only. It never permits live or Pionex execution.

## Failure rule

Any failed gate freezes V1 as rejected.

Do not:
- select only LONG or SHORT;
- remove losing assets;
- change pivot widths;
- change 0.382/0.786, 0.800/1.618 or 0.236 ratios;
- alter noise floor, targets, cost, dates or Daily context based on results.

A successor requires a genuinely distinct predeclared hypothesis.

## Isolation

Research only. Existing Paper state, BTC/ETH Funding Carry, FIB V3, Challenger, Pionex and live execution remain untouched.
