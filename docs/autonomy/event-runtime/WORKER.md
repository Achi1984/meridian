# One-shot local decision worker — source-only, inactive

`local_worker.run_once(database,event_id,owner,payload_raw)` consumes at most the
explicitly named local inbox event. It does not select a next task, poll, invoke a
model, access GitHub or perform remote writes. Database provisioning and enqueue
are separate explicit operations. The database stores only event metadata/digests
and a small decision/reason summary plus full decision SHA256, not raw payload,
comment body, adapter snapshot or model output.

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
Only the summary and full-result digest persist. A crash after COMPLETE before the
caller receives the full adapter result cannot reconstruct its continuation ledger
from this inbox and cannot replay the consumed event. An atomic durable ledger/result
handoff is a remaining deployment prerequisite; this packet does not provide full
autonomous result recovery.

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
