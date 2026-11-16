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
