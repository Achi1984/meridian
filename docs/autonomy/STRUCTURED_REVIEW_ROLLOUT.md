# Structured reviewer rollout proposal

Status: source-only design for issue #754. No workflow is installed or changed.
This document does not authorize execution, credentials, publishing, dispatch,
merge, spending or an autonomous worker. The current reviewer remains operational
under its existing contract. This proposal is not a runnable pilot configuration.

## Verified baseline and outcome

Meridian control source: `5aee595821666853d5f427785439e64474b1a838`.
PR #756 is integrated. Release Safety 38445176451 reports 2383/2383 passed;
Runtime Smoke 38445176492, Coordinator 38445176468 and Pages 38445178905 passed.
These checks establish source integration, not deployment of the observation packet.

Existing interfaces already compose locally:

- `event-runtime/durable_check.py`: one fixed check with a same-host execution journal.
- `event-adapter/review-binding/scripts/review-evidence-contract.py`:
  `produce_envelope` and `validate_envelope` for the complete v2 assessment.
- `event-receiver/review_handoff.py`: `collect_review` with an injected
  `bind_envelope` callback and independently supplied policy.
- The existing continuation adapter consumes the bound result. Synthetic tests in
  `event-receiver/test_evidence_handoff.py` already cover this connection.

No replacement serializer, parallel observation helper or second planner is needed.
The fixed executor covers only the adapter test leaf. It is not the complete
scope-specific review policy, and it is not an untrusted-code sandbox.

## Verified deployment incompatibilities

At the control SHA, `.github/workflows/claude-mailbox-review.yml` requests prose
with an `Executed checks` section. The v2 binder requires the entire original
comment body to be the JSON envelope, without Markdown wrappers or a prose prefix.
The default checkout does not specify the requested PR head, while reviewer
instructions prohibit checkout/switch. Local test reports therefore do not by
themselves establish execution against that requested head.

The binder pins Claude's numeric actor 209825114, login `claude[bot]`, type `Bot`.
Copilot, the owner's connector identity and `github-actions[bot]` are not aliases.
The `bot_id` input of the upstream action is documented for Git operations; it
does not establish the authenticated author of an issue comment.

Upstream inspected source:
`anthropics/claude-code-action@1d6de8cb0c237e7c15e9e1bdf973826ebae490cc`,
`action.yml` blob `196918fd9140218ce0d800755541e1bc5388d37f`.
This is the resolved v1 source inspected during preparation, not a claim that
historical Meridian runs used that immutable version.

That action exposes `structured_output` when `--json-schema` is supplied and an
output named `github_token`. Its composite final cleanup revokes the App token
when no input override token is used. Consequently, a subsequent workflow step
must not assume that output token remains usable for deterministic publication.
Do not disable revocation, substitute a personal token, export the token to an
artifact, or loosen the accepted reviewer identity to make the proposal work.
Structured output supplies a shape; it does not prove a review or test execution.

## Proposed sequence

### 1. Full-body publication compatibility, explicitly negative

Use the existing reviewer's authorized comment capability while its action is
running. Before execution, the lead must prepare one exact v2 envelope with the
existing producer: explicit non-GREEN verdict, a blocking compatibility-only
finding, and every required policy check marked `not_executed`, `executed:false`,
`exitCode:null`, `evidenceSha256:null`. This is supplied test data, not a review.
The policy remains nonempty and independently selected; it must not be narrowed
to obtain a GREEN outcome. Record the exact body digest before publication.

The compatibility request asks only for publication of that complete body as
one separate comment in mailbox 571. It does not ask the model to calculate
digests, fabricate evidence, rewrite the assessment or execute PR code. The body
contains no trigger mention and no `CROSS_MODEL_REQUEST` marker. Existing action
progress comments are not treated as review evidence.

Afterward the lead selects the exact returned comment ID and verifies its
numeric actor, original bytes/digest, timestamps, mailbox and request context.
Identity/version observations must be documented as observations; selecting a
returned ID does not authenticate semantic authority. Pass the original body
through the real handoff, envelope binder and adapter with the pre-pinned scope
and policy. Reread the version and current main/PR/CI. Every action-authority flag
must remain false and the adverse verdict must remain adverse. Require a valid
envelope binding with `NON_GREEN_REVIEW`; generic malformed-input rejection is
not a successful compatibility result. An inability to
publish the exact body through the accepted actor is a failed compatibility test.

This intentionally negative pilot establishes only byte/actor/interface
compatibility. It neither exercises the native-Copilot observation entrypoint nor
proves independent review, executed checks, owner authority or continuous operation.
Do not feed a Claude comment into the Copilot review schema. A successful negative
pilot does not authorize the positive path or require a repair to become GREEN.

Proposed limits, subject to concrete approval: one request for one current open
same-repository PR; one action invocation, no rerun or repinning; maximum 15-minute
workflow duration (cancellation is not proof of rollback); 16 KiB complete body;
at most 20 explicit lead-side API reads and no polling loop; one redacted receipt
of at most 4096 bytes. The read budget does not bound the action's internal calls
or model usage. Existing credentials only; actual allowance and cost must be
confirmed before the owner decides. No target PR or start time is selected here.

### 2. Positive producer with a separate exact-head check environment

Only after compatibility is established, prepare the complete implementation
and its source review before asking to install it. Use separate jobs/trust
contexts for control, check execution and reviewer/publication:

| Context | Input and responsibility | Must not inherit |
|---|---|---|
| Control | Immutable reviewed control source; independent PR/head/base/CI/request/op and complete policy pins | Policy or commands chosen by model output |
| Checks | Exact pinned PR source; approved fixed command catalog; bounded actual process receipts | Reviewer OAuth, publishing token or repository write credentials |
| Reviewer/publication | Explicit assessment of exact source and bound receipts; existing actor publishes validated complete body | Authority to replace receipt results or declare unexecuted checks passed |
| Reconciliation | Original comment, source/run/artifact identity and current pins; existing binders and adapter | Authority inferred from a digest or successful HTTP request |

The check environment must be provisioned by reviewed control code, not by
instructions embedded in the PR. The implementation must demonstrate clean
checkout identity, command scope, credential isolation and execution isolation
before accepting PR code. A separate directory or filtered environment alone is
not a sandbox. Do not run unreviewed PR code in the reviewer credential context.

Artifacts crossing jobs are untrusted until their source run, attempt, workflow,
repository, head, expected catalog and size/content integrity are verified.
Artifacts and Actions concurrency are not durable queue/lease semantics.
Same-runner files writable by the model are not independently trusted execution
receipts. Recomputing a digest cannot repair missing execution provenance.

The implementation must determine which complete scope-mandatory checks can be
executed within the isolated environment. Any required check unavailable there
remains not executed and prevents GREEN. Current reported TAP counters do not
substitute for these receipts. Fresh main/head/base and comment reconciliation
remain mandatory before any later owner decision.

### 3. Owner decision remains explicit

The maximum positive outcome is `READY_FOR_OWNER_DECISION`, with all transport
authentication, provenance and action-authority flags retaining their actual
supported semantics. No code may set them true merely to advance the adapter.
The owner approval URL is not authenticated approval semantics. Automatic owner
approval, expiry/revocation, shared-store fencing and worker activation remain
separate design decisions. The packet does not install a merge worker.

## Acceptance and stop conditions

Use real existing producer/binder/adapter interfaces in the acceptance trace.
Reject prose/wrapped JSON, wrong actor, modified body/version, wrong request/head/
base/CI attempt, stale main, missing/skipped/failed/forged check receipts, policy
replacement, exhausted bounds and unverified owner claims. Include a test that
model-writable receipt data cannot be promoted to trusted execution evidence.
Validate the adverse compatibility path separately from positive readiness.

An ambiguous publication outcome stops without reposting. A version edit,
unexpected actor or target movement discards the candidate without repinning.
No automatic retry or compensating remote mutation follows. Preserve the exact
failure category and identifiers in the one lead-status comment; never include
tokens, signed URLs, raw execution transcripts or sensitive findings in receipts.

## Concrete decision record required before execution

The lead must supply: current target PR/head/base; exact successful Safety run/
attempt/workflow; request/op identifiers; independent complete check policy and
digest; immutable control and upstream action source; exact envelope digest;
existing credential/actor route; actual invocation budget; output destination;
stop/revocation instructions; and source review. Missing fields mean NOT_READY.
Historical PR736/738 pilot pins cannot be reused. Parallel strategy PRs are not
claimed as test targets without coordination with their lead.

Future implementation should stay within the existing reviewer workflow and
review-binding/receiver/runtime surfaces, with an exact path allowlist selected
after implementation design. This proposal changes only this document. Workflow
activation is a later concrete owner decision, never implicit in merging it.
Before an approved rollout, define the exact workflow reversal; after a failure,
disable only the newly approved path through the authorized rollback action.
Do not delete published evidence or represent cancellation as execution reversal.
