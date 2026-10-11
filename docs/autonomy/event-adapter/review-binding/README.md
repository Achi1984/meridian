# Claude review evidence binding — source-only adapter integration

This package binds an explicitly structured review claim to a complete observed comment version and independently supplied request/head/base/CI pins. It performs no GitHub request, model call, workflow change or repository write. Its inputs remain caller-supplied claims, not authenticated evidence; every authority/authentication flag is false.

## Run

From the repository/package parent, with Python 3 and Node 22+ on the trusted PATH:

```sh
python -I review-binding/test/test_review_binding.py
```

From the repository root the equivalent is `python -I docs/autonomy/event-adapter/review-binding/test/test_review_binding.py`. The binding suite exercises the actual sibling event-continuation-adapter.mjs via a test-only Node bridge. It needs no network or installed package. Two original validator/transport fixtures are Git-blob checked against provenance.json. Run all inactive source suites with `python3 -B docs/autonomy/verify-source.py`.

## Existing contracts reused

The unchanged main `structured-review-transport.py` rejects duplicate JSON keys, oversized/nonfinite/deep inputs and invokes the unchanged `validateStructuredReviewClaim` coordinator validator. Expected request, operation, repository, PR, head, base and CI run/attempt/workflow/head pins are checked by that existing contract. No GREEN prose extraction or alternate review schema was added.

PR665 at 663d3e7185f14f0315c1b901e792ddae5514b83c has a distinct inactive Copilot/Claude model execution packet and read-only diff/CI collector. Its own collector cannot supply an authenticated execution attestation. Those contracts do not establish the provenance of a mailbox comment or convert existing prose into this structured claim; they were inspected, not duplicated or silently substituted.

## Interface

`bind_review(observation_raw, expected_raw)` takes two bounded serialized JSON objects. See the complete positive fixture in test/test_review_binding.py.

Observation: repository, issueNumber, eventAction, and comment fields id, user(id/login/type), created_at, updated_at, body. The future authenticated GET collector must provide a complete current comment version; native PR reviews and partial summaries are not silently interpreted as mailbox comments.

Expected: scope(repository/requestId/opId/headSha/baseSha/prNumber/ci), actor, exact version(commentId/createdAt/updatedAt/bodySha256), issueNumber, reviewerFamily. The scope is independently reconciled by the trusted caller, never copied from claim output to make validation pass.

The configured Claude mailbox identity is fixed to user ID 209825114, login `claude[bot]`, type `Bot`, matching the authoritative identity supplied by the Lead during this packet. Both expected actor and observed actor must equal those exact values. An arbitrary expected actor cannot admit Copilot, an owner-posted historical `reviewer: CLAUDE` comment or another bot. A future approved alternate execution/attestation route requires a separately reviewed contract; this binder does not activate one. A JSON reviewer label alone proves nothing.

A matching explicit GREEN structured claim yields CANDIDATE_REVIEW and one **unverified** planner response. A valid non-GREEN claim yields BLOCKED while retaining the adverse response, so the actual adapter sees and blocks it. Deleted/changed comments, wrong actors/pins, absent structured claims and invalid transport yield BLOCKED with no response. The trusted caller must remove previous response evidence for that comment version and stop/reconcile, never retain an old GREEN when the binder is blocked.

A body must itself be the complete JSON claim. Plain text, Markdown code fences and text containing GREEN_LIGHT are blocked as STRUCTURED_CLAUDE_CLAIM_MISSING. A changed body digest or updated_at invalidates the old expected version; re-pinning must come from the trusted reconciliation process, never a model response. Deleted comments remain invalid even if a supplied payload carries their former GREEN body.

## Actual limits

**The current deployed Claude producer does not yet emit this explicit full JSON claim. Existing prose responses remain blocked.** Passing fixture tests does not prove producer compatibility, authenticate a reviewer, satisfy standing merge approval or demonstrate a deployed event pipeline. The receiver-to-binder handoff needs complete authenticated comment metadata/body, not a digest-only observation. Separately fetched actual CI execution remains required; claimed CI success in the body cannot replace real checks.

The trusted launcher owns Python/Node executable and fixture bytes. The original transport resolves Node through that launcher PATH; returned model strings cannot select executables. The binder returns fixed error codes without raw comment content or subprocess diagnostics. It grants no native GitHub approval or branch-protection authority.

Tests demonstrate real code composition with synthetic metadata: successful candidate -> actual adapter's simulated COMPLETE_DRAFT; prose/changed/deleted claims cannot produce readiness; adverse review reaches the adapter's STRICTEST_VERDICT stop. They also cover exact identity, disallowed substitution, request/head/base/PR/CI drift, duplicate keys, payload bounds and pinned fixture integrity.

A successful binder also returns `reviewBinding`: the guarded original comment ID, creation/update timestamps and whole-body SHA-256, plus the validated claim CI run/attempt/workflow/head identity. Pass it unchanged beside the planner response; independently supply the current expected review version. Planner response alone is insufficient for adapter readiness, including workflow-completion wakes. The handoff carries this metadata through its existing rereads. No authentication or new action authority is granted.
