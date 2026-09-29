# MERIDIAN Paper-Bot Deep Audit — 2026-09-29

Status: **REPO-CANONICAL ARCHITECTURE / PROMOTION AUDIT**  
Execution impact: **false**  
Runtime P&L snapshot available in this audit: **false**

## Scope and evidence boundary

This audit uses the canonical `main` repository at:

`41b1f6e43b3e2a35e8d8d259c124e347e1bd2455`

It audits bot lifecycle, execution isolation, cost handling, learning gates, observer surfaces and Paper UI consistency.

It deliberately does **not** invent current P&L, PF, win-rate or drawdown values. Those values live in the runtime state exposed by `/api/bot-observer` and `/api/paper/overview`; no authenticated/current runtime snapshot is available inside this GitHub-only audit.

## Canonical lifecycle findings

### Baseline 6.2

Server invariant:

`BASELINE_REFERENCE_FROZEN=true`

`submitSignal()` rejects new Baseline entries with `REFERENCE_FROZEN`.

Disposition:
- reference ledger only;
- no new entries;
- not a promotion candidate;
- preserve as comparison baseline.

### Shadow V1

Canonical server lifecycle:
- status: `RETIRED`
- active: `false`
- ledgerFrozen: `true`
- reason: `DOMINATED_BY_CHALLENGER_V2`

Disposition:
- archived evidence only;
- no new signals/positions;
- must not be presented as an active contender.

### Regime V1

Canonical server lifecycle:
- status: `RETIRED`
- active: `false`
- ledgerFrozen: `true`
- reason: `NEGATIVE_EDGE_AND_SIDE_CONFLICT`

Disposition:
- archived evidence only;
- no new signals/positions;
- must not be presented as an active contender.

### Challenger V2 / V3 lineage

The live research loop treats V2 as the predecessor and V3 as its deterministic successor:
- V2 runs only while no V3 state exists;
- `ensureChallengerV3()` may create V3 only through the frozen post-stop successor policy;
- V3 has its own independent ledger;
- V3 is evaluated prospectively by the canonical Paper learning policy;
- a weak V3 can retire only through the prospective learning gate;
- a max-drawdown stop routes to review, not auto-restart.

No current runtime performance claim is made here.

### Challenger V4 Exit Shadow

Ruleset:

`8.40-CHALLENGER-V4-PAIRED-PROTECTED-EXIT`

Properties:
- paired shadow only;
- can mirror an accepted V3 position but cannot create its own entry signal;
- independent ledger;
- TP1 closes 50%;
- stop moves to cost-aware break-even after TP1;
- diagnostic / decision / graduation sample sizes: 20 / 30 / 50 pairs;
- auto-promotion false.

Disposition:
- valid prospective exit-logic experiment;
- evaluation must use matched V3/V4 pairs;
- no independent alpha claim is allowed.

### Funding Carry V1

New entries:

`FUNDING_CARRY_V1_NEW_ENTRIES_ALLOWED=false`

Retirement reason:

`SUPERSEDED_BY_STRICTER_COST_AMORTIZED_V2`

Disposition:
- no new entries;
- historical/reference evidence only.

### Funding Carry V2

New entries:

`FUNDING_CARRY_V2_NEW_ENTRIES_ALLOWED=false`

Retirement reason:

`REPEATABILITY_SAMPLE_GATE_6_LT_8`

V2 is materially stronger architecturally than V1:
- executable spot ask / perp bid on entry;
- executable spot bid / perp ask on exit;
- separate spot/perp fees;
- slippage;
- projected funding versus round-trip cost hurdle;
- funding persistence and cadence checks;
- basis entry band;
- 30d checkpoint and 90d max hold.

Disposition:
- concept remains useful;
- current V2 ruleset is not open for new Paper entries;
- do not lower the repeatability sample gate after seeing the result.

## Canonical Paper learning policy

`R32-PAPER-LEARNING-V1` is the authoritative prospective evaluation policy.

Frozen checkpoints:
- 20 closed trades: first checkpoint;
- 30 closed trades: retirement decision can become binding;
- 50 closed trades: final checkpoint.

Frozen thresholds:
- weak PF: **0.90**
- promising PF: **1.10**
- promising status additionally requires positive expectancy.

Retirement:
- at >=30 trades: PF < 0.90 **and** expectancy < 0 => `RETIRE_NO_EDGE`;
- at >=50 trades: PF < 1.00 **and** expectancy <= 0 => `RETIRE_NO_EDGE`.

The policy explicitly sets:
- researchOnly = true
- livePromotion = false

## Cost model

New cost-aware Paper sizing uses:
- entry/stop geometry;
- fees;
- adverse stop slippage;
- fixed risk budget;
- optional target net expectation.

This is preferable to evaluating gross chart outcomes only.

Audit requirement:
Every candidate displayed as "promising" must be demonstrably based on **net** ledger outcomes under its frozen cost policy.

## Critical finding A1 — Paper UI is stale relative to canonical lifecycle

`app-v8.0-paper-summary.js` still hard-codes:

- BASELINE 6.2
- SHADOW V1
- CHALLENGER V2
- REGIME V1

But canonical server state says:
- Baseline is frozen;
- Shadow V1 is retired;
- Regime V1 is retired;
- Challenger V3 is the current successor path when created;
- Challenger V4 is the active paired-exit experiment;
- Funding Carry V2 has an explicit lifecycle and retirement state.

Therefore the customer-facing quick comparison is not a faithful representation of the current research topology.

Severity: **HIGH — decision-quality / observability**, not execution.

## Critical finding A2 — UI evaluation thresholds diverge from canonical learning policy

The v8 Paper summary labels `WATCH+` when roughly:
- trades >= 20
- P&L > 0
- PF >= 1.05
- DD <= 10%

The canonical R32 policy instead uses:
- 20 / 30 / 50 checkpoints;
- promising PF >= 1.10 plus positive expectancy;
- retirement logic tied to PF and expectancy at 30/50 trades.

This creates two competing definitions of "good".

Required correction:
- UI must consume the canonical learning status/decision;
- presentation code must not define a second promotion heuristic.

Severity: **HIGH — governance inconsistency**, not execution.

## Critical finding A3 — current runtime metrics are not durable research evidence

The repo exposes:
- `/api/bot-observer`
- `/api/paper/overview`

These are suitable for current operational telemetry, but a runtime snapshot is not automatically a frozen research result.

Required next step:
- capture a timestamped observer snapshot with source SHA;
- calculate a normalized bot-quality table from that snapshot;
- freeze the snapshot before making keep/retire decisions;
- never compare bots from differently defined cost phases without labeling the phase.

Until that snapshot exists, this audit makes **no current performance ranking**.

## Critical finding A4 — V4 evaluation must be paired, not headline-P&L ranked

V4 differs only in exits and is explicitly paired to V3 entries.

Correct evaluation unit:
- same parent position;
- V3 realized P&L versus V4 realized P&L;
- delta per pair;
- median / mean delta;
- positive-delta share;
- tail-loss delta;
- drawdown delta;
- cost delta;
- at 20 / 30 / 50 matched pairs.

Comparing V4 headline equity against unrelated bots would confound entry selection with exit policy.

## Next implementation package after current Data-V1 run is protected

1. Replace hard-coded Paper UI contender list with observer-driven lifecycle data.
2. Show active / retired / frozen / paired-shadow states explicitly.
3. Remove UI-owned WATCH/WATCH+ promotion logic.
4. Render canonical R32 learning status for V3.
5. Add matched-pair panel for V3 vs V4.
6. Show Funding Carry V1/V2 as retired/no-new-entry research states, not active candidates.
7. Add runtime snapshot export with source commit SHA and frozen cost-policy identifiers.
8. Only then perform a quantitative keep/retire audit using current net performance.

No live or exchange execution change is authorized by this audit.
