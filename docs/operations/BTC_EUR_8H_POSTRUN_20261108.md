# BTC/EUR eight-hour pilot: post-run retrieval and assessment

## Scope and known state

This is a post-run handoff for the already launched, one-shot paper pilot. It
does not authorize a new writer, touch or stop the running job, or extend the
existing one-run egress exception. **Do not begin retrieval or start any
maintenance instance until the writer is independently confirmed stopped.**

| Identity | Value |
| --- | --- |
| Northflank project ID | `meridian` |
| Original writer Northflank job ID | `meridian-btc-paper-host-8h` |
| Reviewed image/build label | `stiff-run-1846` |
| Exact reviewed image reference | `registry.northflank.com/northflank/job/6af0572ec4d97f88cd5701ac:6af076b823f0573613d5d2ab` |
| Evidence volume | `meridian-btc-paper-data` / `6af056c2164923835bd1846d` / 6144 MiB / ReadWriteOnce |
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

Gateway transport was subsequently provisioned and verified in
[PR #1293, comment 6725436689](https://github.com/Achi1984/meridian/pull/1293#issuecomment-6725436689).
At that receipt, gateway `meridian/achi-meridian` ran source `a5223b897a00b51356e4467455c9d6b8cc60dff7`;
the unauthenticated read returned `401 read_token_required` and the authenticated
read returned `404 host8h_report_not_found`. Thus transport was connected with
**no report stored**. The dedicated publisher secret remained unattached. Only
the gateway was restarted; the writer remained running. These are dated
receipts, not a current status check or permission to retrieve active evidence.
No new database migration or credential replacement is part of this handoff.
The latest metadata review found the volume BOUND and attached only to the
writer Job. Do not attach it to maintenance while the writer is active. Reuse
the exact image reference above, not a rebuild from the old branch or a moving
image tag. Volume contents have not been read as part of this preparation.

## Controlled post-run sequence

1. **Independently establish that the writer is terminal.** Check the Northflank
   task/run state for the writer run ID above and confirm the writer container
   is no longer active. Do not infer this from an evidence status or elapsed
   clock alone. If still running, stop here; do not mount or start maintenance.
   Do not abort, retry, relaunch, or replace the writer or its evidence.

2. **Read packaged status and report from the retained volume.** Use the reviewed
   image in a **separate maintenance Job with its own job ID**, as a read-only inspection instance, with custom entrypoint
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
   use a **separate maintenance Job**, with a job ID different from
   `meridian-btc-paper-host-8h`, using the same reviewed image and volume.
   Do not edit, reuse, restart, or replace the writer Job. Record the maintenance
   Job ID as `MAINTENANCE_JOB_ID`; this is an operator-selected existing or newly
   reviewed maintenance resource, not an ID to infer from the writer run.
   Start its one manual packaging run with the volume mounted read-only at `/evidence-root`, custom entrypoint `node`, schedules,
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
   timeout of 390 seconds (60-second cooperative package budget, 300
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
   started. Use both that maintenance Job ID and its exact `instanceName` in
   the Northflank command. Do not use the writer's instance name, the job name as an
   instance name, or either rehearsal instance. Create separate empty local
   destination directories first; observed `--localPath` semantics treat its
   value as a **destination directory** and append the remote basename.
   Keep one local shell session open through steps 6–12 so the private staging
   path remains available.

   ```sh
   set -euo pipefail
   umask 077
   stage="$(mktemp -d)"
   : "${MAINTENANCE_JOB_ID:?set this to the separate maintenance Job ID}"
   test "$MAINTENANCE_JOB_ID" != meridian-btc-paper-host-8h
   : "${MAINTENANCE_INSTANCE_NAME:?set this to the exact instance name from the packaging run}"
   mkdir "$stage/archive" "$stage/manifest"
   northflank download job file \
     --projectId meridian \
     --jobId "$MAINTENANCE_JOB_ID" \
     --instanceName "$MAINTENANCE_INSTANCE_NAME" \
     --remotePath /tmp/btc-eur-paper-001.tar \
     --localPath "$stage/archive"
   northflank download job file \
     --projectId meridian \
     --jobId "$MAINTENANCE_JOB_ID" \
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

7. **Validate the manifest and every archive member before extraction.** Use
   local `jq` and Python's standard-library TAR reader to validate each relative
   path component, the exact regular-file member set, member types, and member
   sizes/hashes before extraction:

   ```sh
   set -euo pipefail
   archive="$stage/archive/btc-eur-paper-001.tar"
   manifest="$stage/manifest/btc-eur-paper-001.manifest.json"
   jq -e '
     .schemaVersion == "SPOT_PAPER_HOST_EVIDENCE_MANIFEST_V1" and
     .preservation == "BYTE_EXACT" and
     (.entries | type == "array") and
     ([.entries[].path] | length == (unique | length)) and
     all(.entries[];
       (.path | type == "string" and length > 0 and
         (startswith("/") | not) and (contains("\\") | not) and
         all(split("/")[]; . != "" and . != "." and . != "..") and
         ((split("/")[0] | test("^[A-Za-z]:") | not))) and
       (.sizeBytes | type == "number" and . >= 0 and floor == .) and
       (.sha256 | test("^[0-9a-f]{64}$"))
     )
   ' "$manifest" > /dev/null
   files0="$stage/manifest/member-paths.nul"
   python3 - "$archive" "$manifest" > "$files0" <<'PY'
   import hashlib
   import json
   import os
   import re
   import sys
   import tarfile

   archive_path, manifest_path = sys.argv[1:]
   if os.path.getsize(archive_path) > 84 * 1024 * 1024:
       raise SystemExit("archive size limit exceeded")
   if os.path.getsize(manifest_path) > 1024 * 1024:
       raise SystemExit("manifest size limit exceeded")
   with open(manifest_path, encoding="utf-8") as source:
       manifest = json.load(source)
   entries = manifest["entries"]
   if len(entries) > 1024:
       raise SystemExit("manifest file-count limit exceeded")

   def safe_path(value):
       if (not isinstance(value, str) or not value or value.startswith("/") or
               "\\" in value or any(ord(char) < 32 or ord(char) == 127 for char in value)):
           raise ValueError("unsafe archive path")
       parts = value.split("/")
       if (any(part in ("", ".", "..") for part in parts) or
               re.match(r"^[A-Za-z]:", parts[0]) or len(parts) > 8 or
               any(len(part.encode("utf-8")) > 100 for part in parts) or
               len("/".join(parts[:-1]).encode("utf-8")) > 155):
           raise ValueError("unsafe archive path")
       return value

   expected = {}
   for entry in entries:
       name = safe_path(entry["path"])
       if name in expected:
           raise ValueError("duplicate manifest path")
       expected[name] = entry

   files = {}
   directories = set()
   all_names = set()
   with tarfile.open(archive_path, mode="r:") as archive:
       for member in archive:
           if len(all_names) >= 1280:
               raise ValueError("archive member-count limit exceeded")
           name = safe_path(member.name)
           if name in all_names:
               raise ValueError("duplicate archive member")
           all_names.add(name)
           if member.type in (tarfile.REGTYPE, tarfile.AREGTYPE):
               files[name] = member
           elif member.type == tarfile.DIRTYPE:
               directories.add(name)
               if len(directories) > 256:
                   raise ValueError("archive directory-count limit exceeded")
           else:
               raise ValueError("archive contains a link or special member")

       if set(files) != set(expected):
           raise ValueError("archive regular-file set differs from manifest")
       for name in all_names:
           parts = name.split("/")
           for index in range(1, len(parts)):
               parent = "/".join(parts[:index])
               if parent in files:
                   raise ValueError("regular-file member is an ancestor")
               if parent not in directories:
                   raise ValueError("archive member is missing a directory ancestor")

       for name, entry in expected.items():
           member = files[name]
           if member.size != entry["sizeBytes"]:
               raise ValueError("archive member size differs from manifest")
           content = archive.extractfile(member)
           if content is None:
               raise ValueError("archive regular member has no content")
           digest = hashlib.sha256()
           size = 0
           with content:
               for chunk in iter(lambda: content.read(64 * 1024), b""):
                   size += len(chunk)
                   digest.update(chunk)
           if size != entry["sizeBytes"] or digest.hexdigest() != entry["sha256"]:
               raise ValueError("archive member hash or size differs from manifest")

   for name in expected:
       sys.stdout.buffer.write(name.encode("utf-8") + b"\0")
   PY
   ```

   The validator rejects duplicate names, absolute or unsafe path components,
   links/special members, extra regular files, and file/directory or ancestor
   conflicts. It accepts up to 256 safe, unique directories, including empty
   directories such as `runtime/<runId>/responses/` when a failed run produced
   no responses; each nested member must still have explicit directory
   ancestors. It compares the exact regular-file path set and hashes every
   member before producing the NUL-delimited allowlist. The package tool's own
   round-trip verification is not a substitute for validating the downloaded
   bytes. Any validator error stops the procedure before extraction.

8. **Extract only validated regular files into a new isolated directory.** Use
   GNU tar's NUL-delimited, verbatim file-list mode so names cannot be
   reinterpreted as options or line-delimited paths. Create a private,
   previously nonexistent destination; `--keep-old-files` prevents overwrite:

   ```sh
   extracted="$stage/extracted"
   test ! -e "$extracted"
   mkdir -m 700 "$extracted"
   tar --extract --file "$archive" --directory "$extracted" \
     --no-same-owner --no-same-permissions --keep-old-files \
     --null --verbatim-files-from --files-from "$files0"
   python3 - "$extracted" "$manifest" <<'PY'
   import hashlib
   import json
   import os
   import stat
   import sys

   root, manifest_path = sys.argv[1:]
   with open(manifest_path, encoding="utf-8") as source:
       entries = json.load(source)["entries"]
   for entry in entries:
       path = os.path.join(root, *entry["path"].split("/"))
       info = os.lstat(path)
       if not stat.S_ISREG(info.st_mode) or info.st_size != entry["sizeBytes"]:
           raise SystemExit("extracted member type or size mismatch")
       digest = hashlib.sha256()
       with open(path, "rb") as member:
           for chunk in iter(lambda: member.read(64 * 1024), b""):
               digest.update(chunk)
       if digest.hexdigest() != entry["sha256"]:
           raise SystemExit("extracted member hash mismatch")
   PY
   ```

   Every command must succeed. The pre-extraction validator checks the exact
   member set and bytes; the second check confirms each extracted path remains a
   regular file with the manifest size/hash. The fresh isolated destination,
   NUL-delimited verbatim allowlist, and no-overwrite option prevent path-list
   option injection and replacement of existing files. Preserve the archive
   and manifest separately; never extract into or over the original evidence
   volume.

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

10. **Export a bounded terminal summary locally, after mandatory assessment.**
    `host8h-presentation.mjs` exports a function; it is not a command-line tool.
    Use the existing function from the reviewed checkout with the same evidence
    and independent context. It reinspects the evidence and reruns the assessor.
    The following invocation also compares its outcome with the separately
    retained assessment from step 9. It writes only a new private summary file
    outside the extracted evidence; it makes no provider requests:

    ```sh
    node --input-type=module - "$stage/extracted" \
      /absolute/path/to/independently-retained/expected-host-context.json \
      /absolute/path/to/review/host-assessment.json \
      "$stage/host8h-summary.json" <<'JS'
    import {readFile, writeFile} from 'node:fs/promises';
    import {exportSpotPaperHost8hSummary} from './scripts/spot-paper-report-bridge/host8h-presentation.mjs';
    import {normalizeSpotPaperHost8hReport} from './scripts/spot-paper-report-bridge/host8h-contract.mjs';
    const [evidenceDir, contextPath, assessmentPath, outputPath] = process.argv.slice(2);
    const context = JSON.parse(await readFile(contextPath, 'utf8'));
    const retained = JSON.parse(await readFile(assessmentPath, 'utf8'));
    if (retained.assessment?.terminalVerified !== true) {
      throw new Error('TERMINAL_ASSESSMENT_REQUIRED');
    }
    const summary = await exportSpotPaperHost8hSummary({evidenceDir, expectedHostContext: context});
    const checked = normalizeSpotPaperHost8hReport(summary);
    if (!checked || checked.snapshot.status !== 'VERIFIED_TERMINAL' ||
        checked.assessment.outcome !== retained.outcome ||
        checked.assessment.assessment.outcome !== retained.assessment.outcome ||
        ['runId', 'profileId', 'sourceSha'].some(key =>
          checked.identity[key] !== retained.assessment[key])) {
      throw new Error('TERMINAL_SUMMARY_REVIEW_REQUIRED');
    }
    await writeFile(outputPath, JSON.stringify(checked), {flag: 'wx', mode: 0o600});
    console.log('TERMINAL_SUMMARY_EXPORTED');
    JS
    ```

    An incomplete or nonterminal assessment stops this terminal-publication
    path; retain its actual result and investigate without fabricating terminal
    metrics. A verified terminal `FAILED` or `UNKNOWN` assessment must keep that
    outcome; do not promote it to `COMPLETED`. Inspect the exported fees, net PnL,
    inventory, EUR units, actual duration, coverage and outcome before publishing.

11. **Validate the exact summary without uploading.** The existing publisher
    defaults to dry-run and does not read the upload credential:

    ```sh
    node scripts/spot-paper-report-bridge/host8h-publisher.mjs \
      --summary "$stage/host8h-summary.json" \
      --endpoint https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/spot-paper-host8h-report/upload
    ```

    Require `DRY_RUN` / `VALIDATED_NO_UPLOAD`. The regular-file and full transfer
    envelope ceilings are 256 KiB. Retain the reviewed summary unchanged.
    The exporter observation time describes this evidence inspection; the
    duration and lifecycle fields describe the historical run. Never edit the
    observation time or regenerate an old summary merely to clear a stale label.

12. **Publish once from the separate authorized publisher environment, then
    verify authenticated readback.** Provision access to the already stored
    publisher secret only for that reviewed external publisher. It supplies
    `MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_TOKEN` through its secret environment;
    do not grant it to the original writer, the evidence-packaging Job, or the
    browser. The provisioning receipt did not attach this secret to a publisher.
    After the exact summary and destination are reviewed, run the same command
    from step 11 with `--publish` appended, using the unchanged private summary
    path accessible to that publisher. Do not put credentials in arguments,
    artifacts, logs or chat, and do not add a retry loop or scheduler.

    Require `ACCEPTED` with a matching HTTP 201 receipt, or `IDEMPOTENT` with a
    matching HTTP 200 receipt. These prove transport acknowledgement, not a
    successful strategy. On `UNKNOWN`, timeout, or redirect rejection, inspect
    destination state before deciding any later action: the POST may have been
    stored even if the receipt was not received. Preserve stale/conflict/terminal
    regression rejection reasons rather than altering evidence to force success.

    Read `/api/private/spot-paper-host8h-report` through the existing authenticated
    dashboard/read client. Confirm the pinned run ID, original `observedAt`,
    sequence, terminal outcome and all summary values match the reviewed file.
    Then verify the Strategies card displays the corresponding actual result,
    modeled fees, EUR units and freshness. An accepted stored report is not
    continuous live extraction, USD trading, or permission for a new run.

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
