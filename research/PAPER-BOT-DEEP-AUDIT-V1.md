# MERIDIAN Paper-Bot Deep Audit V1

Status: **ARCHITECTURE / PROMOTION AUDIT — NO RUNTIME MUTATION**  
Canonical base: `41b1f6e43b3e2a35e8d8d259c124e347e1bd2455`  
Execution impact: **false**

## Scope

This audit separates three things that are currently easy to confuse:

1. presentation/UI summaries;
2. canonical Paper/runtime ledgers and lifecycle state;
3. research/backtest ledgers.

It does not change entries, exits, sizing, promotion gates, state, or live execution.

## Safety baseline

The canonical server is Paper-only by construction:

`if(!config.paperTrading||config.liveTrading) throw new Error("Unsafe configuration: PAPER only required.");`

The baseline Paper ledger is also frozen as a reference:

`BASELINE_REFERENCE_FROZEN=true`

New baseline signals are rejected with `REFERENCE_FROZEN`.

Therefore the baseline is a comparison reference, not a candidate that should be silently reactivated.

## Canonical runtime surface

The canonical runtime observer is `/api/bot-observer`, produced by `bot-observer.js`.

Its current bot surface is:

- BASELINE reference
- CHALLENGER V2
- CHALLENGER V3
- CHALLENGER V4 EXIT SHADOW
- BTC FUNDING CARRY V1
- BTC FUNDING CARRY V2
- archived lifecycle metadata for SHADOW V1 and REGIME V1

The newer `/api/paper/overview` additionally exposes Alpha Lab / Research R42 context.

### Important UI mismatch

`app-v8.0-paper-summary.js` and earlier overview wrappers still evaluate the legacy four-card DOM set:

- BASELINE 6.2
- SHADOW V1
- CHALLENGER V2
- REGIME V1

That is **not** the same set as the canonical runtime observer.

The UI's quick verdict is presentation-only:
- <20 trades => SAMPLE LOW
- positive P&L + PF >= 1.05 + DD <= 10% => WATCH+
- PF >= 0.95 and P&L > -100 => WATCH
- otherwise REJECT
- "leader" = highest displayed P&L

These rules are useful as a visual summary only. They are **not a valid promotion policy** and must not be treated as one.

## Lifecycle audit

### BASELINE

Status: **FROZEN REFERENCE**

- Existing reference ledger remains available for comparison.
- New signal acceptance is blocked by `BASELINE_REFERENCE_FROZEN=true`.
- Do not rank it as an active challenger.

### SHADOW V1

Canonical lifecycle:

- status: `RETIRED`
- active: false
- ledgerFrozen: true
- reason: `DOMINATED_BY_CHALLENGER_V2`

Disposition: **historical comparison only**.

### REGIME V1

Canonical lifecycle:

- status: `RETIRED`
- active: false
- ledgerFrozen: true
- reason: `NEGATIVE_EDGE_AND_SIDE_CONFLICT`

Disposition: **historical comparison only**.

### BTC FUNDING CARRY V1

- research/Paper-only
- new entries: **disabled**
- retirement reason: `SUPERSEDED_BY_STRICTER_COST_AMORTIZED_V2`

Disposition: **retired predecessor / evidence only**.

### BTC FUNDING CARRY V2

- research/Paper-only
- new entries: **disabled**
- retirement reason: `REPEATABILITY_SAMPLE_GATE_6_LT_8`
- stricter executable bid/ask, fee, slippage, cadence and cost-amortization logic than V1

Disposition: **insufficient repeatability sample; no new capital / no restart under same ruleset**.

### CHALLENGER V4 EXIT SHADOW

- paired shadow of accepted CHALLENGER V3 positions only
- no independent signal path
- TP1 closes 50%
- remaining stop moves to explicit fee/slippage-aware cost break-even
- max drawdown gate: 8%
- diagnostic pairs: 20
- decision pairs: 30
- graduation pairs: 50
- autoPromotion: false

Disposition: **active research comparison only until prospective pair-count and quality gates are met**.

### CHALLENGER V2 / V3

Canonical runtime code prefers V3 once a frozen successor exists; otherwise V2 remains the active challenger path.

No conclusion about current P&L, PF, DD or current closed-trade count is made in this audit because the live observer snapshot was not available through the current connector path.

## Canonical prospective learning policy

`paper-learning-policy.js` is stronger than the current quick UI labels.

Frozen checkpoints:

- first checkpoint: **20 closed trades**
- retirement checkpoint: **30 closed trades**
- final checkpoint: **50 closed trades**
- weak PF: **0.90**
- promising PF: **1.10**

Rules include:

- before 20 trades: build sample;
- 20–29: early signal only;
- at >=30: retire only if PF < 0.90 **and** expectancy < 0;
- through 50: extend ambiguous cases rather than retune;
- at >=50: retire when there is no positive net edge;
- promising means PF >= 1.10 and positive expectancy;
- live promotion is always false.

This should be the baseline evaluation contract for active directional Paper candidates.

## Cost and successor discipline

`paper-cost-policy.js` sizes positions using stop loss plus fees and slippage.

`post-stop-learning.js` enforces:
- deterministic post-stop diagnosis;
- at least 20 closed trades before successor construction;
- no asset exclusion;
- no side exclusion;
- no parameter search;
- only one deterministic successor;
- promotion requires prospective evidence.

These constraints are aligned with MERIDIAN's no-post-result-rescue policy.

## Audit findings

### PB-AUDIT-001 — presentation lineage is stale

Severity: **MEDIUM**

The customer-facing Paper summary still foregrounds retired SHADOW V1 and REGIME V1 while newer canonical runtime candidates include V3, V4 and Funding Carry V2.

Risk:
- user may infer the wrong current candidate set;
- UI "leader" can be a retired or non-promotable model;
- displayed quick verdict can be mistaken for research authorization.

Required future fix:
- derive the summary from `/api/bot-observer` or `/api/paper/overview`, not legacy DOM card names.

Do not implement this fix until the current Data V1 evidence run is complete and current-main integration is reconciled.

### PB-AUDIT-002 — quick UI verdict is weaker than research policy

Severity: **MEDIUM**

WATCH+ currently needs only 20 trades, PF >= 1.05, positive P&L and DD <=10%.

The canonical prospective learning policy uses 20/30/50 checkpoints and PF 1.10 for a promising classification, plus expectancy.

Required future fix:
- UI must expose research-policy phase and remaining sample;
- no "candidate found" headline should imply promotion eligibility.

### PB-AUDIT-003 — current performance snapshot unavailable in this audit channel

Severity: **INFORMATION GAP**

The repository defines a read-only `/api/bot-observer` endpoint, but the currently available connector cannot retrieve the deployed runtime endpoint.

Therefore this audit intentionally does **not** invent or reuse stale P&L/PF/DD numbers.

A later runtime snapshot should capture, for each canonical bot:
- lifecycle;
- closed/open sample;
- net P&L;
- PF;
- expectancy;
- max/current DD;
- win rate;
- long/short contribution;
- fee/slippage contribution where available;
- current prospective-learning phase;
- remaining trades to next gate.

## Current promotion eligibility from repository evidence only

| Candidate | Repository status | Promotion now? |
|---|---|---|
| Baseline | frozen reference | No |
| Shadow V1 | retired | No |
| Regime V1 | retired | No |
| Funding Carry V1 | superseded, new entries disabled | No |
| Funding Carry V2 | repeatability sample failed 6<8, new entries disabled | No |
| Challenger V4 | paired research shadow, 20/30/50 pair gates | No automatic promotion |
| Challenger V2/V3 | prospective Paper lineage | Runtime sample required |

## Recommended next Paper-bot work after current Data V1 integration

1. Obtain one canonical live `/api/bot-observer` snapshot.
2. Evaluate only current canonical candidates against the 20/30/50 policy.
3. Build per-bot cost/PF/expectancy/DD/side-attribution evidence.
4. Keep retired ledgers visible only under historical/research details.
5. Replace legacy Paper summary card parsing with observer-derived lifecycle-aware UI.
6. Any new bot or successor receives a new frozen ruleset; never retune a failed ledger in place.

No execution-impact change is authorized by this audit.
