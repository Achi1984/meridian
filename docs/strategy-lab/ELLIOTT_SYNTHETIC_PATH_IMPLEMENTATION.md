# Elliott synthetic already-open path adapter

Implements `ELLIOTT_SYNTHETIC_PATH_CONTRACT_20261014.md` (reviewed contract SHA-256 `b413dad889e6ec5e36ef74e771d8d0c814ae099753bc0310d310d76839e69c8b`, published at `3cf09edc`). Export: `replayAlreadyOpenSyntheticPath` in `elliott-synthetic-path.mjs`. This is a bounded synthetic path proxy, not an integrated Elliott strategy or entry engine.

The exact input and output schemas are those of the contract. The adapter bootstraps a full already-open position and validates all 1–256 contiguous closed raw 4H/1D bars, including any tail after closure. It reuses unchanged bar, target-geometry and signed-accounting helpers; local shape/cap checks preserve the narrower contract. Errors return only `{valid:false,error,...flags}`, with no partial state. Costs are validated before computed normalization; per-bar sequence errors precede OHLC errors. Arrays and records reject custom keys, including symbol keys.

Processing order is active opening stop, opening targets, then remaining range stop before remaining range targets. Only unresolved range conflicts receive `AMBIGUOUS_STOP_FIRST`. Target fills use declared prices without favorable gap improvement. TP1/TP2 each exit 500000 initial PPM. BE activates only on the next supplied bar; an end-of-input pending BE remains pending. `NO_RELOCATION` retains the original stop. Original risk distance stays fixed. Stop slippage is an explicit adverse absolute price amount, and invalid modeled fills reject the entire result without clamping.

Events retain bar bounds. Opening events have a modeled opening timestamp; range events have null exact fill time. Neither asserts receipt, actual execution or observed intrabar order. Only entry and emitted exit costs affect accounting; explicit null used costs preserve gross and set net null. Full-stop and residual-stop costs are separate supplied quote totals, not rates. Full entry cost is charged even on an open position. Inspect residual and closure before calling any result a completed trade. A zero-cost label is not provenance.

## Local synthetic verification

Command from repository root:

```sh
node --test test/elliott-synthetic-path.test.js test/elliott-correction-helpers.test.js test/elliott-frozen-characterization.test.js
```

Result: **35/35 tests pass**: 10 path tests, 17 existing helper tests and 8 unchanged frozen-characterization tests. Four matrix tests each execute 19 hand-derived path vectors, covering LONG/SHORT × 4H/1D. These compare complete output shapes, flags, event identities/order/times/fills, final state and accounting, allowing 1e-12 tolerance only for rational R arithmetic. They also verify input immutability, deterministic replay and no output-mutation leakage.

Other tests cover explicit/unknown used costs, entry cost while open, malformed schemas/types/arrays/OHLC/time/geometry, caps 256/257 for both sides and timeframes, invalid future tail after closure, error precedence, nonpositive/overflowed stop fills including rejection after a partial event, normalization underflow, subnormal-risk contribution overflow, pending final BE and equality opening stops. This is bounded synthetic coverage, not exhaustive venue simulation. No network or market history is used by these tests.

The helper remains byte-identical, SHA-256 `6bcbd374679f8b1a412c0a2a33e7cce32d7a9f417c2c3726b2ca82bc4a4c2e08`. Frozen modules and all previous tests are unchanged. New files are only this document, the path module and its test file.

All outputs retain `researchOnly:true`, `executionAuthorized:false`, `empiricalRunAuthorized:false`, `historicalAvailabilityVerified:false`, `revisionHistoryVerified:false`, `receiptAuthenticated:false`. Closed bars do not establish availability at opening. No signal/pivot/admission linkage, entry adapter, sizing, persistence or historical runner is implemented. Future signal integration must bind validated pivot evidence and its actual or explicitly assumed admission to the exact signal and entry; supplied timestamp ordering alone is insufficient. No empirical trials, cumulative budget reconciliation, profitability claims, candidate reopening, execution permission or repaired-engine completeness follows. Independent review of this new implementation is separate from earlier contract/helper reviews.

## Scoped static review follow-up

Claude response `6162232160` reviewed source head `01db51d` and returned `GREEN_SOURCE_ONLY` with no blockers. This was static review: Claude **did not run tests**. The follow-up modifies tests and this document only; the adapter remains byte-identical, SHA-256 `792ec0309c9995e6b5b141b87c0d8959653dd81b101a963cf8c6a54c26039ed6`.

The expanded matrix includes opening TP1 with a pending stop, its next-bar gap, later TP2, an intermediate no-fill bar retaining active BE, a third-bar opening exactly at BE, and adverse range-stop slippage outside OHLC. An additional test supplies native SHORT geometry (entry200/stop220/targets180/160) independent of the mirrored242 fixtures and explicitly asserts out-of-range slippage in both directions and timeframes. These are local synthetic test results, distinct from Claude's static review; they do not validate venue fills or profitability.

The API expects **trusted plain JSON data records, without getters or proxies**. Existing shape checks do not establish that an object is accessor-free or prevent proxy behavior. Any future external integration must provide an appropriate data-only boundary before calling the adapter. This packet does not alter source validation or claim to solve arbitrary JavaScript object execution hazards.
