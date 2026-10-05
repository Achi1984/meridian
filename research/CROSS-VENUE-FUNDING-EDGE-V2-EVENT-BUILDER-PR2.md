# Cross-Venue Funding Edge V2 — Event Builder PR2

Status: **STRUCTURAL RUNNER ADAPTER ONLY — NO STRATEGY SIGNALS / NO FILLS / NO PNL / NO DISCOVERY AUTHORIZATION**

PR2 bridges the already source-bound Event Builder PR1 output to the frozen runner event vocabulary without evaluating the V2 hypothesis.

## Contract

- `COMMON_DECISION_SLOT` becomes `COMMON_DECISION`.
- `entryActive` is hard-coded to `false`; this layer cannot create a strategy signal.
- `sourceInputsReady` maps to runner `inputsReady`.
- frozen `splitEligible` is preserved.
- funding settlements and integrity detections retain only runner-required structural fields.
- runner ordering is delegated to the frozen `sortRunnerEvents` / `runnerEventKey` implementation.
- unknown builder event kinds fail closed.
- builder output must remain research-only with execution impact, strategy PnL and strategy signals all disabled.
- the caller-provided builder output is read exactly once into a single immutable JSON snapshot; key checks, digest verification, event adaptation, lineage fields and the returned stream all derive only from that snapshot.
- the returned `stream` is detached from caller ownership and deeply frozen, so later caller mutation cannot alter adapted evidence.
- the adapter carries both PR1 stream and package-bound digests for lineage.

## Explicit non-goals

PR2 does not read canonical source data, run the canonical builder, execute Discovery, calculate strategy spreads/directions, create entry/exit fills, create exit decisions, calculate accounting/PnL, or modify any stage lock.

A later separately reviewed layer is required before any strategy-active `COMMON_DECISION` may exist.
