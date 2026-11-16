# BTC/EUR paired diagnostic 002: post-exit terminal export checklist

## Scope and evidence available

This is a post-exit-only, read-only checklist. It does not authorize or change
the active writer, image, volume, journal, runtime, strategy, time limit,
permissions, schedule, or credentials. Do not mount or read its volume until
Northflank independently shows the writer is terminal and its pod has detached.

The latest available candidate evidence is the [#1382 identity receipt at
head `87e8cacbdc28b362ac3d416507b8a3cbaf15019f`](https://github.com/Achi1984/meridian/blob/87e8cacbdc28b362ac3d416507b8a3cbaf15019f/docs/operations/receipts/btc-eur-paired-diag-20261116-002.identity.json)
and its [rehearsal record](https://github.com/Achi1984/meridian/blob/87e8cacbdc28b362ac3d416507b8a3cbaf15019f/docs/operations/BTC_EUR_PAIRED_DIAG_002_REHEARSAL.md).
That receipt identifies:

| Item | Recorded value |
| --- | --- |
| Paper run ID | `btc-eur-paired-diag-20261116-002` |
| Northflank writer run observed | `b1cab3ae-4362-4cb4-b09b-fcd7a8a1b025`, recorded `RUNNING` at `2026-11-16T17:34:11.542Z`; this is a dated snapshot, not current status |
| Northflank project/job | `meridian` / `meridian-btc-eur-diag-002-rehearsal` |
| Pinned registry image | `registry.northflank.com/meridian/meridian-paired-paper-build@sha256:936bda34bfe1445be9ecee9be0324d33f55ba2966b9822ac4c2bad44fdf1f91e` |
| Evidence volume and mount | Dedicated `meridian-btc-eur-diag-002-rehearsal` ReadWriteOnce volume at `/evidence-root`; rehearsal reported runtime UID 1000 |
| Evidence directory | `/evidence-root/btc-eur-paired-diag-20261116-002` |
| Host command limits in receipt | One manual attempt, zero automatic retries, external timeout 28,920 seconds |

The receipt also records a first **synthetic rehearsal** whose terminal
checkpoint did not commit and whose readback retained a writer lock and
pending publication. A separate `/evidence-root/platform-r2` synthetic
follow-up verified SIGTERM, sequence `1→2`, exit code 0, and a read-only
replacement with no lock/pending file. Neither synthetic attempt is a Paper
002 result. Keep the attempts separate and preserve the first rehearsal's
evidence. The latest candidate receipt records the host uniqueness check and
launch; recheck current provider state before post-exit work. No terminal Paper
002 export, evaluator result, report digest, private import, or dashboard
readback is available in this preparation.

## Read-only retrieval after writer exit

1. Recheck the exact Northflank writer run, confirm the container is stopped,
   and confirm the RWO volume is detached from its pod. Do not infer completion
   from elapsed time, `RUNNING` snapshots, logs, or a terminal-looking journal
   file. If the writer remains active, stop here.
2. Start a separate, manual, one-attempt reader Job using the exact pinned
   registry digest above and the same persistent volume mounted read-only at
   `/evidence-root`. Use a reader Job ID and instance name distinct from the
   writer. Disable schedules, restart, and retries; do not attach the volume
   concurrently. This is a sequential RWO replacement, as rehearsed in #1382.
3. Use a private local staging directory and an operator-authenticated
   Northflank CLI. Keep CLI credentials outside the Job and shell command
   arguments. The reader's custom command can capture the structural status
   and terminal export in its temporary filesystem without printing the
   private export to logs:

   ```sh
   umask 077
   node /app/scripts/spot-paper-paired/host.mjs status \
     --data-root /evidence-root \
     --run-id btc-eur-paired-diag-20261116-002 \
     > /tmp/paired-002-status.json \
     2> /tmp/paired-002-status.stderr
   printf '%s\n' "$?" > /tmp/paired-002-status.exit
   node /app/scripts/spot-paper-paired/host.mjs export \
     --data-root /evidence-root \
     --run-id btc-eur-paired-diag-20261116-002 \
     > /tmp/paired-002-export.json \
     2> /tmp/paired-002-export.stderr
   printf '%s\n' "$?" > /tmp/paired-002-export.exit
   node /app/scripts/spot-paper-paired/host.mjs package \
     --data-root /evidence-root \
     --run-id btc-eur-paired-diag-20261116-002 \
     --archive /tmp/btc-eur-paired-diag-20261116-002.tar \
     --manifest /tmp/btc-eur-paired-diag-20261116-002.manifest.json \
     --retrieval-window-ms 300000 \
     > /tmp/paired-002-package.json \
     2> /tmp/paired-002-package.stderr
   package_exit=$?
   printf '%s\n' "$package_exit" > /tmp/paired-002-package.exit
   if [ "$package_exit" -ne 0 ]; then sleep 300; fi
   ```

   Run this as a reviewed custom `/bin/sh -c` command in the reader Job. The
   package command waits for the five-minute native download window when it
   succeeds; it intentionally refuses a lock or pending publication. If it
   fails, the shell still waits so the status/export and error metadata can be
   downloaded. Do not use `set -e` to hide or discard an export failure:
   retain every exit status, stderr file, and output in the private staging
   area. A nonzero export exit, invalid JSON, writer lock, pending publication,
   `INCOMPLETE_UNKNOWN`, or a reconciliation status other than
   `READ_ONLY_VERIFIED` is not a verified terminal export.
4. Download both files from the exact reader Job and instance into separate
   empty local directories. Substitute only operator-selected IDs and private
   staging paths:

   ```sh
   set -euo pipefail
   umask 077
   : "${READER_JOB_ID:?set the separate reader Job ID}"
   : "${READER_INSTANCE_NAME:?set the exact reader instance name}"
   stage="$(mktemp -d)"
   mkdir "$stage/status" "$stage/export" "$stage/metadata"
   northflank download job file \
     --projectId meridian \
     --jobId "$READER_JOB_ID" \
     --instanceName "$READER_INSTANCE_NAME" \
     --remotePath /tmp/paired-002-status.json \
     --localPath "$stage/status"
   northflank download job file \
     --projectId meridian \
     --jobId "$READER_JOB_ID" \
     --instanceName "$READER_INSTANCE_NAME" \
     --remotePath /tmp/paired-002-export.json \
     --localPath "$stage/export"
   for file in paired-002-status.stderr paired-002-status.exit \
     paired-002-export.stderr paired-002-export.exit \
     paired-002-package.json paired-002-package.stderr paired-002-package.exit; do
     northflank download job file \
       --projectId meridian \
       --jobId "$READER_JOB_ID" \
       --instanceName "$READER_INSTANCE_NAME" \
       --remotePath "/tmp/$file" \
       --localPath "$stage/metadata"
   done
   if [ "$(cat "$stage/metadata/paired-002-package.exit")" = 0 ]; then
     mkdir "$stage/archive" "$stage/manifest"
     northflank download job file \
       --projectId meridian \
       --jobId "$READER_JOB_ID" \
       --instanceName "$READER_INSTANCE_NAME" \
       --remotePath /tmp/btc-eur-paired-diag-20261116-002.tar \
       --localPath "$stage/archive"
     northflank download job file \
       --projectId meridian \
       --jobId "$READER_JOB_ID" \
       --instanceName "$READER_INSTANCE_NAME" \
       --remotePath /tmp/btc-eur-paired-diag-20261116-002.manifest.json \
       --localPath "$stage/manifest"
   fi
   ```

5. Record a SHA-256 of the exact host-export bytes and validate the envelope,
   journal checksum, and expected identity with the existing evaluator. The
   expected identity must be independently reviewed from the finalized #1382
   receipt; never derive it from the exported journal. Keep the payload and
   credentials private:

   ```sh
   CHECKOUT=/path/to/reviewed/meridian
   RUN_ID=btc-eur-paired-diag-20261116-002
   EXPECTED_IDENTITY_JSON=/private/path/to/verified-002.expected-identity.json
   statusFile="$stage/status/paired-002-status.json"
   exportFile="$stage/export/paired-002-export.json"
   dtoFile="$stage/paired-002-dashboard-dto.json"
   jq -e --arg runId "$RUN_ID" \
     '.runId == $runId and
      .status == "TERMINAL_JOURNAL_VERIFIED" and
      .verifiedTerminal == true and
      .writerLockPresent == false and
      .pendingPublication == false and
      .reconciliationStatus == "READ_ONLY_VERIFIED"' \
     "$statusFile" > /dev/null
   jq -e --arg runId "$RUN_ID" \
     '.runId == $runId and
      .status == "TERMINAL_JOURNAL_VERIFIED" and
      .verifiedTerminal == true and
      .reconciliationStatus == "READ_ONLY_VERIFIED" and
      .journal.runId == $runId' \
     "$exportFile" > /dev/null
   sha256sum "$exportFile" > "$stage/paired-002-export.sha256"
   node "$CHECKOUT/scripts/spot-paper-paired-report/cli.mjs" \
     "$EXPECTED_IDENTITY_JSON" "$exportFile" > "$dtoFile"
   jq -e --arg runId "$RUN_ID" \
     '.identity.runId == $runId and
      .evidenceStatus == "VERIFIED_COMPLETE" and
      .reasonCode == "TERMINAL_REPORT_RECONCILED" and
      .syntheticFixture == false' \
     "$dtoFile" > /dev/null
   ```

   The evaluator verifies the terminal journal/report against the independently
   supplied identity and reconciles the journal checksum and accounting. Keep
   the host-export SHA-256 separate from the report-ingester digest; they hash
   different payloads. Do not import an `INTERRUPTED`, `INCOMPLETE_UNKNOWN`,
   `CORRUPT_UNKNOWN`, identity-mismatched, or non-verified result.

## Optional byte-exact archive

The host `package` command writes only to the reader's temporary filesystem.
It is part of the inspection command above and intentionally refuses a
non-quiescent run. If it fails, do not retry it against a locked/pending run;
preserve incomplete evidence on the original volume instead of trying to
repair, clean, rename, or restart it.

When package exit is zero, the command above downloads the archive and manifest
using the exact reader Job/instance identifiers into separate empty
directories. Compare the archive
SHA-256 with `archiveSha256` from that package result, then validate every
manifest path, member type, size, and hash before extraction. Follow the
bounded TAR/manifest validation sequence in
[`BTC_EUR_8H_POSTRUN_20261108.md`](BTC_EUR_8H_POSTRUN_20261108.md); do not
extract an unvalidated archive. Keep the original volume unchanged.

```sh
archive="$stage/archive/btc-eur-paired-diag-20261116-002.tar"
manifest="$stage/manifest/btc-eur-paired-diag-20261116-002.manifest.json"
expected_archive_sha256="$(jq -er '.archiveSha256' \
  "$stage/metadata/paired-002-package.json")"
printf '%s  %s\n' "$expected_archive_sha256" "$archive" | sha256sum -c -
```

## Private report import and dashboard readback

Import only a DTO whose evaluator output passed the `VERIFIED_COMPLETE` checks
above. The staged DTO, expected identity, host export, hashes, and database
connection are private. Set `DATABASE_URL` only in the separately authorized
private import environment through its secret manager; never put credentials
in command arguments, files committed to the repository, logs, or receipts.

First compute the immutable report-envelope digest without writing, then write
once and require the same digest and `INSERTED` or `IDENTICAL` result:

```sh
node "$CHECKOUT/scripts/spot-paper-paired-report/ingest.mjs" \
  "$EXPECTED_IDENTITY_JSON" "$dtoFile"
node "$CHECKOUT/scripts/spot-paper-paired-report/ingest.mjs" \
  "$EXPECTED_IDENTITY_JSON" "$dtoFile" --write
```

The dry run returns the run ID and canonical ingester `digest`; record it
separately from `paired-002-export.sha256`. The write path is immutable and
compares an existing row's configuration and digest. On `CONFLICT` or
`OUTCOME_UNKNOWN`, do not retry blindly or overwrite; inspect the authorized
readback first. A `DATABASE_URL` permission or migration change is outside this
checklist and needs separate approval.

The paired-report gateway is configured for one exact expected identity and
its GET has no run-ID query parameter. Before readback, separately authorize
the gateway and V11 dashboard configuration to use the verified Paper 002
identity; the current dashboard identity is not a license to change the active
writer or production permissions. The report gateway's configuration names are
`MERIDIAN_SPOT_PAPER_PAIRED_REPORT_ENABLED`,
`MERIDIAN_SPOT_PAPER_PAIRED_REPORT_DEPLOYMENT_VERIFIED`, and
`MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON`. The progress
dashboard identity is separately pinned in
`$CHECKOUT/v11/spot-paper-paired-progress-config.js`; configure it only in a
separately approved future dashboard release. Then use the existing authenticated Meridian
V11 app-access flow and **Gepaarter Paper-Vergleich** view. Confirm the displayed
run ID is `btc-eur-paired-diag-20261116-002`, status is
`VERIFIED_COMPLETE`, all three arms and expected coverage are present, and
the canonical report matches the staged DTO. The private gateway checks the
stored envelope digest on read. Preserve the dry-run/write digest and
authenticated readback result together; a checkpoint or terminal journal
record alone is not a verified report or profitability claim.

## Interrupted or incomplete run retention

If the run has a writer lock, pending publication, missing/corrupt journal,
invalid export, or evaluator result other than `VERIFIED_COMPLETE`, preserve
the original RWO volume and all files exactly as found, plus any bounded
read-only export and status output that could be obtained. Do not remove locks
or pending files, repair or finalize the journal, relaunch the writer, import a
partial report, or label it complete. Keep it classified as interrupted or
unknown until separately reviewed. A failed or partial readback is evidence to
retain, not a reason to run again.

## Offline verification

These existing source suites use synthetic fixtures and make no provider,
gateway, or production database request:

```sh
node --test \
  test/spot-paper-paired-progress-export.test.js \
  test/spot-paper-paired-progress-observe.test.js \
  test/spot-paper-paired-report.test.js \
  test/spot-paper-paired-report-ingest.test.js \
  test/spot-paper-paired-report-gateway.test.js \
  test/v11-paper-bot-report-bootstrap.test.js
```
