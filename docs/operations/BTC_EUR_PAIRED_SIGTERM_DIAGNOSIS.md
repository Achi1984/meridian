# BTC/EUR paired-paper Northflank termination diagnosis

## Finding

The available diagnostic-002 evidence does **not** establish whether Northflank
delivered SIGTERM to the application, how much termination grace the instance
received, or whether the process exited cleanly. `Process terminated` about a
second after the operator request is not enough to distinguish a quick graceful
exit, a short or expired platform grace period, delayed log delivery, or
instance disposal. Do not describe the run as a clean stop or claim SIGTERM was
missed.

The separate read-only result (`sequence=1`,
`writerLockPresent=true`, `pendingPublication=true`,
`UNKNOWN_PENDING_PUBLICATION`, no terminal event) is fail-closed evidence of an
unresolved journal publication. It is not a terminal readback. Keep the
original volume and every file on it unchanged, including `writer.lock`,
`journal.pending`, and any temporary journal file. The report of no candidate
directory does not establish what happened to the journal's temporary file.

## Frozen implementation and concrete failure modes

The paired image uses an exec-form Node entrypoint and runs as the `node` user
([`Dockerfile.spot-paper-paired`](../../Dockerfile.spot-paper-paired)). In
[`scripts/spot-paper-paired/host.mjs`](../../scripts/spot-paper-paired/host.mjs),
`runSpotPaperPairedWithSignals` handles SIGTERM by aborting an `AbortController`
and awaits the run. It does not spawn a child, impose a host-level shutdown
deadline, or escalate to SIGKILL. Its five-second bound is for read-only status
inspection, not shutdown.

The paired runner propagates cancellation to feed/sleep work. The terminal
journal append and close each use a five-second operation deadline in
[`scripts/spot-paper-paired/forward.mjs`](../../scripts/spot-paper-paired/forward.mjs);
these are per-operation cooperative deadlines, not a hard end-to-end process
deadline. Filesystem publication is staged in
[`scripts/spot-paper-pilot/journal.mjs`](../../scripts/spot-paper-pilot/journal.mjs):
write and sync `journal.pending`, write and sync a temporary journal file,
rename it over `journal.json`, sync the directory, read back and validate the
candidate, then remove and sync the pending marker. An ambiguous I/O failure
fences the writer. An interruption can therefore leave a lock and pending
marker before, during, or after rename/readback; none proves a terminal commit.

Read-only paired-host verification in `host.mjs` requires no writer lock, no
pending marker, `READ_ONLY_VERIFIED`, and a terminal event whose report names
the requested run. Otherwise it returns `WRITER_LOCK_PRESENT` or
`INCOMPLETE_UNKNOWN`; it does not repair the journal. The local SIGTERM test
in [`test/spot-paper-paired-forward.test.js`](../../test/spot-paper-paired-forward.test.js)
proves that a delivered OS signal can preserve a committed synthetic cycle and
seal a synthetic journal. The host wrapper test in
[`test/spot-paper-paired-host.test.js`](../../test/spot-paper-paired-host.test.js)
proves signal-to-abort mapping and listener cleanup. Neither test establishes
Northflank control-plane delivery, live job grace configuration, or this
diagnostic's interrupted publication outcome.

Consequently, a platform instance Terminate may end in any of these concrete
states:

| Failure mode | Evidence that would support it | What it does not prove |
| --- | --- | --- |
| Graceful application stop | Process signal-received marker, terminal append/readback and journal close markers, followed by terminal readback with no lock or pending marker | That the platform request and process timestamps were synchronized unless clock offset is known |
| Signal transit/delivery unknown | Platform records a termination request, but the frozen image has no application signal-received marker | That SIGTERM was missed; log loss, delivery delay, or process exit before marker capture remain possible |
| Grace expires / process disposed | Platform records forced termination or instance deletion before process completion; process markers stop before terminal acknowledgement | Whether the journal failed independently unless the preserved journal identifies its publication stage |
| Journal publication ambiguity/error | Pending marker, writer lock, checksum/readback error, missing terminal event, or non-verified reconciliation in preserved evidence | A clean stop, even if the `journal.json` candidate appears to contain a terminal event |
| Instance exits early | Platform reports process/container exit before the configured grace expires | That the stop was requested by the application rather than a platform action |

## Northflank documentation boundary

Northflank's [scale instances documentation](https://northflank.com/docs/v1/application/scale/scale-instances.md)
says a configurable termination grace period applies to jobs as well as
services: the container receives SIGTERM, then can be forcibly terminated with
SIGKILL when the grace expires; the documented default is 30 seconds, and a
container may exit sooner. Its
[run an image once or on a schedule guide](https://northflank.com/docs/v1/application/run/run-an-image-once-or-on-a-schedule)
and [job settings API](https://northflank.com/docs/v1/api/project/jobs/update-job-settings?tab=api)
describe job configuration, not the live settings of this instance.

The paired launch runbook specifies an eight-hour-two-minute job timeout and a
60-second termination grace period. Neither that proposal nor the Northflank
default proves which values were active for diagnostic 002; the lead is
checking the live job configuration separately. Do not conflate an operator
instance-Terminate action with the application's bounded SIGTERM handler or
with the job's maximum runtime. Record the actual job settings and lifecycle
events before interpreting an elapsed time.

## Fail-closed hosted verification protocol

This is a proposal for a separately authorized rehearsal, not permission to
change Northflank, start a Paper/provider run, or reuse the diagnostic-002
volume.

1. **Freeze the original evidence.** Record the Northflank project, job,
   instance, volume, image repository digest, run ID, command, timeout,
   termination grace, retry/restart policy, and mount path as observed. Do not
   restart, retry, delete, remount read/write, or clean the original volume.
   Have an independently run read-only export/package preserve the complete
   volume bytes and a path/size/SHA-256 manifest outside that volume. Retain the
   original and package as immutable evidence.
2. **Require a fresh namespace.** Only after separate authorization, use a
   new unique job/instance and durable volume, a never-before-used run ID, the
   exact immutable image digest being tested, one attempt, no schedule/retry,
   and restart policy `Never`. Verify the mount is writable by UID 1000 before
   starting anything. Never attach the original volume to the rehearsal.
3. **Capture platform timestamps.** Export the control-plane request time,
   accepted action time, instance/job state-transition times, container stop
   or termination time, any forced-kill/deletion event, and the settings
   snapshot. Preserve Northflank's native event timestamps and retrieval time;
   do not infer signal delivery from the UI request time or the last log line.
4. **Capture process timestamps.** The frozen host currently emits no
   signal-received or journal-publication lifecycle markers. A future
   instrumented candidate must emit structured UTC and monotonic timestamps
   (with PID and run ID) for SIGTERM receipt, terminal append start and
   acknowledgement, writer-lock close, and process exit. Test those markers
   offline first. Keep platform timestamps and process timestamps separate;
   establish clock offset/uncertainty before comparing them. Without a
   process-side signal marker, classify delivery as **UNKNOWN**.
5. **Observe without weakening the stop.** Send exactly one bounded stop only
   in the authorized fresh namespace. Record the operator request timestamp
   independently. Do not send repeated signals, increase the grace period
   mid-run, restart the process, or intervene in journal publication. If the
   process does not finish within the configured grace, let the platform's
   configured termination behavior stand and record it.
6. **Read back terminal state.** After independently confirming the writer has
   stopped, attach the rehearsal volume read-only to a separate one-shot
   inspector with a finite external timeout. Require `TERMINAL_JOURNAL_VERIFIED`,
   `verifiedTerminal=true`, `READ_ONLY_VERIFIED`, a matching run ID and
   terminal event/report, no `writer.lock`, and no `journal.pending`. Preserve
   the raw export and its hash. Any missing marker, timeout, lock, pending
   publication, checksum error, missing terminal event, or identity mismatch
   remains UNKNOWN/INCOMPLETE; do not repair, relaunch, or promote it.

The timestamp sequence distinguishes platform request-to-stop transit from
process handling and journal completion. A signal marker followed by no
terminal acknowledgement points to interrupted cleanup or a journal error;
the journal marker, temporary file, hashes, and readback reconciliation
distinguish publication stages. A recorded platform force-kill/deletion before
the process's completion markers supports disposal within the configured
grace. Missing process markers or a missing instance alone do not prove
non-delivery. Until a fresh, authorized rehearsal satisfies every readback
gate, diagnostic 002 remains `UNKNOWN_PENDING_PUBLICATION`.
