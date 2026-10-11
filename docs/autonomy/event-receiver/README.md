# Native event receiver — inactive source-only candidate

This package is executable preparation, not an installed receiver. `receiver.yml`
is intentionally outside `.github/workflows`. No schedule, model, dispatch,
repository mutation, new credential or permission setting is activated.

The proposed native Actions receiver handles completed Release Safety and Claude
Mailbox Review runs plus created/edited comments in issue571. It runs a standard
library Python metadata collector, loaded from the triggering default-branch
`GITHUB_SHA`. It never checks out or executes PR code, downloads source artifacts,
emits comment bodies or assigns work. It reads only a verified Release Safety job's
bounded log to extract reported test counters, without executing its contents. A separately approved future
installation would retain a <=4096-byte receipt artifact for one day; that artifact
upload is the only proposed remote output. GitHub token permissions are read-only.

The collector fetches current main before and after work. Source workflow IDs,
paths, names, repository identity, run attempt and head are validated. PR sources
require exactly one association, an open same-repository PR, exact head, main base,
and unchanged live main. Push sources require current main. No unbounded listing
or pagination is used; attempt-specific jobs permit at most three pages of 50,
128 total jobs, consistent totals and no duplicates/partial pages. Missing/ambiguous
associations and transport errors reject.
HTTP uses fixed GitHub API GET paths, TLS, no API JSON redirects, 15-second timeouts and
512-KiB response limits. Duplicate JSON keys and non-finite values reject.
These are point-in-time reads, not an atomic GitHub snapshot: the PR may move after
its read even if main does not. No review verdicts are collected.
The receipt must never replace a fresh guarded mutation preflight.

Terminal non-success conclusions, including `startup_failure`, produce metadata-only
receipts. They do not fetch job lists/logs or attach successful CI evidence.

## Release Safety reported test counters

Only the successful `syntax` job with an exactly matching run/attempt/head and one
successful `Research and auth regression tests` step is eligible. Its log API may
return one HTTPS443 redirect to a subdomain of `blob.core.windows.net` or
`githubusercontent.com`. The second GET has no GitHub Authorization header;
further redirects reject. Maximum log size is 8 MiB. Unexpected transport fails
closed; no log text or signed URL is stored in the receipt.

Within exactly one timestamped `Run node --test test/*.test.js` segment, bounded by
the next command group, exactly one top-level tests/pass/fail/cancelled/skipped/todo
summary is required. Nested escaped summaries are ignored. Missing, duplicated,
inconsistent, failed or skipped totals reject. These are **reported counters**:
log text can be forged by executed code. Authentication of retrieval is not proof
that tests are honest; full independent source review remains necessary. The API
run is reread after log retrieval to catch changed attempts. Authority and
`authenticated`/`provenanceVerified` flags remain false even with synthetic inputs.

`source.ciEvidence.adapterFields.workCi` maps to the existing adapter's `work.ci`;
`adapterFields.ciBinding` maps to its exact runId/runAttempt/workflowId/headSha
binding. No new parallel planning schema is needed. A caller must still supply
separately bound expected scope, manifest, PR snapshot and event revision. Its
`expected.ci` must independently pin the accepted run ID, attempt, workflow ID and
head; copying the receipt binding into expected input is not independent evidence.

For comment events only exact current comment ID/revision/author/mailbox metadata
is retained. Bodies are received inside the REST response but never interpreted,
copied into receipts, passed to models or logged. Receipt `bodyCollected=false`
means not retained in the receipt. Claude workflow completion does not establish
which request or final comment was reviewed. Its receipt explicitly records
`NOT_COLLECTED_REQUEST_COMMENT_BINDING_REQUIRED`. This package does not collect
review verdicts or turn a successful reviewer job into approval. Completion is
useful as a wake-up even if token-generated comment events are suppressed, but
actual delivery of either path has not been demonstrated.

## Next boundary, not implemented here

An authenticated request-to-comment/PR binding adapter, independently reviewed test producers,
durable event/attempt dedupe, a shared writer lease and fencing, bounded worker
authorization, and outcome reconciliation are still required. Receipts carry no
dispatch or merge authority. There is no ChatGPT wake API here and no automatic
coding worker. Repeated events may create repeated read-only receipts. Artifacts
and Actions concurrency are not a durable queue or lock. Main movement rejects
the receipt; this stage has no retry/recovery scheduler. Future installation needs
review, concrete owner approval, and real delivery tests before any live claim.

## Offline verification

Run `python3 -B -m unittest discover -s docs/autonomy/event-receiver -p 'test_*.py' -v`.
Stage the sibling `docs/autonomy/event-adapter` packet first. The integration test
uses its unchanged Node adapter; isolated development may set `MERIDIAN_TEST_ADAPTER`
to the absolute adapter module path. Missing adapter is a failure, not a skipped test.
The tests use local API stubs, no credentials/network. Covered failures include
wrong repository/workflow/fork, stale source attempt/head/base/comment, incomplete
PR association, unknown transport outcome, changed main, oversized/invalid JSON
and direct API path injection. Green tests prove local behavior only.
Additional cases cover complete/partial/changing pagination, duplicate jobs,
wrong attempts, ambiguous TAP summaries and credential-free log redirects.
The direct composition test feeds the collector's unchanged `workCi`/`ciBinding`
projection into that adapter and requires `WAITING_REVIEW`, with all authority
flags false. Review metadata/structured body binding is a separate packet; the
current live Claude producer's prose is not silently accepted as that contract.
