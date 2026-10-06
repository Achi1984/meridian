# MERIDIAN Stage Roadmap

Status: operating roadmap for larger development steps.  
Product principle: **Complex inside – simple outside.**

## Operating model

MERIDIAN should advance in larger, coherent stages instead of exposing every small implementation step as a user decision.

Default cadence:
- ChatGPT owns architecture, implementation, product direction and merge coordination.
- Claude performs one independent exact-head review near the end of each major stage, plus earlier challenge reviews only when the scope materially affects trust, safety, research semantics or release governance.
- Intermediate commits, test fixes and refactors stay inside the stage unless they create a real product decision.
- User escalation is reserved for explicit authorization gates, meaningful product choices, release-cadence overrides, trading/research-stage transitions and safety-sensitive changes.
- Every stage closes with exact-head CI evidence, regression checks and a concise stage result.
- Repository live state remains authoritative.

## Stage 1 — R126 Paper authority + readability

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

R126 release-candidate conversion is explicitly authorized.  
The next gate is **fresh exact-head R126 CI + independent Claude release review**, followed by merge only if the final candidate remains GREEN.
