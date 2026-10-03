# Low-Volatility Rank-Weighted V2 — First Untouched Holdout Run Authorization

Status: **FIRST UNTOUCHED HOLDOUT RUN AUTHORIZED / PAPER AND LIVE BLOCKED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Holdout implementation merge: `76e7161ab00886932412a027b9e93b1061ecce4a`  
Execution impact: **false**

## Frozen prerequisite

The canonical Development result is frozen as:

`DEVELOPMENT_PASS_HOLDOUT_REQUIRED`

Canonical Development workflow:

**37132394717**

Development evidence remains byte-locked:

- Development evidence blob: `e9babe1566c8667a21eb6cae8388ca6dfb77385e`;
- Development frozen summary blob: `5b3ada9fd32abe4747fbc854bb5f5388e15e6763`;
- parent V2 Development engine blob: `87302fdc0c1880a35e1bfd663be8191d5f6be429`.

The Holdout implementation verifies this lineage before any Holdout metric can be emitted.

## Frozen Holdout implementation lineage

This first Holdout evaluation is authorized only for:

- Holdout implementation contract blob: `23e6f6bc8cc095f5dca437bd411501a2d0b825f6`;
- Holdout engine blob: `0d07a763b4ed0bb2c4f4c6970de8d50b1823d55c`;
- Holdout source collector blob: `3569c714b000c67184d7144b1da3b92a9c321c6d`;
- Holdout result runner blob: `4ce41e23a5a6db4bf0a26f2218b4e372deebecb1`;
- Holdout invariant-test blob: `899f6d4161d4a4572971a00886d768ffad770ff2`;
- Holdout workflow blob: `a481844c1209609448eadc66b1690aceae1ed52f`;
- frozen research guard blob at implementation merge: `f5c353ca8d3d4416987bb97cd87b7bfcf532c38e`.

The frozen-research guard and Holdout invariants must pass before source collection.

## Authorized untouched source

Only official public Binance Vision USD-M monthly archives:

- 1h `klines`;
- `fundingRate`.

Frozen universe:

`BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX`

Archive months:

- **2025-12 through 2026-08**.

Retained hourly rows:

- first: **2025-12-05T23:00:00Z**;
- last: **2026-08-29T00:00:00Z**;
- expected exact count: **6,386 rows per asset**.

Retained funding rows:

- from **2026-01-03T00:00:00Z**;
- through **2026-08-29T00:00:00Z**.

No private data, synthetic backfill, alternate exchange history, Paper data, or live data are authorized.

## Authorized Holdout calculation

Exactly 34 weekly periods:

- first anchor: **2026-01-03T00:00:00Z**;
- last feature anchor: **2026-08-22T00:00:00Z**;
- terminal next-week open: **2026-08-29T00:00:00Z**.

The Holdout must use the already frozen V2 rules without modification:

- exact V1 28-day / 672-return Low-Volatility feature;
- continuous 12-asset average-rank dollar-neutral weights;
- gross exposure 1.0;
- net exposure 0;
- weekly open-to-open returns;
- official public funding;
- the reviewed 1,000 ms funding timestamp coverage tolerance only;
- 10-bps baseline one-way turnover cost;
- mandatory 20-bps stress cost;
- mandatory terminal close;
- exact preregistered Holdout gate.

Possible scientific decisions are exactly:

- `HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`;
- `HOLDOUT_FAIL_RESEARCH_STOP`.

## Explicit prohibitions

This run may not:

- change the feature, ranking, weights, assets, funding formula, costs, dates, or gates;
- use Holdout data to retune V2;
- rescue a Holdout FAIL;
- authorize automatic Paper deployment;
- authorize live execution.

A PASS permits only a later explicit prospective Paper-review decision.

A FAIL closes V2 without rescue or retuning.
