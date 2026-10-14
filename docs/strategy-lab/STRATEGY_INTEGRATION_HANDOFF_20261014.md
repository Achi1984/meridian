# Whole strategy package: current-main integration handoff

Status: **SOURCE_ONLY_TRANSFER_PREPARATION**, not merge-ready, unattended-runtime-ready or trading-ready. “Live-development lane” means preparing continued engineering in the current repository; it does not mean live orders. This plan preserves the whole package's lineage while proposing selective, reviewed transfer. **Do not merge the whole stale strategy/base branch.** No code, data script, empirical runner, scheduler or runtime is activated by this document.

## Immutable inventory and dependency boundary

| Role | Pinned state |
|---|---|
| Strategy source / PR768 | `7bc92dc79afdc944bb7bed5f3faa9ae3bd1f03de` |
| Base PR758 | OPEN, unmerged; `5e33c91f383b6339d709bb6072186f72b4bda5a9` |
| Target main snapshot | `18304c935e6a5fed2df6a8e086d7de2f698c1a20` |

The companion [inventory](strategy-integration-inventory-20261014.json) records the union of 42 PR768 paths and 79 PR758 paths: **120 unique files**, with one overlapping path. At the pinned main snapshot, **115 are absent and five differ**. Each row records immutable source/main blobs, originating PRs, a proposed group/disposition, next owner role and pending dependency/content review. These classifications are a transfer proposal, not content approval. The inventory covers the source package before these two handoff artifacts were added.

The overlapping `docs/strategy-lab/trend-pullback.mjs` has PR758 blob `725b5c7f9e73183f11b992241d98230077532140` and PR768 blob `fa536f477382b39dd599fd889a51b3b275c00177`; it is absent at target main. PR768 cannot be treated as a self-contained patch independent of its unmerged base. If source or target heads move, recompute affected comparisons before transfer; no silent rebase or overwrite.

The 79-file baseline includes historical market JSON, rank panels, probe outputs, manifests, preparation/audit scripts, spot simulation components, cross-market/trend prototypes and their tests. Presence is not fresh holdout status, data licensing clearance, verified historical receipts, an executable run manifest or available trial budget. Retain artifacts and failures with original identities; do not regenerate or run data scripts as an integration shortcut.

## Phased transfer plan and gates

### 1. Evidence, data and lineage review

Review `STRATEGY_COVERAGE_20261014.md`, `TRIAL_LEDGER_RECONCILIATION_20261014.md` and its JSON, `PAYOFF_POLICY_MIGRATION.md`, Elliott source/findings/disposition documents, P1 historical-experiment drafts, and PR758 benchmark/data/universe/warmup/cost/historical-handoff documents. Preserve older failed/frozen work and distinguish concept, synthetic fixture, data probe, candidate and empirical trial. C01–C22 all remain assessment scope; listing them or repairing arithmetic establishes no efficacy.

Gate: complete the union inventory's **transfer disposition**, not an invented complete historical trial audit. Every path is selected for source transfer, retained as historical evidence, deferred with reason, or already present with matching identity. Explicitly resolve data-use/licensing questions, known inspected-data status and unresolved counts as UNKNOWN where evidence is absent. Reconcile the P1/C1 allocation discrepancy before any empirical proposal; no new budget slots, resets or implied remaining allowance. Phase1 can finish a source-transfer plan while empirical gates remain blocked.

### 2. Minimal dependency-complete source and synthetic tests

Prepare an isolated integration branch from the freshly verified target main. Select paths from the pinned sources using the manifest, not branch ancestry wholesale. Review import/package/test dependencies and unchanged APIs on that target before declaring a selected subset complete.

| Selected group | Dependency and acceptance gate |
|---|---|
| P1 time separation and synthetic runner | PR768 `trend-pullback.mjs`, `trend-pullback-core.mjs`, `trend-pullback-replay.mjs`, `p1-synthetic-runner.mjs` and their tests/docs need PR758 `replay-time-admission.mjs`, its test and `trend-pullback.test.js`. Resolve the missing-main wrapper explicitly. Recursively inspect imports, including any baseline spot primitives needed by the runner, before transfer; this row is not a complete import graph. Preserve actual availability guards and distinguish archive receipts from assumed publication. |
| Baseline spot/cross-market components | Inventory PR758 `spot-journal.mjs`, `spot-ledger.mjs`, `spot-lifecycle.mjs`, `spot-risk-sizing.mjs`, `spot-simulation-step.mjs`, `cross-market-trend.mjs` and related tests/docs. Select only dependency-required pure components or separately reviewed source packets; do not silently pull all baseline modules/data because they share a directory. Their full current-main compatibility review remains outstanding. |
| Elliott synthetic components | Transfer `elliott-correction-helpers.mjs`, `elliott-synthetic-path.mjs`, `elliott-pivot-admission.mjs`, four corresponding tests and their contracts/docs as one reviewed dependency set. Keep both `fixtures/elliott-frozen-*.mjs` byte-identical historical comparators; no frozen-source repair or historical recomputation. Pivot admission is a single-pivot helper, not a wave/entry engine. |
| Payoff/campaign migration | Explicitly reconcile `campaign-20261013.json`, `validate-campaign.mjs`, `test/strategy-campaign-draft.test.js`, README and TRADE_PLAN_CRV against current main. Preserve V2 strategy-specific payoff, permissions and legacy ceilings. Existing caps are not remaining allocation; preserve the legacy ratio utility as historical arithmetic, not universal acceptance. This protected policy-bearing group needs its own exact review, not ordinary metadata-approved writes. |

Acceptance: manifest hashes match selected files; exact changed-path diff contains no M11/runtime/workflow files; import closure is demonstrated; only declared pure synthetic tests run; frozen blobs match; no historical outputs change. Re-run applicable repository CI on the new target branch and review the exact resulting head. Source-branch results alone cannot establish target-branch compatibility.

Known synthetic commands, only after these files and their reviewed dependencies are present:

```sh
node --test test/elliott-correction-helpers.test.js test/elliott-frozen-characterization.test.js test/elliott-pivot-admission.test.js test/elliott-synthetic-path.test.js
node --test test/trend-pullback.test.js test/replay-time-admission.test.js test/trend-pullback-replay.test.js test/p1-synthetic-runner.test.js
node --test test/strategy-campaign-draft.test.js
```

These are proposed integration checks, not executions reported by this handoff. No preparation, download, normalization, historical audit or PnL script is included.

### 3. Offline work-packet metadata validator

Transfer the reviewed `strategy-work-packet.mjs`, `test/strategy-work-packet.test.js`, `STRATEGY_WORK_PACKET_V1.md` and handoff design only after phase2's selected baseline is fixed. Confirm Node built-in crypto compatibility and run:

```sh
node --test test/strategy-work-packet.test.js
```

Gate: exact schema/canonical identity, resource advice, freshness and denied-authority flags pass on the integration head; read/acceptance references stay distinct from writes. `valid:true` admits metadata only. The lexical protected-write list does **not** protect every governance path automatically: integration must explicitly enumerate protected campaign, ledger, schema, handoff, validator, runtime and M11 paths in the host's path policy. Do not widen the metadata grammar or treat a permitted filename as source correctness or a capability. Objective text remains inert. Same-revision re-keying is not detected without the missing history layer.

### 4. Separate missing integration work

Still absent: completed-review/evidence scope evaluator; trusted predecessor/history and durable operation deduplication; atomic actual-head/checkpoint CAS; campaign-validator composition with reconciled trial ledger; authenticated clock/resource observations; explicit protected-path enforcement at the host boundary; interruption recovery with uncertain-side-effect reconciliation. P1 historical execution and full Elliott wave/entry integration are separate research designs, not consequences of these helpers.

Future trusted host/M11 orchestration owns authentication, locks/resource arbitration and any externally authorized dispatch. This package must compose with MERIDIAN_GO STREAM-SAFE-V8, MERIDIAN_ORCHESTRATION.md and docs/AGENT_ORCHESTRATION.md, **not fork another dispatcher**. M11 BUSY/UNKNOWN/stale means defer external Claude calls; supplied FREE is no reservation. Before any runtime proposal, review the actual host boundary, failure recovery, clock/max-age policy and external permissions as a separate exact-head packet. No scheduler activation is part of phases1–3.

## Evidence scope and distinct approvals

Recorded focused engineering checkpoint: **63/63 synthetic tests** across the metadata/Elliott suite. Source CI run `38530286270`, job `115740272097`, was verified by the lead: **2592 passed, zero failed, zero skipped**, at source head `7bc92dc79afdc944bb7bed5f3faa9ae3bd1f03de`. This is not a target-main test claim. No tests are run by this document.

Claude response `6163487827` is static GREEN for the three-file metadata follow-up, **TESTS_NOT_RUN**. Earlier `6163220262` covers the prior metadata packet and `6162729225` the pivot follow-up, each within its recorded source/head scope. None is a whole-PR758/768 review, a historical artifact authentication or an approval of this future main integration.

Owner source/design approval supports concrete preparation and reviewable source/synthetic work. It is distinct from approval to merge the resulting exact current-main diff, adopt unattended runtime behavior, or conduct empirical trials. Merge requires its own target-head review/tests and existing approval process. Unattended runtime requires the separately reviewed host/permissions/recovery design. Empirical runs require reconciled allocation, frozen hypothesis/data/cost/execution manifest and the existing owner gates; unknown data/model/cost evidence remains research-only. No trading authority, all-concept efficacy claim or fresh holdout follows from transfer.

## Receiving-lane work queue

Role assignments below are proposed responsibilities, not claims that another lane has accepted work.

| Order | Responsible role | Concrete next evidence / acceptance |
|---|---|---|
| 1 | Strategy lead + independent reviewer | Review the two handoff files and all 120 proposed dispositions; resolve disputed selections before source transfer. |
| 2 | Strategy lead | Build recursive dependency map for the selected synthetic subset, pinned to source blobs; classify filesystem/network effects and required package versions. |
| 3 | Live-development integration owner | Refresh main, reserve an isolated branch and reconcile every selected existing path; retain historical-only artifacts by pinned reference. |
| 4 | Integration owner + independent reviewer | Run declared synthetic tests and required target-head CI; review exact resulting diff, protected paths and frozen fixture hashes. |
| 5 | Strategy research owner | Reconcile P1/C1 and cumulative trial accounting; supply data-use and availability evidence before any empirical proposal. UNKNOWN remains blocking for empirical work. |
| 6 | M11/host owner | Design authenticated evidence, resource arbitration, durable deduplication, CAS and recovery as a separate reviewed host packet. |

The first receiver action is the inventory/dependency review, not merging the stacked branches. Local inventory validation checked 120 unique paths and required source hash fields; it did not review the full contents or demonstrate dependency closure. Internal independent review of this handoff did not complete because the reviewer agents reached their usage limit. Prior Claude verdicts do not cover these two new files; a new exact-scope review is required. No extra spending or quota retry is part of this handoff.

Final transfer-ready gate: reviewer checks proposed phase assignments/dependencies and protected paths, receiving owners accept the queue, and the selected target-head packet passes its own gates. This is a reviewable source-only integration preparation plan; it does not assert the entire package is ready to merge or run.
