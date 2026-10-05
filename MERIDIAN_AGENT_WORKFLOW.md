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

The user does not need to approve each merge once the agreed gates pass.

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

### 14.2 Interruption / Streaming Recovery

After a tool interruption, streaming interruption, resumed conversation, or user “Fortsetzen” request:

1. Perform the Resume preflight before any mutation.
2. Treat repo state as authoritative over chat summaries.
3. Detect already-completed commits/PRs/merges and skip them.
4. If a parallel actor advanced `main`, invalidate the old release plan and recompute the next revision.
5. Never replay a write merely because the previous response was interrupted; verify whether it already landed first.
6. Never merge a PR whose gates belong to an older head SHA or an older `main` base.

### 14.3 Streaming-Safe Execution Protocol

To reduce chat-stream interruptions and make every interruption harmless:

1. Prefer compact metadata queries over full diffs, full logs, or whole-file dumps.
2. Fetch full diff/log content only when a failed gate or review defect requires it, and then only the relevant failure window.
3. Keep each user-visible work cycle short: one implementation milestone, one gate milestone, or one merge milestone per update rather than one very long uninterrupted response.
4. After every durable mutation, treat GitHub state (commit SHA, PR head, merge state, workflow run) as the checkpoint. Never rely on unsent chat text as the only record of progress.
5. `MERIDIAN_AGENT_STATE.lastCheckpoint` is historical evidence: its `canonicalMainSha` and `build` describe the same verified checkpoint and must not be rewritten merely because the current terminal release advances. Current release identity belongs in `version.json`, `MERIDIAN_RESUME.json` and `MERIDIAN_LIVE_CHECKPOINT.json`.
5. Before any post-interruption mutation, rerun the Resume preflight from 14.2.
6. Batch independent read-only checks where possible, but serialize repository writes.
7. Tool outputs should normally be reduced to the fields needed for the next decision: SHA, PR number, branch distance, gate status, failing step, and concise file list.
8. Do not paste large raw CI logs into the conversation. Extract only the failing tests and the minimal surrounding evidence.
9. When a long-running release is healthy, send short checkpoint updates instead of holding the entire result until the end.
10. A streaming interruption must never trigger blind replay of a merge, commit, release bump, or external action.

This protocol reduces transport/output pressure, while the existing GitHub checkpoint and exact-head rules ensure correctness even if the UI stream still disconnects.


### 14.4 Hard Streaming Budgets

The following limits are mandatory for interactive repository work:

- **Tool-call budget:** after at most 2 consecutive repository/tool-call groups, emit a short user-visible checkpoint before any third group.
- **Polling budget:** do not poll the same workflow/status more than 2 consecutive times without a checkpoint or a state-changing event.
- **Output budget:** a single tool result surfaced back into the orchestration context should normally stay below 6 KB. Filter, slice, or summarize inside the tool call before returning text.
- **Log/diff budget:** never emit a complete large CI log, full large diff, or whole large source file when a targeted search/window is sufficient. Return only the failing test, relevant lines, SHA/status, or a concise file list.
- **Retry budget:** after 2 identical tool failures, stop repeating the same call. Re-read state, switch method, or report the blocker.
- **Mutation checkpoint:** every commit, PR creation/update, merge, release bump, or deployment state change must be followed by a durable identifier (SHA/PR/run/deploy status) before the next mutation.
- **Resume command:** after any interruption, prefer `node scripts/stream-safe-preflight.mjs` (or the equivalent GitHub metadata query when operating remotely) before any mutation.
- **No blind continuation:** a resumed stream may continue analysis immediately, but must not write/merge/release until the preflight confirms current state.

These are transport-safety limits, not quality shortcuts. Large investigations are split into multiple small verified milestones rather than one oversized streamed response. A visible burst should also end or checkpoint by 90 seconds, whichever comes first. Every durable mutation is followed by a concise user-visible checkpoint before further mutation.

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

## STREAM-SAFE-V5 — compact resume and atomic tool bursts

To reduce chat-stream interruption risk without weakening repository safety:

1. Before every Meridian work step, read Issue #539 comments since the last durable checkpoint and all open `CROSS_MODEL_REQUEST` / `REVISION_REQUIRED` items.
2. For routine continuation, read `MERIDIAN_LIVE_CHECKPOINT.json` before `MERIDIAN_RESUME.json`, `MERIDIAN_HANDOFF.md`, or other large continuity files.
3. Reconcile live `main`, current CI and only the related PRs/branches against the compact checkpoint.
4. Expand the large continuity files only when the compact checkpoint disagrees with live GitHub state or historical detail is required for the current task.
5. Perform at most one remote repository mutation per visible tool burst. After every mutation, emit a short user-visible checkpoint before the next mutation.
6. Keep rendered tool payloads small (target <= 4096 bytes). Never dump whole large continuity files when only a few fields are needed.
7. Never repeat a completed write after a streaming interruption. Reconcile #539 + compact checkpoint + live main first.
8. Long or irreversible work must be split into durable atomic commits so an interrupted chat can resume from GitHub without reconstruction.
9. A stream interruption is never evidence that a GitHub operation failed; repository state remains authoritative.
10. These transport rules do not relax exact-head review, CI, Research-stage, PnL, execution, or Single-Writer gates.
