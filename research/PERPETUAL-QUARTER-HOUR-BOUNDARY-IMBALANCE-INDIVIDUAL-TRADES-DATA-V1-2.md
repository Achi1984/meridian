# Quarter-Hour Boundary Imbalance — Individual Trades Data V1.2

Status: **FROZEN STRATEGY-NEUTRAL DATA QUALITY PROTOCOL**  
Parent source foundation: **120/120 official monthly individual-trades archives + CHECKSUMs available**  
Execution impact: **false**  
Signal / forward returns / positions / PnL allowed: **false**

## Why a new version is required

Data V1 and V1.1 remain immutable failures.

### Data V1 — aggTrades

The 120-shard aggTrades run completed 119 PASS / 1 FAIL. SOLUSDT/2025-07 contains a source-level aggregate-ID anomaly. V1 is not relaxed.

### Data V1.1 — individual trades with raw quoteQty + exact kline reconciliation

The frozen V1.1 canaries failed. Subsequent strategy-neutral diagnostics established two independent source-semantics issues:

1. **raw quoteQty is not reliable enough to be a hard invariant**
   - SOLUSDT/2025-07: 1 malformed quoteQty row among 83,455,863 trades;
   - BTCUSDT/2025-01: 122 malformed rows among 127,495,209 trades;
   - the malformed rows are sparse and the required primary fields price/qty/time/isBuyerMaker remain parseable.

2. **1m kline trade-count/volume is not a universally valid completeness oracle**
   - #348 localized the BTCUSDT/2025-01 mismatch to 2025-01-14 and 2025-01-29;
   - #350 proved monthly and daily individual-trades packages are identical on both days;
   - #352 added official daily aggTrades as a third source.
   - On the exact #350 deficit windows, individual trades and aggTrades reconcile in base/derived quote after respecting aggregate-record minute-boundary semantics, while the 1m kline archive omits most or all activity.
   - Example: 2025-01-14 13:31–13:34 UTC has 5,550.846 BTC / 538,256,225.2349 USDT in both trade-flow sources versus 2,074.539 BTC / 201,356,918.6156 USDT in klines.
   - On 2025-01-29 the three independently identified deficit windows reconcile exactly between individual trades and aggTrades, while klines are materially lower.

Therefore V1.1 is not patched. V1.2 freezes a different field/source policy before its canaries.

## Fixed scope

Universe:
- BTCUSDT
- ETHUSDT
- XRPUSDT
- SOLUSDT
- DOGEUSDT
- ADAUSDT

Window:
- 2025-01 through 2026-08 inclusive;
- exactly 120 asset-month shards.

Each shard downloads and CHECKSUM-verifies:
- monthly individual `trades`;
- monthly 1m klines;
- monthly fundingRate.

## Source-field policy

### Primary individual-trades fields

Hard-validated:
- `price`: finite and positive;
- `qty`: finite and positive;
- `time`: inside target month, nondecreasing, millisecond source unit;
- `isBuyerMaker`: strict Boolean **schema validation only** at this stage;
- trade ID: strictly increasing and unique.

Numeric trade-ID gaps remain diagnostic because contiguity is not a documented market-trade completeness guarantee.

### quoteQty

`quoteQty` must parse as finite and non-negative, but:

**it is not authoritative in V1.2 and does not participate in the hard gate.**

V1.2 records mismatch counts/examples against `price * qty`. Derived `price * qty` is used only for strategy-neutral source diagnostics.

This is not a tolerance relaxation. The failed V1.1 invariant remains failed and immutable; V1.2 explicitly removes a source field that the later external OI definition does not require.

### 1m klines

Kline archive structure remains hard-validated:
- exact one-minute cadence;
- exact first/last minute;
- valid OHLC;
- non-negative volume/taker fields;
- millisecond timestamps.

But exact trade-count/base/quote reconciliation against individual trades is **diagnostic only**.

V1.2 records:
- monthly count/base/derived-quote differences;
- per-minute mismatch counts;
- bounded mismatch examples.

Kline trade-count/volume is not a hard completeness oracle because the already-observed official archive contains isolated zero-/under-volume windows while both official trade-flow sources contain activity.

### Funding

Hard requirements remain:
- strictly increasing events;
- timestamps within target month;
- millisecond unit;
- no leading/trailing/inter-event gap above 12 hours.

## Primary trade-stream coverage gate

The monthly individual-trades archive must have:
- published CHECKSUM exact match;
- exactly one ZIP member;
- at least one data row;
- strict monotone unique trade IDs;
- nondecreasing timestamps;
- millisecond source timestamps;
- every UTC 15-minute bin in the month represented by at least one trade.

The first 10 seconds of each quarter-hour are also counted, but empty first-10-second windows are **diagnostic only** at Data V1.2. Handling a zero-denominator OI event belongs in the later strategy preregistration and may not be chosen after PnL.

## Frozen canary plan

Known-anomaly fixtures validate that V1.2 implements the documented source semantics:
- BTCUSDT / 2025-01
- SOLUSDT / 2025-07

Independent row-level canaries, not used to design the V1.2 field policy:
- ETHUSDT / 2025-11
- XRPUSDT / 2026-02
- DOGEUSDT / 2026-05

All five plus parser invariants must PASS before the 120-shard full run may be authorized.

The known fixtures are not independent evidence. They only prevent accidental regression against the diagnosed anomalies. The three additional canaries are the independent release gate.

## Full-run gate

A later full run may be authorized only after all five canaries are green without changing this protocol.

PASS requires:
- exactly 120 unique expected shards;
- 120/120 shard PASS;
- zero missing/duplicate/unexpected shards;
- every shard passes primary trade-stream quarter-hour coverage;
- strict monotone unique trade IDs in every shard;
- expected millisecond timestamp semantics;
- complete structural 1m-kline cadence;
- complete funding coverage;
- all anti-leakage/execution flags false.

The following remain aggregate diagnostics and do **not** become retrospective failure thresholds:
- numeric trade-ID gap count;
- raw quoteQty mismatch rows;
- kline count/volume mismatch minutes;
- empty first-10-second windows.

PASS decision:

`INDIVIDUAL_TRADES_DATA_V1_2_PASS_STRATEGY_PREREGISTRATION_REQUIRED`

FAIL decision:

`INDIVIDUAL_TRADES_DATA_V1_2_FAIL_DATA_QUALITY`

## Explicitly forbidden

Data V1.2 must not calculate:
- buyer-minus-seller flow;
- signed order imbalance;
- forward returns;
- signal/return relationships;
- asset rankings;
- position direction or sizing;
- turnover;
- fee/funding strategy PnL;
- strategy PnL.

`isBuyerMaker` is parsed only to validate schema.

## What PASS would authorize

Only a separately frozen strategy preregistration.

It would **not** authorize a backtest, Paper promotion or live execution.
