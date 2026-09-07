# MERIDIAN — Elliott Wave Bot V1: Confirmed Wave-3 Breakout

Status: PREDECLARED / RESEARCH ONLY / NO PROMOTION  
Declared: 2026-09-07, before the first result

## Research question

Can a fully mechanical Elliott impulse count identify a repeatable Wave-3 breakout edge without discretionary relabelling, hindsight pivots or conventional indicator gates?

V1 tests exactly one setup: entry into Wave 3 after a confirmed Wave-2 retracement and subsequent break of the Wave-1 extreme. Wave 4, Wave 5 and ABC trading are explicitly out of scope.

## Frozen universe and timeframe

- BTC, ETH, SOL, XRP, ADA, AVAX and LINK.
- 1D provides confirmed structural swing context only.
- 4h defines waves, confirms pivots and executes orders.
- LONG and SHORT rules are exact mirrors.
- Coinbase Exchange public OHLC is the historical source.

## Mechanical wave count

### Confirmed pivots

- A 4h pivot uses three complete bars on the left and three complete bars on the right.
- A pivot becomes available only after the third right-hand bar closes.
- Equal highs/lows use the earliest bar; later equality cannot rewrite history.
- Confirmed pivots are immutable. No repainting or retrospective relabelling.

### Wave 0 → Wave 1

- LONG: confirmed pivot low W0 followed by confirmed pivot high W1.
- SHORT: confirmed pivot high W0 followed by confirmed pivot low W1.
- The absolute W0→W1 move must be at least twice the median complete 4h true range of the preceding 30 days. This is a predeclared structural noise floor, not a directional indicator.
- W1 must break the immediately preceding same-type confirmed pivot extreme.

### Wave 2

- W2 is the first confirmed opposing pivot after W1.
- Valid retracement is fixed at 0.382–0.786 of W0→W1.
- W2 may not cross W0. Crossing W0 permanently invalidates the count.
- If a new W1 extreme prints before W2 confirms, W1 advances to that extreme and the retracement is recalculated prospectively.

### Wave-3 entry

- A stop entry is placed one minimum price increment beyond W1 only after W2 is confirmed.
- If price crossed W1 before W2 confirmation, no retroactive fill is allowed; a later fresh cross is required.
- One setup and one position maximum per symbol.
- Unresolved or competing counts produce no trade.

## Exits and conservative execution

- Initial stop: one minimum price increment beyond W2.
- Target 1: W2 plus/minus 1.000 × Wave-1 length; exit 50%.
- Target 2: W2 plus/minus 1.618 × Wave-1 length; exit remaining 50%.
- After Target 1, remaining stop moves to entry only from the next complete 4h bar.
- If stop and target are both reachable inside one bar, stop is assumed first.
- Gaps fill at the worse available open/trigger price.
- Fixed round-trip cost and slippage assumptions must be declared in R units before the first evidence run and applied symmetrically.
- No trailing stop, time exit or discretionary wave relabelling in V1.

## Leakage and isolation

- Every pivot, true-range statistic, count, order and stop uses only information available at decision time.
- No outcome, future bar or best-fit wave count may influence labelling.
- No RSI, MACD, EMA, ADX, regime, asset, side, funding, OI or order-flow gate.
- FIB ratios define Elliott structure and targets; they are not optimized after evidence.
- Baseline 6.2, Hybrid Alpha, FIB V3, Paper/live execution, Pionex, `server.js`, sizing, orders and ledgers remain untouched.

## Frozen evaluation protocol

- Primary historical period is declared before execution and must not reuse a discovery result.
- Minimum three chronological folds.
- Report closed setups, rejected counts, fill rate, PF, expectancy R, net R, maximum DD, win rate and median bars in trade.
- Report LONG/SHORT, asset, 1D structural context and chronological-fold breadth.
- Track opportunity count and the share of unresolved/invalidated counts.
- Report concentration of positive net R; no asset may exceed 40% for a robustness pass.
- Minimum 150 closed trades overall, minimum 30 per chronological fold, both sides positive, at least five of seven assets positive and no fold below PF 0.90.

## Decision boundary

Failure means no pivot-width, noise-floor, retracement, target or asset/side tuning. Wave-5 and ABC concepts are not fallback parameter variants; each would require a separate future predeclaration. Passing permits independent replication or prospective holdout review only and never automatic promotion.
