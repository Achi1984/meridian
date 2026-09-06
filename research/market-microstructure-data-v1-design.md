# MERIDIAN Market Microstructure Data Foundation V1

Status: RESEARCH DATA AUDIT ONLY — NO SIGNAL — NO PROMOTION — NO EXECUTION IMPACT.

This contract is committed before the first audit response is inspected.

## Purpose

Determine whether public, decision-time-available derivatives data are sufficiently complete and reproducible to support a later, separately predeclared Hybrid Alpha hypothesis. V1 does not test profitability and does not modify v7.97.

## Locked source

Official Binance USDⓈ-M Futures public REST endpoints:

- Funding history: `GET /fapi/v1/fundingRate`.
- Open-interest statistics: `GET /futures/data/openInterestHist`.
- Taker buy/sell volume: `GET /futures/data/takerlongshortRatio`.

No account key, holdings, quantities, venues, orders or user identifiers are sent. Requests contain only the locked public market symbol, interval and time range.

Universe: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, LINKUSDT.

## Retention and scope constraints

- Funding is audited over 90 complete UTC days.
- Open interest and taker flow are audited only over the latest 30 complete UTC days because the public historical endpoints have limited retention.
- V1 must report the actually returned earliest/latest timestamp and must not label a shorter series as 90-day evidence.
- No interpolation, forward fill or synthetic value creation.
- Endpoint or symbol failure remains explicit missing data.
- Raw response order is normalized by timestamp; duplicate timestamps are rejected from the canonical series and counted.
- Only observations whose endpoint timestamp is no later than the evidence cutoff may be used.
- The evidence cutoff is the last completed UTC hour at run start.

## Canonical schema

Each normalized observation contains:

- `source`, `endpointVersion`, `symbol`;
- `eventTime` from the exchange;
- `availableAt`, conservatively equal to audit retrieval time unless the endpoint defines a later publication time;
- `value` fields parsed as finite numbers;
- `retrievedAt`;
- `rawIndex` for deterministic traceability.

Funding fields: `fundingRate`, optional `markPrice`.

Open-interest fields: `sumOpenInterest`, `sumOpenInterestValue`.

Taker fields: `buySellRatio`, `buyVol`, `sellVol`.

## Locked audit outputs

For every symbol and feature:

- HTTP/shape validity;
- requested and returned start/end;
- row count, unique count and duplicate count;
- invalid numeric/timestamp count;
- monotonic timestamp status;
- expected cadence and missing interval count;
- maximum gap;
- freshness at cutoff;
- coverage ratio;
- raw-payload SHA-256 and normalized-series SHA-256.

Portfolio-level audit reports complete-symbol breadth and whether all seven assets pass each feature gate.

## Predeclared data-quality gates

Funding passes per asset only if:

1. at least 90% of expected funding events are present over 90 days;
2. no duplicate canonical timestamps;
3. no invalid numeric/timestamp rows;
4. timestamps are monotonic after normalization;
5. maximum gap is no more than twice the asset’s observed median funding cadence;
6. latest event is within twice that cadence of the cutoff.

Open interest and taker flow pass per asset only if:

1. at least 95% of expected 1h observations are present over the returned/requested 30-day window;
2. no duplicate canonical timestamps;
3. no invalid numeric/timestamp rows;
4. maximum gap <=2h;
5. latest observation is no older than 2h relative to cutoff.

A feature is foundation-ready only if all seven assets pass. Partial breadth remains descriptive and cannot silently shrink the universe.

## Decision rule

- If all three features are foundation-ready, V1 permits design of one later predeclared soft-evidence experiment.
- If only funding is ready, future work may study funding alone; OI/taker must remain missing and weights must renormalize.
- If OI/taker retention prevents leakage-safe 90-day walk-forward alignment, do not backfill it synthetically and do not use current snapshots as historical proxies.
- A data-quality pass is not alpha evidence and cannot permit promotion.
- No changes to Baseline 6.2, v7.97, Paper/live execution, `server.js` or Pionex.
