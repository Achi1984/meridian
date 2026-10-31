# Paper readiness: source preparation and next packet

## What this delivery changes

M11 exposes one shared, immutable preparation snapshot from
`v11/paper-readiness.js`. It separates implemented synthetic accounting from
operational gaps and lists the exact twelve unset groups in the existing
Forward Paper contract. It is source evidence, not telemetry, a live readiness
probe, a strategy selector, or an admission mechanism. Its `canStart`,
`paperAuthorized` and `liveAuthorized` values remain false. No caller-provided
object, imported result, score or button can authorize a run through this model.

The source baseline inspected for this packet is
`dcfd520c02987c546fc5d23db4a0491cc4a3d935`. PR #993's existing
[`test-support/synthetic-paper/harness.mjs`](../../test-support/synthetic-paper/harness.mjs)
already supplies an isolated BigInt accounting model. Its
[receipt](SYNTHETIC_PAPER_HARNESS_RECEIPT.md) records 18 focused tests; this packet
does not rerun them or reinterpret them as operational proof. Its fake journal
is not durable storage, fake causal assertions are not source evidence, and
its integer cents/whole-share units are fixture choices, not Paper defaults.
The retrospective Arena is also not a running Forward Paper implementation.

**D2 source assessment checked 2026-10-31:** the pinned baseline checkpoint's
`currentWork.d2NoEdge935` records one approved and completed trial, attempt 1,
with screen result **NO_EDGE**. Its source references are
[snapshot 935/6448721244](https://github.com/Achi1984/meridian/issues/935#issuecomment-6448721244)
and [assessment 935/6449045864](https://github.com/Achi1984/meridian/issues/935#issuecomment-6449045864).
The independent acceptance of the full private result remains **PENDING**.
This dated source note is neither a new trial nor an independent re-analysis;
it does not classify all twelve strategy hypotheses as failures. The documented
D2 result does not qualify a strategy for Paper admission.

## Recommended next technical packet

**First deliver a versioned reconciliation contract amendment.** This is a
documentation-and-generated-example prerequisite, not implementation of a
journal or resolver. Its deliverables are an exact versioned receipt envelope,
state-transition/reason table, authority/evidence binding rules, a finite
acceptance matrix and independent review. The existing
[event contract](FORWARD_PAPER_V1_CONTRACT_SPEC.md) intentionally leaves the
resolution receipt unspecified. Define and independently review, without
implementing or activating it:

1. Immutable binding to the original operation, expected state, original fence
   and exact evidence, plus the separately selected resolution authority.
2. Distinct applied, authoritative absence, conflict and still-unknown outcomes.
   An absent lookup is not authoritative absence; absence is not retry authority.
3. Duplicate-safe, effect-free resolution and protection against a stale resolver
   overwriting a newer state. No replay of the original monetary effect.
4. An explicit state/receipt model for each outcome and generated examples of
   lost acknowledgment, process restart and contradictory evidence.

**Then prepare a separate temporary-journal implementation packet.** Select and
verify an existing suitable dependency/resource before proposing implementation.
Use only generated fixtures, injected time and bounded temporary storage. Test
atomic receipt/account/fence commits, crash before/after durability, lost ACK,
restart lookup, competing writers, and retained UNKNOWN. State exactly which
filesystem/process guarantees the tests establish. Do not reuse the portfolio
history's floating-point schema or B1 identities. No provisioning, new dependency,
production persistence, provider connection, schedule or Paper activation is
part of this recommendation or this delivery.

These technical packets can prepare reliability before strategy qualification;
they cannot make an unqualified strategy eligible. The existing source/time
proof, independently assessed qualification and operating-decision gates remain.

## Owner decision worksheet for a later bounded Paper proposal

The following is a review template, not a runnable configuration. Every answer
is currently **REQUIRED_UNSET**. An engineering proposal must supply concrete
values and their evidence before asking the owner to select or approve them;
the template itself does not ask the owner to invent technical parameters.
Historical Arena capital, costs and no-stop behavior must not be copied as defaults.

| Group | Concrete content required in the later proposal | Decision state |
| --- | --- | --- |
| Strategy | Exact qualified strategy version, code/rules identity and independent qualification receipt | REQUIRED_UNSET |
| Source | Exact provider/source and adapter/schema version; availability and identity evidence | REQUIRED_UNSET |
| Universe | Ordered instrument identifiers and membership/change policy | REQUIRED_UNSET |
| Product | Spot/derivative type, venue, settlement and any margin semantics | REQUIRED_UNSET |
| Capital and currency | Simulated starting amount and explicit account currency; any required FX model | REQUIRED_UNSET |
| Observation period | Start/end policy, duration and minimum forward sample; no historical days counted | REQUIRED_UNSET |
| Costs and liquidity | Fee basis, slippage-price treatment, spread/depth/impact and participation units with evidence | REQUIRED_UNSET |
| Risk | Stop method, exposure limit, maximum loss, units and breach action | REQUIRED_UNSET |
| Timing and marks | Decision/fill causal rule, price event phase, expiry boundary/action and eligible marks | REQUIRED_UNSET |
| Freshness and gaps | Exact age/cadence limits, gap behavior and cross-instrument synchronization | REQUIRED_UNSET |
| Compute bounds | Input bytes, event/array/work counts and transition timeout with units | REQUIRED_UNSET |
| Reconciliation authority | Named authority, permitted evidence and reviewed durable-resolution procedure | REQUIRED_UNSET |

Storage durability and clock/source-time proof are additional technical gates,
not new operating-choice groups. A final separate admission request must bind
all reviewed choices, exact source/configuration identities, test evidence,
scope/duration and stop conditions. Until that explicit operational decision,
the preparation view continues to state that no Paper run is configured or
authorized. No strategy P/L, discovery, replay, provider read or trading action
has been performed by this packet.

## Validation

`node --test test/v11-paper-readiness.test.js` checks that the source projection
cannot admit a run, deeply frozen objects cannot be mutated, the exact twelve
groups/fields remain aligned with contract section 3, and operational gaps do
not become synthetic successes. These are presentation/source consistency
tests; they do not verify real data, persistence, clocks or eligibility.
