# Event continuation intake — offline draft (#647)

This is NOT functional autonomous continuation. It normalizes serialized,
untrusted GitHub-shaped claims into a read-only reconciliation proposal. It has
no transport, filesystem, clock, timers, queue, dispatch, merge or activation.
All authentication, provenance, authority, dispatch, merge, lease and durable
deduplication flags remain false. Local success proves only normalization.

## Delivery reality and remaining prerequisites

Current ChatGPT GitHub event automation supports opted-in PR opened, ready,
closed and synchronize events, submitted human reviews and created human PR
comments. This does not provide workflow-run completion, non-PR mailbox issue
comments, edited comments, or guaranteed bot-review completion delivery.
Delivery of the two event types modeled here to ChatGPT is UNAVAILABLE/UNVERIFIED.
A bot-comment bridge is not an established solution. The existing hourly
schedule remains unchanged; this draft neither replaces nor accelerates it.

GitHub itself supports workflow-run completion and created/edited/deleted issue
comments. Raw GitHub support is distinct from the limited ChatGPT connector:
[Actions event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
and [webhook payload reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

`lead_lease_validation.py` validates document fields. It is not an atomic runtime
lock. Actual operation additionally requires separately implemented and tested:
authenticated transport and fresh bounded GitHub reads; durable queue/replay and
conflict reconciliation; a shared atomic lease with fencing against stale writers;
explicit activation approval and operational monitoring. No new permissions,
workflows, spending, schedules or production/research/trading authority arise here.

## API and claims

`normalizeEvent(eventName, payloadJson, configJson)` accepts serialized JSON only.
Configuration has exactly `repository`, positive numeric `mailboxIssue`, and a
nonempty unique list of up to 32 positive numeric `workflowIds`. Repository is
fixed to `Achi1984/meridian`; mailbox identity is explicit, not hardcoded in code.
The config is a claim, not proof of approved configuration.

Payload maximum: 65,536 UTF-8 bytes. Config: 4,096 bytes. Parsed input: 4,096 values,
depth 12; malformed JSON, invalid Unicode and prototype-related keys fail closed.
GitHub's additional payload metadata is permitted but never forwarded. No actor
name, label, comment prose or GREEN text becomes authorization.
Both the event repository and a workflow's head repository must explicitly claim
`fork:false`; missing or incorrectly typed fork fields fail closed too.

| Event | Accepted scope | Proposal source hint |
|---|---|---|
| workflow_run | completed action/status, allowlisted workflow ID, positive run ID/attempt, full SHA, matching non-fork head repository | GET specific run attempt |
| issue_comment | created/edited/deleted on configured non-PR mailbox issue, positive comment ID, valid ordered creation/update timestamps, string body | GET comment ID |

Workflow conclusions success, failure, neutral, cancelled, skipped, timed_out,
action_required, stale and startup_failure all request reconciliation. A failure
is an event to inspect, never a success shortcut. Unknown/null conclusions fail
closed. Each run attempt has its own event identity. Conflicting conclusions or
SHA/workflow claims for that identity produce different revision digests; a future
consumer must reconcile these conflicts, never accept the newer-looking claim.

Comment identity binds repository/mailbox/comment ID; revision digest additionally
binds action, created/updated timestamps and SHA-256 body digest. Edited bodies
matter because Claude may update a progress comment in place. A changed body in
the same timestamp second still produces a different revision. Opaque body text
is never returned, parsed as instructions, or converted into a review verdict.
Deleted-comment notifications are revocation wake hints; a missing result from the
fresh GET must reconcile removed evidence and cannot preserve an old approval.
A comment GET returns current state, not guaranteed
historical revision; out-of-order receipts cannot establish ordering or approval.

`eventIdentity` and `revisionDigest` yield a deterministic `deduplicationKey`.
Equal results are not durable deduplication, exactly-once execution or a trusted
receipt. No webhook delivery ID or signature is verified. A workflow source hint
uses `/actions/runs/{runId}/attempts/{attempt}`; a comment hint uses
`/issues/comments/{commentId}`. These paths are data for future authenticated GETs,
not executed calls. Fresh reads must reverify repository, workflow, attempt/head,
mailbox binding, actor/provenance and current gates before any downstream action.

## Receipt test matrix before any activation

| Scenario | Required later operational result |
|---|---|
| Completed success/failure/cancelled run | Real authenticated receipt and reconciled exact attempt; no success inference |
| Created, edited and deleted Claude mailbox comment | Demonstrated real delivery, fresh current state, changed/revoked verdict handled |
| Duplicate/reordered delivery or conflicting digest | Durable dedup/conflict handling; no repeated dispatch or rollback of state |
| Fork, foreign repo, unapproved workflow, forged signature | Reject without queueing actionable work |
| Crash before/after claim, expired lease, concurrent hourly/event worker | Atomic claim plus fencing; unknown outcome stops and reconciles |
| API outage/rate limit/partial response | Bounded stop/wait, no guessed state or blind retry |
| Disable during in-flight work | Stop new intake; fence writes and reconcile outstanding outcomes |

Rollback design: keep transport disabled by default. Future approved deployment
must have a disable switch that stops intake/dispatch, invalidates active fencing
tokens, retains audit/queue state for reconciliation and restores the unchanged
hourly fallback. This switch and transport are not implemented here. Reverting
these three unused draft files removes only the offline prototype.

Local verification: `node --test test/event-continuation-intake.test.js`. These
tests are not an end-to-end receipt test or evidence of working automation.
