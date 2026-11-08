# BTC/EUR eight-hour pilot: post-run retrieval and assessment

## Scope and known state

This is a post-run handoff for the already launched, one-shot paper pilot. It
does not authorize a new writer, touch or stop the running job, or extend the
existing one-run egress exception. **Do not begin retrieval or start any
maintenance instance until the writer is independently confirmed stopped.**

| Identity | Value |
| --- | --- |
| Northflank project ID | `meridian` |
| Northflank job ID | `meridian-btc-paper-host-8h` |
| Reviewed image/build label | `stiff-run-1846` |
| Source revision bound to that image | `473943fb20d8ef25a5822c89a5abfb216437d782` |
| Writer Northflank run ID | `e7916ab3-3b3e-43f8-a07a-27204c066c15` |
| Writer Northflank instance name | `meridian-btc-paper-host-8h-6af07e22a8cdd5b245eb83af-ncb4m` |
| Evidence run ID | `btc-eur-paper-host-8h-001` |
| Profile and model | `BTC_EUR_PAPER_HOST_8H_V1` / `BTC_EUR_SMA5_SMA20_V1` |
| Persistent evidence path in the container | `/evidence-root/btc-eur-paper-001` |
| Start receipt | [issue #1279, comment 6722330496](https://github.com/Achi1984/meridian/issues/1279#issuecomment-6722330496) |

The start receipt recorded the writer as `TASK_RUNNING` and the packaged status
as `RUNNING_OBSERVED`. That was an initial observation only, not a terminal
result. The actual eight-hour evidence tree has **NOT_YET_RETRIEVED** status;
there is no result, performance finding, or profitability claim to report.

Prior transport rehearsals are limited proofs, not pilot results:

- The small-file native download and hash comparison are verified by
  [PR #1282, comment 6721975395](https://github.com/Achi1984/meridian/pull/1282#issuecomment-6721975395).
- The small archive plus manifest download, archive hash, and member size/hash
  checks are verified by
  [issue #1279, comment 6722023990](https://github.com/Achi1984/meridian/issues/1279#issuecomment-6722023990).
  The maintenance run was later recorded as provider-failed because its idle
  retrieval hold was intentionally ended; its completed download and independent
  byte checks remain verified. This is not a full-size archive test.

## Controlled post-run sequence

1. **Independently establish that the writer is terminal.** Check the Northflank
   task/run state for the writer run ID above and confirm the writer container
   is no longer active. Do not infer this from an evidence status or elapsed
   clock alone. If still running, stop here; do not mount or start maintenance.
   Do not abort, retry, relaunch, or replace the writer or its evidence.

2. **Read packaged status and report from the retained volume.** Use the reviewed
   image as a separate, read-only inspection instance, with custom entrypoint
   `node`, no schedule/restart/retry, and the original persistent volume mounted
   read-only at `/evidence-root`. The actual evidence argument is
   `/evidence-root/btc-eur-paper-001` (not the generic `/var/lib/...` examples in
   older host notes). Run these existing entrypoint commands as separate
   one-shot inspections:

   ```text
   scripts/spot-paper-pilot/host-entrypoint.mjs status --evidence-dir /evidence-root/btc-eur-paper-001
   scripts/spot-paper-pilot/host-entrypoint.mjs report --evidence-dir /evidence-root/btc-eur-paper-001
   ```

   Preserve both outputs. A `FAILED`, `INCOMPLETE_UNKNOWN`, missing, or
   inconsistent result is still evidence to retain; it is not permission to
   repair or rerun the writer.

3. **Preserve the complete tree.** Keep the entire original
   `/evidence-root/btc-eur-paper-001` tree unchanged, including host state,
   locks, journals, pending or candidate journal files, responses, and partial
   or corrupt files. Do not clean, rename, repair, or selectively copy files
   from the persistent volume.

4. **Package once in a separate bounded maintenance run.** Only after step 1,
   start a manual instance of the same reviewed job/image with the same volume
   mounted read-only at `/evidence-root`, custom entrypoint `node`, schedules,
   CI/CD, restart, and retry disabled, and no public port. Use the existing
   package command and distinct temporary outputs:

   ```text
   scripts/spot-paper-pilot/package-host-evidence.mjs /evidence-root/btc-eur-paper-001 /tmp/btc-eur-paper-001.tar /tmp/btc-eur-paper-001.manifest.json --retrieval-window-ms 300000
   ```

   The command requires three absolute paths and optionally
   `--retrieval-window-ms <1..300000>`; the image's working directory is
   `/app`, so the relative script path above resolves to the packaged
   entrypoint. The source volume is read-only; only the separate maintenance
   container's temporary filesystem receives the TAR and manifest. Capture the
   small package result, especially `archiveSha256`, `archiveBytes`, status,
   and file count. `PACKAGED_BYTES_ONLY` and `operationalReadiness:
   NOT_ASSESSED` mean byte preservation only, not a successful paper run.

   The five-minute hold is required because the native file-copy command needs
   a running container. Configure a one-attempt maintenance run with an external
   timeout of at least 390 seconds (60-second cooperative package budget, 300
   seconds of retrieval window, and 30-second exit margin); do not add an
   automatic retry. Keep this maintenance run distinct from the original writer
   run and from both rehearsal runs. Provide at least 84 MiB of temporary
   storage for the archive. Never automatically abort, retry, or replace a
   failed/incomplete package or the retained writer evidence.

5. **Authenticate the Northflank CLI outside the job.** Use the operator's
   already approved local CLI authentication flow before starting downloads.
   The browser's Local access → Download panel only displays/copies CLI
   instructions; it does not authenticate the CLI. Never put tokens, passwords,
   or other credentials in the job, command line, logs, or this runbook.

6. **Pin the exact active maintenance instance and download both files.** Record
   the run ID and instance name returned when the packaging maintenance run is
   started. Use that maintenance `instanceName` with the actual Northflank
   `--jobId` option. Do not use the writer's instance name, the job name as an
   instance name, or either rehearsal instance. Create separate empty local
   destination directories first; observed `--localPath` semantics treat its
   value as a **destination directory** and append the remote basename.
   Keep one local shell session open through steps 6–9 so the private staging
   path remains available.

   ```sh
   set -euo pipefail
   umask 077
   stage="$(mktemp -d)"
   : "${MAINTENANCE_INSTANCE_NAME:?set this to the exact instance name from the packaging run}"
   mkdir "$stage/archive" "$stage/manifest"
   northflank download job file \
     --projectId meridian \
     --jobId meridian-btc-paper-host-8h \
     --instanceName "$MAINTENANCE_INSTANCE_NAME" \
     --remotePath /tmp/btc-eur-paper-001.tar \
     --localPath "$stage/archive"
   northflank download job file \
     --projectId meridian \
     --jobId meridian-btc-paper-host-8h \
     --instanceName "$MAINTENANCE_INSTANCE_NAME" \
     --remotePath /tmp/btc-eur-paper-001.manifest.json \
     --localPath "$stage/manifest"
   ```

   The resulting files are
   `$stage/archive/btc-eur-paper-001.tar` and
   `$stage/manifest/btc-eur-paper-001.manifest.json`. Verify the downloaded
   archive SHA-256 against `archiveSha256` from this maintenance run's package
   result before inspecting or extracting it:

   ```sh
   : "${EXPECTED_ARCHIVE_SHA256:?set this to archiveSha256 from this packaging run}"
   printf '%s  %s\n' "$EXPECTED_ARCHIVE_SHA256" \
     "$stage/archive/btc-eur-paper-001.tar" | sha256sum -c -
   ```

   `$EXPECTED_ARCHIVE_SHA256` is the recorded 64-character hash from that
   package result, not a value copied from a rehearsal. Keep the package result,
   downloaded manifest, command outcome, and hashes with the local review
   record. Do not download files from the original writer instance.

7. **Validate the manifest and every archive member before assessment.** Use
   local `jq` and GNU `tar` to validate relative paths, the complete regular-file
   member set, and member types before extraction:

   ```sh
   set -euo pipefail
   archive="$stage/archive/btc-eur-paper-001.tar"
   manifest="$stage/manifest/btc-eur-paper-001.manifest.json"
   files="$stage/manifest/member-paths.txt"
   jq -e '
     .schemaVersion == "SPOT_PAPER_HOST_EVIDENCE_MANIFEST_V1" and
     .preservation == "BYTE_EXACT" and
     (.entries | type == "array") and
     ([.entries[].path] | length == (unique | length)) and
     all(.entries[];
       (.path | type == "string" and length > 0 and
         (startswith("/") | not) and (contains("\\") | not) and
         all(split("/"); . != "" and . != "." and . != "..") and
         ((split("/")[0] | test("^[A-Za-z]:") | not))) and
       (.sizeBytes | type == "number" and . >= 0 and floor == .) and
       (.sha256 | test("^[0-9a-f]{64}$"))
     )
   ' "$manifest" > /dev/null
   jq -r '.entries[].path' "$manifest" | LC_ALL=C sort > "$files"
   archive_file_count="$(tar -tvf "$archive" | awk '
     substr($0, 1, 1) == "-" { files++ }
     substr($0, 1, 1) != "-" && substr($0, 1, 1) != "d" { invalid = 1 }
     END { if (invalid) exit 1; print files + 0 }
   ')"
   manifest_file_count="$(jq '.entries | length' "$manifest")"
   test "$archive_file_count" = "$manifest_file_count"
   ```

   The manifest must not contain duplicate, absolute, empty, `.` or `..` path
   components. The TAR listing may contain only regular files (`-`) and
   directories (`d`), and its regular-file count must equal the manifest entry
   count. The package implementation rejects symlinks, special files, and
   escaping/unsupported paths, and its result is round-trip verified; these
   checks must still be repeated on the downloaded bytes. Stop on any mismatch;
   never assess an unverified archive.

8. **Extract validated regular files into a new isolated directory.** The
   manifest path list is used as the extraction allowlist. Create a private,
   previously nonexistent destination; `--keep-old-files` makes extraction fail
   rather than overwrite:

   ```sh
   extracted="$stage/extracted"
   test ! -e "$extracted"
   mkdir -m 700 "$extracted"
   tar --extract --file "$archive" --directory "$extracted" \
     --no-same-owner --no-same-permissions --keep-old-files \
     --files-from "$files"
   while IFS=$'\t' read -r size path; do
     actual_size="$(wc -c < "$extracted/$path" | tr -d '[:space:]')"
     test "$actual_size" = "$size"
   done < <(jq -r '.entries[] | [.sizeBytes, .path] | @tsv' "$manifest")
   jq -r '.entries[] | "\(.sha256)  \(.path)"' "$manifest" |
     (cd "$extracted" && sha256sum -c -)
   ```

   Every command must succeed. The archive hash binds the downloaded TAR to the
   package result; the manifest path allowlist, matching regular-file count,
   and per-file size/hash checks verify all regular members. Do not extract
   links, special files, or unlisted members. Preserve the archive and manifest
   separately; never extract into or over the original evidence volume.

9. **Run the existing offline assessor with independently retained context.**
   Context `#1279/6722005612` was prepared before launch and kept independently
   of run artifacts. Its exact contents are:

   ```json
   {
     "schemaVersion": "SPOT_PAPER_HOST_EXPECTED_CONTEXT_V1",
     "profileId": "BTC_EUR_PAPER_HOST_8H_V1",
     "hostRunId": "btc-eur-paper-host-8h-001",
     "launchManifestSha256": "b8dd60fd302aec3f6406e010abfaa996c291f7dc482cf028efa9ee5bca27209a",
     "runtimeSourceSha256": "1e0204c8ac2c611940bdebbf61ae396a0282eb7d31cc52be7e51ef4036a961fd",
     "imageDigest": null,
     "hostIdentity": null
   }
   ```

   Do not regenerate this context from retrieved artifacts. From the reviewed
   checkout, keep the context and output outside the extracted evidence
   directory and run:

   ```sh
   node scripts/spot-paper-pilot/host-evidence-assessment.mjs \
     "$stage/extracted" \
     /absolute/path/to/independently-retained/expected-host-context.json \
     /absolute/path/to/review/host-assessment.json
   ```

   Use a new assessment output path that does not already exist.
   A missing, mismatched, corrupt, incomplete, or failed result remains
   `UNKNOWN` or `FAILED` as reported. Do not substitute `-` for the expected
   context to obtain a more favorable result. The assessor makes no network
   requests and does not repair evidence.

## Review checklist and decision boundary

Record only values present in the retained report or offline assessment; use
`unknown` or `not available` rather than inferential replacements.

- **Run outcome and bounds:** platform terminal state; assessor outcome and
  classification; actual `startedAt`, `endedAt`, elapsed time, stop reason,
  cycle count against the 480-cycle cap, and actual duration/cycle coverage.
  The 480-cycle cap may stop slightly before eight hours; report actual coverage,
  not the requested maximum as achieved duration.
- **Coverage and data quality:** accepted observations, data gaps and reasons,
  gap/observation coverage, stale or missing marks, and any unknown interval.
- **Request and byte budgets:** actual request count and delivered bytes against
  the 960-request, 64 MiB total, and 256 KiB-per-response bounds.
- **Paper activity:** number and side of simulated fills, gross simulated
  turnover, fees, and whether the final inventory is flat or an open position.
- **Accounting and replay:** quote/ledger accounting reconciliation, signal
  replay outcome, and any failure or limitation. Keep open-position mark age
  and value distinct from realized results.
- **P&L with units:** report realized and unrealized P&L separately as
  `...Cents` (EUR cents for this BTC/EUR profile), plus any aggregate only when
  the retained report explicitly provides it. Do not convert or net fields
  silently; include the unit and source field names.

Evidence retrieval, integrity, terminal status, context binding, and accounting
reconciliation are operational acceptance questions. They do not establish
profitability: the assessor explicitly reports `profitability:
NOT_ASSESSED`. A completed assessment is not permission to start another
experiment; that requires a separate owner decision. No strategy result exists
until the actual eight-hour evidence has been retrieved and assessed.
