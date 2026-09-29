# MERIDIAN Agent Orchestration & Streaming-Resilience Protocol

Version: **1**  
Status: **canonical after merge**  
Scope: all MERIDIAN research, code, audit, release and operational work.

## 1. Purpose

This protocol prevents ChatGPT streaming interruptions from becoming project-state failures.

The chat stream is **never** a source of truth. A streaming interruption may truncate the visible answer after repository operations have already completed. Therefore every resumable MERIDIAN task is driven from durable repository state, not from the last visible sentence in chat.

The protocol also defines the requested Main-Agent / Subagent / Reviewer operating model.

## 2. Non-negotiable source-of-truth order

When starting or resuming work, trust sources in this order:

1. merged `main`
2. green current-base CI / release gates
3. `MERIDIAN_RESUME.json`
4. `MERIDIAN_AGENT_STATE.json`
5. active PR metadata and branch comparison against current `main`
6. committed branch checkpoints
7. issue/PR comments
8. chat transcript

The visible chat stream is coordination only. It must never override repository evidence.

## 3. Roles

### Main Agent

The Main Agent is the only role that communicates with the user and the only merge owner.

Responsibilities:
- reconcile current repository state before doing work;
- create the work package;
- decide serial vs parallel decomposition;
- assign bounded tasks to Subagents;
- prevent two writers from changing the same mutable surface at the same time;
- integrate only reviewed outputs;
- refresh against current `main` immediately before merge;
- run/inspect required gates;
- merge or reject;
- update durable resume state;
- report the final result to the user.

### Subagent

A Subagent owns one bounded work packet.

A work packet must define:
- work-package ID;
- objective;
- input `main` SHA;
- dependency IDs;
- allowed files/surfaces;
- forbidden files/surfaces;
- required evidence;
- implementation constraints;
- acceptance criteria;
- required tests;
- explicit non-goals;
- expected output artifact.

A Subagent:
- never merges;
- never changes frozen rules outside its packet;
- never expands scope silently;
- writes only to its isolated branch/workspace when writing is required;
- returns a structured handoff to its Reviewer.

### Reviewer / Prüfer

Every Subagent result gets its own review lane.

The Reviewer independently checks, as far as the runtime permits:
- requirement coverage;
- correctness;
- regressions;
- invariants;
- data leakage / look-ahead;
- frozen-rule compliance;
- test adequacy;
- diff scope;
- source/evidence quality;
- unsafe or unauthorized side effects.

Reviewer verdict:
- `GREEN`
- `CHANGES_REQUIRED`
- `BLOCKED`

A `CHANGES_REQUIRED` result goes back to the Subagent. Maximum **3 review loops**. After loop 3 without GREEN, the package is BLOCKED and returns to Main Agent.

## 4. Model-routing policy

Requested target routing:
- Main Agent: **GPT-6-Astra**
- Reviewer: **GPT-6-Sol**
- Subagent: at least **GPT-6-Luna**, stronger model selected by Main Agent for complex tasks.

Runtime rule:
- never claim a model or independent Subagent was used unless the runtime actually exposed that capability;
- if the requested model is unavailable, use the strongest available model/capability and record the actual execution mode;
- if native Subagent spawning is unavailable, use `COMPAT_ROLE_ISOLATION`: separate work/review phases, isolated branches/checklists, CI and explicit disclosure that the review was not a separate model instance.

Current chat/runtime limitations must not be hidden.

## 5. Decomposition policy

The Main Agent classifies every task before execution.

### Parallel candidates

Run in parallel only when outputs are independent and write sets do not overlap, for example:
- external research vs repository audit;
- UI inspection vs backend test review;
- separate read-only analyses;
- independent test-design review.

### Serial candidates

Run serially when one result changes the assumptions of the next, for example:
- protocol freeze -> engine -> real PnL;
- schema migration -> data migration -> runtime verification;
- branch integration -> release gate -> merge;
- research selection -> data foundation -> strategy preregistration.

### Single-writer rule

For any mutable canonical surface:
- exactly one writer at a time;
- parallel agents use isolated branches;
- no concurrent merge;
- Main Agent is the only integrator.

## 6. Streaming-resilience protocol

### 6.1 Atomic work bursts

A visible interaction burst should normally contain no more than:
- 2–3 tool-call groups; or
- one durable repository transition.

Before a longer sequence, commit/checkpoint the current durable state.

### 6.2 Checkpoint-before-risk rule

Create a durable checkpoint before:
- running first real PnL;
- loading a holdout;
- changing a frozen protocol;
- starting a migration;
- invoking a long CI/replay;
- merging a PR;
- any step that would be expensive or ambiguous to repeat.

### 6.3 Idempotency

Every step must be safe to re-enter.

Before creating or editing:
- check whether the branch already exists;
- check whether the file already exists;
- check whether a matching PR already exists;
- compare branch against current `main`;
- verify whether the intended commit/result has already landed.

Never blindly repeat a write after a streaming interruption.

### 6.4 Recovery after interrupted ChatGPT streaming

On the next user message such as “Fortsetzen”:

1. fetch latest `main` SHA;
2. read `MERIDIAN_RESUME.json`;
3. read `MERIDIAN_AGENT_STATE.json`;
4. inspect active/open PRs relevant to the work package;
5. inspect active branches and compare them to current `main`;
6. identify the **first incomplete durable step**;
7. continue from that step only;
8. do not repeat completed changes;
9. send a short user update with recovered status.

Do not ask the user to restate information already known.

### 6.5 Chat updates

For long work:
- send a concise status update roughly every 15 seconds or after 2–3 tool-call groups;
- report meaningful findings, not low-level API chatter;
- immediately surface a discovered blocker or contradiction;
- keep final user-facing result compact and stateful.

## 7. Work-package lifecycle

Every substantial task follows this state machine:

`RECONCILE -> PLAN -> ASSIGN -> EXECUTE -> REVIEW -> INTEGRATE -> GATE -> MERGE -> CHECKPOINT -> REPORT`

### RECONCILE

Required checks:
- latest `main`;
- latest resume/state files;
- open related PRs;
- related branches;
- current CI status;
- already-completed commits.

### PLAN

Main Agent creates:
- work-package ID;
- success criteria;
- dependency graph;
- serial/parallel decision;
- risk classification;
- Subagent packets;
- Reviewer packets;
- merge plan.

### ASSIGN / EXECUTE

Each Subagent receives only the minimum context needed.

Write tasks must use isolated branches. Read-only tasks may run in parallel.

### REVIEW

Each Subagent result is reviewed before integration.

Maximum loops:
- loop 1: initial review;
- loop 2: first correction review;
- loop 3: final correction review.

No fourth silent retry.

### INTEGRATE

Main Agent:
- re-reads current `main`;
- confirms no concurrent merge;
- resolves drift explicitly;
- integrates reviewed output;
- rejects stale output rather than force-merging it.

### GATE

Required gates depend on task type. Typical gates:
- unit/invariant tests;
- release safety;
- regression tests;
- data-integrity checks;
- frozen-rule checks;
- holdout locks;
- no execution-impact checks.

### MERGE

Merge only if:
- current-base comparison is clean/reconciled;
- required review verdict is GREEN or transparently marked COMPAT review;
- required CI is green;
- frozen invariants are preserved;
- no parallel merge is active.

### CHECKPOINT

After merge:
- update `MERIDIAN_RESUME.json`;
- update `MERIDIAN_AGENT_STATE.json`;
- record merged SHA, PR, result and exact next action.

### REPORT

The user-facing completion report must contain:

- **Work package**
- **Status**
- **Canonical main SHA**
- **PR / merge**
- **What changed**
- **Reviewer verdict**
- **Tests / gates**
- **What was deliberately not changed**
- **Remaining risk / limitation**
- **Exact next action**

## 8. Required Subagent handoff format

```text
WORK_PACKAGE:
TASK_ID:
ROLE: SUBAGENT
EXECUTION_MODE:
INPUT_MAIN_SHA:
BRANCH:
OBJECTIVE:
FILES_CHANGED:
EVIDENCE:
TESTS_RUN:
RESULT:
KNOWN_LIMITATIONS:
REVIEW_REQUEST:
```

## 9. Required Reviewer handoff format

```text
WORK_PACKAGE:
TASK_ID:
ROLE: REVIEWER
EXECUTION_MODE:
REVIEW_LOOP: 1..3
REVIEWED_SHA:
CHECKS:
FINDINGS:
  - severity:
    issue:
    required_change:
VERDICT: GREEN | CHANGES_REQUIRED | BLOCKED
```

A Reviewer must not rewrite the result while reviewing it. Corrections go back to the Subagent.

## 10. Required Main-Agent integration record

```text
WORK_PACKAGE:
BASE_MAIN_SHA:
INTEGRATED_HEAD_SHA:
PR:
SUBAGENT_RESULTS:
REVIEW_VERDICTS:
CI_GATES:
MERGE_DECISION:
MERGED_SHA:
RESUME_UPDATED:
NEXT_ACTION:
```

## 11. Trading/research-specific hard gates

For MERIDIAN strategy research:
- no strategy PnL before protocol + invariants are frozen;
- no holdout loading before the prior gate authorizes it;
- no post-result parameter rescue under the same ruleset;
- no Paper/live promotion from failed or ambiguous evidence;
- frozen data failures stay frozen;
- research and execution-impact changes must be separated;
- executionImpact remains false unless explicitly authorized by a separate reviewed work package.

## 12. Failure handling

### Streaming failure

Do not infer failure of repository operations from truncated chat output. Reconcile the repo first.

### Tool/API timeout

Retry reads safely. Before retrying writes, check whether the write already landed.

### Conflicting parallel work

Freeze integration, compare both branches against current `main`, choose one canonical path, and record why.

### Reviewer failure after 3 loops

Return BLOCKED to Main Agent. Main Agent must redesign or narrow the task; no silent fourth loop.

### CI failure

Do not merge. Diagnose the failing gate, fix on the same isolated branch, re-review changed scope, then rerun CI.

## 13. Definition of done

A work package is done only when:
- the intended result is merged or explicitly rejected;
- repository source of truth is current;
- review outcome is recorded;
- tests/gates are recorded;
- resume/state files are current;
- next action is unambiguous;
- the user receives a compact completion report.

Chat completion alone is not completion.
