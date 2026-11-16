# Northflank rehearsal for BTC/EUR Paper diagnostic 002

Use the repository-qualified digest recorded in the [candidate receipt](receipts/btc-eur-paired-diag-20261116-002.identity.json). This rehearsal runs the paired host's signal handler and journal against a synthetic checkpoint. It is separate from the real run and contains no provider call.

## Prepare the isolated job

1. Use a separate manual Northflank job and a new dedicated data volume. Do not attach a historical volume. Apply the planned Paper runtime UID and mount path `/evidence-root`. Record the registry image reference, project, job, instance and volume IDs.
2. Inspect the project workload and volume inventory for active writers or another assignment of this run identity or volume. Confirm that the prospective production run directory does not exist. The platform inventory and independent receipt are needed for the host exclusivity check.
3. Select a custom entrypoint and custom command. Run Node directly as the container's foreground process with the argv below. Use the exact bytes of [host-rehearsal.mjs](../../scripts/spot-paper-paired-acceptance/host-rehearsal.mjs) as a single argument. Keep the image working directory `/app`. Use one manual attempt with retries and schedules disabled.

```text
Entrypoint: node
Command argv: --input-type=module | --eval | <source as one argument> | /evidence-root | btc-eur-paired-diag-20261116-002
```

The script requires the eval-style invocation above. Equivalent local command from the checkout root:

```sh
node --input-type=module --eval "$(cat scripts/spot-paper-paired-acceptance/host-rehearsal.mjs)" \
  "$EMPTY_CANONICAL_TEST_ROOT" btc-eur-paired-diag-20261116-002
```

## Observe stop and readback

Wait for `READY_FOR_SIGTERM`, then request one graceful platform stop. Record the request and terminal times, actual process exit, and the platform's stop evidence. Wait for `STOPPED` and the durable `READ_ONLY_VERIFIED` result. An exit without that receipt, a timeout or `UNKNOWN` leaves the gate blocked. The script waits at most three minutes for SIGTERM and uses the existing bounded journal I/O. It writes only to the synthetic `btc-eur-paired-diag-20261116-002-sigterm` directory.

The application output provides the non-root UID, matching canonical root and target path, and successful checkpoint write and readback. Combine it with the platform volume and instance assignment for `externalEvidence.mountIdentity`. For `externalEvidence.sigtermDrill`, record before/after checkpoint digests, preservation of the already-committed event, final readback, and independently measured platform stop latency. The application timing covers its own append and readback. The platform timing supplies the preflight's `graceMs`.

Local validation at UID 1000 sent an OS SIGTERM to the foreground Node process. The persisted checkpoint advanced from 1 to 2, readback was `READ_ONLY_VERIFIED`, the intended Paper directory was absent, and repeat invocation against the occupied root was refused. These local observations do not clear hosted evidence gates.

## Launch handoff after hosted rehearsal

Diagnostic 002 passed the hosted mount probe and a follow-up SIGTERM drill
with 60 seconds configured on the test job. The separate readback verified
sequence 2, a terminal event and no lock or pending file. The candidate
receipt keeps the initial interrupted journal as historical evidence.

### Exclusivity before run

The Meridian project Jobs inventory showed five jobs, all manual and with
no active run at the time of inspection. The dedicated ReadWriteOnce volume
showed one attachment, the diagnostic-002 rehearsal job. The read-only
replacement on that volume also reported that the real candidate directory
was absent. These are project-scoped observations and do not populate the
global host evidence field. Reconcile the full operational host scope and
recheck the exact job, attachment and candidate directory immediately before
launch. Keep competing launches fenced until readback. Confirm any scope
or writer reported outside the Meridian project before marking CLEAR.

- [Meridian job inventory](https://app.northflank.com/t/achi1984s-team/project/meridian/jobs)
- [Dedicated volume attachment](https://app.northflank.com/t/achi1984s-team/project/meridian/volumes/meridian-btc-eur-diag-002-rehearsal/attached)
- [Read-only replacement run](https://app.northflank.com/t/achi1984s-team/project/meridian/jobs/meridian-btc-eur-diag-002-rehearsal/observe?runs=d4dade47-7044-4a87-8315-57f6bd25165d)

The team-wide Projects view showed a single project, Meridian. Its
Services inventory listed `achi-meridian`, `meridian-paired-paper-build`
and `meridian-paper-observer`. This establishes the visible Northflank
inventory. It does not establish whether any other operator-managed host
is assigned this run identity. Leave `hostGlobalExclusivity` unpopulated
until that operational scope is reconciled.

### One-shot Paper launch plan

Use the immutable image in the candidate receipt and its original
`ENTRYPOINT`. Replace the synthetic rehearsal command completely with this
job CMD:

```text
run --data-root /evidence-root --run-id btc-eur-paired-diag-20261116-002 --account-contract BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2 --model-pair BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1
```

Use one manual attempt, zero retries, no schedule and no image-triggered runs.
Set the external timeout to 8 h 02 min and the termination grace to 60 s.
Verify the planned image, CMD, volume assignment and limits before submission.
The host enforces 8 h / 480 cycles and the receipt's data and virtual-risk
limits. The run uses a public market feed and simulated executions only.

After confirmed exit, obtain a read-only terminal export without touching
journal files or removing locks. Evaluate against the exact identity in
the receipt. Import only a verified terminal report into the private immutable
store, compare canonical digest on readback, and check run identity, coverage,
net P&L and the three arms in the authenticated Meridian dashboard. Retain
any interrupted run as interrupted and distinguish it from a full comparison.
