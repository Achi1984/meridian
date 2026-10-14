# P1 numerical core and explicit assumed-history timing

This change is an offline engineering separation, tested only on synthetic fixtures. It does not run repository market history, compute returns, size positions, generate orders, authorize research execution, or establish historical availability/revision evidence. C1 and historical fill simulation remain deferred.

## Three entry points

- `evaluateTrendPullback` retains the original public `{bars, asOfMs, position}` API and actual `availableAtMs` checks. All 201 bars must have been available by the decision, monotonically received, completed, contiguous and fresh. Existing validation order is preserved. Its signal shape remains unchanged.
- `evaluateTrendPullbackCore({bars, decisionAtMs, position})` computes the unchanged P1 SMA200, Williams %R, ATR, exit priority and candidate stop after raw-window and position validation. Raw bars contain exactly `openTimeMs`, `closeTimeMs`, `open`, `high`, `low`, `close`, `volume`. It validates daily contiguity, shape, prices, position and decision/window bounds, **but does not admit actual or assumed publication times**. Every result carries `timeAdmissionPerformed:false`. A valid core signal is not a time-admitted signal.
- `evaluateTrendPullbackReplay` combines the core with the unchanged `planReplayTimeAdmission` contract. It supports only the explicit assumed-publication mode. It returns `{valid:true, signal, timing, historicalAvailabilityVerified:false, revisionHistoryVerified:false, executionAuthorized:false, researchOnly:true}`. Failure returns `valid:false`, an error, `action:'NONE'` and the same denial/evidence flags.

The replay adapter requires exactly:

```js
{
  schemaVersion: 'MERIDIAN_P1_ASSUMED_HISTORY_V1',
  mode: 'ASSUMED_PUBLICATION_V1',
  assumptionId: 'SYNTHETIC_FIXTURE_1',
  publicationDelayMs: 1000, // explicit assumption, including explicit zero if intended
  decisionAtMs,           // hypothetical historical decision
  archiveRetrievedAtMs,  // observed archive receipt, preserved without backdating
  bars,                  // exactly 201 raw daily OHLCV bars, no availableAtMs
  position: null         // or exactly {entryAtMs}; within window and not future
}
```

Its `timing` object keeps actual archive receipt and the separately named `assumedPublicationTimesMs` array. A receipt before a candle close, unsafe timestamps, unsupported/evidence-backed modes, missing/extra keys, invalid OHLCV, gaps, incomplete/future candles and stale windows are rejected. Assumptions never establish publication evidence or historical revision correctness. Raw values may include later corrections; this adapter cannot detect that.

No caller input is modified. No reconstructed bars or `signalAvailableAtMs` are returned. Feeding raw bars or the replay output directly into the live wrapper fails schema validation; using actual later archive receipt as live availability fails the original time guard. This is API separation, not an authentication boundary: a caller could fabricate input timestamps, and neither pure module can prove their provenance.

## Verification and scope

Run `node --test test/trend-pullback.test.js test/replay-time-admission.test.js test/trend-pullback-replay.test.js test/p1-synthetic-runner.test.js`.

The existing live (13), replay-admission (10) and P1 synthetic adapter (13) tests are unchanged. Seven new tests cover synthetic math equivalence under matching explicit publication assumptions, entry/exit/no-action cases, immutable receipt provenance, rejection at the live boundary, exact schema/evidence-claim rejection, time boundaries, invalid data and the core's non-admission status. Synthetic equality is a refactoring check, not independent historical strategy validation or profitability evidence.
