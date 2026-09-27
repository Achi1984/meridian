# TSMOM Holdout V1 — Frozen Protocol

Status: **research only**  
Ruleset: `TSMOM-HOLDOUT-V1-FROZEN`

The discovery run in Documented Edge Lab V1 passed its internal gate. This holdout does **not** tune the TSMOM rules.

## Unchanged TSMOM mechanics

Exactly the same research configuration is retained:

- 30 / 90 / 365 day trend directions
- equal-weight average of the three signals
- rebalance every 30 days
- 60-day realized volatility estimate
- 10% annualized per-market volatility target
- 2x research leverage cap
- 8 bps modeled exposure-turnover cost
- public daily price history only

No parameter is changed after the discovery result.

## H1 — Legacy time holdout

Fixed evaluation window:

- 2020-05-01 through 2022-07-31 inclusive

Universe remains the original frozen discovery set:

- BTC
- ETH
- SOL
- XRP
- HBAR
- LINK
- AVAX
- SUI

Only assets that genuinely had enough data at the time can become active. Missing pre-listing history is not backfilled.

The same frozen TSMOM gate is applied. In addition, at least four assets must have valid holdout periods.

## H2 — Transfer-universe holdout

Frozen **before results**:

- BNB
- ADA
- DOGE
- DOT
- XLM
- TRX
- LTC
- BCH

This universe was not part of the discovery batch.

The same TSMOM rules and same frozen TSMOM gate are applied. All eight transfer assets must have sufficient data for the holdout result to be accepted.

## Combined decision

`HOLDOUT_PASS` requires:

1. H1 frozen TSMOM gate passes;
2. H2 frozen TSMOM gate passes;
3. H1 has at least four valid assets;
4. H2 has all eight transfer assets.

Even a combined pass:

- does not enable live trading;
- does not auto-promote the strategy;
- only permits consideration of a later paper-shadow / forward stage.

## Diagnostics only

The holdout additionally reports, but does **not** gate on:

- long contribution;
- short contribution;
- long / short signal share;
- average absolute exposure;
- average leverage;
- modeled cost sum;
- modeled cost relative to absolute gross return.

These diagnostics cannot be used to remove a side or alter parameters inside Holdout V1.

## Anti-overfitting

- no asset dropping after results;
- no side filtering after results;
- no lookback changes;
- no volatility-target changes;
- no cost-model changes;
- no gate changes;
- no date changes after results;
- any new hypothesis requires a separately named version and protocol.

## Deep-audit implementation revision

The strategy rules above remain frozen. MERIDIAN engine revision `WEIGHTED-TURNOVER-R2` corrects implementation accounting only:

- skipped under-breadth periods no longer mutate position state;
- portfolio turnover is measured on equal-weighted portfolio exposures;
- assets leaving the active universe incur explicit exit turnover cost;
- final portfolio/asset close costs are included.

Results produced before this engine revision must be rerun before they are treated as current evidence. No gate or strategy parameter was relaxed.
