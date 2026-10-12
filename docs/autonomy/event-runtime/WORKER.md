# One-shot local decision worker — source-only, inactive

`local_worker.run_once(database,event_id,owner,payload_raw)` consumes at most the
explicitly named local inbox event. It does not select a next task, poll, invoke a
model, access GitHub or perform remote writes. Database provisioning and enqueue
are separate explicit operations. The schema2 database stores event metadata/digests,
a small decision/reason summary, full decision SHA256 and a strict minimal recovery
projection with the actual continuation ledger, not raw payload, comment body,
planner, adapter input snapshot or model output.

Before claiming, the worker compares exact input bytes SHA256 and expected scope
to the persisted binding and calls the actual canonical event normalizer through
the fixed sibling Node module to compare event identity/revision. It then claims
and starts through the inbox's fence, invokes the actual unchanged continuation
adapter once for the decision, and settles that exact claim. The preflight is
read-only normalization, not a second adapter decision or external operation.

The executable is a resolved local Node binary; the module path is fixed to
`../event-adapter/scripts/event-continuation-adapter.mjs`, never chosen by event
content. No shell interpolation occurs. The child environment excludes credentials,
NODE_OPTIONS and caller code hooks. Input is capped at128KiB, stdout32KiB,
stderr4KiB; pipe bounds are enforced during reads, and each child has at most10s
timeout. On exit/error/timeout the process group is cleaned up, including a child
that retained pipes after its direct parent exited. Linux/POSIX is assumed.

Caught uncertain execution records UNKNOWN and retains the active inbox fence.
If settlement itself cannot be persisted, the returned state is UNSETTLED with
`persistConfirmed=false`; it never reports durable UNKNOWN falsely. Abrupt host
loss or SIGKILL may leave CLAIMED/STARTED; restart cannot replay that consumed
event or clear the active slot. Operator reconciliation is intentionally required.
This local fence is not an expiring lease and does not coordinate separate hosts.
COMPLETE settlement stores the minimal actual adapter decision/ledger projection
in the same transaction as state/fence settlement. Its separate digest binds the
canonical inbox binding (including payload/head/base/event revision) and projection.
`recover_completed(database,event_id,expected_binding)` verifies matching completed
state, independently supplied binding and the stored digest, then returns the
allowlisted projection without executing Node, reclaiming or replaying the event.
An actual subprocess crash after commit and before return is tested: a new process
recovers the exact COMPLETE_DRAFT ledger. A crash before commit remains STARTED and
locked. Projection/summary consistency and structure are validated by the inbox.
Legacy schema1 stores fail closed; this package never migrates or recreates them.
This is same-host local result recovery, not authenticated/distributed durability,
automatic operator reconciliation or recovery from database deletion/corruption.

The existing `event-write-fence.py` requires a real changed intendedHead for remote
write tracking; the review claim ledger binds a model invocation. Neither is
misused with fictional SHAs for a local computation. This packet supplies only a
same-host decision inbox, not a replacement remote-write authorization mechanism.

Tests use the real sibling adapter and its fixture contracts, plus explicit local
subprocess failure/timeout fixtures. Run the enclosing source verifier or
`python3 -B -m unittest discover -s docs/autonomy/event-runtime -p 'test_*.py'` in
the staged package. Isolated tests may set MERIDIAN_TEST_ADAPTER to the trusted
adapter module; runtime accepts no such environment override. Tests cover replay,
restart, wrong digest/normalized identity, stale fence, process timeout/exit/output
overflow, child cleanup and persistence uncertainty. All dispatch/merge and
authentication/provenance authority remains false. No deployed worker or live
event-delivery claim follows from these tests.
