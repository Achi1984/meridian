# Cross-Venue Funding Edge V1 — Implementation & Source Contract

Status: **FROZEN BEFORE SOURCE RESULT / PNL INSPECTION**  
Ruleset: `CROSS-VENUE-FUNDING-EDGE-V1`  
Execution impact: `false`  
Auto-promotion: `false`

This document resolves the remaining implementation and data-source ambiguities in the preregistered Cross-Venue Funding Edge V1 before any strategy PnL is calculated.

## Venue pair and instrument

The first and only V1 venue pair is:

- Binance USD-M `BTCUSDT` perpetual
- Bybit Linear `BTCUSDT` perpetual

The pair is chosen before strategy results because both venues expose unauthenticated historical funding data and historical mark-price klines for the same linear USDT-settled BTC perpetual. Hyperliquid is not used in this V1 because its public `candleSnapshot` is trade OHLC rather than a historical mark/index series; its historical asset-context archive is Requester-Pays and would introduce a less reproducible source dependency.

No venue substitution is permitted inside V1 after source collection or PnL inspection.

## Frozen public sources

### Binance

Authoritative public Binance Vision USD-M archive:

- `fundingRate/BTCUSDT`
- `markPriceKlines/BTCUSDT/1h`
- monthly ZIP + provider `.CHECKSUM`
- missing/incomplete final month may be rebuilt only from provider daily ZIPs, each with its provider checksum

### Bybit

Unauthenticated V5 public market API:

- `GET /v5/market/funding/history?category=linear&symbol=BTCUSDT`
- `GET /v5/market/mark-price-kline?category=linear&symbol=BTCUSDT&interval=60`

Every fetched Bybit page is retained in the source provenance as query bounds plus a SHA-256 digest of the raw response body. Pagination is fail-closed on non-progress, duplicates or invalid API status.

## Frozen raw window

- start: `2021-01-01T00:00:00.000Z`
- end: `2026-09-30T23:59:59.999Z`
- funding timestamp normalization tolerance: **1 second**
- mark cadence: **1 hour**
- maximum funding gap after coverage begins: **8 hours + 1 second**

The source audit must prove continuous mark coverage and authoritative funding coverage for both venues. No interpolation, forward fill or synthetic funding is allowed.

## Common funding decisions

A venue funding timestamp may be canonicalized to the nearest exact UTC hour only when its absolute timestamp skew is at most 1 second. A common decision timestamp exists only when both venues have one authoritative funding event mapped to the same canonical timestamp.

The fixed 60/20/20 split is computed once from these common funding decision timestamps. The exact source receipt and split boundaries are locked in a later source-decision PR before strategy PnL is authorized.

## Frozen signal and projection

At common funding decision timestamp `t`:

- `spread(t) = BybitFunding(t) - BinanceFunding(t)`
- positive spread => candidate **LONG Binance / SHORT Bybit**
- negative spread => candidate **LONG Bybit / SHORT Binance**

Only information already settled by `t` may be used.

Projection requires the latest **three completed common 8h funding spreads**, including `t`:

1. all three must have the same non-zero sign;
2. `conservative8hSpread = min(abs(spread[t]), abs(spread[t-8h]), abs(spread[t-16h]))`;
3. projected 24h spread = `3 * conservative8hSpread`.

If persistence is absent, the decision is NO TRADE. No alternate lookback or estimator is allowed inside V1.

## Position normalization and execution reference

- notional per leg: **10,000 USDT**
- reserved research capital: **20,000 USDT**
- no leverage benefit is credited
- at most one BTC pair position
- no pyramiding or averaging
- fixed base quantity per venue from that venue's entry mark

A signal at funding time `t` may enter only at the first complete 1h mark-price candle OPEN whose timestamp is strictly greater than `t`. Same-timestamp prices can never be used to enter on a just-observed funding event.

Exit signals use only completed information and execute at the next 1h mark OPEN strictly after the exit decision timestamp. A basis-risk breach is detected from a completed hourly mark observation and also exits on the following hourly mark open.

## Frozen costs

No volume/VIP/maker discount is credited.

Per executed fill:

- Binance taker fee: **5.0 bps**
- Bybit taker fee: **5.5 bps**
- baseline adverse slippage: **3.0 bps**
- stress adverse slippage: **6.0 bps** (exactly 2x baseline)

Per completed position cycle:

- additional operational/rebalancing contingency: **5.0 bps of one-leg notional**

For 10,000 USDT per leg:

- baseline round-trip cost = **38.0 bps = 38.00 USDT**
- stress round-trip cost = **50.0 bps = 50.00 USDT**
- entry safety hurdle = **1.50 × baseline round-trip cost = 57.00 USDT**

The operational buffer is charged even though the research model assumes both venues are pre-funded; it prevents cross-venue rebalancing/operational friction from being silently zero.

## Frozen entry

Entry is permitted only when:

- three-spread persistence is valid;
- projected 24h funding-spread income on 10,000 USDT is **strictly greater than 57.00 USDT**;
- required funding and mark inputs are complete and fresh;
- there is no existing position.

## Funding accounting

Funding is booked from authoritative settlement records exactly once.

For each venue:

- LONG funding cash flow = `-qty * fundingMark * rate`
- SHORT funding cash flow = `+qty * fundingMark * rate`

The funding mark is the venue's 1h mark-price OPEN at the canonical funding timestamp. A funding event applies only when its canonical timestamp is strictly after entry and at or before the final exit-decision timestamp. Entry-time funding is never credited.

## Frozen exits

Maximum holding horizon: **24 hours from actual entry time**.

Exit at the earliest of:

1. current common funding spread reverses sign versus the held direction;
2. three-spread persistence is no longer valid for the held direction;
3. conservative projected funding over the remaining whole 8h intervals does not exceed **1.50 × remaining close cost**;
4. marked cross-venue basis PnL falls to or below **-1.00% of one-leg notional (-100 USDT)**;
5. 24h maximum holding horizon is reached;
6. any required input fails integrity/staleness checks.

Remaining close cost is both taker fees plus baseline slippage for the two closing fills: **16.5 bps = 16.50 USDT**. Its 1.50x safety buffer is **24.75 USDT**.

A data-integrity exit makes the research stage INCONCLUSIVE rather than converting missing data into economic PnL.

## Basis PnL

Each leg is independently marked with its own venue mark series and fixed entry quantity.

- long leg: `qty * (exitMark - entryMark)`
- short leg: `qty * (entryMark - exitMark)`

No forced convergence assumption is credited.

## Frozen statistics and gates

Starting research equity is 20,000 USDT.

Baseline and stress use the identical frozen trade path and quantities; stress changes only slippage from 3 to 6 bps per fill.

A completed position cycle runs from pair entry through final pair exit. A closed funding settlement is one common funding decision timestamp during which an already-open pair accrues authoritative funding on both legs.

The preregistered gates are unchanged:

- positive net PnL
- PF >= 1.20
- positive expectancy
- max drawdown <= 8%
- >= 4/5 positive chronological windows
- positive result under 2x baseline slippage
- no single calendar month >35% of total positive monthly PnL
- no unresolved accounting/data error
- >=100 closed funding settlements
- >=20 completed position cycles

Five windows are contiguous near-equal slices of the authorized split's common funding timestamps. A position cycle is attributed to the window and calendar month containing its final exit.

## Stage isolation

The initial code is locked to `SOURCE_AUDIT`:

- Discovery: disabled
- Validation: disabled
- Holdout: disabled
- Paper/live: disabled

The source collector is not allowed to calculate strategy PnL, entries, exits, PF, expectancy or gate outcomes. Only after the source artifact is green will its exact receipt and split be frozen in a separate PR. Strategy PnL remains unauthorized until that second pre-result gate passes.

Any post-result change to venue pair, projection, horizon, fees, slippage, operational buffer, basis limit, source window, split or gates requires a new ruleset.
