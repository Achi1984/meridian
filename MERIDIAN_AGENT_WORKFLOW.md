# MERIDIAN — Main-Agent / Subagent / Review Workflow

## Purpose

This document defines the default quality process for all substantive tasks, not only software work. The Main Agent is the only agent that communicates with the user. Work is decomposed into specialist tasks whenever that materially improves quality, verification, speed, or clarity.

**Priority:** Quality first. Speed is secondary.

No result may be described as independently reviewed, model-verified, tested, deployed, or merged unless that actually happened.

## 1. Scope

This workflow applies to MERIDIAN software, trading and market analysis, research and backtesting, UI/UX, data reconciliation, documents, plans, comparisons, technical troubleshooting, and other larger tasks where decomposition helps.

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

1. Start from current main.
2. Create dedicated feature/fix branch.
3. Implement scoped changes.
4. Run specialist self-checks.
5. Run independent review.
6. Revise up to three times if required.
7. Run integration quality gates.
8. Inspect final diff against main.
9. Create PR documenting change, reason, checks, limitations, and execution impact.
10. Confirm PR is mergeable.
11. Merge autonomously when all gates are green.
12. Verify main contains the intended change.
13. Verify production/deployment behavior when possible.
14. Update continuity documentation for durable architecture/rule/limitation/next-step changes.

The user does not need to approve each merge once the agreed gates pass.

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

For substantive completed work, the Main Agent reports:

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
