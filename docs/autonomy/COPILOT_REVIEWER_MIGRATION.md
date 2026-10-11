# Copilot-funded reviewer migration — source-only design

Status: proposed, inactive. Current coordination input from Lead: main `181059`
and PR #662 head `db41`, awaiting independent review. These abbreviated refs are
context, not executable pins: resolve and verify their full SHAs before adoption.
The previous Claude failure-diagnostic invocation allowance is consumed and must
not be reused. This document changes no workflow, permission, subscription,
budget, review gate, research/trading authority or live execution.

## Routing decision

ChatGPT remains Lead and merge owner. Copilot supplies bounded GitHub development
and, after verification, a separate Claude review invocation. The direct Claude
OAuth reviewer remains a distinct route until replacement is demonstrated. No
subscription cancellation or renewal change is performed by this proposal.

The current mailbox action authenticates with `CLAUDE_CODE_OAUTH_TOKEN`. That is
not Copilot authentication. GitHub documents Copilot CLI `GITHUB_TOKEN` requests
in a personally owned repository as billed to the repository owner's Copilot
seat. Development and review share its allowance. This is not unlimited usage,
a new independent quota, or a guarantee of model availability.

The existing coding pilot pins CLI integrity and disables tools but does not
explicitly select a model. Its successful invocation does not prove Claude was
used. GitHub's Claude coding-agent offering is another possible route; it is not
automatically equivalent to our mailbox reviewer or its executed-check contract.

## Smallest implementation candidate

Prepare a separate reviewer adapter, with no default runnable configuration:

1. Bind one approved review request to repository identity, PR number, full head
   and base SHAs, approved control SHA, complete bounded source/diff evidence,
   required checks and evidence digests. Missing/truncated files block review.
   Fetch using trusted read-only code, not instructions supplied by PR content.
2. Select one explicitly approved Claude model identifier. Verify that the
   installed CLI supports the selection and that the account can use it. Capture
   provider-reported model identity only through a documented supported response
   or session surface. Do not invent response fields or treat model-authored text
   as identity evidence. Missing/mismatched identity leaves the review unverified;
   never fall back silently to the default model.
3. Reuse the reviewed CLI integrity verification, fresh configuration directory,
   sanitized environment and local tool-exposure probe. The model receives only
   its necessary Copilot authentication and bounded evidence. No publisher/App
   token, Claude OAuth token, repository write permission, inherited plugins or
   candidate instructions. It cannot execute commands or publish a verdict.
4. Validate structured findings against a fixed schema and the supplied evidence
   inventory. Require head/base, checked scope, findings, missing checks and
   proposed verdict. Output is untrusted advice until deterministic validation
   and trusted live reconciliation finish. Unsupported claims block acceptance.
5. A distinct trusted publication step may report a clearly attributed result
   only after authorization, identity verification and fresh head/base checks.
   It must not mislabel this as the old OAuth reviewer or an automatic merge
   approval. If publication is uncertain, reconcile before any repeat.

The eventual job needs `copilot-requests: write` for model requests, with only
the required read permissions for evidence. Any comment-writing credential is
kept outside model/test execution. Exact workflow permissions and transport must
be presented in the activation configuration; no workflow is supplied here.

Lead's local CLI 1.0.95 help inspection, without inference, reports `--model`,
`--max-ai-credits`, `--usage-output-file`, `--output-format=json` and
`--no-auto-update`. These are candidate selection/measurement controls. Verify
their semantics on the exact pinned CLI before wiring; help text does not prove
the usage JSON schema, identity authenticity or error behavior. Local
`copilot --no-auto-update help limits` explicitly describes `--max-ai-credits`
as a **soft cap**, with a minimum of 30 credits. One response may overshoot the
cap before the next call is blocked; subagents share the limit and hidden
compaction counts toward it. This control cannot substitute for the account's
paid-usage block or establish a hard trial billing ceiling. Actual enforcement,
usage-output schema and model-identity metadata still need verification on the
pinned runtime. Never infer actual charged credits from an unverified local field.

## Preserve independently executed checks

A zero-tools model can inspect supplied source and test evidence. It cannot
truthfully say it independently ran tests, and it cannot by itself replace the
current executed-check requirement.

Proposed solution: an independent trusted check runner fetches the exact candidate
and executes a reviewed fixed command list in an isolated unprivileged job. It
must not execute candidate code alongside model authentication, publisher tokens,
repository secrets, privileged caches or write credentials. A trusted collector
binds the resulting evidence to the exact commit, workflow/control revision,
run/attempt and executed commands, including failures, skipped tests and omitted
checks. No candidate-produced assertion alone establishes successful execution.

The Claude reviewer then assesses source plus those independently produced
results. Attribution distinguishes runner-executed checks from model inspection.
Whether this split satisfies the existing reviewer gate requires an explicit
equivalence decision before adoption. If that contract requires Claude itself
to select and execute tests, the split is insufficient: prepare a separately
reviewed constrained tool runner or retain the existing gate. Do not weaken it
through wording, change a missing-check failure to GREEN, or count ordinary
author-provided test output as independent execution.

## Serial operation and fallback

One coordinator owns review state across OAuth, Copilot, manual requests and
hourly/event-driven work. Reserve the approved invocation before starting it.
Bind the reservation to request, exact head/base, route, model and attempt. A
running or unknown-outcome review blocks a second route; neither a new event nor
an edited comment resets the reservation. Claim protection and actual enforced
cross-route serialization must be demonstrated, not inferred from a prompt.

Fallback eligibility requires authenticated evidence of the approved condition,
for example a documented provider rate-limit response. Generic SDK `is_error`,
timeout, missing output or a diagnostic marker does not prove rate limiting.
For uncertain outcomes, reconcile and stop. For a proven eligible failure, a
Copilot attempt still requires an unused separately approved reservation, live
account/usage assumptions, supported model availability and remaining time.
No automatic repeat loops, provider hopping or default-model substitution.

For migration the first test should be an explicit Copilot review trial, rather
than forcing another OAuth failure to test fallback. Historical Trial3 claims
and the consumed diagnostic allowance remain untouched. Independent review of
PR #662 remains pending until valid evidence actually exists for its exact head.

## Concrete activation checklist

Before proposing one bounded trial, fill and independently review all items:

- Full current main/control SHA and trial PR/head/base; fresh mailbox state and
  confirmation of no conflicting reviewer or writer.
- Exact model identifier, pinned CLI binary/package evidence, model-identity
  observation mechanism and failure behavior if selection cannot be verified.
- Reviewed source/diff inventory, required-check list, isolated runner design,
  actual permissions, credential separation and reviewer-equivalence decision.
- One new request/reservation identity, maximum one model invocation, input/output
  bounds, process timeout, explicit timezone/expiry and no automatic retry.
- Current Copilot billing identity and remaining allowance observation, existing
  zero-overage controls, and any Actions accounting assumptions. No new paid API.
- Deterministic result validation, stale-head/base rejection, independent
  attribution, permitted publication destination and no automatic merge.
- Disable procedure, revocation of outstanding credentials where applicable,
  unknown-outcome reconciliation and preservation of consumption evidence.
- Concrete Owner activation authorization covering that configuration. This
  design approval is not the activation, and a model trial is not a subscription
  cancellation decision.

First demonstrate an attributed review on the fixed candidate, compare coverage
with the existing required gate, and record consumption. Only then consider
making this the normal reviewer and retiring direct OAuth usage. Recurrent
fallback, additional packets and larger limits require their own concrete scope.

## Ten completed-packet measurement plan

After a successful bounded trial and approval of the measurement phase, record
ten completed development packets. This plan does not authorize ten invocations:
each packet may need multiple approved calls, and failures consume allowance.
Completed means implementation, required checks and independent review finished;
merge/deployment status is recorded separately. Track failed/abandoned attempts
alongside completed packets to avoid understating cost.

For each packet record:

| Field | Measurement |
| --- | --- |
| Packet identity/scope | Fixed task ID, allowed files, product outcome |
| Immutable code evidence | Full base/head/control SHAs and PR |
| Roles and routes | Implementer/reviewer route, requested and observed model identity |
| Invocation evidence | Reservation IDs, actual starts, run/attempt references, outcomes |
| Time | Start/end timestamps, execution duration and blocked waiting time |
| Validation | Required checks, executed commands, pass/fail/skip, review verdict and coverage gaps |
| Repair/retry work | Approved repair attempts, failures, unknown outcomes, human interventions |
| Account usage | Before/after observed Copilot usage, timestamps, billing identity, reset boundary |
| Attribution limits | Concurrent unrelated usage, reporting delay, unavailable counters, whether delta is attributable |
| Outcome | Completed/abandoned, merge/deploy status, usefulness and remaining blockers |

Record gross consumption of failures and diagnostics in the same measurement
window; do not hide them by counting only successful packages. Aggregate credits
per completed packet only where attribution is supported. Report total observed
window delta separately when unrelated activity prevents per-packet attribution.
Do not convert model SDK `total_cost_usd` into an actual subscription bill or
equate an invocation cap with a hard credit ceiling. Upgrade decisions should
use measured workload and remaining allowance, not agent count alone.

## Official capability references

Reviewed as routing documentation, not as proof of current account entitlement:
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/copilot-cli-in-github-actions
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions
- https://github.com/anthropics/claude-code-action/blob/1d6de8cb0c237e7c15e9e1bdf973826ebae490cc/action.yml

No files outside this design document are changed. No workflow, model invocation,
secret, subscription, spending setting or repository mutation is performed.
