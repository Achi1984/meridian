# Paper-first evidence contract — offline advisory

Status: source-only contract proposal. It is not research, trading, operational, or execution authorization.

## Purpose and boundary

`validate-evidence-contract.mjs` validates the shape and continuity of an explicitly supplied evidence packet. It reports whether claimed evidence is structurally complete, what is missing or invalid, and which evidence is required for the named next lifecycle stage. It does not retrieve or authenticate the referenced evidence, calculate PnL or metrics, recommend or rank strategies, allocate capital, register candidates, mutate state, or invoke a lifecycle transition. Its result always contains `executionAuthorized: false` and `autoPromotion: false`.

This contract fills a distinct gap rather than replacing existing components:

- `validate-campaign.mjs` checks one fixed, inert hypothesis-card draft and its denial permissions; it does not validate evidence receipts or lifecycle continuity.
- `paper-learning-policy.js` summarizes a prospective trade phase using its existing fixed checkpoints; it is not a provenance, holdout, or lifecycle validator.
- `paper-edge-v1-data-contract.js` and `paper-edge-v1-state-machine.js` validate or model one frozen strategy's data and position mechanics; they do not govern cross-strategy stage evidence.
- The autonomy review-evidence contract binds a caller-supplied review envelope and explicitly leaves execution authenticity to a trusted boundary. This validator applies the same limitation to strategy evidence, without reusing its reviewer/CI-specific schema.

The validator accepts one bounded JSON-shaped object:

```text
{
  schemaVersion, assessmentAt,
  checkpoint: { id, mainSha, stage, sourceOnly, flags },
  strategy: {
    id, version, hypothesis, entry, exit, risk, positionSizing,
    costAssumptions, marketConditions, telemetry,
    invalidationConditions, frozenAt, disposition
  },
  lifecycle: { currentStage, proposedNextStage, receipts }
}
```

The API is `validateEvidenceContract(input)`. It is pure and deterministic for the same input. Unknown fields and enums, non-JSON shapes, nonfinite numbers, unsafe object properties, excess nesting/size, missing required timestamps, stale data receipts, and inconsistent identity or evidence references fail closed. SHA-256 and commit-looking strings are syntax-checked only: they are caller assertions, not verified hashes, signatures, source provenance, or proof that a run occurred.

## Authority and lifecycle

The checkpoint must identify `MERIDIAN_LIVE_CHECKPOINT`, say `SOURCE_AUDIT`, and explicitly set every listed canonical execution, PnL, Discovery, Validation, Holdout, Paper, and Live authority flag to `false`. Missing, unknown, or contradictory checkpoint/flag data blocks readiness. Caller-supplied `true` flags cannot grant authority; even an entirely structurally complete packet can never authorize execution.

The lifecycle is strictly contiguous and ordered:

```text
IDEA → RESEARCH → BACKTEST → OUT_OF_SAMPLE_HOLDOUT → PAPER_BOT
     → FORWARD_VALIDATION → ROBUSTNESS_REVIEW → LIVE_CANDIDATE
```

Receipts must cover every stage through `currentStage` exactly once, in order, and `proposedNextStage` must be the immediate successor. Each receipt is bound to the same strategy ID/version and has immutable-looking receipt, source, dataset, and digest references. Reusing an ID with a different digest, reusing or overlapping development data as Holdout, or changing strategy identity blocks readiness. Holdout tuning must be explicitly false. `PAPER_BOT` and `FORWARD_VALIDATION` require `FORWARD` evidence starting no earlier than the frozen strategy timestamp and after the prior forward window; all other stages require `RETROSPECTIVE` evidence. This is a structural chronology check, not a determination that data was genuinely unseen or collected prospectively.

Known frozen/failed identities (Baseline 6.2, Shadow V1, Regime V1, Elliott Wave 5, Breakout V1, taker-flow V1/V2, and regime-grid V2) and the frozen LowVol reference are not eligible for a synthetic promotion claim. Existing or retrospective strategies require explicit migration and evidence reconciliation; this contract cannot invent earlier receipts. A green synthetic fixture demonstrates only that the schema can be complete.

Evidence outcomes are `PASS`, `FAILED`, `INCONCLUSIVE`, and `NOT_ASSESSED`. Failed or inconclusive receipts block proposed-stage readiness; `NOT_ASSESSED` remains distinct and is not treated as a failure or a pass. The output separately reports evidence completeness and `READY_UNVERIFIED` (a structural advisory only), `BLOCKED`, or `NOT_ASSESSED`; terminal `LIVE_CANDIDATE` returns `NO_NEXT_STAGE`. It explicitly leaves `operationalReadiness` as `NOT_ASSESSED` and `authorityStatus` as `NOT_GRANTED`; it does not advance the lifecycle.

## Evidence and metric requirements

Every stage receipt carries source and data references, a dated data window, availability and validity timestamps, and a freshness-policy source. Assessment after the declared `validThrough` timestamp is stale. Data timestamps and hash formats are checked, but their truth is not authenticated.

Strategy definition requires an explicit hypothesis, entry, exit, position sizing, applicable market conditions, telemetry, invalidation conditions, and costs for fees, spread, slippage, funding, and borrow. A stop-based risk policy must state its stop definition. A non-stop portfolio-risk policy is allowed only when explicitly named and justified, with no invented stop.

`BACKTEST` and later stages require a complete metric set:

- net expectancy, profit factor, and drawdown;
- Sharpe and Sortino, or an explicit reason each is inapplicable;
- tail risk and cost/slippage sensitivity;
- regime, time, and asset stability;
- OOS/Holdout evidence;
- uncertainty, sample dependence, and selection/overfitting risk.

Each assessed metric includes a finite value, unit, positive denominator with unit, and a stage-specific threshold with a source and predeclaration timestamp before the evidence window. The validator checks the declared comparison; it defines no universal financial cutoff. Undefined/inapplicable metrics need reasons, not zero defaults. Win rate is not a qualifying metric and cannot replace net expectancy or any required dimension. OOS/Holdout may remain explicitly `NOT_ASSESSED` before the Holdout stage; it must be assessed at that stage and thereafter.

## Evidence of this packet

Tests use deterministic synthetic inputs only. They do not reproduce or revalidate historical results and do not qualify any existing or proposed strategy:

```sh
node --test test/strategy-evidence-contract.test.js
node --test test/strategy-campaign-draft.test.js
```

No network, market fetch, PnL run, workflow, scheduler, credential, runtime activation, registration, or authority change is part of this contract.
