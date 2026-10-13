# Crypto Top20 / Top10 data preparation — 2026-10-13

Owner requests the largest ten or twenty cryptocurrencies. Design decision: Top20 eligible coins is the primary research universe; Top10 is a counted comparison variant. Size means circulating market capitalization, not price, recent return, FDV or volatility. More coins broaden selection but do not prove better diversification or profitability. H7 still selects at most three25% positions; this is not twenty simultaneous5% allocations.

## Universe contract

At each planned Saturday selection, use only the latest ranking snapshot whose availability precedes the decision. Walk the historical market-cap ranking; exclude historically classified stablecoins and duplicate wrapped/staked representations, then apply point-in-time venue, liquidity and minimum-history eligibility. Select the first20 eligible for the primary universe and first10 for the comparison. Log exclusions with stable provider identity, chain/contract where needed, as-of evidence and reason. Symbol renames and migrations cannot be resolved from ticker alone.

The precise liquidity threshold and venue are still to be frozen before evaluation. Missing classification, unknown publication time or insufficient ranked depth leaves the universe unverified. Do not silently replace it with a current ranking, a lower-quality source or a smaller universe. Preserve failed/delisted assets in the data-use ledger. Top10/Top20 comparison consumes a variant slot; it must fit the existing per-family and total campaign budgets before any run.

Practical primary-source finding: https://coinmarketcap.com/historical/20241013/ exposes a dated ranking table with market cap and circulating supply. The web extraction verified twenty numbered rows; it includes stablecoins, so it does not yet supply twenty eligible coins after exclusions. We did not validate a deeper complete historical table, a bulk feed, original publication time or immutable historical revisions. Global ranking is not venue tradability. This page is a feasibility example, not the universe for every date.

https://docs.coingecko.com/demo/reference/coins-id-history documents per-coin historical price/market-cap data. It is not by itself a historical global ranking: asking only today's surviving IDs for their past data does not repair survivor bias. No paid source subscription or API credentials were used or purchased. Historical ranking and classification remain the material data gap.

## Implemented daily price adapter

`normalize-binance-daily.mjs` exports `normalizeBinanceDaily({rows,timestampUnit,availableAtMs,asOfMs})` without I/O. Rows are arrays of exactly12 strings representing one-day Binance spot klines. Supply1–10,000rows, one explicitly declared unit (`ms` or `us`) per batch, and one availability timestamp per row. No unknown top-level keys.

Opening and inclusive closing timestamp strings are checked with BigInt, converted without losing the submillisecond end boundary, and required to describe exactly one UTC day. The output `closeTimeMs` is the exclusive end boundary. Milliseconds apply before2025-01-01; microseconds from that date. Split histories at that unit transition, then validate continuity across normalized batches in the later data pipeline; this adapter does not perform cross-batch reconciliation.

Rows within a batch must be strictly contiguous. OHLC values must be finite positive decimals and internally consistent; volume must be finite nonnegative. Metadata cells7–11 are bounded strings but otherwise opaque and not certified. Input arrays are not mutated. Invalid data rejects the entire batch. Output bars include opening/end times, OHLCV and explicit `availableAtMs`. Every output remains `researchOnly:true` and `executionAuthorized:false`.

Availability must be no earlier than bar closure, no later than asOf, and nondecreasing. This verifies supplied values, not actual historical release time. For archive downloads performed today, the probe records today's receipt; it never pretends those records were received at their historical close. A subsequent research model needs independently evidenced availability or a clearly declared historical publication-lag assumption, with sensitivity analysis and no claim of strict as-known validation where evidence is absent.

## Real source-format probes and limits

`normalizer-probes-20261013.json` records six independently downloaded small archives: BTCUSDT, ETHUSDT and SOLUSDT for2024-01-01 and2025-01-01. Every ZIP matched its companion SHA256 CHECKSUM, contained one12-column record, and passed the adapter with explicit current receipt times. This exercises both timestamp regimes against real source rows. No signal selection, trades, return series or strategy PnL was calculated. Downloaded historical examples are recorded as inspected material; no new holdout is claimed.

The eight synthetic tests additionally cover wrong units, invalid availability, gaps/duplicates, bad OHLCV, malformed timestamp strings and immutable inputs. Source documentation: https://github.com/binance/binance-public-data . Checksums establish byte integrity, not economic correctness, historical publication, no revisions or completeness.

Full Top20 histories, point-in-time membership, classifications, EUR/USDT conversion, execution quotes, fees, calendar behavior, cross-batch checks and risk/portfolio simulation remain incomplete. These probes do not certify Binance access for trading or select a broker. The manifests remain source designs with execution disabled; frozen research and the parallel platform lane are unchanged.
