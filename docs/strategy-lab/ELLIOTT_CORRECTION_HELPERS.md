# Elliott correction helpers — bounded synthetic implementation

Basis: `ELLIOTT_CORRECTION_CONTRACT_DRAFT_20261014.md` at strategy commit `7e658c4a8990a3fafc1148aeea167cf1a7c7761b`. The new `elliott-correction-helpers.mjs` implements pure input/time, target-geometry and signed-fill arithmetic helpers. It is **not a corrected Elliott strategy engine**, integrated signal adapter, fill simulator or break-even scheduler.

Every success and rejection includes `researchOnly:true`, `executionAuthorized:false`, `empiricalRunAuthorized:false`, `historicalAvailabilityVerified:false`, `revisionHistoryVerified:false`, `receiptAuthenticated:false`. Success means the local declared contract passed, not that the data/receipts/fills are authentic or economically validated. All functions return new results and leave inputs untouched. Rejection is `{valid:false,error,...flags}` with no partial computed position.

## Exact input schemas

All inputs are plain JSON-style records with exactly the listed keys. Unknown/missing keys, coercible strings instead of numbers, unsupported schema tags and sparse arrays reject. Arrays must have only their indexed elements. UTC timestamps are nonnegative safe integer milliseconds. No sorting, dropping, deduplication or missing-bar repair is performed.

| Export | Exact input keys and required schemaVersion |
|---|---|
| `validateClosedBars` | `{schemaVersion:'ELLIOTT_CLOSED_BARS_V1', timeframe, asOfMs, bars}` |
| `aggregateUtcDay` | `{schemaVersion:'ELLIOTT_UTC_DAY_V1', asOfMs, bars}` |
| `pivotConfirmationTime` | `{schemaVersion:'ELLIOTT_PIVOT_TIME_V1', timeframe, asOfMs, bars, pivotIndex, leftBars, rightBars}` |
| `admitObservationTime`, actual receipt | `{schemaVersion:'ELLIOTT_OBSERVATION_ADMISSION_V1', mode:'ACTUAL_RECEIPT', geometricConfirmationAtMs, decisionAtMs, receivedAtMs}` |
| `admitObservationTime`, explicit assumption | `{schemaVersion:'ELLIOTT_OBSERVATION_ADMISSION_V1', mode:'ASSUMED_PUBLICATION', geometricConfirmationAtMs, decisionAtMs, publicationDelayMs, archiveRetrievedAtMs, assumptionId}` |
| `admitTargetGeometry` | `{schemaVersion:'ELLIOTT_TARGET_GEOMETRY_V1', side, entryPrice, originalStopPrice, targets}` |
| `accountExplicitFills` | `{schemaVersion:'ELLIOTT_EXPLICIT_FILL_ACCOUNTING_V1', quoteCurrency, side, entryPrice, originalStopPrice, initialQuantity, entryCostQuote, exits}` |

### Bars, geometric time and receipt assumptions

`timeframe` is exactly `4H` or `1D`. Every bar has exactly `{openTimeMs,closeTimeMs,open,high,low,close,volume}`. Its interval is UTC aligned, has the declared duration, and closes exclusively at `closeTimeMs<=asOfMs`. OHLC must be positive finite numbers with consistent bounds; volume finite and nonnegative. All 1–10,000 bars must be contiguous, unique and ordered. There is no implied freshness interval or actual publication admission: successful bar validation returns `publicationAdmitted:false`.

Daily aggregation requires exactly six consecutive 4h bars starting at UTC midnight, covering the whole day. It returns a copied daily bar with first open, last close, maximum high, minimum low and summed volume. A duplicate cannot substitute for a missing interval. Volume overflow rejects.

`pivotIndex` is zero-based; positive integer `leftBars`/`rightBars` must fit within the supplied window. Confirmation is the **exclusive close of the rightmost required bar**, using the declared timeframe. `pricePatternValidated:false` means this helper does not determine whether a pivot actually exists, resolve ties, generate a signal or admit receipt. The legacy asymmetric pivot detector is preserved only in the unchanged frozen comparator, not reimplemented here. Future appended bars supplied at the old decision reject; admitting an extended window at a later decision leaves the same pivot's geometric confirmation unchanged.

Actual receipt must be at/after geometric confirmation and at/before decision. It returns `eligibleUnderSuppliedReceipt:true` but still `receiptAuthenticated:false`. Historical assumptions require an explicit safe nonnegative delay, identity of 1–80 ASCII letters/digits/underscore/dot/hyphen, archive receipt at/after geometric confirmation and decision at/after the safely representable assumed publication time. The result keeps `archiveRetrievedAtMs` and `assumedPublicationAtMs` separate and returns `eligibleUnderAssumption:true`; it never emits a fabricated `receivedAtMs`. Neither mode authenticates past publication or revisions. Evidence-claim modes and injected availability-verification fields reject.

### Target eligibility

`side` is `LONG` or `SHORT`; entry, stop and 1–10 targets are positive finite numbers. Original distance `D=sideSign*(entry-originalStop)` must be strictly positive. Every target must be strictly beyond entry in the profitable direction and strictly farther than the preceding target. Equal, behind-entry or misordered targets reject with `INVALID_TARGET_GEOMETRY`; none are repaired or dropped. Output is copied targets, original risk distance and `fillEstablished:false`.

This is pre-entry **modeled-price eligibility**, not an assertion that a real order could be cancelled after its actual fill. No target test establishes execution.

### Explicit signed fills and exact residual units

`quoteCurrency` labels one consistent price/cost quote unit: 1–16 uppercase letters/digits/underscore, first character a letter (tests use `SYNTH_QUOTE`). `initialQuantity` is a positive finite base quantity. Costs are quote-unit totals, each explicitly nonnegative finite or **null for unknown**; omitted costs reject. No FX conversion is performed.

Each of at most 1,000 exits has exactly:

```js
{eventId:'exit-1', portionPpm:500000, fillPrice:130, costQuote:0}
```

`eventId` uses the same 1–80-character safe alphabet as assumption IDs. `portionPpm` is an integer from 1 through 1,000,000 representing millionths of **initial** quantity. This intentionally restricted fraction contract gives exact residual/over-exit decisions: initial portion 1,000,000; cumulative portions cannot exceed it; only exact equality closes the record. For example three 333,333 exits leave one unit open. There is no epsilon, implicit final closure or binary floating-fraction admission. Fractions smaller than one millionth are unsupported, not rounded.

`costQuote` is the total cost of that particular executed exit portion, already based on its executed quantity; it is **not** a whole-original-position hypothetical cost or per-unit rate. The helper subtracts it once and does not multiply by the portion again. `entryCostQuote` is charged once for the input ledger. Gross realized R is the sum of `portionPpm/1,000,000 * sideSign*(fillPrice-entryPrice)/D`. Net realized R subtracts `(entryCostQuote + all executed exit costQuote)/(initialQuantity*D)`. Original D never changes when an explicit exit happens at break-even or a stop changes elsewhere.

Accounting deliberately accepts loss-making explicit fills that target admission rejects: a supplied already-executed losing fill must not vanish. It does not infer that those fills happened, validate event chronology or apply target/stop rules. Event IDs prevent duplicates **within the complete supplied exit ledger**; this is not persistence or cross-call exactly-once delivery. Callers must retain all prior exits. No live-position object is updated.

Output keeps `grossRealizedR`, `netRealizedR`, `exitedPortionPpm`, `remainingPortionPpm`, and `closed` distinct. Residual quantity is not marked at entry or silently closed; no mark-to-market is supplied. Any unknown cost preserves gross but sets net to null and `costStatus:'COSTS_UNRESOLVED'`; `knownCostQuote` sums only explicit known costs and is not a complete-cost claim. Explicit all-zero costs yield `SYNTHETIC_ZERO_COSTS`. Otherwise costs are `EXPLICIT_QUOTE_COSTS`. No fixed 0.05R is inserted.

IEEE-754 arithmetic remains approximate for prices, R and cost normalization; finite output checks reject overflow and nonpositive/underflowed normalization. There is no numeric tolerance for timestamps, portions, target ordering or risk admission. Test comparisons use 1e-12 absolute tolerance only for small bounded rational synthetic R examples. This is not a decimal currency engine: production use requires an instrument-specific integer/decimal unit and rounding contract. Extreme finite inputs may be rejected rather than rescaled.

## Error codes

Schema and shape: `INPUT_SCHEMA`, `BARS_LENGTH`, `BAR_SCHEMA`, `EXIT_LIST`, `EXIT_SCHEMA`, `QUOTE_CURRENCY`, `EVENT_ID`.

Time and bars: `TIME_CONTRACT`, `BAR_TIME`, `FUTURE_OR_INCOMPLETE_BAR`, `BAR_SEQUENCE`, `OHLCV`, `EXACT_UTC_DAY_REQUIRED`, `PIVOT_WINDOW`, `UNSUPPORTED_MODE`, `RECEIPT_TIME`, `NOT_YET_RECEIVED`, `ASSUMPTION_TIME`, `ASSUMPTION_ID`, `TIME_OVERFLOW`, `NOT_YET_ASSUMED_PUBLISHED`.

Geometry/accounting: `INVALID_INITIAL_RISK`, `INVALID_TARGET_GEOMETRY`, `INVALID_COST`, `DUPLICATE_EVENT`, `EXIT_PORTION`, `OVER_EXIT`, `FILL_PRICE`, `NUMERIC_RANGE`. Errors report the first failed validation, not an exhaustive list.

## Synthetic verification and boundaries

Run `node --test test/elliott-correction-helpers.test.js test/elliott-frozen-characterization.test.js`.

**21/21 tests pass:** 13 new helper tests and all 8 unchanged frozen-characterization tests. Frozen comparator modules and test file are copied unchanged solely as verification dependencies, with original Git blob integrity checked by the existing suite. New tests cover daily/4h timing, exact aggregation, separate actual/assumed metadata, mirrored long/short target and signed-exit cases, gap-loss arithmetic, TP1 residual loss, entry-level and gap-through-entry accounting, quantity-dependent costs, unknown costs, exact residual units, duplication, wrong shapes/types, sparse/nonfinite/future inputs and failure immutability.

No integrated pivot/strategy detector, annotation mapper, bar fill engine, stop-first ambiguity ordering, next-bar break-even scheduler, entry-after-signal scheduler or actual venue model is implemented. The tests supply explicit fills for stop/target/break-even economic arithmetic; they do not prove that a path engine selected the proper fill time or price. No historical artifacts or market data are executed/recomputed. No corrected-engine completeness, repaired profitability, candidate registration, budget reset or execution permission follows. Wave3 remains frozen/unpromoted, Wave5 rejected, and cumulative ledger reconciliation remains incomplete.
