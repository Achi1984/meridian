# Paper-first evidence contract — offline advisory

This source-only packet defines an evidence vocabulary and checks bounded caller-supplied structure. It grants no authorization. It does not retrieve or authenticate evidence, calculate PnL or metrics, assign edge health, rank or allocate strategies, register candidates, mutate state, or advance lifecycle. Its authority result is always `{source:'OFFLINE_ADVISORY', executionAuthorized:false, autoPromotion:false}`. Checkpoint truth and runtime gates remain enforced outside this validator.

## Why this is a separate contract

- `validate-campaign.mjs` validates one fixed inert campaign draft, not evidence receipts, historical access, or cross-stage identity.
- `paper-learning-policy.js` is a legacy Paper heuristic with fixed checkpoints and PF 99/0 coercion when losses or trades are absent. Those are scope-excluded runtime limitations; this validator neither imports nor repairs it and performs no PnL calculation.
- `paper-edge-v1-data-contract.js` and `paper-edge-v1-state-machine.js` validate one strategy's source data and position mechanics, not shared lifecycle evidence.
- The autonomy review-evidence envelope validates caller claims for review transport, not strategy stages or empirical evidence.

`validateEvidenceContract(input)` accepts one bounded JSON-like object. Accessors, cyclic/prototype-polluting or malformed objects, unknown fields/enums, nonfinite numbers, and over-bound shapes return structured invalid output without invoking accessors. No file, network, environment, scheduler, workflow, market, credential, or runtime interface is used.

## Output axes

- `lifecycle` preserves the claimed stage and receipt claims with `UNVERIFIED_CALLER_SUPPLIED` provenance.
- `evidenceCompleteness` reports per-item `PRESENT_ASSERTED`, `MISSING`, `NOT_ASSESSED`, `FAILED`, `INCONCLUSIVE`, or `INVALID` states and counts. The strongest aggregate description is `ASSERTED_WELL_FORMED`; it is not readiness or a stage pass.
- `edgeHealth` remains `UNKNOWN` unless a sourced measurement is supplied, and then remains `ASSERTED_UNVERIFIED`. No status is derived from metrics.
- `operationalReadiness` is always `NOT_ASSESSED`.
- `authority` is constant and all execution/promotion permissions are false.

Hashes with valid syntax are `HASH_FORMAT_VALID_UNAUTHENTICATED`; references, timestamps, sources, and checkpoint flags are still caller assertions. `asOf` is required input, not a clock lookup. A synthetic fixture may be marked `syntheticFixture:true`, which remains visible in the result.

## Lifecycle, timing and historical records

The one lifecycle vocabulary is:

```text
IDEA → RESEARCH → BACKTEST → OUT_OF_SAMPLE_HOLDOUT → PAPER_BOT
     → FORWARD_VALIDATION → ROBUSTNESS_REVIEW → LIVE_CANDIDATE
```

The roadmap mapping and external gates are in [`MERIDIAN_STAGE_ROADMAP.md`](../MERIDIAN_STAGE_ROADMAP.md). Evidence completeness at a stage does not open any checkpoint gate. `LIVE_CANDIDATE` means eligible for a separate decision only; it is not execution authority.

Receipts are contiguous, monotonic, and bound to one strategy ID, version, and exact rules reference. Every receipt in a version must match the same rules-reference identity and hash; changing either under another source ID is still a mismatch. Stage-specific datasets have separate IDs, hashes, roles, declared disjointness, and as-known timestamps; their hashes are not required to equal one another. Incorrect stage roles, undeclared Development/Holdout or Holdout/Forward disjointness, overlapping windows, or identity mismatch are reported without rewriting claims.

`PAPER_BOT` is a `PAPER_SETUP` receipt with a version frozen no later than setup recording and a planned observation window. Setup may be recorded before that future window begins or ends, and carries no completed outcome or performance metrics. `FORWARD_VALIDATION` and other outcome receipts require observation end no later than recording, data availability no earlier than the end and no later than `asOf`, and a rules freeze before collection. The data reference's as-known time must fall between availability and recording. Forward windows begin after the Holdout window. A completion timestamp in the future is invalid.

Holdout access history distinguishes `FIRST_EXPOSURE`, `SELECTION_OR_TUNING`, `EXACT_REPRODUCTION`, `AUDIT`, `HASH_INSPECTION`, and `REUSED_FOR_NEW_HYPOTHESIS`. Selection/tuning and reuse for another hypothesis make the independence claim unavailable. Unknown history stays `UNKNOWN`. Exact reproduction, audit, and hash inspection may be recorded as `DIAGNOSTIC_ONLY`; repeated diagnostic access by itself is not contamination and cannot become fresh confirmation. Existing consumed Holdout evidence remains usable for reproduction/audit, not as new validation.

`RETROSPECTIVE_RECONCILIATION` is an inventory annotation with explicit historical gaps. It creates no stage receipt, does not satisfy or skip a lifecycle prerequisite, and changes no thresholds or authority. Existing frozen failures and the frozen LowVol reference remain unchanged; no synthetic fixture can establish their empirical performance.

## Evidence fields

Each performance outcome carries a declared sample size/unit, dependence and uncertainty approach, source/rules/data references, a timestamped data window, freshness reference, and sourced predeclared criteria. The validator checks structure and chronology, not claimed values or threshold outcomes.

Declared metrics include net expectancy, profit factor, drawdown, Sharpe, Sortino, tail risk, cost/slippage sensitivity, regime/time/asset stability, uncertainty, sample dependence, and selection risk. Each metric states `APPLICABLE`, `NOT_APPLICABLE`, or `UNDEFINED`, with an explicit value or null, unit/denominator where applicable, and a reason when not assessed. Completed performance receipts require applicable core expectancy, risk, cost, and uncertainty evidence; missing, undefined, or inapplicable evidence remains distinct and cannot be counted as present. Sharpe/Sortino may be inapplicable with a reason. No default zero, universal financial threshold, winner, or win-rate-only qualification is produced.

Stage-specific thresholds are caller-supplied through a predeclared, sourced preregistration or metric threshold assertion. No numeric threshold is invented here. Missing/undefined performance remains distinct from failure and does not count as evidence that a stage succeeded.

Risk policy explicitly states STOP_BASED (with stop definition and bound) or PORTFOLIO_LEVEL_NO_STOP (with justification, bound and source). The latter invents no stop and reports `PLANNED_NET_CRV_MIN_3_V1` as `NOT_APPLICABLE_NO_FINITE_TRADE_PAYOFF`, `NOT_ASSESSED`, and research-only. For other strategies, the existing fixed 3:1 CRV contract is represented as an unverified policy reference only; this validator does not import or replace its arithmetic and cannot claim it satisfied.

Sizing must declare its own method, unit, policy, and source. Any defaults mentioned elsewhere—EUR 10,000, futures leverage 10x, spot 1x, gross exposure 1.5x—are draft research defaults only, never approved sizing.

## Verification

Deterministic fixtures are synthetic schema tests only:

```sh
node --test test/strategy-evidence-contract.test.js
node --test test/strategy-campaign-draft.test.js
```

The candidate's returned assertions are not real historical validation, profitability evidence, operational acceptance, or authorization.
