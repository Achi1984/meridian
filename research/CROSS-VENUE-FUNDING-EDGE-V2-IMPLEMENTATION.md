# Cross-Venue Funding Edge V2 — Implementation & Source Contract

Status: **FROZEN IMPLEMENTATION CANDIDATE BEFORE V2 SOURCE AUDIT / PNL**  
Ruleset: `CROSS-VENUE-FUNDING-EDGE-V2`  
Execution impact: `false`  
Auto-promotion: `false`

This document instantiates the already-frozen V2 preregistration without changing its hypothesis, economics, gates or venue pair. No V2 Source Audit, strategy PnL, Discovery, Validation, Holdout, Paper or Live stage is authorized by this implementation PR.

## Pre-contract coverage evidence

The exact source boundaries were derived before V2 source collection or strategy PnL by the source-availability-only probe preserved in `research/CROSS-VENUE-FUNDING-EDGE-V2-COVERAGE-EVIDENCE.json`.

Probe run: `37280311203`  
Probe HEAD: `80e7afddc7849197b608875bf6d6abec4f1b9bce`

The probe emitted no rates, prices, signals, positions or PnL. The final V2 source contract embeds the probe run/head and the four provider evidence SHA-256 values, so every later source receipt is cryptographically bound to the pre-result coverage decision.

Frozen boundaries:

- raw start: `2022-03-01T00:00:00.000Z`
- fundingCoverageEnd: `2026-09-30T08:00:00.000Z`
- markCoverageEnd: `2026-10-03T23:00:00.000Z`
- coverageEnd: `2026-09-30T08:00:00.000Z`
- decisionWindowEnd: `2026-09-29T00:00:00.000Z`
- decision reserve: 26 hours

The OKX September 2026 monthly funding archive is therefore intentionally not assumed to contain a 2026-09-30 16:00 UTC settlement. The contract stops at the objectively available common funding boundary proven before any V2 result.

## Explicit source fields

No V2 normalizer uses alias chains.

Accepted normalized funding fields are exactly:

- `fundingTime`
- `fundingRate`

Accepted normalized mark fields are exactly:

- `openTime`
- `open`
- `high`
- `low`
- `close`
- `confirmed`

Provider parsers are responsible for mapping provider-specific schemas into these explicit fields. Blank, boolean, array, object, NaN or non-numeric numeric fields are rejected; they are never coerced to zero.

## Frozen settlement grid

For each venue independently:

- scheduled settlements: 00:00 / 08:00 / 16:00 UTC
- tolerance: ±1 second
- automatic interval adaptation: forbidden

A raw funding record outside this grid remains in raw provenance but is an `OFF_GRID_FUNDING` integrity event and never becomes a common decision timestamp.

A provider interval change (including synthetic 4h cadence) therefore produces integrity events and does not redefine the V2 grid.

## Duplicate funding

Two or more authoritative funding records mapping to the same venue + scheduled timestamp are a `DUPLICATE_FUNDING` integrity event, whether rates agree or disagree.

No rate is selected from that duplicate set. The timestamp is ineligible as a common decision timestamp.

Duplicate mark rows similarly produce `DUPLICATE_MARK` and no row is selected.

## Missing source and DATA_DEGRADED

A venue enters `DATA_DEGRADED` when any frozen V2 integrity event becomes observable, including:

- missing scheduled funding after its +1 second tolerance;
- authoritative off-grid funding;
- duplicate funding;
- missing 1h mark;
- duplicate 1h mark;
- unconfirmed required mark;
- source/archive/provenance or deterministic parser failure.

No missing value is synthesized, interpolated, forward-filled or chosen by heuristic.

## Event ordering and entry tie

Integrity detection is processed before authorizing a new entry for later timestamps.

For the exact tie case where a pending entry fill timestamp equals the degradation detection timestamp, V2 treats the fill as already open for fail-closed research classification.

Therefore:

- position already open at detection => `INCONCLUSIVE`
- pending fill time < detection => `INCONCLUSIVE`
- pending fill time == detection => `INCONCLUSIVE`
- pending fill time > detection => pending entry is blocked, but a flat run is not automatically INCONCLUSIVE

## INCONCLUSIVE is terminal inside V2

If a position is open at the beginning of any degradation episode, the affected V2 stage becomes `INCONCLUSIVE` immediately.

For that affected position V2 models no:

- exit price;
- basis realization;
- post-detection funding path.

`INCONCLUSIVE` means the stage is not passed and cannot progress. It cannot be healed inside V2 by changing the window, data, recovery rule, source handling, parameters or later observations.

Any successor attempt requires a new, independently preregistered ruleset.

## Recovery

Flat runs remain entry-blocked until Recovery.

Recovery at common settlement timestamp `T` requires all of:

1. three consecutive common on-grid scheduled settlements after the latest integrity event;
2. no new integrity event with `detectionTime <= T` before the third settlement;
3. complete, unique, confirmed hourly marks for both venues from the first required hourly candle after the latest degradation reset through the last candle that has closed by `T`, i.e. through `openTime = T - 1h`.

The candle with `openTime = T` closes only at `T + 1h` and cannot affect a Recovery decision at `T`.

A funding-only recovery cannot reopen entries while mark integrity is still unresolved. An integrity event whose `detectionTime > T` cannot retroactively block Recovery at `T`.

## Entry source completeness / freshness

A V2 entry decision at common funding timestamp `t` may use only information available by `t`.

Entry can be eligible only when:

- integrity state is `HEALTHY`;
- both venues have exactly one authoritative on-grid funding record at each of `t-16h`, `t-8h` and `t`;
- the decision timestamp is within the frozen decision window;
- the last fully closed hourly mark before the decision, `openTime = t-1h`, is unique and confirmed on both venues;
- the latest three common spreads are formed only from completed eligible common funding timestamps.

The entry execution reference remains the mark OPEN at `t+1h`. The decision at `t` must not inspect whether that future candle will later be complete, unique or confirmed.

If an ENTRY decision is active and the `t+1h` entry candle on either venue is later found missing, duplicated, unconfirmed or otherwise invalid at its causal detection time `t+2h`, the entry is treated as already open/in execution for fail-closed research classification and the affected stage becomes terminal `INCONCLUSIVE`. The anomaly must never be converted retrospectively into “no entry”.

Missing, duplicate or unconfirmed information already observable by `t` blocks the entry as freshness/integrity failure. Information with a later detection timestamp cannot influence the decision at `t`.

## Split

The 60/20/20 chronological split is still computed from all valid common canonical decision timestamps inside the frozen V2 decision window, independent of strategy PnL or entry eligibility.

For `N` sorted common timestamps the frozen rounding rule is identical to V1: Discovery is indices `[0, floor(0.60N))`, Validation is `[floor(0.60N), floor(0.80N))`, and Holdout is the remainder `[floor(0.80N), N)`.

A timestamp made ambiguous by duplicate funding is not a valid common decision timestamp because no venue value is selected.

## Strict V2 economics

V2 does **not** import the coercive numeric helpers from `research/cross-venue-funding-edge-v1.js`.

All V2 numeric inputs are validated before conversion. Invalid accounting or strategy inputs fail closed.

The retained economic constants are unchanged from preregistration:

- 10,000 USDT notional per leg
- 20,000 USDT research capital
- Binance taker 5 bps/fill
- OKX taker 5 bps/fill
- baseline slippage 3 bps/fill
- stress slippage 6 bps/fill
- operational contingency 5 bps one-leg per completed cycle
- baseline round trip 37 USDT
- stress round trip 49 USDT
- entry hurdle >55.50 USDT
- close hurdle 24 USDT
- basis loss limit -100 USDT
- maximum holding horizon 24 hours

Funding accounting remains authoritative and exactly once:

- LONG: `-qty * mark * rate`
- SHORT: `+qty * mark * rate`

Entry-time funding is never credited.

## Accounting reconciliation

Every synthetic or later authorized research cycle must reconcile:

`endingEquity = startingEquity + fundingCashflow + basisPnl - totalCosts`

A mismatch is an accounting error and blocks progression.

Baseline and stress must use the identical trade-path identity and quantities. Stress may differ only in the frozen slippage assumption (3 bps vs 6 bps per fill).

## Collector self-lock

The V2 collector checks `CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK.sourceAudit` itself before any network access.

With the current frozen V2 lock (`PREREGISTERED`, `sourceAudit:false`) it must throw immediately.

The workflow also gates the source job, but workflow gating never substitutes for the collector self-check.

## Stage isolation

Current authoritative V2 lock remains unchanged:

- stage: `PREREGISTERED`
- Source Audit: false
- Discovery: false
- Validation: false
- Holdout: false
- Paper: false
- Live: false

This PR is implementation/source-contract only. A later reviewed stage-transition PR is required before any V2 source collection can execute.

## Runner contract addendum — frozen before any V2 strategy PnL

Status of this addendum: **IMPLEMENTATION CONTRACT ONLY — NO RUNNER EXECUTION / NO DISCOVERY AUTHORIZATION / NO PNL**.

The historical stage-isolation text above describes the earlier source-contract implementation PR. The authoritative stage lock now remains separately frozen at `SOURCE_AUDIT` with `sourceAudit:true` and `discovery/validation/holdout/paper/live:false`. This addendum does not change that lock.

### Strict boolean API guards

- `entryInputsReady.activeDegradation` is mandatory and must be a boolean. Any string, numeric, null or undefined value throws `CROSS_VENUE_V2_INVALID_DEGRADATION_FLAG`.
- `entryFillIntegrityOutcome.entryActive` is mandatory and must be a boolean. Invalid values throw `CROSS_VENUE_V2_INVALID_ENTRY_ACTIVE_FLAG`.
- `exitDecision.integrityOk` no longer defaults to healthy; omitted/non-true values fail closed as data-integrity failure.
- Raw-number equity reconciliation is retired from the public V2 primitive surface. Reconciliation is through a verified event-sourced ledger object only.

### Deterministic runner event order

The only runner ordering key is `runnerEventKey(event)`:

`(time_ms, phaseRank, venue, kind, stableId)`

Equal timestamps use these immutable phase ranks:

1. `FUNDING_SETTLEMENT`
2. `EXIT_FILL`
3. `ENTRY_FILL`
4. `INTEGRITY_DETECTION`
5. `COMMON_DECISION`
6. `EXIT_DECISION`

The complete key must be unique. Duplicate keys are a hard error.

Consequences:

- a detection tied with an entry fill sees the entry as open and is terminal `INCONCLUSIVE`;
- a detection tied with an exit fill still treats the position as open through that timestamp and is terminal `INCONCLUSIVE`;
- a detection tied with a common decision is processed first and blocks a new pending entry;
- no alternate sorting path exists in the runner.

### Frozen time rules

- Entry fill: first complete 1h mark OPEN strictly after the decision timestamp, structurally `t+1h`.
- Exit fill: first complete 1h mark OPEN strictly after exit decision, structurally `exitDecision+1h`.
- Funding window: book settlement `s` only when `entryFill < s <= exitDecision`.
- Horizon exit decision: `entryFill+24h`; fill follows one hour later.
- Split isolation: an entry decision in a non-final split is eligible only when `decisionTime + 26h < nextSplitStart`. Equality is rejected. This prevents any Discovery/Validation cycle from reading later-split funding or marks.
- Split start state is derived causally from events with timestamp strictly before the split start. An unresolved degradation episode carries into the split as degraded; no later data may heal the past.

### Runner state machine

States:

- `FLAT_ELIGIBLE`
- `ENTRY_PENDING`
- `POSITION_OPEN`
- `EXIT_PENDING`
- `DEGRADED_FLAT`
- `TERMINAL_INCONCLUSIVE`

Rules:

- `FLAT_ELIGIBLE + INTEGRITY_DETECTION -> DEGRADED_FLAT`.
- Eligible active common decision -> `ENTRY_PENDING`; fill occurs only at the predeclared `t+1h`.
- `ENTRY_PENDING + detection before fill -> DEGRADED_FLAT`, pending entry permanently cancelled.
- If the fill deadline passes and any later event arrives without the required `ENTRY_FILL`, the run becomes terminal `INCONCLUSIVE / ENTRY_FILL_MISSING`.
- An integrity detection at or after the pending entry fill time without a valid fill is terminal `ENTRY_FILL_DATA_DEGRADATION`, never an illegal-transition escape.
- `ENTRY_PENDING + fill -> POSITION_OPEN`.
- `POSITION_OPEN + exit decision -> EXIT_PENDING`; fill occurs at decision +1h.
- If the exit-fill deadline passes and any later event arrives without the required `EXIT_FILL`, the run becomes terminal `INCONCLUSIVE / EXIT_FILL_MISSING`.
- A run that ends in `ENTRY_PENDING`, `POSITION_OPEN` or `EXIT_PENDING` is terminal, never a non-terminal partial cycle.
- Any integrity detection while `POSITION_OPEN` or `EXIT_PENDING`, including exact entry/exit boundary ties, -> absorbing `TERMINAL_INCONCLUSIVE`.
- `INTEGRITY_DETECTION.integrityKind` is mandatory and non-empty. Missing/blank kinds fail closed.
- After a successful exit fill, a mark-integrity event `MISSING_MARK`, `DUPLICATE_MARK` or `UNCONFIRMED_MARK` detected exactly at `exitFill+1h` is terminal `EXIT_FILL_DATA_DEGRADATION`: that detection belongs to the candle whose OPEN supplied the exit fill. This remains terminal even if the already-flat run became `DEGRADED_FLAT` from another integrity event after the exit fill and before (or earlier in deterministic order at) `exitFill+1h`. Funding-integrity events at that timestamp, or mark events later than `exitFill+1h`, degrade/reset a flat run but are not terminal for the closed position.
- `EXIT_PENDING + EXIT_FILL -> FLAT_ELIGIBLE`, but a detection at the same timestamp remains terminal by the inclusive position-at-detection rule.
- Common decisions while pending/open are ignored; no pyramiding or averaging.
- Cancelled pending entries never resurrect after recovery. A new entry requires a new post-recovery decision.
- Illegal fills/decisions or impossible transitions throw `CROSS_VENUE_V2_ILLEGAL_TRANSITION`.
- After terminal outcome the runner stops consuming later events. Later recovery, marks, funding or events cannot alter the outcome or causal trace.

### Recovery

`DEGRADED_FLAT` carries a recovery count `0..2` plus the latest reset time.

- only a common usable on-grid settlement with timestamp strictly greater than the latest reset may advance recovery;
- settlements must remain exactly 8h consecutive;
- any integrity detection at or before candidate `T` resets the sequence;
- a detection exactly at `T` is processed before the common decision and `T` does not count;
- the runner derives common decision timestamps and integrity detections from its own ordered event stream and calls the frozen `recoveryAt` contract directly;
- callers may not supply a `recoveryEligible` flag; such a flag is rejected;
- the only external Recovery inputs are the two mark series (plus the frozen contract), and recovery is accepted only when `recoveryAt(...) === T`, including required marks only through `T-1h`;
- a decision at the exact recovery timestamp may be used because its three spreads are the recovery settlements themselves.

### Independent event-sourced ledger

`research/cross-venue-funding-edge-v2-ledger.js` is intentionally arithmetically independent from the analytic strategy decomposition.

Ledger inputs:

- paired fill records: entry `{venue, side, qty, markOpen, time, feeBps, slipBps}` and close `{..., exitDecisionTime}`; both close legs must carry the same strict `exitDecisionTime < exitFill`;
- funding records: `{venue, rate, fundingMark, time}`;
- hourly venue mark records;
- the frozen 10,000 USDT notional per leg and operational buffer.

Ledger mechanics:

- separate venue cash accounts;
- signed position quantity: LONG positive, SHORT negative;
- funding cash: `-signedQty * fundingMark * rate`, but only for `entryFill < settlement <= exitDecision` using the close-fill `exitDecisionTime` independently inside the ledger;
- funding rows with `exitDecision < settlement <= exitFill` remain visible as `FUNDING_OUT_OF_WINDOW` trace events with zero cash effect;
- fill fees/slippage deducted from the fixed notional basis;
- basis realization derived from signed quantity and mark movement;
- operational buffer booked independently when a paired cycle closes;
- hourly equity path = venue cash sum + unrealized signed-position value;
- complete paired hourly marks are mandatory from entry through exit;
- each returned ledger is marked `EVENT_SOURCED_V2` and protected by its own content digest.

Forbidden inside the ledger arithmetic:

- `fundingCashflow`;
- `basisPnl`;
- `costBreakdown`;
- `directionLegs`.

The analytic decomposition remains the independent side:

- funding cashflows from the strategy primitives;
- basis PnL from entry/exit marks;
- frozen cost scenario.

`reconcileLedger({ledger,decomposition})` first verifies ledger kind and digest, then compares ledger equity delta with the independent analytic decomposition at 1e-8 USD tolerance. Raw `openingEquity/closingEquity` objects are rejected.

Later performance gates, if ever authorized, must derive equity and drawdown from the ledger path, never from the same pre-aggregated summands being reconciled.

### Synthetic-only regression contract

The implementation tests cover:

- entry/exit/detection timestamp ties;
- pending-entry cancellation and non-resurrection;
- no-pyramid decisions;
- illegal transitions;
- input permutation invariance;
- recovery resets, gaps, one-venue non-recovery and split-start carry;
- generic earlier-integrity-event monotonicity across funding/mark/provenance/parser families;
- terminal and prefix causality invariance;
- strict 26h split isolation;
- hand-calculated zero-move, funding-only, basis-only and mirrored-side accounting;
- identical baseline/stress trade-path identity with exactly 12 USD frozen cost difference;
- intentional cash/price/fee/qty/rate/sign corruption;
- strict scalar typing;
- runner self-lock while `stageLock.discovery !== true`;
- an assertion that runner/ledger tests do not read the canonical source artifact/package.

No test in this runner contract executes the canonical V2 source package or strategy PnL.

