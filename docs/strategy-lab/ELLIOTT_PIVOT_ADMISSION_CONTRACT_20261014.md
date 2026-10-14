# Single-pivot evidence and admission binding — design only

Status: `SOURCE_DESIGN_ONLY`. Proposed export: `bindSinglePivotAdmission(input)`; version below. One pivot binds to its supplied raw window and receipt metadata; it is not a wave setup, signal or trade.

Pattern comparator reference: frozen `elliott-wave-bot-v1.js`, line 6 (`confirmedPivots`), commit `a1283b68419bdb2a5d22ff2b49fff5b4109354db`, Git blob `aa2eefd3dc9e2169a184c1ac625207c44102f8ca`; byte-identical local fixture `fixtures/elliott-frozen-v1.mjs`. Preserve asymmetric ties, not the frozen hard-coded 4h offset for daily timing. Frozen source/results stay unchanged.

## Exact inputs and bounded window

Trusted plain JSON **data** only: no getters/accessors/proxies; external integration needs a data-only boundary, which shape checks do not establish. No coercion, sorting, repairs or inferred receipts. Reject missing/extra keys and sparse/custom-key arrays.

Top-level exact keys in both modes:

```js
{
 schemaVersion: 'ELLIOTT_SINGLE_PIVOT_ADMISSION_DRAFT_V1',
 assetId: 'SYNTH_ASSET', timeframe: '4H', decisionMs: 43200000,
 leftBars: 1, rightBars: 1,
 bars: [/* exact raw records */],
 admission: {/* one of the exact mode schemas below */}
}
```

`assetId` is an unauthenticated caller label, 1–40 ASCII letters/digits/underscore/dot/hyphen. `timeframe` exactly `4H` or `1D`. `decisionMs` is a nonnegative safe integer UTC millisecond timestamp. Widths are safe integers 1–32; require length=leftBars+1+rightBars (3–65), derived pivotIndex=leftBars. No external pivot/result/geometric timestamp/verification flags/resume state is accepted.

Each bar has exactly `{openTimeMs,closeTimeMs,open,high,low,close,volume}`. Reuse `validateClosedBars` with `asOfMs=decisionMs`: positive finite consistent OHLC, nonnegative finite volume, UTC-aligned declared duration, safe integer timestamps, exact exclusive close, ordered contiguous unique intervals, all closed by decision. Reject unsafe derived times. Closure does not prove availability at opening. No aggregation or transformed bars.

Actual mode exact admission shape:

```js
{mode:'ACTUAL_RECEIPT', receipts:[
 {barIndex:0, openTimeMs:0, receivedAtMs:14400000}
]}
```

Assumed mode exact admission shape:

```js
{mode:'ASSUMED_PUBLICATION', assumptionId:'explicit-assumption',
 publicationDelayMs:0, archiveReceipts:[
 {barIndex:0, openTimeMs:0, archiveRetrievedAtMs:14400000}
]}
```

Metadata arrays exactly match window length/order; require barIndex=array index and openTimeMs=corresponding bar open. Reject any mismatch. Binding is local, not archive/OHLC authentication; revalidate every call.

Actual `receivedAtMs` is a safe timestamp at/after its bar's exclusive close and at/before decision. All bars need eligible receipts. Aggregate admission is their maximum, including late left bars.

Assumed `assumptionId` follows the existing helper's 1–80 ASCII letters/digits/underscore/dot/hyphen grammar. `publicationDelayMs` is one explicit nonnegative safe integer applied **separately to each bar close**, not to its open. Safely compute each `assumedPublicationAtMs=closeTimeMs+publicationDelayMs`; require each at/before decision. Every original `archiveRetrievedAtMs` is a safe timestamp at/after its own close. It may be **after decision only in assumption mode**. Preserve archive timestamps separately; emit no fabricated `receivedAtMs`. Aggregate admission is maximum assumed publication, not archive receipt. Neither proves historical availability.

## Pattern, derived time and admission

After bar validation derive g with `pivotConfirmationTime`, using the validated window, derived pivot index and widths: g is the rightmost required exclusive close at the actual timeframe duration. This helper does not validate the price pattern.

Validate the entire metadata binding, then reuse `admitObservationTime` per bar: geometric time is its derived close; decision is `decisionMs`. Pass its bound actual receipt or its explicit delay/assumption identity/original archive receipt. Reject any admission failure **before price-pattern evaluation**. Aggregate `admittedAtMs` is the appropriate maximum above, at/after g and at/before decision. No external geometric timestamp is accepted.

Only after every bar is admitted, compare candidate extremes against all required neighbors:

- HIGH: candidate high > every left high and >= every right high.
- LOW: candidate low < every left low and <= every right low.
- Both true: `AMBIGUOUS_PIVOT`; neither: `NOT_A_PIVOT`; no partial pivot. Exactly one yields kind and corresponding extreme price.

Admission precedes pattern diagnostics to avoid a not-yet-available window revealing even a negative/ambiguous pattern verdict. Raw structural validation still occurs first.

Finally derive `earliestHypotheticalEntryOpenMs=(floor(decisionMs/duration)+1)*duration`, checking safe representability and strict inequality. Even when decision is exactly aligned, the result is the *following* boundary. This hypothetical time asserts no entry candle, price, fill or permission; earlier admission does not move it backward.

## Exact results, copying and failures

Every success/failure includes these fixed flags: `researchOnly:true`, `executionAuthorized:false`, `empiricalRunAuthorized:false`, `historicalAvailabilityVerified:false`, `revisionHistoryVerified:false`, `receiptAuthenticated:false`, `dataSourceAuthenticated:false`, `tradingSignal:false`, `entryFillEstablished:false`.

Success exact keys:

```js
{valid:true, schemaVersion, assetId, timeframe, mode,
 pivot:{kind,price,barIndex,openTimeMs,closeTimeMs},
 geometricConfirmationAtMs, admittedAtMs, decisionMs,
 earliestHypotheticalEntryOpenMs,
 evidence:{assetId,timeframe,leftBars,rightBars,bars,admission},
 ...flags}
```

Echo version/asset/timeframe/mode. Copy all validated bars; pivot index/time identifies the candidate. Labels are not authentication. `evidence.admission` in actual mode is a copy of the exact actual input admission object. In assumed mode it has exactly `{mode,assumptionId,publicationDelayMs,archiveReceipts,assumedPublications}`; archive records are copied unchanged, and `assumedPublications` is a dense derived array of exactly `{barIndex,openTimeMs,assumedPublicationAtMs}`. Copied evidence is a local binding, not cryptographic/durable identity. Changed inputs require full revalidation; changed prices may form a different valid pivot, without authenticity.

Failure is exactly `{valid:false,error,...flags}`, no partial pivot/evidence. Inputs are never mutated; output changes cannot affect inputs or later calls. First-error order:

| Stage | Errors |
|---|---|
| Exact records/version/asset and mode-dependent key sets | `INPUT_SCHEMA`; unrecognized mode `UNSUPPORTED_MODE` before its mode-specific keys |
| Width/minimal window | `PIVOT_WINDOW` for invalid widths or wrong length/density/custom array keys |
| Raw bars | Unchanged helper order: `TIME_CONTRACT`, `BAR_SCHEMA`, `BAR_TIME`, `FUTURE_OR_INCOMPLETE_BAR`, `BAR_SEQUENCE`, `OHLCV` |
| Metadata list and binding | `RECEIPT_BINDING` for wrong list length/density/record shape/index/open binding, checked for the whole list before scalar admission |
| Per-bar admission, ascending index | Helper errors `RECEIPT_TIME`, `NOT_YET_RECEIVED`, `ASSUMPTION_TIME`, `ASSUMPTION_ID`, `TIME_OVERFLOW`, `NOT_YET_ASSUMED_PUBLISHED`; retain helper scalar-validation order |
| Price pattern | `AMBIGUOUS_PIVOT` or `NOT_A_PIVOT` |
| Strict next boundary | `TIME_OVERFLOW` if multiplication/result is unsafe or not strictly after decision |

Propagate internal helper errors exactly. No epsilon for time, comparisons or bindings.

## Hand vectors — not executed

Use three bars starting at0, T, 2T, exclusive closes T, 2T, 3T; T=14400000 for4H or86400000 for1D. Each volume1; widths1/1. Base OHLC tuples are `(8,10,7,9)`, `(10,12,8,11)`, `(10,11,9,10)`: HIGH price12, index1, g=3T. Actual base receipts equal each close; decision=3T. Expected admittedAt=3T and hypothetical entry=4T. Run the same expectations for both durations in a future implementation.

| Change | Hand expectation |
|---|---|
| Left receipt=3T+5, decision=3T+5; others at close | admittedAt=3T+5, g remains3T; next boundary4T |
| Any receipt=its close−1 | `RECEIPT_TIME` |
| Left receipt=3T+5 but decision=3T | `NOT_YET_RECEIVED` |
| Left high12 plus left receipt3T+5, decision3T | `NOT_YET_RECEIVED`; no pattern verdict |
| Left high becomes12 (other OHLC unchanged) | Left tie disqualifies HIGH; LOW false → `NOT_A_PIVOT` |
| Right high becomes12 | Right tie allowed → HIGH12 |
| Candidate becomes `(10,12,6,11)` | HIGH and LOW true → `AMBIGUOUS_PIVOT` |
| Candidate high becomes11, left high becomes11 | Valid OHLC but no strict left high; no LOW → `NOT_A_PIVOT` |
| Reflect all prices x→20−x and exchange high/low | LOW price8; same time/admission; tied-left LOW rejected, tied-right LOW allowed |
| Swap two metadata entries unchanged | `RECEIPT_BINDING`, no sorting |
| Assumed delay5, archive receipts each4T, decision3T+5 | g3T; admittedAt3T+5; next4T; archive4T preserved after decision, authenticity remains false |
| Same assumed input with decision3T | `NOT_YET_ASSUMED_PUBLISHED` |
| decision exactly4T, otherwise base | Earliest hypothetical entry5T, never4T |
| Extra or missing bar / width0 or33 / NaN price | `PIVOT_WINDOW` / `PIVOT_WINDOW` / `OHLCV`, respectively |
| Aligned three-bar window ending at floor(MAX_SAFE_INTEGER/T)×T, decision MAX_SAFE_INTEGER | Valid geometric window; next aligned boundary exceeds safe range → `TIME_OVERFLOW` |
| Same near-limit window, assumed delay=T with valid archive times | Derived publication overflow → `TIME_OVERFLOW` before next-boundary derivation |

Future cases: schemas, unsafe/string times, gaps, bindings and mutation isolation.

No tests run. Implementation needs separate review/tests. No wave/entry logic, history or trading. Frozen dispositions and unresolved budget stay unchanged.
