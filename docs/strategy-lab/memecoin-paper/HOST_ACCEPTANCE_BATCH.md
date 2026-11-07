# Paper host-acceptance batch

This is a one-shot, synthetic-only batch using the existing ProofA
`PIPELINE_QUOTE`, ProofA `ACTIVE_STOP`, and source-policy controller no-entry
proofs. It does not establish host durability, provider trust, quote readiness,
or live execution. A successful batch reports `hostAcceptance: NOT_ASSESSED`.
The feature is disabled unless explicitly enabled.

## Preconditions

- Lead review of the exact source commit containing this entrypoint and a
  published immutable registry digest for the corresponding image.
- A unique run ID and the final full 40-character source revision and full
  `sha256:` image digest supplied explicitly below.
- A verified persistent volume mounted at `/var/data/meridian-paper`; the
  entrypoint requires `/proc/self/mountinfo` to identify that exact mount and
  independently checks the real mount root is UID 0, GID 1000, mode `03775`,
  with no symlink ancestry. Its direct child
  `/var/data/meridian-paper/host-acceptance-batch` must be a private UID 1000
  directory with mode `0700` or `02700`.
- The service runs as UID/GID `1000:1000`. Do not change mount ownership or
  permissions. In particular, a `02775` mount is not accepted. The separately
  scoped volume-protection repair is not part of this procedure and must not be
  run without separate approval for that exact repair.

The previous rehearsal source pin `fc5b3d97f62b8a9098e53a99eaa9a03b7955e5aa`
does not contain this batch entrypoint. Its recorded local image IDs are not
published registry digests; do not use either as the image pin. This runbook
does not authorize publishing, deployment, provider calls, credential access,
or additional spend.

## Northflank one-shot configuration

Use the dedicated Paper worker with its already verified volume attached. Set
both the custom entrypoint and custom command: the image's default entrypoint
is `pilot-online.mjs`, and a CMD-only override would invoke the wrong program.

```text
Custom entrypoint: node
Custom command: scripts/memecoin-paper/host-acceptance-batch.mjs

PAPER_HOST_ACCEPTANCE_BATCH_ENABLED=true
PAPER_HOST_ACCEPTANCE_BATCH_SOURCE_REVISION=<reviewed full 40-character source commit>
PAPER_HOST_ACCEPTANCE_BATCH_IMAGE_DIGEST=sha256:<published immutable image digest>
PAPER_HOST_ACCEPTANCE_BATCH_RUN_ID=<unique letters-digits-dot-underscore-hyphen ID>
PAPER_HOST_ACCEPTANCE_BATCH_HOLD=true
```

`HOLD=true` keeps the worker inert after completion, failure, or discovery of an
existing claim. It forwards SIGINT/SIGTERM to an active proof and waits for that
proof to finish within the single monotonic batch deadline of at most 60 seconds.
Configure at least **65 seconds of platform termination grace**. The batch
claim is exclusive, synced, and permanent: after any interruption or ambiguous
write, preserve it and all evidence; never clear it or retry with the same
volume. A restart reports `ALREADY_CLAIMED` and starts no proof.

The batch invokes no network operation and reads no credentials. It forces
synthetic HTTPS off and supplies no TLS or authorization file settings. Keep the
worker private with no public port. Do not configure production application
entrypoints, secrets, or provider credentials for this task.

## Expected outcome and evidence

The output is `BATCH_COMPLETE` only after all three exact result contracts and
their stored config/export hashes and readbacks pass:

1. `PIPELINE_QUOTE`: exit `0`, `PASS`, `contractChecks: PASS`.
2. `ACTIVE_STOP`: exit `2`, `UNKNOWN`, `contractChecks: PASS`, and
   `OPEN_UNVALUED_TERMINAL_POSITION`.
3. Controller no-entry: exit `2`, `UNKNOWN`, acknowledged export,
   `SOURCE_POLICY_UNAPPROVED`, `networkAccessed: false`, zero quotes, and zero
   entry fills.

Claim, manifests, proof output/exit receipts, original exports, and readback
hashes remain under `/var/data/meridian-paper/host-acceptance-batch`. Preserve
the entire directory for independent review. `BATCH_COMPLETE` is synthetic
contract evidence only; it is not host acceptance or permission to activate a
Paper worker. Actual host acceptance remains unperformed until the Lead has the
published image digest and independently verifies the host prerequisites.
