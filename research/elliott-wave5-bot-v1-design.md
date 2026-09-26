# MERIDIAN — Elliott Wave-5 Bot V1

Status: PREDECLARED / INDEPENDENT RESEARCH / NO PROMOTION  
Declared: 2026-09-07, before the first result

## Independent hypothesis

Does a fully confirmed W0–W1–W2–W3–W4 impulse structure provide positive expectancy when price freshly breaks W3 and begins Wave 5?

This is not a rescue or parameter variation of the frozen Wave-3 bot. Wave-3 entries remain unchanged and are not part of this experiment.

## Frozen universe and data

- BTC, ETH, SOL, XRP, ADA, AVAX and LINK.
- 1D confirmed swing direction is descriptive context only.
- 4h confirms waves and executes entries/exits.
- Coinbase Exchange public 1h OHLC resampled to complete 4h bars.
- LONG and SHORT are exact mirrors.
- Primary period: `2023-09-06T16:00:00Z` to `2024-09-06T16:00:00Z`.
- Secondary stability: the following two disjoint years through `2026-09-06T16:00:00Z`.
- Fixed total cost: `0.05R` per completed trade.

## Immutable pivots

- Three complete bars left and three complete bars right.
- A pivot is usable only after the third right-hand bar closes.
- Equal extremes retain the earlier pivot.
- Confirmed pivots never repaint or relabel.

## Mechanical impulse structure

For LONG, five alternating confirmed pivots must be LOW W0, HIGH W1, LOW W2, HIGH W3, LOW W4. SHORT is mirrored.

- W0→W1 must exceed 2× the preceding 30-day median complete-4h true range.
- W1 must break the previous same-type confirmed pivot.
- W2 retraces 0.382–0.786 of W1 and may not cross W0.
- W3 must break W1 and its length from W2 must be at least W1 length.
- W4 retraces 0.236–0.500 of W3.
- W4 may not enter W1 price territory: LONG W4 must remain above W1; SHORT W4 below W1.
- Any failed rule yields `UNRESOLVED`; no best-fit relabelling is allowed.

## Entry and exits

- After W4 confirmation, place a stop entry one minimum price increment beyond W3.
- A crossing before confirmation is not a fill; a fresh later crossing is required.
- Initial stop one increment beyond W4.
- Target 1: W4 plus/minus 0.618 × W1 length; exit 50%.
- Target 2: W4 plus/minus 1.000 × W1 length; exit remaining 50%.
- After Target 1, the remaining stop moves to entry from the next complete 4h bar.
- Stop wins every ambiguous same-bar stop/target collision; gaps fill at the worse available open/trigger.
- One setup and one position per symbol; competing counts are unresolved.
- No time exit, trailing stop or discretionary wave completion.

## Forbidden inputs and isolation

- No future bars, realized outcome or retrospective best count.
- No RSI, MACD, EMA, ADX, regime, funding, OI, flow, asset, side or context gate.
- No Wave-3 result is used for decisions or risk.
- Baseline 6.2, Hybrid Alpha, FIB V3, Wave-3 research, Paper/live, Pionex, `server.js`, sizing, orders and ledgers remain untouched.

## Locked historical gate

Report trade frequency/opportunity cost, PF, expectancy, net R, drawdown, win rate, time in market, three chronological folds, LONG/SHORT, asset breadth, daily context and contribution concentration.

Historical robustness requires all:

1. at least 80 closed primary trades;
2. PF at least 1.10 and positive expectancy;
3. three folds with at least 20 trades each and PF at least 0.90;
4. LONG and SHORT each at least 20 trades, PF above 1 and positive expectancy;
5. at least four of seven assets with at least 8 trades are positive;
6. no asset contributes more than 40% of positive primary net R;
7. both secondary years have PF above 1 and positive expectancy;
8. primary maximum drawdown does not exceed 15R.

Failure closes this exact Wave-5 architecture without tuning. Passing permits independent replication or prospective review only; automatic promotion is prohibited.
