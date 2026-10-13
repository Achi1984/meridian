# Hypothetical replay time admission V1

Pure function: `planReplayTimeAdmission` in `replay-time-admission.mjs`.
Tests: `node --test test/replay-time-admission.test.js` from repository root.
This is timing metadata only, not a replay runner, strategy or execution engine.

Input has exactly six fields: mode, assumptionId, publicationDelayMs,
decisionAtMs, archiveRetrievedAtMs and candleCloseTimesMs. All time values are
nonnegative safe integer milliseconds. Exactly 201 consecutive UTC daily close
boundaries are required. The actual archive receipt must follow every close.

Only ASSUMED_PUBLICATION_V1 is supported. The caller must provide a versioned
assumption identifier and an explicit nonnegative delay. No default delay is
selected by this implementation. For each candle, assumed publication equals
close plus that delay; overflow is rejected. The simulated decision must be at
or after all assumed publications, but less than one day after the latest close.
Equality at assumed publication passes; equality at the next daily close fails.

Archive receipt remains separately returned and unchanged. The prototype does
not create or overwrite an availableAtMs field and cannot be passed directly
as a P1 bar window. The actual-receipt contract in trend-pullback.mjs is intact.
An evidence-backed label is rejected: authenticating historical publication,
version hashes and revision histories requires a separate future implementation.

valid:true means only that this supplied timing assumption is internally
consistent. It does not authenticate an assumption registry, prove historical
availability, validate prices/universe, or grant permission to execute anything.
All returns mark historicalAvailabilityVerified and execution flags false.
Successful returns also mark revisionHistoryVerified false. The output is
hypothetical and cannot be promoted to evidence by changing a label.

For a future experiment, freeze the assumption specification and its content
hash before looking at outcomes. A version name alone cannot prevent a caller
from changing its delay; enforcing the frozen manifest is a runner responsibility.
No evidence-backed mode, archive-date rewriting, strategy evaluation, return
calculation, state machine, costs, sizing, fills, scheduler or live integration
is introduced here. Tests use synthetic timestamps only.
