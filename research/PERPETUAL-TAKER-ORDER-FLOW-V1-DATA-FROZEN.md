# Perpetual Taker Order Flow V1 — Frozen Data Foundation

Status: **FROZEN BEFORE ANY ORDER-FLOW SIGNAL OR STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

## Objective

Establish a reproducible public-data foundation for a new strategy family based on aggressive taker order flow in Binance USD-M perpetual futures.

This is orthogonal to the closed cross-sectional reversal lineage. No reversal parameter, sign inversion or rescue is reused.

External motivation fixed before strategy work:
- Anastasopoulos et al. (2026), *Order flow and cryptocurrency returns*, Journal of Financial Markets: order flow has strong explanatory and out-of-sample predictive power for cryptocurrency returns.
- Recent crypto microstructure work documents portable predictive importance of order-flow and trade features across multiple perpetual-futures assets.
- Binance public USD-M kline archives expose volume, quote volume and taker-buy volume fields historically, allowing transparent reconstruction without private credentials.

MERIDIAN treats these findings as motivation, not exact replication.

## Frozen candidate universe

Exactly 12 liquid Binance USD-M perpetuals:

- BTC
- ETH
- BNB
- SOL
- XRP
- ADA
- DOGE
- LINK
- DOT
- LTC
- BCH
- AVAX

No asset replacement is permitted after the foundation result.

## Frozen audit interval

- start: **2023-01**
- end: **2026-08**
- expected months per asset: **44**

## Public sources

Binance Vision USD-M monthly archives only:

1. `klines/{SYMBOL}USDT/1h`
2. `fundingRate/{SYMBOL}USDT`

No API credentials, private endpoints, synthetic backfill, interpolation or nearest-neighbor substitution.

## Hourly kline fields required

For every 1h row:

- open time
- open
- high
- low
- close
- base volume
- close time
- quote asset volume
- number of trades
- taker buy base asset volume
- taker buy quote asset volume

The foundation may inspect these raw fields for integrity only.

It must **not** calculate:
- taker imbalance;
- buy/sell ratio;
- order-flow score;
- return predictability;
- ranks;
- trading positions;
- PnL.

## Price/order-flow data integrity

For every asset-month:

- exactly one row for every UTC hour in the calendar month;
- first open timestamp = month start 00:00 UTC;
- last open timestamp = final calendar day 23:00 UTC;
- exact 1-hour cadence;
- strictly increasing timestamps;
- no duplicates;
- finite positive OHLC;
- internally consistent OHLC;
- finite non-negative base volume;
- finite non-negative quote volume;
- finite non-negative trade count;
- finite non-negative taker-buy base volume;
- finite non-negative taker-buy quote volume;
- taker-buy base volume <= total base volume, with only tiny numerical tolerance;
- taker-buy quote volume <= total quote volume, with only tiny numerical tolerance.

No missing hourly slot may be reconstructed.

## Funding integrity

For every asset-month:

- official funding archive exists;
- finite rates;
- strictly increasing timestamps;
- no duplicates;
- at least 60 funding events in a normal month;
- maximum boundary/inter-event gap <=12 hours.

No missing funding event may be reconstructed.

## Qualification

An asset qualifies only if:
- all 44 hourly-kline months pass;
- all 44 funding months pass;
- no unexpected transport error occurs for that asset.

Foundation gate:

- output contains exactly 12 candidate assets;
- unexpected transport errors = 0;
- at least **10 of 12** assets qualify end-to-end.

PASS => `FOUNDATION_PASS_STRATEGY_PREREGISTRATION_ALLOWED`

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

A PASS authorizes only strategy preregistration. It does not authorize signal calculation, PnL, Paper or live execution.

## Anti-overfitting / sequencing

Before a foundation PASS:
- do not calculate taker imbalance;
- do not choose lookback or holding horizon from returns;
- do not choose continuation versus reversal sign;
- do not rank candidate signals;
- do not inspect strategy PnL.

After a PASS:
- freeze the exact qualified universe;
- select one strategy specification from external evidence before its first PnL;
- preserve a genuinely independent validation stage;
- use explicit transaction costs and funding;
- no automatic Paper/live promotion.

## Safety

Research only. No exchange credentials, live orders, leverage automation, wallet mutation or automatic promotion.
