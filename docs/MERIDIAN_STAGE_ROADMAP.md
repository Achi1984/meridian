# MERIDIAN Stage Roadmap

Status: reconciled operating roadmap, 14 October 2026.
Product principle: **Complex inside – simple outside.**

## Dated checkpoint snapshot — observed 14 October 2026

At this observation, main was `efec133f4ff8a809722b79fa7c5fe8007667c1ea`, terminalBuild `10.0-r128`, with the checkpoint at `SOURCE_AUDIT` and canonical execution, PnL, Discovery, Validation, Holdout, Paper, and Live authorization all false (`MERIDIAN_LIVE_CHECKPOINT.json:19,26-37`). Release Safety run `38637684818`, Runtime Smoke `38637684961`, Release Coordinator `38637684547`, and Pages `38637684223` succeeded on that exact main SHA. This is dated source/check evidence, not a new research or runtime transition or a claim about mutable latest-main state.

On 15 October 2026, PR #805 merged as `1387b47e564c06c3475db501ac3ee77ffa098715`, adding a source-only receipt audit packet. The 14 October PR/head/mergeability pins below remain historical attribution, not a mutable checkpoint; consult the live checkpoint and current main for present state.

Do not restart R118 or R119. PR #563 merged R118 at `bd1f67b991bf7e67ebf50e5f2ae8113207c794f8`; PR #564 merged R119 at `d995726e106c0aa2dc73904e67dd1c59bcc88f11`. R119's original approval, mobile matrix and scope remain historical release evidence, not a new Visual QA result.

Keep these independent candidate threads separate; none is a blind-merge instruction. The following GitHub PR states and heads are observations made 2026-10-14; PR metadata is mutable and not an integration instruction:

- PR #805 is an open draft receipt-verification packet (five files, head `e05409412d82acea26a3e0a6ccbb5cc7d99276bb`, mergeability `blocked`). Its six archive/46-payload receipt checks must not be confused with an evaluator rerun or profitability validation.
- Issue #808 and draft PR #809 are a separate two-file independent-reproduction protocol (head `6667161dbe7f0f37356cfd3021bb1174eba484a4`, mergeability `blocked`). This is the observed current PR state, not the stale `94de4fd8042cb529bca18ef4055402b54f6d867c` head; “blocked” describes GitHub mergeability only. Keep its source-only scope and do not touch its files here.
- Draft PR #791 (strategy lineage; head `41b638ec567540e555eb0dc0cd45bb97e3278cba`, mergeability `behind`) and draft PR #795 (X1 input composition; head `469623cf35c363d24702a73b8bfe845d95fa0923`, mergeability `clean`) remain separate evidence/design candidates. PR #795 targets `draft/strategy-autopilot-20261013`, not `main`. Their synthetic contract evidence is not empirical performance evidence.
- PR #599 is open and not merged (head `b9d62d30a1c59005bcbcf63a36c64733a44ea9de`, mergeability `dirty`; 15 changed files). Its body describes a one-file scope and pins an older base; reconcile its exact full diff and base before any future integration.
- PR #653 remains draft and open (head `2b267ecc0f94565fe005156bf45e8f0ae139eb9b`, mergeability `dirty`; three changed files). Its 44px “Schließen” action and focus restoration already exist in pinned `v11/index.html` (`v11/index.html:230-242,403-426`); merging its branch without reconciliation risks duplication. Source history distinguishes terminal R128 from the Meridian 11 preview labeled B9 while a B6 history entry remains (`test/v11-version-history.test.js:10-15`). These are source/history checks only: no fresh rendered or deployed Visual QA is claimed.

The live checkpoint records active mailbox #571 and archived #539. The owner-requested #539 inspection is complete; retain #571 for current handoffs and do not reopen old review threads as a substitute for exact-head review.

## Product and evidence model

Preserve three product layers:

1. Empirically/scientifically motivated existing methods, with retrospective strategy identities and evidence reconciled explicitly rather than inventing earlier lifecycle receipts.
2. New explicit hypotheses and candidate variants, with every attempted, failed, and discarded variant retained in an append-only trial ledger.
3. Eventual transparent strategy/portfolio autonomy, only after evidence gates and separate authority. Strategy names, popularity, and win rate do not establish edge. The objective is robust positive net expectancy after costs with risk first; profitability is a goal, never an assumption or guarantee.

The strict lifecycle is **IDEA → RESEARCH → BACKTEST → OUT_OF_SAMPLE_HOLDOUT → PAPER_BOT → FORWARD_VALIDATION → ROBUSTNESS_REVIEW → LIVE_CANDIDATE**. Do not skip stages. Candidacy is never execution. The source-only evidence contract at `docs/strategy-lab/PAPER_FIRST_EVIDENCE_CONTRACT.md` checks structure and stage continuity only; hash-looking references and caller-supplied results remain unverified assertions.

Evidence should state net expectancy with denominator/unit, profit factor, drawdown, appropriate Sharpe/Sortino, tail risk, cost/slippage sensitivity, regime/time/asset stability, OOS/Holdout, uncertainty/sample dependence, and selection/overfitting risk. Explain undefined or inapplicable metrics; never substitute zero defaults or invent global financial thresholds. A high win rate alone cannot qualify a strategy. Any stage thresholds must be explicit, sourced and predeclared.

Evidence completeness, operational readiness, and authority are separate. Evidence classifications (`ACTIVE`, `WEAKENING`, `INVALID`, `UNRESOLVED`, `EXPERIMENTAL`) are also independent of lifecycle and authority. Unmeasured correlation and edge health remain `UNKNOWN`; there is no data-derived allocation or automatic deactivation now. Compact decision explanations should answer **ACTION / WHY / RISK / INVALIDATION**, with strategy, market, signal/data/version/time, regime, uncertainty and thesis-invalidating conditions available as detail. Do not fabricate current Long/Short recommendations.

Translate owner value into six release questions: Is it understandable? Does it improve decisions? Does it earn trust? Can it detect a measurable edge? Is it testable? Is it necessary? Prefer small coherent releases and independent exact-head review. Existing M11 commissioning is another chat: this roadmap does not change database/permissions or claim operational acceptance.

## Operating model

MERIDIAN should advance in larger, coherent stages instead of exposing every small implementation step as a user decision.

Default cadence:
- ChatGPT owns architecture, implementation, product direction and merge coordination.
- Claude performs one independent exact-head review near the end of each major stage, plus earlier challenge reviews only when the scope materially affects trust, safety, research semantics or release governance.
- Intermediate commits, test fixes and refactors stay inside the stage unless they create a real product decision.
- User escalation is reserved for explicit authorization gates, meaningful product choices, release-governance changes, trading/research-stage transitions and safety-sensitive changes.
- Every stage closes with exact-head CI evidence, regression checks and a concise stage result.
- Repository live state remains authoritative.

## Stage 1 — R126 Paper authority + readability (historical plan; status as of 2026-10-06)

Goal:
Make Paper immediately understandable without implying that Paper or Live is authorized.

State:
- Draft PR #583
- exact Draft head e2148b52f50ac83cad72e98944a8c66da69e4d31
- Release Safety GREEN
- Visual QA GREEN
- Claude exact-head Draft review GREEN_LIGHT
- release-candidate conversion explicitly authorized on 2026-10-06
- candidate terminalBuild is 10.0-r126
- merge authorized only after fresh exact-head CI + Claude GREEN_LIGHT

These bullets describe the R126 plan and its state at that historical checkpoint. They are not current next-action instructions; R119 is merged and the current source checkpoint is R128.

Completion gate:
- preserve fixed non-performance model order
- preserve VALIDATION ONLY / PAPER ONLY / liveTrading=false semantics
- preserve GET-only research-only Paper contract
- preserve 9/10/11px role floors and >=44px actions
- preserve 390/375/320 trust-state visual evidence
- convert Draft to a release candidate only after an explicit R126 release authorization
- perform fresh exact-head release CI + Claude review before merge

## Stage 2 — Decision surfaces completion

Goal:
Finish the remaining user-facing decision hierarchy so all primary and secondary surfaces answer:
1. What is the state?
2. Why can I trust it?
3. What can I safely do next?

Primary scope:
- Asset Detail first viewport
- remaining cross-surface readability inconsistencies
- first-action/nav-occlusion QA hardening
- rendered pair/metric fixtures that close known false-green gaps
- no global font-size inflation
- no strategy, score, ranking, execution or research-stage semantic changes

Completion gate:
- 390/375/320 visual matrix passes
- stale/error/unavailable states remain understandable
- no clipping or nav occlusion
- no cross-surface semantic regression
- exact-head Claude review GREEN_LIGHT

## Stage 3 — Paper evaluation framework

Goal:
Turn Paper into a rigorous evaluation workspace rather than a performance leaderboard.

Scope:
- explicit baseline/challenger experiment registry
- rendered model-order invariants
- rendered R42 cohort evidence
- fee, slippage, drawdown, trade-count and sample-size visibility
- evidence provenance and snapshot freshness
- experiment comparison without winner/promotional language
- immutable experiment identity and reproducibility metadata

Hard boundary:
This stage may improve infrastructure, fixtures, presentation and experiment governance, but must not authorize canonical PnL, Discovery, Validation, Holdout, Paper or Live transitions.

Completion gate:
- repeatable deterministic fixtures
- model order independent of PnL
- accounting/provenance checks
- no auto-promotion path
- exact-head CI + Claude GREEN_LIGHT

## Stage 4 — Strategy research engine vNext

Goal:
Build a professional candidate-research engine capable of developing and challenging strategies while keeping canonical research gates explicit.

Planned research families:
- Moneyflow / volume-candle-direction features
- FIB context and reversal zones
- SK long/short framework
- regime filters
- momentum/trend factors
- funding/carry and cross-venue structures
- grid/range strategies
- ensemble/confluence experiments

Architecture:
- frozen candidate definitions
- deterministic datasets
- train/development/validation separation
- fee/slippage/funding accounting
- robustness and stress tests
- anti-lookahead / anti-overfit guards
- challenger vs baseline governance

Authorization gate:
Canonical strategy PnL, Discovery, Validation or Holdout execution requires the explicit authorization defined in the live checkpoint. Planning, code scaffolding and non-canonical fixtures do not imply authorization.

Completion gate:
- reproducible research pipeline
- no hidden parameter tuning on holdout data
- independent Claude methodology challenge
- research-stage transitions recorded explicitly

## Stage 5 — Paper Bot Lab

Goal:
Evaluate promising strategies prospectively under realistic Paper conditions.

Only after explicit Paper authorization:
- forward-only Paper bots
- fixed strategy versions
- realistic fees, funding and slippage
- risk budgets and exposure caps
- baseline/challenger cohorts
- daily/weekly evidence windows
- no retroactive parameter edits
- no performance-based silent reordering
- automatic stop conditions for invalid data or contract failures

Key success criteria:
- positive expectancy after costs
- acceptable drawdown
- sufficient sample size
- robustness across assets/regimes
- concentration controls
- reproducible decisions

## Stage 6 — Autonomous Paper Trader

Goal:
Allow MERIDIAN to operate professionally in Paper mode while remaining fail-closed.

Scope after explicit authorization:
- decision engine
- position sizing/risk controller
- exposure and correlation limits
- stop/exit governance
- stale-data blocking
- daily loss limits
- emergency kill switch
- full decision journal
- post-trade attribution
- continuous challenger evaluation

Principle:
Autonomy applies to Paper operation only. It never grants Live authorization.

Completion gate:
- stable forward evidence
- operational reliability
- explainable decisions
- bounded risk
- independent review of failure modes

## Stage 7 — Live readiness

Goal:
Prepare, not automatically activate, a production trading path.

Required before any Live transition:
- separate explicit user authorization
- hardened secrets/permissions
- venue-specific read/write separation
- canary sizing
- hard capital/risk limits
- kill switch
- audit log
- incident/recovery procedures
- exact deployment/runtime acceptance
- independent Claude risk review

No Paper success automatically authorizes Live.

## User interaction model

From now on, report primarily at these points:
- stage start
- material blocker or real user decision
- stage gate result
- release authorization request
- final merge/release status

Do not require the user to repeatedly say “Go” for routine implementation inside an already-authorized stage.

## Current next action

The R126 release-candidate conversion and its next-action wording above are historical, not the current release instruction. R119 is already merged, and terminalBuild is R128. Current priority is reproducibility, the paper-first evidence contract, and a reconciled trial ledger; next is reviewable UI integration against the existing #599 candidate; only later, and separately authorized, may Paper work begin. No packet authorizes a canonical/PnL/Discovery/Validation/Holdout/Paper/Live run, market fetch, workflow, scheduler, credential, or runtime activation.

## Lifecycle-to-roadmap and external-gate mapping

The lifecycle describes evidence sequence only. Roadmap stage names are planning containers; the checkpoint flags below remain external authorization gates and are false in the current checkpoint (`MERIDIAN_LIVE_CHECKPOINT.json:26-37`).

| Evidence lifecycle stage | Roadmap planning stage | External checkpoint gate / boundary |
| --- | --- | --- |
| IDEA | Stage 4 — Strategy research engine vNext | Design only; no canonical run or authority gate is opened. |
| RESEARCH | Stage 4 — Strategy research engine vNext | Source and assumptions only; `discoveryAuthorized` remains a separate gate. |
| BACKTEST | Stage 4 — Strategy research engine vNext | Canonical execution/PnL and Discovery require their explicit checkpoint gates (`canonicalExecutionAuthorized`, `strategyPnlAuthorized`, `discoveryAuthorized`). |
| OUT_OF_SAMPLE_HOLDOUT | Stage 4 — Strategy research engine vNext | `validationAuthorized` and `holdoutAuthorized` remain separate explicit gates; historical Holdout access is not a new confirmation. |
| PAPER_BOT | Stage 5 — Paper Bot Lab | A setup receipt is not an operating bot; `paperAuthorized` remains external and false. |
| FORWARD_VALIDATION | Stage 5 — Paper Bot Lab; Stage 6 — Autonomous Paper Trader | Requires separately authorized Paper operation (`paperAuthorized`) and operational review; evidence completeness alone grants neither. |
| ROBUSTNESS_REVIEW | Stage 6 — Autonomous Paper Trader; Stage 7 — Live readiness | Review/candidacy evidence only; no automatic transition or authority. |
| LIVE_CANDIDATE | Stage 7 — Live readiness | Candidacy is never execution; `liveAuthorized` is a separate explicit gate and remains false. |

No stage or validator output can authenticate a checkpoint claim, authorize the next stage, or change an external gate.

Any later UI follow-on must test 320/375/390px, READY/AUTHORITY conflicts, next-action and error states, hierarchy/hero height, progressive disclosure, and bottom navigation. No UI changed in this packet and no new Visual QA is claimed. Preserve independent review and exact-head/base checks; stop and report if ownership or instructions conflict.
