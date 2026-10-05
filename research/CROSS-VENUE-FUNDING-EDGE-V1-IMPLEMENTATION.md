# Cross-Venue Funding Edge V1 — Implementation & Source Contract

Status: **FROZEN BEFORE SOURCE RESULT / PNL INSPECTION**  
Ruleset: `CROSS-VENUE-FUNDING-EDGE-V1`  
Execution impact: `false`  
Auto-promotion: `false`

This document resolves the remaining implementation and data-source ambiguities in the preregistered Cross-Venue Funding Edge V1 before any strategy PnL is calculated.

## Pre-PnL source correction

The first implementation candidate used Binance USD-M plus Bybit Linear. The first source-only workflow run `37234804097` failed before producing a source artifact because Bybit returned HTTP 403 to the GitHub-hosted runner. No strategy PnL, entry, exit, PF, expectancy or gate result was calculated or inspected.

Bybit is therefore excluded under the preregistered reproducibility rule before any PnL.

OKX was then tested from the same GitHub-hosted environment:

- run `37265897307`: unsigned OKX historical funding and historical mark-price endpoints reachable;
- run `37266098877`: March 2022 and September 2026 monthly BTC-USDT-SWAP funding archives returned by the public historical-market-data endpoint;
- run `37266137577`: March 2022 static funding ZIP downloaded and SHA-256 hashed; CSV schema verified as `instId,fundingRate,fundingTime`; 1h historical mark-price candles independently returned for March 2022.

This source correction is made while the ruleset remains at `SOURCE_AUDIT`, before a valid source package or any strategy result exists.

## Venue pair and instrument

The frozen V1 venue pair is:

- Binance USD-M `BTCUSDT` perpetual
- OKX `BTC-USDT-SWAP` USDT-margined perpetual

Both are linear USDT-settled BTC perpetuals with public historical funding records and historical mark-price data that are reproducibly accessible from the research runner.

No venue substitution is permitted after the first valid source package or PnL inspection.

## Frozen public sources

### Binance

Authoritative public Binance Vision USD-M archive:

- `fundingRate/BTCUSDT`
- `markPriceKlines/BTCUSDT/1h`
- monthly ZIP + provider `.CHECKSUM`
- missing/incomplete final month may be rebuilt only from provider daily ZIPs, each with its provider checksum

Every used Binance ZIP must match its provider checksum.

### OKX funding

Unsigned public historical-market-data endpoint:

- `GET /api/v5/public/market-data-history`
- `module=3` — funding rate
- `instType=SWAP`
- `dateAggrType=monthly`
- `instFamilyList=BTC-USDT`

For each month, the returned static `BTC-USDT-SWAP-fundingrates-YYYY-MM.zip` is downloaded directly from the URL supplied by OKX and SHA-256 hashed locally. The monthly CSV is parsed only as:

`BTC-USDT-SWAP,fundingRate,fundingTime`

The query response data are also hashed and retained in provenance.

### OKX mark prices

Unsigned public endpoint:

- `GET /api/v5/market/history-mark-price-candles`
- `instId=BTC-USDT-SWAP`
- `bar=1H`

Pages are traversed backward without overlap/non-progress. Only confirmed historical candles are accepted. Each page's deterministic `data` payload is SHA-256 hashed together with its query parameters.

## Frozen raw window

- start: `2022-03-01T00:00:00.000Z`
- end: `2026-09-30T23:59:59.999Z`
- funding timestamp normalization tolerance: **1 second**
- mark cadence: **1 hour**
- maximum funding gap after coverage begins: **8 hours + 1 second**

The start moves from the unproven 2021 candidate window to March 2022 solely because March 2022 is the first historical OKX funding archive boundary objectively verified before any PnL. This is a source-availability correction, not a strategy-window selection from returns.

The source audit must prove continuous mark coverage and authoritative funding coverage for both venues. No interpolation, forward fill or synthetic funding is allowed.

## Common funding decisions

A venue funding timestamp may be canonicalized to the nearest exact UTC hour only when its absolute timestamp skew is at most 1 second. A common decision timestamp exists only when both venues have one authoritative funding event mapped to the same canonical timestamp.

The fixed 60/20/20 split is computed once from these common funding decision timestamps. The exact source receipt and split boundaries are locked in a later source-decision PR before strategy PnL is authorized.

## Frozen signal and projection

At common funding decision timestamp `t`:

- `spread(t) = OKXFunding(t) - BinanceFunding(t)`
- positive spread => candidate **LONG Binance / SHORT OKX**
- negative spread => candidate **LONG OKX / SHORT Binance**

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

Exit signals use only completed information and execute at the next 1h mark OPEN strictly after the exit-decision timestamp. A basis-risk breach is detected from a completed hourly mark observation and also exits on the following hourly mark open.

## Frozen costs

No volume/VIP/maker discount is credited.

Per executed fill:

- Binance taker fee: **5.0 bps**
- OKX taker fee: **5.0 bps**
- baseline adverse slippage: **3.0 bps**
- stress adverse slippage: **6.0 bps** (exactly 2x baseline)

Per completed position cycle:

- additional operational/rebalancing contingency: **5.0 bps of one-leg notional**

For 10,000 USDT per leg:

- baseline round-trip cost = **37.0 bps = 37.00 USDT**
- stress round-trip cost = **49.0 bps = 49.00 USDT**
- entry safety hurdle = **1.50 × baseline round-trip cost = 55.50 USDT**

The operational buffer is charged even though the research model assumes both venues are pre-funded; it prevents cross-venue rebalancing/operational friction from being silently zero.

## Frozen entry

Entry is permitted only when:

- three-spread persistence is valid;
- projected 24h funding-spread income on 10,000 USDT is **strictly greater than 55.50 USDT**;
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

Remaining close cost is both taker fees plus baseline slippage for the two closing fills: **16.0 bps = 16.00 USDT**. Its 1.50x safety buffer is **24.00 USDT**.

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

The code remains locked to `SOURCE_AUDIT`:

- Discovery: disabled
- Validation: disabled
- Holdout: disabled
- Paper/live: disabled

The source collector is not allowed to calculate strategy PnL, entries, exits, PF, expectancy or gate outcomes. Only after a green source artifact will its exact receipt and split be frozen in a separate PR. Strategy PnL remains unauthorized until that second pre-result gate passes.

Any post-result change to venue pair, projection, horizon, fees, slippage, operational buffer, basis limit, source window, split or gates requires a new ruleset.
