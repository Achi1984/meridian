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

The probe emitted no rates, prices, signals, positions or PnL.

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

Recovery requires all of:

1. three consecutive common on-grid scheduled settlements after the latest integrity event;
2. no new integrity event before the third settlement;
3. complete, unique, confirmed hourly marks for both venues from the first required hour after degradation detection through the third recovery settlement.

A funding-only recovery cannot reopen entries while mark integrity is still unresolved.

## Entry source completeness / freshness

A V2 entry can be eligible only when:

- integrity state is `HEALTHY`;
- both venues have exactly one authoritative on-grid funding record at the decision timestamp;
- the decision timestamp is within the frozen decision window;
- the required entry mark row on each venue is unique, confirmed and exactly at the first hourly timestamp strictly after the decision;
- the latest three common spreads are formed only from completed eligible common funding timestamps.

Stale, missing, duplicate or unconfirmed inputs block entry.

## Split

The 60/20/20 chronological split is still computed from all valid common canonical decision timestamps inside the frozen V2 decision window, independent of strategy PnL or entry eligibility.

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
