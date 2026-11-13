# Paper Arena Life Mode

This module is an offline evaluation layer for the Paper Bot Arena. It does not
run a bot, fetch market data, create orders, alter a ledger, or promote a strategy.

The fixed unit is **USD 1,000.00 = 100,000 cents = one life**. The evaluator
receives a strictly increasing, runId-bound series of USD equity snapshots.
Equity is assumed to include all already-booked fees and slippage; this module
does not apply costs again.

The result reports starting/current/minimum/maximum lives, life gains and losses,
life transitions, minimum equity and maximum peak-to-trough drawdown. A strategy
can recover a life after losing one; recovery is counted as a new gained life
transition. Negative, unordered, duplicated, malformed or contradictory input
returns `UNKNOWN`.

The output is diagnostic. It carries no Paper start, Live permission, execution
authority or promotion authority. It is separate from the existing retrospective
Arena and from the Solana Meme-Coin runner.

Focused check:

```sh
node --test test/paper-arena-life-mode.test.js
```
