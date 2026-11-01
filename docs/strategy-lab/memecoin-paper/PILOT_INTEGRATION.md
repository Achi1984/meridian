# Offline Paper pilot integration contract

**Disposition: synthetic fake-dependency contract only; real-module integration is
BLOCKED. No Paper run is startable or authorized.** The package is default-disabled,
has no CLI or auto-start, accepts only the explicit `SYNTHETIC_TEST_ONLY` mode,
and does not change the disabled manifest, producer modules, ledger, or risk policy.
It does not fetch a feed, open a checkpoint store, start a host, or perform a run.

## What this checkout exercises

`scripts/memecoin-paper/pilot-integration.mjs` composes injected interfaces without
importing branch-only modules. Omitting `mode` returns a disabled control without
calling any dependency. The explicit test-only path requires the unchanged disabled
manifest, empty allowlists, disabled providers, a fake/injected transport, a fixed
run identity, and bounded budgets. It cannot select a real mode. The test fixtures
are generated synthetic objects with non-address identities; tests replace every
producer boundary with a fake.

The adapter:

- passes provider-normalized candidate records to the existing
  `filterCandidate(candidate, {now, holdUntil})` boundary using explicit sample
  time; `UNKNOWN` and `REJECT` never invoke the injected step boundary;
- maps a candidate and its filter result into a step envelope, while keeping
  provider request-audit events in a separate count. Provider request events are
  not ledger commands or step inputs;
- enforces cumulative request, per-provider request, byte, provider-event, and
  candidate budgets across cycles. Each provider call receives the remaining
  limits; its per-call counters must be consistent and are added to run totals.
  The run-control event budget separately bounds candidate events passed to steps;
- returns `ACKNOWLEDGED` only when the existing session metadata and one
  `store.readCheckpoint()` result agree on run, sequence, and SHA-256 hash, and
  the readback record binds the last step receipt. Unknown or mismatched state
  stops without retry or reconciliation;
- can project a no-entry report from a verified header-only checkpoint at
  sequence zero, using `PaperCheckpointSession.snapshot()` and an empty supported
  checkpoint result list; this does not invent a ledger command or fill;
- calls the operator-report projector only with an identity-bound
  `SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY` result. The terminal run-control
  summary is not a report input; command-bearing results are receipt-bound, and
  a projected report is not a durable receipt.

The step boundary is deliberately injected. This package does not implement a
strategy, ledger command mapper, accounting, P&L, liquidation, or risk policy.
Existing #996 limits remain authoritative: USD 1,000 virtual capital, at most
8% entry sizing, three positions, 6% initial stop, 6% trailing distance after
12% activation, 3% daily loss limit, and an eight-hour window. A filter
`UNKNOWN` blocks entry; the tests do not weaken evidence gates to produce a fill.

## Exact source references and integration status

These are source pins, not approval of integration, CI, review, or run authority.
The branch-only exports are injected and are not imported from this checkout.

| Lane | Exact source pin | Documented boundary | Status here |
| --- | --- | --- | --- |
| Existing #996 stages/checkpoint | Base `fa04cf49842f0350bd4fc21f466984612a139396` | `filterCandidate(candidate, {now, holdUntil})`; `PaperCheckpointSession.metadata`; `store.readCheckpoint()` with `status`, `sequence`, `hash`, and `bytes` | Present on base; existing filter and checkpoint tests remain authoritative |
| Provider #1108 | `78edb557c868e7ed29b5ba6e7df21d2171f835f2` | `acquireProviderEvidence(options)` returns `status`, `events`, normalized `candidates`, and `counters` including requests, bytes, events, and per-provider counts | Branch-only. With this package's disabled manifest and `enabled: false`, the actual adapter remains disabled. Fake dependency only is tested |
| Operator report #1104 | `beaf77e171b1bc605032930325a18e3f47c0e369` | `projectOperatorReport(input)` and `renderOperatorReport(report)`; report input is a supported replay/checkpoint result | Branch-only. No controller summary is passed to the projector |
| Readiness #1106 | `cf7121262a0d986e467546090885054b874168cc` | `projectPilotReadiness(input)` is a readiness projection, not an execution adapter | Branch-only and not used as a readiness or success substitute |
| Controller #1110 | Original `702f3f5413e53e4a0d1e246cce49c93615e2010b` is superseded; stale-position correction used here is `0323cc5856d13020903bd2fcd4421ec049f8e383` | `createPilotRunControl(options)` with injected `acquire`, `step`, `checkpoint`, and `report` callbacks | Branch-only. The fake controller tests callback wiring; they do not execute this pinned module |
| Clock/assembly #1096 | `61044c0709fd071a734d3aa60db2c01e54f0b54f` | Source reference only | Not imported or exercised |

Real-module integration is **BLOCKED** for a concrete interface mismatch: the
current `runSyntheticPaperOrchestration` accepts only named generated scenarios
and rejects caller-supplied candidates, while `acquireProviderEvidence` returns
provider candidates and audit events. The current base has no generic step
adapter that binds those candidate/filter outputs to `PaperCheckpointSession`
commands and produces the full receipt/result shape expected by the operator
report projector. No adapter is invented here to conceal that mismatch.

The pinned controller summary is also not a valid operator-report input.
Controller checkpoint acknowledgement, durable checkpoint readback, and terminal
report projection remain three separate results. Controller correction
`0323cc5` invalidates current position evidence when a later step omits or fails
to settle it, retaining any earlier evidence only as explicitly stale. This
package does not replace that behavior; the fixture test exercises only the
synthetic callback contract.

The #1096 and #1106 pins are references, not integration approval. Their prior
base reviews do not approve this package. The provider/report/controller source
pins must be exercised together at one authorized integration head before anyone
claims end-to-end acceptance.

## Validation and authority boundary

Run the focused synthetic contract suite:

```sh
node --test test/memecoin-paper-pilot-integration.test.js
```

These tests use generated fixtures and fake dependencies only; they do not
exercise the pinned provider, controller, readiness, or operator-report modules.
They establish adapter invariants, not end-to-end acceptance. The next real-module
acceptance command is this same focused test at an authorized integration
checkout after the missing step/receipt mapping is implemented and the exact pins
are present. Full hosted regression is still required on the frozen candidate.

There is no host/start authority in this package. Any future host-specific
acceptance requires explicit owner/lead authorization for the exact run
configuration, validated host storage durability and trusted-clock policy,
independent review, and successful exact-head checks. The unchanged manifest
remains disabled; this work authorizes no scheduling, provider probing, wallet,
order, Paper, or Live activity.
