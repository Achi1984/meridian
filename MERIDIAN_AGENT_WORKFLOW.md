# MERIDIAN — Main-Agent / Subagent / Review Workflow

## Purpose

This document defines the default quality process for **all tasks**, not only software work. The Main Agent is the only agent that communicates with the user. Work is decomposed into specialist tasks whenever that materially improves quality, verification, speed, or clarity.

**Priority:** Quality first. Speed is secondary.

No result may be described as independently reviewed, model-verified, tested, deployed, or merged unless that actually happened.

## 1. Scope

This workflow applies to **all work**: MERIDIAN software, trading and market analysis, research and backtesting, UI/UX, data reconciliation, documents, plans, comparisons, technical troubleshooting, and small/mechanical tasks.

Even small changes such as text, CSS, labels, cache tags, version changes, or one-line code fixes pass through review. Review depth may scale with risk, but review is not skipped.

## 2. Roles

### Main Agent — Orchestrator

The Main Agent is the only user-facing agent. It owns the full goal, decomposition, dependency graph, specialist assignment, integration, conflict resolution, quality gates, branch/PR/merge decisions, and final delivery.

The Main Agent must reconcile specialist results into one coherent solution rather than concatenate them.

### Specialist Subagent

A specialist receives a narrowly scoped task packet and returns a concrete deliverable. Typical roles include implementation, data analysis, trading methodology, backtesting/statistics, API/data integrity, security/privacy, UI/UX, mobile/iPhone layout, testing, documentation, and evidence review.

A specialist never communicates directly with the user.

### Independent Review Agent

Every specialist result is checked independently against the original task packet, relevant source material, tests, and output.

The reviewer returns one of two states:

- **GREEN LIGHT** — acceptance criteria are met.
- **REVISION REQUIRED** — exact defects, severity, evidence, required correction, and required re-test are identified.

Approval cannot be based on plausibility alone.

## 3. Model Policy

Target model policy when those models are actually available:

- Main Agent: GPT-6-Astra
- Review Agents: GPT-6-Sol
- Specialist Subagents: at least GPT-6-Luna, upgraded for complexity/risk

**Cross-model precedence:** These GPT-6 review targets are Lead-internal review targets only. For any change covered by `MERIDIAN_LEAD_LEASE.json.crossModelReviewRequiredFor`, merge additionally requires GREEN LIGHT from the independent cross-model reviewer named by `MERIDIAN_LEAD_LEASE.json.subAgent` on the exact PR HEAD-SHA. An internal GPT-6 review never substitutes for that cross-model review.

If requested models are unavailable, the strongest available model is used and the system must not falsely claim another model performed the work.

Task risk determines model strength: mechanical edits may use a lighter specialist; code, financial logic, architecture, research methodology, and high-risk trading logic use stronger reasoning. Reviews use the strongest available independent reviewer.

## 4. Intake Before Work

Before starting, the Main Agent decides whether essential information is missing. Questions are asked only when the missing information materially affects correctness.

For each task the Main Agent defines:

1. Goal — what success means.
2. Inputs — files, screenshots, APIs, repo state, user constraints.
3. Constraints — safety, privacy, performance, UX, compatibility.
4. Deliverables — exact outputs required.
5. Acceptance criteria — measurable conditions for approval.
6. Verification plan — tests, cross-checks, review method.
7. Integration impact — other components that may be affected.

## 5. Serial vs Parallel Work

The Main Agent defines dependencies before assigning work.

Run work in parallel when inputs are independent, tasks do not mutate the same state, one result is not required by another, or independent perspectives increase quality.

Examples: UI review plus data-integrity review; trading-method review plus code review; documentation plus test-plan drafting; independent source checks.

Run work serially when task B depends on task A, tasks modify the same code path, one establishes canonical data needed by another, review follows implementation, or integration can be tested only after all parts exist.

**Repository mutation is single-writer by default.** Parallel agents may research, audit, review, draft tests, or prepare isolated patch proposals, but they must not independently allocate release numbers, bump `terminalBuild`, open competing release PRs, merge to `main`, or mutate the same release branch. Release integration is serialized through the Main Agent.

Typical software sequence:

1. Architecture/task design.
2. Implementation.
3. Specialist self-check.
4. Independent review.
5. Revision loop if required.
6. Main-Agent integration.
7. Full test/release gates.
8. PR.
9. Merge.
10. Post-merge verification.

## 6. Specialist Task Packet

Every specialist receives:

- **Objective:** precise problem.
- **Scope:** included and excluded work.
- **Inputs:** exact files, functions, screenshots, APIs, metrics, or evidence.
- **Constraints:** compatibility, safety, privacy, performance, visual, or methodology requirements.
- **Required checks:** validations before handoff.
- **Deliverable:** exact expected output form.
- **Acceptance criteria:** binary/measurable reviewer criteria.

## 7. Specialist Self-Check

Before review, the specialist checks its own work.

For code, where applicable: syntax/parse, type/lint, unit tests, integration tests, negative/edge cases, stale-data behavior, error states, backward compatibility, mobile impact, and data-source correctness.

For analytical work: arithmetic/formulas, source consistency, assumptions, edge cases, alternative explanations, uncertainty, limitations, and reproducibility.

The specialist explicitly identifies what was not verified.

## 8. Independent Review Loop

The reviewer gets the original task packet, specialist result, relevant source material, test evidence, and diff/output.

### GREEN LIGHT

Reviewer states what was checked, why acceptance criteria are satisfied, and any non-blocking residual risk. The reviewed result returns to the Main Agent.

### REVISION REQUIRED

Reviewer specifies exact defect, severity, evidence, required correction, and re-test. The same specialist fixes it, reruns checks, and resubmits to the same reviewer.

Maximum: **3 review cycles**.

After three unsuccessful cycles, the work is not silently approved or merged. The Main Agent escalates unresolved points to the user with evidence and options.

## 9. Main-Agent Integration

Only GREEN-LIGHT specialist outputs enter the integrated result.

The Main Agent checks cross-component interactions, contradictory assumptions, duplicate logic, source mismatches, UI wording versus actual behavior, version/cache consistency, release metadata, user constraints, and whether the combined result still satisfies the original goal.

An individually approved result may still be rejected if integration reveals a conflict. The affected specialist/reviewer loop then reopens.

## 10. Mandatory Software Quality Gates

For code changes, these gates are binding when the repository provides them:

1. Syntax/parse validation.
2. Existing test suite.
3. Relevant targeted tests.
4. Release-check/release-sync.
5. Runtime smoke test.
6. Diff review.
7. Independent implementation review.
8. UI/mobile review for user-facing changes.
9. Data-integrity review for live/financial data.
10. Security/privacy review when credentials, private APIs, or personal data are touched.

If a gate cannot be run because the current environment lacks access/tooling, that limitation is recorded. It is never presented as passed.

## 11. Mandatory UI/UX Review

Every relevant UI change receives a dedicated UI/UX review covering at minimum:

- iPhone/narrow-mobile layout
- safe area and fixed bottom navigation
- clipping and overflow
- card hierarchy
- readability
- action clarity
- color/state semantics
- label consistency
- scroll burden
- stale/unavailable states
- whether the UI implies certainty unsupported by the data

For MERIDIAN, screenshots from the user's actual iPhone take precedence over desktop assumptions.

## 12. Trading/Market Logic — Dual Review

Changes involving signals, risk scores, Profit Lock, hedging, FIB, liquidation logic, leverage, re-entry, regime logic, backtests, paper bots, or portfolio exposure require two distinct reviews.

### Technical review

Checks implementation, math, LONG/SHORT handling, units, PnL interpretation, data freshness, missing-data behavior, edge cases, and accidental execution side effects.

### Methodology/trading review

Checks look-ahead bias, overfitting, sample size, regime dependence, entry/exit attribution, survivorship/selection bias, realistic costs, leverage effects, drawdown interpretation, and whether conclusions exceed the evidence.

Correct code alone does not establish a trustworthy trading rule.

## 13. Data Integrity — Two-Source Rule

Material live/time-sensitive market or portfolio decisions require a second source whenever technically possible.

Examples: Pionex plus another reputable market; API plus user screenshot; exchange A plus exchange B; protected account API plus independent public price feed.

Rules:

- newest authoritative user screenshot overrides stale snapshots
- stale search snippets are not live evidence
- source discrepancies are surfaced
- obvious bad ticks/malformed values are rejected
- missing current price must not silently use break-even as a live price
- ambiguous monetary fields are cross-validated against internally consistent percentages/investment where possible

If only one source exists, the result is marked single-source/not cross-verified.

## 14. MERIDIAN Git/Release Process

Default flow:

1. **Resume preflight:** before any write, re-read the actual current `main` SHA, `version.json`, relevant branch head, open PR state, and current workflow runs. Never trust interrupted-stream or chat state as authoritative repo state.
2. Determine whether the task is a terminal release or an infrastructure/non-terminal change.
3. For a terminal release, the Main Agent alone allocates the next revision from the freshly read `main` value. The target must be exactly `main + 1`.
4. Create one dedicated branch from the exact current `main` SHA. Release branches use `fix/v10-rNN-...` with NN equal to `version.json.terminalBuild`.
5. Specialists/subagents may implement or review scoped work, but release-number ownership, release metadata, PR creation, and merge remain with the Main Agent.
6. Run specialist self-checks and the required review loop.
7. Integrate serially into the single release branch.
8. Run targeted tests and the full repository quality gates.
9. Inspect the final diff against current `main`.
10. Create one release PR documenting change, reason, checks, limitations, and execution impact.
11. **Gate binding:** gate results are valid only for the exact current PR head SHA. Any new commit invalidates earlier approvals and requires fresh gates.
12. **Pre-merge atomic recheck:** immediately before merge, re-read current `main`, PR metadata, branch compare, competing release PRs, and workflow results. Require all of:
    - PR head SHA equals the SHA that passed the gates;
    - PR base SHA/current merge base still corresponds to current `main`;
    - branch is not behind current `main`;
    - candidate terminal revision is still exactly current `main + 1`;
    - no older open PR owns the same release revision;
    - all mandatory gates are green on the exact head.
13. If any pre-merge condition fails, **do not merge**. Close/supersede the stale release PR, rebase/port the scoped change onto fresh `main`, allocate the next free revision, and rerun all gates.
14. Merge with `expected_head_sha`.
15. Verify `main` contains the intended change and release identity.
16. Verify production/deployment behavior with Runtime Smoke when available.
17. Update continuity documentation for durable architecture/rule/limitation/next-step changes.

Each merge requires explicit Project Owner approval of the concrete candidate in addition to the agreed gates.

### 14.1 Single-Writer Release Lease

MERIDIAN terminal releases use a single-writer lease:

- Only the Main Agent may allocate or change `terminalBuild`.
- A release PR must be exactly one revision ahead of current `main`.
- Branch revision and `version.json.terminalBuild` must agree.
- If multiple open PRs target the same revision, the oldest open PR owns the lease; later contenders are invalid.
- After `main` advances, open release PRs targeting the current or older revision are stale and must be closed, never merged.
- A stale branch/release number is never repurposed. Its scoped work may be ported to a new branch using the next free revision.
- Infrastructure/docs/process PRs may keep the current terminal build, but may not change it.

The repository enforces this with `scripts/release-coordinator.mjs`, the Release Safety guard, and the post-main stale-PR sweep workflow.

### 14.1A Release cadence and explicit override

- Standard cadence: maximum one UI/presentation terminal release merge per GitHub UTC calendar day.
- Automatic exception: a genuine bugfix or trust/safety defect that should not wait.
- Any additional same-day UI/presentation terminal release is blocked unless a release-specific `CROSS_MODEL_STATUS NEEDS_USER_DECISION @Achi1984` names the exact blocked release and the cadence conflict, and the user explicitly authorizes that exact release.
- A same-day override is single-use. It applies only to the named release and never carries forward to another release, branch or later decision.
- A prior user statement must never be generalized into standing override authority. Example: `Go – Regel ändern und R125 heute mergen` authorized R125 only.
- Every override release still requires all normal exact-head CI, Claude review, expected-head merge protection and Single-Writer safeguards.
- Before every `@claude` request, check the authoritative mailbox for the same Request-ID + exact head. If an unanswered matching request exists, do not repost. If a matching response exists, do not repost.
- Any change to autonomy rules, release cadence, watchdog/workflow behavior, scheduler behavior or 24/7 operating rules requires `CROSS_MODEL_STATUS NEEDS_USER_DECISION @Achi1984` plus an explicit user answer before merge. Post-hoc authorization is invalid.
- Current 24/7 MERIDIAN operation is explicitly user-authorized. Quota control comes from state-change detection, deduplication and staggered scheduling, not quiet hours.
- GitHub scheduled workflows are best-effort. Do not create further Ops PRs solely to improve cron reliability unless a demonstrated configuration defect exists.

## 15. Documentation and Continuity

Canonical continuity documents:

- MERIDIAN_CONTEXT.md
- MERIDIAN_DECISIONS.md
- MERIDIAN_HANDOFF.md
- MERIDIAN_AGENT_WORKFLOW.md

Meaningful changes update the relevant documents. Chat history is not the sole project memory.

## 16. User Communication

The Main Agent is the only user-facing agent.

Default behavior:

- no continuous internal-progress narration
- no raw specialist chatter
- no reviewer back-and-forth
- report the finished integrated result
- interrupt only for required missing information, an unresolvable blocker, unresolved failure after three loops, or an action that requires explicit external authorization

### 16.1 Mandatory User Escalation
Post `CROSS_MODEL_STATUS NEEDS_USER_DECISION` with `@Achi1984` in #571 before proceeding for:
- Stage/lock changes, canonical V2 run, strategy PnL, Discovery, Validation, Holdout, Paper or Live.
- A new strategy or research direction.
- Agent-rule changes: Lead lease, protocols, STREAM-SAFE version, bootstrap, review duties or workflow permissions.
- Secrets, material costs or external services.
- Review loop 3/3 without GREEN LIGHT.

UI, tests, ordinary bugfixes and housekeeping remain autonomous when none applies.

## 17. Final Result Format

For completed work, the Main Agent reports the following when the sections are relevant:

### What changed
Concrete integrated result.

### What was verified
Tests, sources, reviews, data cross-checks, mobile validation, etc.

### Review status
GREEN, partially verified, or blocked.

### Residual risks
Only real remaining limitations.

### Delivery
PR, commit, file, artifact, deployment, or other concrete output.

### Next step
The single most useful follow-up, if any.

Internal chain-of-thought is not exposed, and no review is claimed unless it actually occurred.

## 18. Failure Policy

Work is not merged or presented as complete when required tests fail, reviewer correctness issues remain, material data conflicts are unexplained, a live financial value is materially ambiguous, target-device UI is broken, release/runtime validation fails, a privacy/security regression exists, or three review loops end without GREEN LIGHT.

The Main Agent then reports what is unresolved, why it matters, what was attempted, and the safest options.

## 19. Priority Order

When priorities conflict:

1. Correctness.
2. Safety/privacy.
3. Data integrity.
4. Reproducibility/verification.
5. User intent.
6. UX clarity.
7. Maintainability.
8. Performance.
9. Speed.

## 20. Runtime Honesty Rule

This is the intended orchestration architecture.

If the current runtime does not expose true separate subagent instances or the requested GPT-6 model family, the Main Agent must use the strongest available tools/models, preserve the same decomposition and independent-review logic as far as technically possible, never claim a named model/agent ran when it did not, and distinguish an actual independent-agent review from a same-agent second-pass review.

Runtime honesty overrides cosmetic adherence to the workflow.

## STREAM-SAFE-V8 — recoverable work packages

1. Before work, resolve `mailboxIssue` from `MERIDIAN_LIVE_CHECKPOINT.json`, read its bounded latest relevant items and reconcile live main, branch, PR and CI.

A task is bounded by its authorized objective, allowed files, branch owner, acceptance tests, budget constraints and stopping conditions, rather than by chat turns. One Go resumes the first incomplete authorized step after reconciliation; it never repeats the previous write blindly.

- Multiple sequential reads, implementation steps, tests and guarded writes are allowed within one authorized work package. No 30-second or one-tool-group chat limit applies.
- Before each write, record intent and a unique op-id, check branch ownership and expected head/base/blob. Use atomic expected-state guards where required; unavailable guards block the write.
- After each write, reconcile the actual effect and record a durable checkpoint before dependent work. A checkpoint is not proof of durable replay protection or authenticated transport.
- One writer per branch; integration and release numbering belong to the lead. Isolated agents may implement, test and prepare a Draft PR only within their delegated scope.
- Stop dependent writes on conflicts, unknown outcomes or scope drift. Read-only diagnosis may continue immediately. Retry at most once after verified OP_ABSENT; never replay OP_APPLIED. A second interruption yields BLOCKED_STREAM.
- Read bounded successful-CI evidence as well as named failures. Preserve payload/source budgets and mailbox tail limits. Never dump entire mailboxes.
- No sleep or polling loops. Poll unchanged external work at most once per session. WAITING records request/run IDs and the resume condition. Existing authorized agents may finish their packet; future dispatch requires a real, separately authorized mechanism.
- Keep one edited progress comment per PR. Deduplicate reviewer requests by request ID and exact head. Give concise milestone updates without requiring a new Go for each internal step.
- Stop at completion, missing authorization, unresolved conflict, exhausted authorized budget, unavailable capability or external dependency. End unfinished reports with NEXT.
- Exact-head/base CI and independent review remain mandatory. Changed heads invalidate prior gates. Project Owner approval of the concrete merge candidate remains required.
- This policy does not authorize production activation, trading, extra spending, workflow/permission/secret/scheduler changes, or a continuously running chat. Existing research and release boundaries remain.

Proposal: mailbox #571 comment 6096562356. This candidate requires independent review and explicit Project Owner merge approval before adoption.

## Transport V1 — source uploads versus rendered excerpts

Authorization: mailbox #571 comment 6037360103 resolves proposal 6037209376.
The user's exact approval is "MERIDIAN – Transport & Feedback V1". This section
implements part A only. Part B (watchdog no-new-finding suppression) still needs
separate implementation/tests and exact-head review. No schedule is changed here.

- `maxPayloadBytes=4096` applies only to rendered progress/log excerpts, not source files.
- `maxSourceFileBytes=262144` applies per file, measured as UTF-8 bytes, not characters.
- `maxSerializedUploadBytes=393216` applies per complete serialized request, not per file.
  Measure the native tool envelope and its encoded transport; use the larger size.
  The contents wrapper's base64 expansion is counted, including metadata. A tree
  upload with several individually valid files may still exceed the request limit.
- Use `node scripts/stream-safe-preflight.mjs --upload-budget contents` (`blob` or
  `tree` for Git-data actions) with complete native tool arguments from stdin. The
  preflight rejects unsupported inputs, invalid Unicode and over-budget uploads;
  its output contains byte counts and Git blob hashes, never the source content.
  Do not substitute an abbreviated envelope. A platform/tool may impose a lower
  limit: obey it; this contract does not expand actual tool capabilities.
- The preflight is a Lead-invoked local check, not an interception of every connector
  call. It performs no network request, upload, branch mutation or authorization.
  It must be invoked for the exact payload to be sent. Pin and reconcile the active
  policy first; a stale/old unscoped policy is rejected rather than silently enlarged.
- Check source blob SHA before and after publication (`verifySourceBlob` can compare
  local source with a returned blob SHA). A checksum proves bytes, not branch ownership.
  Existing op-id, scope, expected-head/CAS, Single-Writer, no-blind-retry, per-operation reconciliation,
  CI, independent exact-head review and protected-merge requirements remain binding.
  Reference-only tree entries require those checks too; they do not upload new content.
- The historical two-file 64-KiB exception is consumed by 74ed8fd1 and b8c35ab8.
  This approved contract, not reuse of that exception, governs subsequent scoped files.

The compact preflight status reads the canonical checkpoint instead of advertising
obsolete STREAM-SAFE-V4 budgets. No research-stage, PnL, Paper or Live flag is changed.
The separate Claude advisory task remains 11:50 / 19:50 Europe/Vienna; advisory
feedback is not an exact-head implementation verdict. Runtime watchdog behavior is
unchanged by this transport implementation.
