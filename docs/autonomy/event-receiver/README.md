# Native event receiver — inactive source-only candidate

This package is executable preparation, not an installed receiver. `receiver.yml`
is intentionally outside `.github/workflows`. No schedule, model, dispatch,
repository mutation, new credential or permission setting is activated.

The proposed native Actions receiver handles completed Release Safety and Claude
Mailbox Review runs plus created/edited comments in issue571. It runs a standard
library Python metadata collector, loaded from the triggering default-branch
`GITHUB_SHA`. It never checks out or executes PR code, downloads source artifacts,
reads job logs, emits comment bodies or assigns work. A separately approved future
installation would retain a <=4096-byte receipt artifact for one day; that artifact
upload is the only proposed remote output. GitHub token permissions are read-only.

The collector fetches current main before and after work. Source workflow IDs,
paths, names, repository identity, run attempt and head are validated. PR sources
require exactly one association, an open same-repository PR, exact head, main base,
and unchanged live main. Push sources require current main. No unbounded listing
or pagination is used; missing/ambiguous associations and transport errors reject.
HTTP uses fixed GitHub API GET paths, TLS, no redirects, 15-second timeouts and
512-KiB response limits. Duplicate JSON keys and non-finite values reject.
These are point-in-time reads, not an atomic GitHub snapshot: the PR may move after
its read even if main does not. No job/test totals or review verdicts are collected.
The receipt must never replace a fresh guarded mutation preflight.

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

An authenticated request-to-comment/PR binding adapter, credible CI job totals,
durable event/attempt dedupe, a shared writer lease and fencing, bounded worker
authorization, and outcome reconciliation are still required. Receipts carry no
dispatch or merge authority. There is no ChatGPT wake API here and no automatic
coding worker. Repeated events may create repeated read-only receipts. Artifacts
and Actions concurrency are not a durable queue or lock. Main movement rejects
the receipt; this stage has no retry/recovery scheduler. Future installation needs
review, concrete owner approval, and real delivery tests before any live claim.

## Offline verification

Run `python3 -B -m unittest discover -s docs/autonomy/event-receiver -p 'test_*.py' -v`.
The tests use local API stubs, no credentials/network. Covered failures include
wrong repository/workflow/fork, stale source attempt/head/base/comment, incomplete
PR association, unknown transport outcome, changed main, oversized/invalid JSON
and direct API path injection. Green tests prove local behavior only.
