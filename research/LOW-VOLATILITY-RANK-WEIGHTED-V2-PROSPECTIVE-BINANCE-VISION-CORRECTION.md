# Low-Volatility Rank-Weighted V2 — Prospective Binance Vision Source Correction

Status: **PRE-START TECHNICAL SOURCE CORRECTION / ZERO ELIGIBLE OUTCOMES OBSERVED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Execution impact: **false**

## Why this correction is required

Two pre-start transport probes failed before any prospective source payload or performance result was produced:

- workflow **37143326461**: primary USD-M REST host returned HTTP 451;
- workflow **37143595493**: the primary host returned HTTP 451 and the fapi1-4 mirrors did not return usable JSON from the GitHub-hosted runner.

The prospective start boundary, **2026-10-10T00:00:00Z**, is still in the future. No eligible prospective outcome has been observed.

## Corrected official source

The collector now uses only official public Binance Vision USD-M archive files:

- completed monthly 1h kline archives for prior months;
- completed daily 1h kline archives for the current cutoff month;
- completed monthly fundingRate archives for prior months;
- completed daily fundingRate archives for the current cutoff month.

No REST trading/account endpoint, API key, private stream, account data, order data, or exchange mutation is used.

## Archive-safe timing

A daily archive is treated as source only after the corresponding UTC day has completed.

Therefore:

- scheduled collection moves to **Sunday 02:15 UTC**;
- the canonical Saturday cutoff remains unchanged;
- a required canonical snapshot is timely when collected within **36 hours** after its Saturday 00:00 UTC cutoff;
- the collector refuses to use the newest Saturday cutoff until at least 24 hours have elapsed, otherwise it falls back to the prior Saturday for diagnostic snapshots.

This changes evidence transport/timing only. It does not change the strategy or any return interval.

## Unchanged scientific rules

Unchanged:

- prospective start: **2026-10-10T00:00:00Z**;
- first eligible completed outcome: **2026-10-17T00:00:00Z**;
- fixed first-12-week gate endpoint: **2027-01-02T00:00:00Z**;
- 12 frozen assets;
- Low-Volatility feature;
- rank weighting;
- funding contribution formula;
- 10-bps baseline and 20-bps stress costs;
- all performance thresholds;
- append-only evidence ledger;
- Paper/live authorization remains false.

The failed REST probes are not evidence and cannot count in the prospective ledger.
