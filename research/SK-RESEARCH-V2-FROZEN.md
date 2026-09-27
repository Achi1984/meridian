# SK Research V2 — Frozen A/B Protocol

Status: **research only**  
Ruleset: `SK-RESEARCH-V2-AB-FROZEN`

## Hypothesis

The first SK Core V1 BTC run did not pass its frozen research gate. A small subgroup of Double-Advantage trades was positive, but the sample was too small to interpret as an edge.

V2 tests one narrow hypothesis without changing SK Core V1:

- **A — Core V1:** every valid SK PaperBot V1 trade.
- **B — Double Advantage only:** only Core V1 trades where the strict opposing-target × parent-GKL overlap was known **before the first-fill bar**.

This is a filter comparison, not a parameter search.

## Frozen mechanics

V1 remains unchanged:

- 4h structure
- correction gate 0.382
- staged entries 0.500 / 0.559 / 0.618 / 0.667
- origin invalidation
- targets 1.618 / 1.809 / 2.000
- 1% total model risk across four tranches
- fees and slippage enabled

V2 does **not** tune these values.

## Double Advantage anti-lookahead

A trade belongs to cohort B only when:

1. strict SK Double Advantage geometry exists;
2. the overlap is detected from information available at that time; and
3. the Double Advantage condition is confirmed on a strictly earlier 4h bar than the first fill (`doubleAdvantageAt < openedAt`). Same-bar OHLC cannot prove event order and is excluded.

A Double Advantage condition discovered after the first fill stays in Core A and is excluded from B.

## Frozen batch universe

- BTC
- ETH
- SOL
- XRP
- HBAR
- LINK
- AVAX
- SUI

Requested history can be 365 / 730 / 1460 days using public 4h candles. Assets with shorter listing history use only genuinely available candles.

## Frozen V2 gate

B must satisfy all of the following:

- at least 20 pre-entry Double Advantage trades;
- Profit Factor >= 1.20;
- positive expectancy;
- closed-trade drawdown <= 10%;
- at least 3 of 5 chronological windows positive;
- at least 3 positive assets;
- no single positive asset contributes more than 50% of positive B-cohort PnL.

A gate pass does **not** promote the strategy. It only permits a later independent forward / paper-shadow stage.

## Diagnostics

V2 reports:

- Core vs Double Advantage trade count, PnL, PF, expectancy, win rate and closed-trade DD;
- LONG vs SHORT split;
- entry-depth cohorts by deepest filled level;
- per-asset Core and Double Advantage results;
- five chronological Double Advantage windows;
- positive-asset breadth and positive-PnL concentration.

## Explicit non-goals

- no live orders;
- no automatic promotion;
- no gate relaxation after results;
- no parameter optimization against the same sample;
- no interpretation of pooled closed-trade DD as true concurrent portfolio DD.

