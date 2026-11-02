# Bounded PAPER execution step

Source-only package for issue #1143 / `meridian-paper-execution-step-20261102`.
No runtime, controller, provider, report, UI, deployment, or activation changes.
Import and construction do not fetch, schedule timers, open stores, or dispatch
commands. The owner opens and exclusively owns the checkpoint store/session.

This is **not real-data eligibility or runtime approval**. Existing controller
synthetic/read-only modes and report provenance restrictions remain unchanged.
Missing hard-gate, analyst, allowlist, or quote-source evidence remains blocking.
The existing evidence contracts validate assertions, not provider truth.
Runtime mode/provenance integration is separate work requiring independent
GitHub review and full CI before integration. No credentials or dependencies.

## Contract

`createPaperExecutionStep({session, store, runId, startedAt, endAt, limits})`
returns five asynchronous operations. Supply the same exclusively opened store
used by the session, a fresh checkpoint (sequence zero), and explicit integer
millisecond timestamps. `endAt` must be after `startedAt` and no later than its
fixed eight-hour deadline. Do not call the session/store concurrently outside
the adapter. The caller retains responsibility for closing the session.

Every input requires a globally unique bounded `eventId` (1–120 characters,
letters/digits/`._:-`) and `now`:

| Operation | Additional required input |
| --- | --- |
| `authorizeEntry` | `tickId`, `candidate`, `smartWalletAllowlist`, `marks` |
| `executeEntry` | `authorizationId`, `quote`, `marks` |
| `observeExitQuote` | `quote` |
| `riskSnapshot` | `marks` |
| `finishRun` | `marks` |

These are exact shapes, not extensible options. Caller `filterResult`,
`scoreResult`, or PASS flags are rejected. The adapter recomputes
`filterCandidate` (LP hold horizon: fixed `endAt`) and `analyzeCandidate` at
the operation's explicit time. The candidate and allowlist must satisfy the
existing evidence contracts. Missing evidence returns `BLOCKED` without a
checkpoint command. An authorization returns the generated `authorizationId`;
it only reserves budget and does not debit cash or create a position.

Entry requires that live authorization and a quote strictly later than both
the candidate sample and authorization time. Entry/exit quotes must have their
`eventId` equal to the operation's ID. Quotes and supplied marks require the
exact Solana mint, pool, quote currency, and decimals of the authorization/open
position, explicit source, integer observed time and positive price, complete
nonnegative integer `feeCents`, `spreadCents`, `slippageCents`,
`priceImpactCents`, `networkCents`, `mode: "HYPOTHETICAL"`, and
`executable: true`. They cannot be future-dated or older than five minutes.
Synthetic and nonsynthetic sources cannot mix. Nonsynthetic source strings do
not authenticate data or establish live-data simulated-trade provenance.

Marks are always explicit arrays. `[]` does not invent a valuation: with open
positions, risk is `EQUITY_UNKNOWN`, additional entries cannot fill, and finish
reports unavailable equity. Malformed supplied marks/costs are rejected before
dispatch. Exit observations and risk snapshots need no new candidate and run
independently, including trailing/stop/gap and daily-loss exits.

Successful checkpoint commands return the ledger result plus `commandId` and
`receipt: {runId, sequence, hash, resultDigest}`. A ledger rejection can also
have a verified receipt: rejection does not imply no risk/state change.
Command and authorization IDs are SHA-256 identities bound to run, event,
purpose, and the complete detached payload. Exact event duplicates return the
historical result without a second command or monetary effect; any changed
payload or purpose with the same event ID is rejected. Results are detached
from the cache. Unique rejected/blocked events also consume admission capacity.
New events cannot move time backwards, even after evidence blocks.

Unique operations are serialized in invocation order, including concurrent callers;
inputs are detached and bounded before entering the queue. Before dispatch the
adapter verifies its exact checkpoint head and checks capacity. After every
command it independently constructs the expected full checkpoint bytes,
including predecessor, run, sequence, command, inputs, and result digest, and
checks canonical bytes, SHA-256, store readback, and session metadata.
Missing/uncertain ACK, exceptions, or any mismatch latch `UNKNOWN`.
Visible candidate bytes cannot substitute for ACK. All subsequent operations,
including duplicates and finish, return `UNKNOWN`: no blind retry, automatic
reconcile, restart, or resume is exposed.
Duplicates coalesce onto the original operation; they cannot enqueue additional
checkpoint reads or dispatches.

## Risk and bounds

All monetary decisions use the existing checkpoint ledger without policy
overrides: $1,000 virtual capital; at most $80 and 8% equity per entry; three
open/reserved distinct mints; no pyramiding; 6% initial stop; trailing activation
at +12% and distance 6%; $30 Vienna-calendar-day net-equity loss gate;
conservative integer rounding; five-minute authorization validity.

`limits` may only tighten:

| Limit | Default/ceiling |
| --- | --- |
| `maxEvents` | 9,998 unique input events, plus one reserved finish event |
| `maxCommands` | 9,999 commands (header excluded, finish included) |
| `maxPendingAuthorizations` | 3 |
| `maxBytes` | 8 MiB each for aggregate admitted input bytes and checkpoint bytes |

These derive from the existing 10,000-record, 10,000-ledger-event, three-position,
and 8 MiB checkpoint capacities. Inputs additionally obey the session's 100,000
node / 64-depth bounds. New non-finish commands reserve one final record,
minimum empty-marks finish bytes, and conservative worst-case ledger-event
headroom. Aggregate input bytes also reserve a maximum-ID empty-marks finish.
Pending authorizations are bounded and tracked from confirmed ledger
results/release events; expiration may require an explicit risk snapshot before
new admission. Capacity rejection never dispatches that command.
An oversized finish with supplied marks can still be rejected; no marks are
silently dropped. Rejected finish attempts consume bounded event/input capacity
but do not permanently disable a corrected attempt with a new event ID while
capacity remains.

At `now >= endAt`, new non-finish work stops without dispatch; call `finishRun`
explicitly with actual time and available marks. Finish can also stop early.
Calls after the fixed eight-hour deadline are rejected without dispatch and
cannot manufacture an on-time finish. Finish never liquidates positions or
invents quotes/costs. This adapter cannot be reconstructed on an advanced
checkpoint, even though the underlying session separately supports replay.

## Validation

Generated synthetic fixtures and exclusive temporary stores exercise real
session/ledger effects, exact receipts, collisions, concurrent calls, limits,
quote/evidence failures, independent exits, the daily-loss gate, deadline stop,
and injected ACK/readback failures.

Focused command from repository root:

```sh
node --test test/memecoin-paper-execution-step.test.js test/memecoin-paper-checkpoint.test.js test/memecoin-paper-execution-evidence.test.js test/memecoin-paper.test.js
```

These tests establish only source-level simulated behavior, not market-data
eligibility, runtime activation, trading realism, or deployment readiness.
