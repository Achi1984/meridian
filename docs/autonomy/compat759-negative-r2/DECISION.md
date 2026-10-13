# One-shot negative compatibility decision, revision 2

Prepared, not approved or started. Target PR759 remains open at
686795d61b5b87a4ca70a9a186827e7a189a750c, base/control
b26a10b31d2929f8c44d227358312726085209b9. Both Safety runs
38450967975 and 38450961180, attempt1, passed2387/2387. All required
base postchecks passed. Any later movement invalidates this proposed invocation.

## Exact proposed action

After concrete owner approval, the lead may post `request.txt` once to mailbox571,
triggering the existing Claude reviewer. Claude is asked only to verify target/CI
identity, read the immutable supplied negative body, and publish that body once
through its existing authorized comment capability. No independent review or
positive readiness is claimed. This uses the existing OAuth/App route and existing
quota; no additional service, credential, token export, permission, workflow,
scheduler or recurring activation is introduced. Model usage is not zero-cost.

Body:4560UTF-8bytes, no trailing newline; Git blob
e50d6721771613a50b427ed276d9d47de6ac658a; SHA-256
a1f2c49bf3c13e58e718e4d73949969c8b0507a437a0bbdcd42eaf0cf788fbf3.
Policy digest:e088617a3bd8431f95f9a337f97cf5b0ab4e2ff05cbc6aa533f0b735c9a7c99e.
Request:compat759-v2-negative-r2; operation:compat759-publication-test-r2.
No selected live comment ID or timestamps exist yet. Fixture metadata is not
eligible for live verification.

The existing workflow limits are35minutes and35modelturns. The earlier proposal's
15-minute limit is not installed. This decision explicitly describes the actual
limits; accepting it does not install a new limit. The upstream reference remains
mutablev1, observed at1d6de8cb0c237e7c15e9e1bdf973826ebae490cc during preparation.
Recheck it before posting; if it changes, stop for source review. This reduces
observed drift but cannot promise atomic execution of a pinned upstream version.
If immutable action execution is required, this existing route is not ready and
a separately approved workflow change is needed.

## Collection, success and stopping

Lead-side collection allows at most20explicit API reads after posting, including
one bounded mailbox page of at most5new comments per permitted reconciliation.
No polling loop or blind rerun. This does not bound the action's internal API
calls. If the exact response cannot be located within that budget, stop without
guessing. Do not provision or search for tokens to call the observation launcher.
Use the existing connector for read-only evidence collection; feed the real
observed data to the existing local validators while keeping all authority false.

The response must be an original mailbox571 comment authored by numeric actor
209825114/login claude[bot]/type Bot. Read it twice and require unchanged original
bytes, timestamps and body digest; reconcile current main/PR/CI around collection.
Require valid full-envelope/handoff binding with NON_GREEN_REVIEW and an adverse
non-null planner response, followed by the existing adapter's BLOCKED result.
Do not count malformed-input rejection as success. Code and evidence remain
non-authoritative. This proves publication/interface compatibility only.

Emit a redacted receipt of at most4096bytes, containing real response/run IDs,
version and digest, comparison/binding results and explicit false authority flags,
in the existing PR759 lead-status comment. Never copy raw logs, credentials,
signed URLs or synthetic owner/execution claims into the live evidence record.
Preserve the source JSON as supplied test data, not a reviewer verdict.

Wrong actor, changed/missing body, scope drift, quota/authentication failure,
unavailable capability or unknown outcome ends the invocation. No replacement
identity, repinning or automatic retry follows. Approval may be revoked before
posting. If revoked after start, cease additional authorized actions and cancel
the run only using an approved available cancellation capability; cancellation
does not undo publication or establish rollback. Preserve evidence; do not delete
or rewrite prior responses. No merge or worker activation follows either outcome.

## Approval boundary

Approval must explicitly cover this one existing reviewer invocation and its
single negative test response, actual35-minute/35-turn limits and existing quota
use. Source-integration approvals for PR756/760 do not approve it. No automatic
future schedule is prepared. Reconcile source, target, CI and approval immediately
before posting; stop rather than silently adapt this packet.
