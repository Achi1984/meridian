# Low-Volatility Rank-Weighted V2 — Corrected Development Run Authorization

Status: **CORRECTED DEVELOPMENT RUN AUTHORIZED / HOLDOUT SEALED / PAPER AND LIVE BLOCKED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Corrected implementation merge: `257fcd3fba441e3ccb4103ba8c1382185d22c9a0`  
Execution impact: **false**

## Why this rerun is permitted

The first authorized Development workflow stopped before any strategy metrics were produced because the funding-coverage validator treated official millisecond settlement timestamp jitter as a missing interval.

Frozen first-run facts:

- workflow run: **37131815781**;
- source artifact: **11277585916**;
- source artifact ZIP digest: `sha256:207c116332410d2de0435fa76e381b097661bb79ddd4104526341bbfa6545307`;
- result artifact: **11276907747**;
- result artifact ZIP digest: `sha256:a4a5a48891643b8a28edf82bdc562f27f4859cc7da062d4c100068fc3091402f`;
- source receipt digest: `c632e7a00c30625fc3efb7a58c400e9c9b481bb0c603aa95bf68e0be44ba6220`;
- `dataIntegrityFailure=true`;
- `result=null`;
- `stress=null`;
- no Development strategy return, Profit Factor, Sharpe, drawdown, funding contribution, or stress return was exposed;
- Holdout remained untouched.

The correction is therefore a technical source-validation fix, not a post-result strategy retune.

## Exact corrected lineage

This authorization applies only to:

- preregistration blob: `b8c644a5a15c321a1a52514dd05eb088288cd8f4`
- implementation contract blob: `90e070996c399d6d678a10b25e6b52cd0aac6335`
- corrected funding timestamp note blob: `ad5694309438c80aac0717700b7772fd94bc8f89`
- corrected V2 engine blob: `87302fdc0c1880a35e1bfd663be8191d5f6be429`
- Development collector blob: `c084d8ec4a72a666818b9e8a9f5ca143788a0c9d`
- Development runner blob: `e8f076258612407dd3676af94a7442c785ab53ba`
- corrected invariant test blob: `8a5c044e76555ad11eaff0da9be2ef763a16329c`
- workflow blob: `52bc76b5572b74cf4e7808e4f707e15bddda6769`
- frozen parent V1 feature engine blob: `d161b6b4553d5a18fc7064570f4a4e956178d0c9`
- frozen research guard blob at corrected merge: `10b37866485ef49100344910c401a353d4e46164`

## Only authorized validator change

Funding coverage validation may allow at most **1,000 milliseconds** of timestamp jitter around the declared funding interval.

The exact inclusion rule remains unchanged:

`start < funding_timestamp <= end`

No funding row may be rounded, moved, synthesized, interpolated, dropped to improve results, or sourced from another venue.

The tolerance may not mask a genuinely missing funding interval.

## Authorized public source

Only official Binance Vision USD-M monthly archives:

- 1h `klines`;
- `fundingRate`.

Frozen universe:

`BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX`

Archive months:

- 2025-01 through 2026-01.

Retained hourly rows:

- first: **2025-01-03T23:00:00Z**
- last: **2026-01-03T00:00:00Z**
- exact count per asset: **8,738**

Retained funding rows:

- from **2025-02-01T00:00:00Z**
- through **2026-01-03T00:00:00Z**

No private data, synthetic backfill, alternate exchange data, or Holdout data are authorized.

## Authorized Development evaluation

Exactly 48 weekly periods using the frozen V2 rules:

- unchanged V1 28-day / 672-return Low-Volatility feature;
- continuous 12-asset rank weighting;
- gross exposure 1.0;
- net exposure 0;
- weekly open-to-open return;
- official public funding;
- baseline 10-bps one-way turnover cost;
- mandatory 20-bps stress cost;
- mandatory terminal close;
- exact preregistered Development gate.

Possible decisions remain exactly:

- `DEVELOPMENT_PASS_HOLDOUT_REQUIRED`
- `DEVELOPMENT_FAIL_RESEARCH_STOP`

## Explicit prohibitions

This run may not:

- alter the strategy after seeing the corrected result;
- evaluate Holdout data;
- change assets, feature, ranking, costs, funding formula, dates, or gates;
- authorize Paper or live trading.

A Development PASS authorizes only a separately reviewed and separately authorized untouched Holdout stage.

A scientific Development FAIL closes V2 without touching Holdout.
