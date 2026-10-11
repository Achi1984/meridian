# Development centre: offline work planner

Status: IMPLEMENTATION_CANDIDATE, not an activated execution service.

The planner turns bounded supplied work packets into a deterministic queue. It
performs no network, filesystem, agent dispatch, workflow, merge or trading
operation. It cannot claim operational autonomous execution, authenticated
snapshots, fresh GitHub state, ownership leases or durable replay protection.
The current policy still requires owner merge approval and does not authorize
automatic dispatch. No policy or existing bridge contract changes here.

## Roles and next integration boundary

- ChatGPT lead: fetch current checkpoint/mailbox and exact GitHub state, reconcile
  unknown outcomes, propose scoped packets and retain sole merge ownership.
- Codex/Copilot: implement assigned, isolated packets within explicit scope.
- Claude: independently review the exact head and integration evidence.
- Project Owner: approve reserved decisions and concrete merges under current policy.

These roles describe the existing operating process; the planner does not execute
it. A future separately reviewed collector must authenticate and pin remote
observations. A durable ownership adapter must acquire ownership before writes,
with reconciliation on ambiguous outcomes. No periodic/event-triggered execution
or expanded spending is introduced by this packet. Mailbox migration is separate.

## Packet schema

`planWork({requiredJobs, work})` accepts ordinary bounded data records only.
`requiredJobs` is a nonempty unique array of job identifiers. Each work record has
exactly these fields:

| Field | Meaning |
|---|---|
| deliveryId, workId | Event delivery and stable logical work identifier |
| requestId, opId | Existing review scope identifiers |
| repository | Exactly `Achi1984/meridian` |
| headSha, baseSha | Distinct full lowercase 40-character commit pins |
| paths | Nonempty unique relative file/directory scope; no traversal |
| owner | `NONE`, `CHATGPT`, `CODEX` or `COPILOT`; a claim, never a lease |
| execution | `PLANNED`, `RUNNING` or `UNKNOWN`; running requires an owner |
| ci | Null or `{headSha, baseSha, runId, jobs}` |
| responses, inFlight | Existing `classifyReview()` records, unchanged |

Each CI job has exactly `{name, conclusion, total, passed, failed}`. Conclusions
are `SUCCESS`, `PENDING`, `FAILURE`. Counts are nonnegative safe integers with
`passed + failed = total`; every required job must succeed with positive totals.
Required job identifiers intentionally represent test-bearing jobs; non-test jobs
need a separately designed schema rather than invented test counts. All other
job failures also block. Any pending job, including a non-required job, waits
with `WAITING_CI / CI_INCOMPLETE`; failures take precedence over pending jobs. Required-job selection is caller-supplied policy, not
verified repository policy. Identifiers use 3–128 letters/digits/`.`/`_`/`:`/`-`,
starting with a letter/digit. The collector must map GitHub display names to
stable, collision-free schema IDs and preserve the source-to-ID mapping in its
own provenance record; names containing spaces and the short name `ci` are
invalid here. The same mapping must be used for required jobs and observed jobs.
Do not silently sanitize two names into the same ID or discard pending checks.
Collections allow at most 128 members; strings 1024
characters; depth 12; total cloned values 20,000. This is a snapshot limit, not a
queue retention policy.

Duplicate deliveries/work collapse only for identical packet content (excluding
delivery ID); conflicting work/request/operation identities fail closed. Review comment IDs and
CI run IDs must also have identical evidence bindings across the entire snapshot.
Every top-level and nested response/in-flight scope shares snapshot-wide bindings:
a request or operation ID cannot refer to different scope pins, and a head cannot
refer to different bases. Consistent historical rows may repeat across packets;
they do not substitute for a review of the current request/head. After all packets
are validated, responses and in-flight rows are deduplicated and routed to their
active head across the entire snapshot. Their containing packet does not determine
which work they affect. Alternate request IDs on an active head still block;
the strictest matching verdict wins even when carried in another packet. Matching
GREEN answers an in-flight request under the existing coordinator rules. Unrelated
historical heads remain historical. The existing coordinator limit of 256 unique
responses and 256 unique in-flight scopes per routed head remains fail-closed;
the planner never truncates adverse evidence to fit that limit. A head
cannot be reintroduced under a different work packet. Updates belong in a new
reconciled snapshot, not appended alongside an old version. Array ordering is
part of packet identity. Output ordering is stable by status then work ID.

Unknown outcomes block pending reconciliation. Any overlapping scopes among
current work packets conservatively block both, including planned work and
ancestor directory scopes. No automatic conflict winner or retry is selected. Overlaps are indexed once with
a sorted segment-prefix sweep, rather than comparing every pair of paths for
every work item. Exact matches and directory ancestors conflict across owners;
nesting within one work packet and lexical near-prefixes such as `src-ab` do not.
For P paths, indexing uses O(P log P) string comparisons plus a linear sweep and
O(P) auxiliary storage; string comparisons remain bounded by path-length limits.
Running packets wait for their owner unless supplied CI is stale or failed;
those CI blockers take precedence over `WAITING_AGENT`. Null or pending CI
keeps an active owner in `WAITING_AGENT`. CI must match both pins; stale head/base
evidence intentionally returns `BLOCKED / STALE_CI` and requires a fresh
reconciled snapshot rather than speculative continuation. Reviews reuse the
existing strictest-verdict and deduplication rules. Missing evidence waits.

`READY_FOR_OWNER_DECISION` means supplied evidence is internally consistent only.
Every output explicitly returns false for authentication, verified provenance,
dispatch permission, merge permission and authorization. All results are frozen.
The planner never consumes the evidence module's in-memory replay Set, reserves
journal entries or widens Bridge V2's path/model allowlists.

## Verification

Run `node --test test/development-centre-planner.test.js`. Tests exercise malformed
and hostile inputs, duplicate scope bypass, stale integration evidence, incomplete
CI, contradictory reviews, overlapping ownership, unknown outcomes, repeatability
and input immutability. These tests prove local behavior only; exact-head CI and
independent review remain required before any proposed merge.
