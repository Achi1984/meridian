# Low-Volatility Rank-Weighted V2 — Prospective Public Endpoint Failover Correction

Status: **PRE-START TECHNICAL SOURCE-TRANSPORT CORRECTION / ZERO ELIGIBLE OUTCOMES OBSERVED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Execution impact: **false**

## Trigger

The first prospective-start authorization push triggered workflow run **37143326461**.

The run failed during the very first public source request:

`GET https://fapi.binance.com/fapi/v1/time`

GitHub-hosted runner response:

`HTTP 451`

No public market payload was collected, no prospective snapshot was produced, no eligible prospective return was calculated, and the 2026-10-10 prospective start boundary is still in the future.

Therefore this is a source-transport correction before any prospective performance observation exists.

## Narrow correction

The collector now tries the interchangeable official Binance USD-M public REST hosts in fixed order:

- `https://fapi.binance.com`
- `https://fapi1.binance.com`
- `https://fapi2.binance.com`
- `https://fapi3.binance.com`
- `https://fapi4.binance.com`

The request paths, parameters, source hashing, asset universe, start boundary, strategy, funding accounting, costs, gate dates, and thresholds are unchanged.

Each successful receipt records the exact base host that served the response.

If every official host fails, source collection fails closed and no snapshot is eligible.

## Scientific invariants

Unchanged:

- prospective start: **2026-10-10T00:00:00Z**;
- first eligible completed outcome: **2026-10-17T00:00:00Z**;
- fixed first-12-week gate endpoint: **2027-01-02T00:00:00Z**;
- 12 frozen assets;
- frozen Low-Volatility feature and rank weights;
- 10-bps baseline / 20-bps stress costs;
- all performance gates;
- Paper/live authorization remains false.

The failed 37143326461 run is not evidence and cannot count in the prospective ledger.
