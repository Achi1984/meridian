# Positive native event probe — source-only proposal

Status: PREPARATION ONLY. No workflow, configuration or dispatch is authorized or installed by this document.
Baseline supplied by lead: main `2d5e460e5affb1590d692f7a243c99e4c2d648b6`; verify again before preparing an installation PR.

## Recommended source and circular pin resolution

Use the installation commit's **push** Release Safety run, then explicitly rerun that same run once (source attempt 2) after the installation's post-merge gates finish. For push evidence the collector already requires source head to equal current main; no PR association or base rule changes are needed.

The reviewed workflow identifies its control revision with `github.sha` and requires the source head to equal that value. It rechecks that control revision against fresh current main before loading the collector from the immutable SHA. The installation's own run ID and merge SHA cannot be literal constants in its own commit. Consequently this proposal deliberately replaces a preinstalled literal run-ID/head pair with exact runtime equality to the installed control revision, then a lead-verified run-ID selection before the single rerun.

**This is a changed activation envelope, not equivalent to immutable literal run-ID pinning.** A main freeze and immediate cleanup are operational controls. If literal run-ID pinning or durable one-execution enforcement is required, do not install this design; use a separately reviewed trusted configuration mechanism after installation instead.

## Workflow envelope to review

- Native `workflow_run`, workflow name `MERIDIAN Release Safety`, type `completed`; no manual workflow dispatch, cron, issue or PR trigger.
- Repository and head repository both `Achi1984/meridian`; source event `push`, branch `main`, source workflow ID `347821227`, path `.github/workflows/backend-safety.yml`, success conclusion and terminal status. Collector independently refetches identity, repository provenance and run metadata.
- Source head equals `github.sha`; source attempt exactly 2; receiver attempt exactly 1. Verify head branch, event, workflow ID and path both in the workflow guard and fresh API validation.
- Exactly one collector job, four-minute timeout, Ubuntu 24.04, explicit read-only `contents`, `actions`, `issues` and `pull-requests` permissions. No model token, checkout, arbitrary input, PR code execution, write API, upload action or external dispatch.
- Same bounded collector download from immutable `GITHUB_SHA`, which must equal fresh main. Existing collector push/current-main checks remain intact.
- A reviewed literal UTC expiry must be checked before any API call or collector execution. Select a short concrete activation window in the installation review; do not derive expiry from each event's arrival time. A skipped or expired probe must not be reported as accepted delivery.
- Collector produces its bounded local receipt. A separate fixed Python summary step reads only approved scalar fields from that receipt; print repository, control/main SHA, event, source run ID/attempt/head/workflow, conclusion, and authority booleans. Require authority `NONE` and false dispatch/merge/deduplication/lease flags; never print raw payloads, comments, logs, environment, tokens or a free-form whole object. No artifact upload. Exact summary schema and maximum output length must be reviewed/tested before installation.

## Concrete sequence

1. Prepare source-only workflow candidate, summary validator and safety-envelope tests. Review the exact expiry, guards, token scope and cleanup diff. Obtain concrete activation authorization for this changed pin envelope and one rerun.
2. Freeze unrelated main merges and source/receiver reruns. Merge the approved installation PR. Record actual installation main SHA `M` immediately; a later main revision invalidates the selected run and ends this probe.
3. Installation push starts Release Safety at source attempt 1. Any resulting receiver job must skip because only source attempt 2 is allowed. Observe this as the negative attempt guard, not positive evidence.
4. Wait for required installation post-merge gates to finish green. Find exactly one successful push run `R` for workflow 347821227 at head `M`; verify path, branch, repository origin, attempt 1 and fresh main `M`. Record `R` and `M` in the operational checkpoint. Do not choose an old run or start a replacement if ambiguous.
5. If within the approved window, rerun **that exact R once**, creating attempt 2 without a commit/main change. No receiver rerun, third source attempt, retry loop or model request.
6. Observe one receiver run from completion of R/2. Check its control SHA is M and its source linkage is R/2/M. Inspect collector and bounded summary step success and the fixed scalar log summary. Confirm actual job token permissions are read-only.
7. Remove the installed listener and its installation-only contract test through the prepared reviewed cleanup PR. Verify absence on main and cleanup post-merge gates. Do this on success, rejection, timeout or unexpected delivery; do not leave the listener enabled for future retries.

## Acceptance and stopping

Positive evidence requires native completion delivery, successful current-main collector reconciliation, matching R/2/M summary and unchanged false authority flags. CI evidence must retain `authenticated:false`, `provenanceVerified:false` and `testOutputForgeryExcluded:false`. A positive receipt is not trusted coding evidence. It establishes native read-only transport and reported metadata collection only: not authenticated job counters, autonomous coding, review authorship, durable deduplication or cross-host coordination.

The attempt-1 skip and receiver-attempt-1 guard do not prove exact duplicate suppression. One receiver execution is the operational budget, not a durable hard cap against duplicate GitHub deliveries. Stop and clean up on a second eligible delivery, a moved main, wrong run association, non-green source/post-merge gate, expired window, missing summary, wrong permissions or an unexpected accepted source. Do not silently expand the window or rerun budget.

## Authorization boundary

Generic development Go covers this preparation only. Installation review must approve the concrete window, runtime control-SHA/run-selection envelope, one exact source rerun after discovery, read-only evidence scope and immediate cleanup. The lead can prepare and review all artifacts before presenting that final concrete decision. No live worker, trading, model invocation or autonomous writing is authorized.

## Prepared files

All four files target `docs/autonomy/event-receiver/`: `positive-native-pilot.yml` (inactive), `receipt_summary.py`, `test_positive_pilot.py` and this proposal. Candidate expiry `2026-10-12T00:00:00Z` is already expired and deliberately rejects execution. Installation requires replacing it with a reviewed concrete future UTC deadline, no more than 90 minutes away when executing. The candidate is not an activation authorization.
