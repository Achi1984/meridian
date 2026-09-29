# Quarter-Hour Order-Flow V1 — Data V1 Frozen Foundation

Status: **FROZEN BEFORE ANY ORDER-FLOW SIGNAL OR STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- MERIDIAN main after PR #322 / commit `541d04586d7ed13ae3105e0ee188603f86ff8922`

## Objective

Establish whether the official Binance Vision public archive can support a future, separately preregistered high-frequency research lane motivated by the 2026 paper *The Quarter-Hour Effect: Periodic Algorithmic Trading and Return Predictability in Cryptocurrency Futures*.

Data V1 is deliberately strategy-neutral.

It does **not** compute:
- order imbalance;
- quarter-hour predictors;
- technical indicators;
- forward returns;
- trading signals;
- portfolio weights;
- PnL;
- Sharpe;
- transaction-cost profitability.

## External motivation fixed before Data V1

Kim & Hansen (2026) document intrahour periodicity using aggregate trades for six Binance USDT-margined perpetual contracts. Their six assets are:

- BTC
- ETH
- XRP
- SOL
- DOGE
- ADA

The paper's sample ends 2024-10-31. MERIDIAN Data V1 therefore audits only a later period so that any eventual economic test can be built on evidence not used in the paper.

External references:
- https://arxiv.org/abs/2607.09426
- https://github.com/binance/binance-public-data

## Frozen universe

Exactly:

- BTCUSDT
- ETHUSDT
- XRPUSDT
- SOLUSDT
- DOGEUSDT
- ADAUSDT

No substitute or extra asset is allowed in Data V1.

## Frozen audit window

Monthly archive coverage:

- start: **2025-01**
- end: **2026-08**
- expected completed months: **20**
- expected asset-months: **120**

This interval is strictly after the paper's 2021-01-01 through 2024-10-31 sample.

## Official sources

Only Binance Vision public USD-M futures archives.

### Aggregate trades

Monthly archive pattern:

`https://data.binance.vision/data/futures/um/monthly/aggTrades/<SYMBOL>/<SYMBOL>-aggTrades-YYYY-MM.zip`

For every frozen asset-month, Data V1 requires the corresponding official `.CHECKSUM` sidecar to exist and name the expected archive with a valid SHA-256 digest.

Expected futures aggregate-trade columns:

1. aggregate trade ID
2. price
3. quantity
4. first trade ID
5. last trade ID
6. timestamp
7. is buyer maker

Header and headerless files are both accepted only when they map unambiguously to this seven-field schema.

### Funding

Monthly archive pattern:

`https://data.binance.vision/data/futures/um/monthly/fundingRate/<SYMBOL>/<SYMBOL>-fundingRate-YYYY-MM.zip`

Funding archives are included now because any later 4–12 hour perpetual holding simulation must account for realized funding when a holding crosses settlement.

For every frozen asset-month, Data V1 requires the official funding archive checksum sidecar.

## Fixed schema sentinels

To validate actual raw aggregate-trade rows without downloading the entire 20-month tick history, Data V1 downloads exactly these **daily** aggregate-trade archives for all six assets:

- 2025-01-15
- 2026-08-15

Expected sentinel files: **12**.

Every row in every sentinel file must satisfy:

- exactly seven parseable fields after optional header handling;
- aggregate trade ID is an integer and strictly increasing;
- price is finite and >0;
- quantity is finite and >0;
- first and last trade IDs are integers;
- first trade ID <= last trade ID;
- timestamp is an integer in millisecond scale and belongs to the UTC sentinel date;
- timestamps are non-decreasing;
- `isBuyerMaker` parses unambiguously as true/false.

No trade-side aggregation is performed in Data V1.

## Fixed funding sentinels

Data V1 downloads funding archives for the two fixed months:

- 2025-01
- 2026-08

for all six assets.

Expected funding sentinels: **12**.

Sentinel funding rows must have:

- parseable timestamp;
- finite funding rate;
- strictly increasing timestamps;
- no duplicates.

No funding PnL is computed.

## Archive-size metadata

Data V1 may collect HTTP Content-Length for aggregate-trade archives when the server exposes it. This is capacity-planning metadata only and is not a pass/fail requirement.

No trading decision may use archive size.

## Frozen gate

PASS only if all are true:

- exactly 6 frozen assets;
- exactly 20 frozen months;
- exactly 120 valid aggregate-trade checksum sidecars;
- exactly 120 valid funding checksum sidecars;
- exactly 12 aggregate-trade sentinel files downloaded and fully schema-validated;
- every aggregate sentinel has >0 rows;
- exactly 12 funding sentinel files downloaded and schema-validated;
- every funding sentinel has >0 rows;
- no unexpected HTTP/transport error;
- no schema ambiguity;
- no signal, forward return, strategy PnL or portfolio calculation was performed.

PASS => `FOUNDATION_PASS_SOURCE_SCHEMA`

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

## Required next stage after PASS

A PASS authorizes only a separately frozen **Data V2 compression / coverage foundation**.

Data V2 must define, before running:

- raw-history partitioning;
- deterministic 10-second aggregation semantics;
- exact treatment of empty 10-second bins;
- UTC quarter-hour boundary labeling;
- preservation of buyer/seller initiated quantity from `isBuyerMaker`;
- raw checksum verification;
- storage/streaming budget;
- development versus untouched validation dates.

Data V2 still must not calculate strategy PnL unless a separate strategy protocol is frozen first.

## Anti-overfitting and safety

- Do not inspect forward-return economics in Data V1.
- Do not choose assets or dates based on results.
- Do not change the six-asset universe after schema inspection.
- Do not infer missing archives.
- Do not synthesize trades.
- Do not interpolate prices.
- Do not load account/private exchange data.
- No API credentials, exchange orders, Paper promotion or live execution.
