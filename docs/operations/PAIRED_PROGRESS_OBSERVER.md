# Bounded paired Paper progress observer

This is source/offline readiness only. It does not activate the observer,
schedule a job, provision credentials, change the gateway, or modify any Paper
run. The merged publisher/API (#1347), authenticated dashboard (#1349), and
bounded observer are separate from terminal-report evaluation and import.

Compared with the blocked draft in [#1352](https://github.com/Achi1984/meridian/pull/1352),
the current exporter has a distinct sanitized `IDENTITY_CONFLICT` result. The
observer stops on that result and defers ordinary `BUSY`/`UNKNOWN` snapshots;
do not restore the draft's ambiguous-`UNKNOWN` behavior or duplicate its
observer implementation.

## Northflank access constraint

The current Paper 002 writer uses a dedicated Northflank **Single Read/Write
(ReadWriteOnce)** volume. Northflank documents that this access mode permits
one pod at a time; a second read-only job cannot mount that volume while the
writer pod is using it. A read-only replacement is a post-exit operation, not a
live observer. See [Northflank: Add a persistent volume](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume).
The diagnostic-002 rehearsal in [#1382](https://github.com/Achi1984/meridian/pull/1382)
also verified sequential replacement readback, not concurrent live attachment.

For a future launch that needs live checkpoints, the candidate design is an
observer sidecar/container in the **same one-shot Northflank job/pod** so the
RWO volume has only one pod attachment. The observer mounts that volume
read-only and runs the existing bounded exporter in its own lifecycle; it
never changes the journal, pending marker, lock, account, or strategy state.
The RWO documentation establishes single-pod attachment, but does not by
itself establish Northflank support for this exact multi-container job,
container-specific mount mode, or isolation configuration. Verify those
capabilities against the target job/API before treating this as launchable.
Do not substitute a second job against the live volume.

Environment filtering between two processes is **not credential isolation**
when both run under the same UID/container: the writer may be able to inspect
the observer's process environment or secret. The raw uploader token must be
available only in the observer container through an observer-only secret
mount, with a distinct runtime UID, isolated PID/process namespace, no shared
process namespace, and no `CAP_SYS_PTRACE` (or equivalent process-inspection
authority) for the writer. Configure the observer container to omit the token
from the writer's environment and mounts. Validate the effective user,
mounts, capabilities, and process visibility in an offline rehearsal before
any future launch. If Northflank cannot provide and verify this boundary, do
not use the same-UID process-only design or expose the token to the writer;
the blocker is unavailable per-container secret/process isolation. The
supported alternative is to defer live publishing and use sequential
post-exit readback, or separately approve a distinct publisher service fed by
a coherent supported transfer (not a concurrent RWO attachment).

The observer lifecycle is bounded by an absolute UTC end time and a finite tick
cap; it exits after a terminal journal record or on its bound. It has no
retry/restart policy, and a publication failure must not affect the writer or
its exit handling. This requires a separately reviewed future image/entrypoint
and launch configuration; it is not an instruction to change the active Paper
002 job.

## Credential ownership and provisioning

| Component | Credential/configuration | Provisioning location and boundary |
| --- | --- | --- |
| Observer container | Raw `MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_PUBLISH_TOKEN` | New Northflank secret mounted only in the isolated observer container. Require a distinct UID/PID namespace, no shared process namespace, and no writer ptrace/process-inspection access. Never bake into the image, arguments, logs, or writer environment. |
| Progress gateway | `MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_UPLOAD_TOKEN_SHA256` plus `MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_ENABLED=true`, `MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_DEPLOYMENT_VERIFIED=true`, and exact `MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY_JSON` | Separately approved Meridian gateway deployment configuration. Store only the hash at the gateway; exact run identity allowlist is not caller-selectable. |
| Dashboard read API | Existing `MERIDIAN_READ_TOKEN_SHA256` (or its existing secret-management input before startup hashing) | Existing Meridian gateway secret configuration; this remains independent of the upload token. Dashboard users use the existing authenticated app-access flow. |
| Gateway storage | Existing private report/progress database configuration (`DATABASE_URL`) | Gateway service secret configuration only. It is never provided to the observer. |

No exchange/feed credential is needed for publishing; the public market feed
belongs only to the separately approved writer. Do not reuse the completed
report uploader, dashboard reader, database, or exchange credentials for
progress upload. The browser remains a bounded manual reader, not a scheduler
or publisher.

## Explicit observer invocation

Only after the future launch, credential placement, exact expected identity,
gateway allowlist, and dashboard configuration have been separately reviewed
and approved, the supervisor may start the observer in the writer's pod:

```sh
node "$CHECKOUT/scripts/spot-paper-paired-progress/observe.mjs" \
  --run-directory "/evidence-root/$RUN_ID" \
  --expected-identity "$EXPECTED_IDENTITY_JSON" \
  --end-at "$OBSERVER_END_AT_UTC" \
  --max-ticks "$OBSERVER_MAX_TICKS"
```

`CHECKOUT` is the absolute reviewed checkout path. The identity file must be
independently pinned, not derived from the journal. `OBSERVER_END_AT_UTC` must
be an absolute UTC timestamp and `OBSERVER_MAX_TICKS` a positive integer.
Provide `MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_PUBLISH_TOKEN` in the observer
process environment only. This invocation publishes; it is not a dry run.

The first tick is immediate; later ticks are at most once per 60 seconds on a
monotonic clock. Missed slots are skipped and ticks never overlap. The exporter
and publisher have bounded operations (3 seconds and 8 seconds by default).
`BUSY` and `UNKNOWN` snapshots defer to the next tick. A validated
`IDENTITY_CONFLICT`, sequence regression/conflict, authentication failure, or
ambiguous upload stops without retry. A successful terminal checkpoint is
published once and stops. Observer state is in memory only; a process restart
requires operator reconciliation before any new invocation.

## First checkpoint and evidence distinctions

1. Use the existing authenticated Meridian V11 strategy view and its manual
   **Paper-Checkpoint manuell prüfen** action. Confirm that the panel reports an
   available observed checkpoint and displays the three virtual arms. The
   dashboard's independently configured expected identity must be the new
   run's exact identity, not diagnostic 001 or a historical report.
2. Through the same authorized read path, verify the progress API response is
   for that exact identity and has `classification: OBSERVED_CHECKPOINT`, the
   expected `journalSequence` and `journalSha256`, and matching
   `observedAt`/`valuationAt`. The first accepted publication receipt must
   match that sequence and digest. The fixed GET endpoint has no run-ID query
   parameter:
   `https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/spot-paper-paired-progress`.
3. Keep these separate: journal sequence/digest and the committed valuation
   are observed progress; the API readback is the last published checkpoint;
   feed health is not reported by this contract; and an evaluator-verified
   terminal report is separate evidence. A dashboard checkpoint is not a
   running/liveness claim or terminal verification.

The current `SPOT_PAPER_PAIRED_PROGRESS_V1` snapshot does **not** contain the
run `startedAt`, a last successful feed-poll timestamp, or cycle progress. The
source journal does retain `manifest.startedAt` and, on a committed
`shared_observation`, `cycle` and the validated ticker `receivedAt`. The
minimal future source change is to project those exact values into the
progress payload and extend the validator, gateway/store contract, dashboard
model/view, and focused tests. Use the last committed observation's
`ticker.receivedAt` as the successful poll time only if the producer contract
continues to define it that way; otherwise add and validate an explicit
successful-poll field at the journal source. Do not substitute `valuationAt`,
`observedAt`, `exportedAt`, or a publication receipt time for a successful
feed poll.

`BUSY`/`UNKNOWN` exports are not publishable. A terminal event is only
`TERMINAL_RECORDED` or `INTERRUPTED_RECORDED`; only the independent terminal
evaluator and private report readback can establish a verified final report.
The [paired progress runbook](PAIRED_PROGRESS_RUNBOOK.txt) and
[Paper 002 post-run checklist](BTC_EUR_PAIRED_DIAG_002_POSTRUN.md) preserve
the separate operation boundaries.

Focused source tests:

```sh
node --test test/spot-paper-paired-progress-export.test.js \
  test/spot-paper-paired-progress-observe.test.js
```
