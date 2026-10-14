# Elliott already-open synthetic path contract — design only

Identity: `ELLIOTT_ALREADY_OPEN_PATH_DRAFT_V1`. Status: `SOURCE_DESIGN_ONLY`; no adapter is implemented by this packet. Basis: `ELLIOTT_CORRECTION_CONTRACT_DRAFT_20261014.md` and `ELLIOTT_CORRECTION_HELPERS.md`. The existing helper module remains unchanged (SHA-256 `6bcbd374679f8b1a412c0a2a33e7cce32d7a9f417c2c3726b2ca82bc4a4c2e08`). This is a proposed pure, bounded replay of one supplied **already-open** synthetic position, not an Elliott signal/entry engine or an authenticated execution model.

## Exact proposed API

Proposed export: `replayAlreadyOpenSyntheticPath(input)`. All records have exactly the keys below, plain JSON-style objects; reject missing/extra keys, unsupported literals, coercion, sparse arrays and custom array properties. Inputs remain unchanged. No persistence, resume state, callbacks, networking, external receipts or signal objects are accepted.

```js
{
  schemaVersion: 'ELLIOTT_ALREADY_OPEN_PATH_DRAFT_V1',
  fixtureId: 'example',
  timeframe: '4H',
  asOfMs: 28800000,
  mode: 'NEXT_BAR_BREAK_EVEN',
  initialPosition: {
    side: 'LONG', entryAtMs: 1, entryPrice: 121,
    originalStopPrice: 110, initialQuantity: 2,
    targets: [130, 140]
  },
  quoteCurrency: 'SYNTH_QUOTE',
  stopSlippagePrice: 0,
  costs: {
    entryCostQuote: 0, target1CostQuote: 0, target2CostQuote: 0,
    fullStopCostQuote: 0, residualStopCostQuote: 0
  },
  bars: [{openTimeMs: 14400000, closeTimeMs: 28800000,
          open: 125, high: 129, low: 120, close: 128, volume: 1}]
}
```

`fixtureId`: 1–40 ASCII letters/digits/underscore/dot/hyphen. `quoteCurrency`: existing helper grammar (1–16 uppercase letters/digits/underscore, first a letter). Modes exactly `NEXT_BAR_BREAK_EVEN` or `NO_RELOCATION`; no default. `side` exactly `LONG` or `SHORT`. Entry, original stop, two targets and initial quantity are positive finite numbers. Targets are exactly two, strictly profitable and ordered farther from entry in the side's profit direction. Each target exits **500000 initial PPM**, never half the then-remaining amount. No caller-controlled portions or pre-existing exits.

Let `s=+1` for LONG and `-1` for SHORT. `D=s*(entryPrice-originalStopPrice)` and `initialQuantity*D` must be positive finite; zero from underflow rejects. D remains immutable throughout replay, including after stop relocation. Target admission does not establish that the supplied entry really occurred. `entryAtMs` is a nonnegative safe integer strictly less than the first bar's opening: bootstrap is fully open with no prior exits and original stop active. This is a supplied fixture premise, not a simulation of the interval between entry and the first bar. No entry bar is processed.

Bars: 1–256 exact raw OHLCV records as shown, UTC aligned to `4H` (14400000 ms) or `1D` (86400000 ms). All timestamps and `asOfMs` are nonnegative safe integers. Exclusive close equals open plus duration, safely representable, and is at/before `asOfMs`. Bars are ordered and exactly contiguous, without duplicates; positive finite OHLC satisfy low ≤ open/close ≤ high; volume is finite and nonnegative. Validate the whole input, including bars after a modeled closure, before any replay. Do not sort, fill gaps, transform candles or aggregate. There is no freshness rule beyond closure and no claim of publication admission. A closed bar available at the replay's supplied horizon is **not** thereby known before its own opening.

`stopSlippagePrice` is an explicit finite nonnegative **absolute price amount**, not a percent or R rate. Costs are each explicitly null (unknown) or finite nonnegative quote-unit totals. All five keys are required even if unused. Full-stop cost means the total for a 1000000-PPM exit; residual-stop cost the total for a 500000-PPM exit; each target cost the total for its 500000-PPM exit. These are supplied fixture costs, not inferred fees, per-unit rates or costs to multiply by the exit portion again.

## Fixed bootstrap and state transitions

Internal/final state has exactly `{originalRiskDistance, effectiveStopPrice, remainingPortionPpm, target1Filled, target2Filled, pendingBreakEvenAtMs, closed}`. Start with D, original stop, 1000000, false, false, null, false. All results are new values, not mutations of caller objects. At most two exit events are possible; retain the full ledger. Only exact zero residual means closed. There is no automatic terminal liquidation or mark-to-market.

For each bar, if not closed:

1. **Activate a previously pending BE** when this bar opens at `pendingBreakEvenAtMs`. Set effective stop to entry, clear pending. With valid initial risk this is max(originalStop,entry) for long and min for short. `NO_RELOCATION` never schedules BE.
2. **Opening stop:** long open ≤ effective stop or short open ≥ effective stop exits the entire residual. Base fill is opening price (including equality). Fill is base minus slippage for long, base plus slippage for short. Close; do not process targets.
3. **Opening targets:** for each unfilled target in TP1 then TP2 order, long open ≥ target / short open ≤ target fills 500000 at that target's declared price. No favorable gap improvement. If both are crossed, fill both in order and close, even if the later bar range touches the former stop. After TP1 alone, queue BE at this bar's exclusive close in BE mode, but keep the original effective stop for the rest of this bar.
4. **Remaining range stop:** if still open and long low ≤ effective stop / short high ≥ effective stop, exit the entire residual at stop minus/plus slippage. If the range also reaches any still-unfilled target, mark this stop event `AMBIGUOUS_STOP_FIRST`; its target produces no exit. Otherwise ambiguity is `NONE`. This is a named OHLC convention, not proof of the actual within-bar sequence or a universal worst-case bound.
5. **Remaining range targets:** only when step 4 did not stop, fill reached unfilled targets at declared price, in TP1 then TP2 order. Queue BE after TP1 alone as above. An entry-level return within this bar cannot trigger that newly queued stop. TP2 or a stop closes and clears any pending BE.

After closure skip all further path decisions; those bars were still validated. At the end an unactivated BE may remain pending at the last close, even if `asOfMs` is later. Without the next bar, do not activate it or invent a fill. Replay from full bootstrap is the only API; final state is diagnostic and is not accepted as resume input.

**Explicit refinement of the earlier draft:** opening targets precede a later range stop, after opening-stop protection. Known opening chronology must not be called ambiguous. The earlier draft's stop-first rule now applies only to unresolved *remaining range* orders. When only TP1 is crossed at opening, it fills first; a later same-bar original-stop touch closes its residual. Both targets crossed at opening close before later range checks. Target fills are still an explicit synthetic order/fill assumption: a chart line, opening print or range touch alone is not venue fill evidence. Range event order and target-price gap treatment remain model conventions.

No stop fill may be clamped to zero: nonpositive or nonfinite modeled fill rejects the **whole replay**, with no partial output ledger. Slippage may put a modeled fill outside observed OHLC; that is an explicit adverse proxy, not an observed print. The same amount applies to full and residual stop fills; target fills receive no slippage adjustment.

## Exact result and failure shapes

Every output includes these six fixed flags: `researchOnly:true`, `executionAuthorized:false`, `empiricalRunAuthorized:false`, `historicalAvailabilityVerified:false`, `revisionHistoryVerified:false`, `receiptAuthenticated:false`.

Success keys exactly `{valid:true, schemaVersion, fixtureId, mode, finalState, events, accounting, ...flags}`. `schemaVersion` echoes the contract tag. `finalState` is the seven-key record above. `events` is a new ordered array with records exactly:

```js
{eventId, kind, barIndex, barOpenTimeMs, barCloseTimeMs,
 phase, modeledFillTimeMs, portionPpm, fillPrice, costQuote, ambiguity}
```

`kind` is `TP1`, `TP2` or `STOP`; `phase` is `OPEN` or `RANGE_PROXY`; `barIndex` is zero-based. IDs are deterministic `fixtureId + '.' + barIndex + '.' + kind`, unique within the ledger. `modeledFillTimeMs` is bar open for OPEN, **null** for RANGE_PROXY. Bar bounds locate a proxy event without inventing an intrabar timestamp. These are modeled times, never receipt/availability timestamps. `ambiguity` is `NONE` or `AMBIGUOUS_STOP_FIRST`, only the latter for step 4 conflict. No synthetic BE activation is disguised as a quantity exit event; its effect is determined by mode, preceding TP1 event and state transition rules.

`accounting` keys exactly `{grossRealizedR, netRealizedR, knownCostQuote, costStatus, exitedPortionPpm, remainingPortionPpm, closed}`. Use the unchanged signed-fill helper's arithmetic: sum `(portionPpm/1000000)*s*(fill-entry)/D`, subtract `(entryCostQuote + executed exit costs)/(initialQuantity*D)` for net. Entry cost is charged once, even while entirely open; consumers must inspect residual and closed before describing a completed trade. Only **used** costs matter: entry plus emitted exits. An unknown used cost gives net null and `COSTS_UNRESOLVED`; an unknown untriggered target/stop cost does not. Known costs sum explicitly supplied used amounts only. All used zero costs give `SYNTHETIC_ZERO_COSTS` (numeric label, not provenance); otherwise `EXPLICIT_QUOTE_COSTS`. Residual state and accounting must agree exactly. No realized loss or residual can disappear under a BE label.

Failure keys exactly `{valid:false,error,...flags}`; no partial computed events/state. Deterministic first failure uses this validation order:

| Stage | Codes and conditions |
|---|---|
| Top-level shape/literals | `INPUT_SCHEMA` for wrong/missing/extra keys, schema, fixture identity or record shapes; `UNSUPPORTED_MODE`; `QUOTE_CURRENCY` |
| Bar validation | Existing `TIME_CONTRACT` for timeframe/asOf; `BARS_LENGTH` for outside 1–256 or non-dense array; then each bar in order: `BAR_SCHEMA`, `BAR_TIME`, `FUTURE_OR_INCOMPLETE_BAR`, `BAR_SEQUENCE`, `OHLCV` using the helper's rules |
| Bootstrap/geometry | `INITIAL_POSITION_TIME` for entry timestamp invalid/not before first open; `INVALID_INITIAL_RISK` for side/entry/stop/quantity or D invalid; `INVALID_TARGET_GEOMETRY` for target count/shape/profit/order |
| Slippage/costs | `INVALID_SLIPPAGE` for invalid amount; `INVALID_COST` in entry, TP1, TP2, full stop, residual stop key order |
| Computed quantities | `NUMERIC_RANGE` for normalization underflow/overflow or nonfinite arithmetic; `FILL_PRICE` for a modeled stop fill ≤0 or nonfinite |

Structural nested record errors precede scalar validation. Numeric normalization is checked before replay; event fill validity before accounting arithmetic. Existing helper validations may be reused internally but must not loosen caps or invent defaults. Floating R comparisons in future bounded rational tests may use 1e-12 absolute tolerance; timestamps, PPM, geometry and ordering have no epsilon. Reject rather than silently rescale extreme numbers. This is not a decimal currency/venue rounding contract.

## Hand-calculated acceptance vectors — NOT executed tests

Each row starts a new fixture unless it explicitly supplies two bars. Long base: entry121, original stop110, TP1=130, TP2=140, D=11, quantity2; BE mode, zero slippage and all zero costs unless stated. `OHLC` is `(open,high,low,close)`. Bars start at 14400000, advance by 14400000, volume1, entryAt1; asOf equals final close. The same vectors must later be tested on 1D aligned intervals. All results below are design expectations, not newly run simulations or research results.

**Mirrored short for every row:** reflect every price x to `242-x`, swap high/low after reflection: entry121, stop132, targets112/102. For example long stop-gap open90 becomes short open152, and a long fill89 with slippage1 becomes short153. D, event kinds/order, residual PPM and signed R must match. All reflected fixture prices remain positive.

| Case / long OHLC | Expected exits in order | Residual / gross R |
|---|---|---|
| A: `(90,95,89,92)` | OPEN STOP 1000000 at90 | 0; `-31/11` |
| A with slippage1 | OPEN STOP 1000000 at89 | 0; `-32/11` |
| B: `(125,141,109,125)` | RANGE STOP 1000000 at110; `AMBIGUOUS_STOP_FIRST`; no targets | 0; `-1` |
| C: `(135,139,109,125)` | OPEN TP1 500000 at130; RANGE STOP 500000 at110, ambiguity NONE | 0; `(4.5-5.5)/11 = -1/11` |
| D: `(145,146,109,125)` | OPEN TP1 at130 then OPEN TP2 at140, each500000; later low ignored | 0; `(4.5+9.5)/11 = 14/11` |
| E: `(125,131,120,128)` | RANGE TP1 500000 at130; no same-bar BE at121 | 500000; `4.5/11`; effective stop110, BE pending at next open |
| E then `(120,125,119,122)` | Prior TP1; next OPEN STOP 500000 at120 after BE activation | 0; `(4.5-0.5)/11 = 4/11` |
| E then that bar, slippage1 | Prior TP1; next OPEN STOP 500000 at119 | 0; `(4.5-1)/11 = 3.5/11` |
| E then `(125,129,121,122)` | Prior TP1; next RANGE STOP 500000 at121, ambiguity NONE | 0; `4.5/11` |
| E then `(115,120,109,112)`, NO_RELOCATION | Prior TP1; next RANGE STOP 500000 at110 | 0; `-1/11`; no BE pending ever |
| `(125,129,120,128)` | No exits | 1000000; `0`; open, no terminal marking |

Cost vector: E then BE gap120 with entry cost1, TP1 cost0.5, residual-stop cost0.5: used total2 quote, denominator22, gross `4/11`, net `3/11`. TP2/full-stop costs may be null because unused. Change residual-stop cost to null: gross remains `4/11`, net null, known costs1.5. No-exit vector with entry cost1 has gross0/net `-1/22`, still fully open. Mirrored short results are identical.

Required future rejection vectors: missing/extra keys and unsupported mode; malformed/sparse 0/257 bars; nonfinite OHLC, bad volume, gaps/duplicates, wrong duration, future close, unsafe timestamps; entry at/after first open; wrong side, nonpositive D/quantity, reversed/equal/behind-entry targets, other target count; missing/negative/string costs or slippage; normalization zero/overflow; long stop110 with slippage110 yields fill0 and rejects atomically. Assert inputs unchanged on every success/failure. Repeat invocation must reproduce the same ledger, not append to it. Preserve the eight original frozen characterization tests unchanged in a later implementation packet.

## Deliberate boundary and next gate

There is no pivot detector, signal construction, entry scheduler, receipt adapter, mark-to-market, strategy comparison, historical replay, candidate registration or trial-count change. Future entry integration must bind the **exact validated pivot pattern, its confirmation bars/timeframe, geometric confirmation result, actual/explicitly assumed admission result and resulting signal/entry**. Ordering arbitrary supplied timestamp scalars does not establish that linkage. Historical archive receipt must stay separate from assumed publication; none of these bar paths authenticate either. That future work is outside this adapter.

Next permissible engineering packet is implementation against independently reviewed design plus executable synthetic acceptance tests, with its own review. This document itself runs no tests. Frozen Wave3/Wave5 sources, historical results and stopping rules remain unchanged; Wave3 remains unpromoted and Wave5 rejected. Cumulative budget reconciliation stays unresolved. No empirical run, profitability claim, Paper/Live promotion, trading, merge or scheduler authorization follows.
