# Integrated publisher host — inactive source preparation

Tracking: issue #774. Baseline: `18304c935e6a5fed2df6a8e086d7de2f698c1a20`.
This packet connects the previously separate adapters. It does not install a server,
route, workflow, credential, database connection or unattended dispatcher. Tests use
simulated infrastructure; no actual publication or new PostgreSQL run is authorized.

## Shared contract

The additive reservation-receipt adapter leaves the old ledger API unchanged. A
newly acknowledged INSERT returns the complete five-field operation binding and the
database-created reservation time. Conflict, malformed acknowledgment, lost reply or
exception returns no receipt. Reading an existing row never produces send permission.
The database timestamp is returned as canonical integer-millisecond text, not derived
from an untrusted request or invented from the host's clock.

The host privately carries that receipt through the full sequence: real admission,
fresh reservation acknowledgment, credential retrieval, fresh admission with the same
binding, one bounded POST, response capture/record retention, then independent readback
and confirmation. Credential retrieval precedes the last admission so that a slow
credential operation cannot silently enlarge the gap between that check and sending.
The request cannot provide a receipt, window, response, URL or infrastructure dependency.

Aborted or timed-out work must not resume downstream effects when an outstanding
promise eventually resolves. A database call already in flight can still commit;
the result remains uncertain, and it never causes a retry or a late POST. Database
statement timeouts and autocommit semantics are deployment requirements, not facts
proved by a JavaScript timer. The database must preserve the consumed reservation.

Wall-clock milliseconds provide epoch timestamps for comparison with GitHub's
second-resolution comment time. Monotonic time guards elapsed work separately; it
must never be substituted for an epoch timestamp. Clock mismatch fails closed.
There is no atomic revocation across GitHub and the database: approval can change
between the final check and the POST. Later rejection cannot undo a publication.

## Confirmation-only recovery

The separate recovery path has no sender, credential acquisition or reservation
creation. It may confirm only through the existing retained sender record and the
actual confirmation checks. If that record is absent, an owner must reconcile the
uncertain state. Matching a shared bot actor, body and time alone must not be used to
invent a missing sender record or claim provenance. No automatic resend or unlock
is introduced. Automatic AMBIGUOUS settlement is not introduced either.
Recovery retains the current token, approval and publisher-run checks from
`confirmPublication`. A completed workflow or a different run is not automatically
accepted as recovery authority. An absent or terminal record requires owner review;
this wrapper is not a general post-expiry or cross-run reconciliation service.

## Evidence boundaries and activation gates

All existing authority, authentication, provenance and durability flags remain false.
Those flags are descriptions, not a network sandbox: the preparation is inactive
because no productive entrypoint supplies real dependencies and invokes it.

Synthetic E2E tests can demonstrate ordering, conflict handling, delayed completion,
mutation isolation and no-resend behavior. A simulated restart is not a durability
test. The earlier isolated PostgreSQL runs do not validate this new receipt SQL and
host composition; both earlier one-run allowances are consumed.

The existing top-level test discovery now includes a synthetic integration bridge
at `test/publisher-host-integration.test.js`. It executes the three new receipt,
host and recovery suites with a bounded child process. No workflow, runtime route
or secret is added. A green GitHub run can therefore cover these new suites rather
than relying solely on local test claims; inspect its actual logs before claiming it.

Before any controlled live attempt the owner must approve a concrete deployment:

1. Host and its integrity/operational owner; no provider is selected by this packet.
2. Dedicated database, verified TLS, narrowly scoped roles, autocommit, timeouts and
   an independently tested durability/restart configuration.
3. Credential identity, scope and issuance; no new secret is acquired here.
4. Authenticated evidence/approval bootstrap and the exact pinned publisher identity.
5. Handling of uncertain consumed operations, including owner-only reconciliation.
6. Exact request/body, one-attempt limit, stop conditions and verification evidence.

Source merge, real isolated database testing, deployment and a real single attempt
remain distinct decisions. No research/trading permission, cadence policy or standing
dispatch authority changes in this packet.
