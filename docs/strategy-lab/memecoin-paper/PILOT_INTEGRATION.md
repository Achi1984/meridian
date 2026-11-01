# Historical offline Paper pilot integration fixtures

**Disposition: historical synthetic fake-dependency contract only. This document
does not describe the actual observation-only runner.** The current runner is
`scripts/memecoin-paper/pilot-online.mjs`; its published source assembly, lifecycle,
and operator contract are documented in [PILOT_ONLINE.md](PILOT_ONLINE.md). The
historical `scripts/memecoin-paper/pilot-integration.mjs` fixture adapter remains
offline-only: it accepts explicit `SYNTHETIC_TEST_ONLY` mode, does not fetch a feed,
and is not the runner used for the published observation-only composition.

## What the historical fixtures exercise

The historical adapter composes injected interfaces without importing producer
modules. Omitting `mode` returns a disabled control without calling dependencies.
Its explicit test-only path requires the unchanged disabled manifest, empty
allowlists, disabled providers, a fake/injected transport, a fixed run identity,
and bounded budgets. Test fixtures use generated synthetic objects with
non-address identities and replace every producer boundary with a fake.

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

## Current observation-only runner pins

The actual runner source composition is listed here to avoid confusing it with the
historical pins below. These are source pins, not approval of deployment or run
authority; see [PILOT_ONLINE.md](PILOT_ONLINE.md) for the full assembly contract.

| Dependency | Current runner pin | Runner boundary |
| --- | --- | --- |
| Base | `fa04cf49842f0350bd4fc21f466984612a139396` | Checkpoint session/store and existing filter/analyst boundaries |
| Provider #1108 | `b000c6a6dcfcce102e61821e8316174a15a0dd58` | Fixed public-data acquisition |
| Controller #1110 | `89a20bf118e059c6153ac75b51f2ed6947d46332` | `READ_ONLY_PAPER` lifecycle and callbacks |
| Report #1104 | `14075eef9ef0eebde3249718a6f6e3c51016bdee` | Receipt-bound operator report projection/rendering |

The runner remains observation-only: no entries or fills are authorized or
produced, and the existing risk limits remain unchanged.

## Historical synthetic fixture pins

The following table records the historical synthetic fixture's references only.
These pins do not identify the actual runner's dependencies and do not supersede
the current runner pins above.

| Lane | Exact source pin | Documented boundary | Status here |
| --- | --- | --- | --- |
| Existing #996 stages/checkpoint | Base `fa04cf49842f0350bd4fc21f466984612a139396` | `filterCandidate(candidate, {now, holdUntil})`; `PaperCheckpointSession.metadata`; `store.readCheckpoint()` | Historical base reference; filter/checkpoint behavior remains covered by its existing tests |
| Provider #1108 | `78edb557c868e7ed29b5ba6e7df21d2171f835f2` | `acquireProviderEvidence(options)` and normalized candidate/counter results | Historical fake dependency; not the current runner provider pin |
| Operator report #1104 | `beaf77e171b1bc605032930325a18e3f47c0e369` | `projectOperatorReport(input)` and `renderOperatorReport(report)` | Historical fake dependency; not the current runner report pin |
| Readiness #1106 | `cf7121262a0d986e467546090885054b874168cc` | `projectPilotReadiness(input)` readiness projection | Historical reference; not imported or used as a success substitute |
| Controller #1110 | Original `702f3f5413e53e4a0d1e246cce49c93615e2010b`; correction `0323cc5856d13020903bd2fcd4421ec049f8e383` | `createPilotRunControl(options)` callback contract | Historical fake controller; tests do not execute the pinned module |
| Clock/assembly #1096 | `61044c0709fd071a734d3aa60db2c01e54f0b54f` | Source reference only | Historical; not imported or exercised |

When this synthetic fixture contract was written, real-module integration was
**BLOCKED** by an interface mismatch: `runSyntheticPaperOrchestration` accepted
only named generated scenarios and rejected caller-supplied candidates. That
historical finding is not the integration status of the current runner documented
above.

In the historical fixture contract, the pinned controller summary is not a valid operator-report input.
Controller checkpoint acknowledgement, durable checkpoint readback, and terminal
report projection remain three separate results. Controller correction
`0323cc5` invalidates current position evidence when a later step omits or fails
to settle it, retaining any earlier evidence only as explicitly stale. This
historical fixture does not replace that behavior; its tests exercise only the
synthetic callback contract.

The historical #1096 and #1106 pins are references, not integration approval.
They do not change the current runner pins or authorize a run.

## Validation and authority boundary

Run the focused synthetic contract suite:

```sh
node --test test/memecoin-paper-pilot-integration.test.js
```

These tests use generated fixtures and fake dependencies only; they do not
exercise the historical pinned provider, controller, readiness, or operator-report
modules. They establish historical adapter invariants, not end-to-end acceptance.
The actual observation-only runner has separate focused tests listed in
[PILOT_ONLINE.md](PILOT_ONLINE.md). Full hosted regression remains required on the
frozen candidate.

This historical fixture contract carries no host/start authority. The current
runner's source contract also does not authorize deployment or an observation run;
host-specific acceptance requires explicit owner/lead authorization for the exact
run configuration, validated host storage durability and trusted-clock policy,
independent review, and successful exact-head checks. This work authorizes no
scheduling, provider probing, wallet, order, Paper, or Live activity.
