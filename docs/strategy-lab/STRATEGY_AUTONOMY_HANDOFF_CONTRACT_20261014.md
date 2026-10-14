# Strategy autonomy handoff — proposed contract

Status: `DESIGN_ONLY_NOT_ADOPTED`. This proposes offline handoff checks only: no policy adoption or activation. It must fit existing MERIDIAN_GO STREAM-SAFE-V8, MERIDIAN_ORCHESTRATION.md and docs/AGENT_ORCHESTRATION.md; it neither replaces orchestration nor creates a scheduler.

## Scope and actual checkpoint

Coverage remains all **C01–C22** in [STRATEGY_COVERAGE_20261014.md](STRATEGY_COVERAGE_20261014.md). Preserve IDs and failed predecessors. Concepts are not 22 new budget slots; bind each to economic-family records, with unresolved lineage UNKNOWN, never an invented independent family or reset count.

C04 checkpoint `bf0884db`: completed pivot follow-up, **48/48 internal synthetic tests** across four suites. See [ELLIOTT_PIVOT_ADMISSION_IMPLEMENTATION.md](ELLIOTT_PIVOT_ADMISSION_IMPLEMENTATION.md) and [ELLIOTT_PIVOT_ADMISSION_CONTRACT_20261014.md](ELLIOTT_PIVOT_ADMISSION_CONTRACT_20261014.md). Claude response `6162729225` is a scoped static review, `TESTS_NOT_RUN`; it is not a review of the entire PR or independent execution of those tests. No new run here; resolve short commits to full SHAs before machine use. Pivot/path helpers are not a complete strategy. Frozen dispositions and unresolved trial counts stay unchanged.

## Proposed machine-readable packet

Proposed `STRATEGY_WORK_PACKET_DRAFT_V1`: freeze exact keys/types/bounds before implementation; reject missing/extra fields. Trusted JSON data only, no getters/proxies. Required groups:

| Field group | Required content and meaning |
|---|---|
| Identity | `packetId`, positive `revision`, `lane:STRATEGY`, unique C01–C22 `conceptIds`, source-backed `economicFamilyRefs` or UNKNOWN, one bounded objective/exclusions. |
| Immutable lineage | Repository/ref, full `expectedHeadSha`, predecessor packet/revision/key, sources `{path,commitSha,blobSha}`, dependency/test hashes. Retain failed/superseded lineage; branch names are insufficient. |
| Work class | Exactly `SOURCE_DESIGN`, `SOURCE_CHANGE`, `SYNTHETIC_CHECK`, `EMPIRICAL_REQUEST`, `MERGE_REQUEST` or `RUNTIME_REQUEST`. A request is not permission. Declare proposed actions separately from observed completion. |
| Path boundary | Exact relative `allowedPaths`, proposed path/actions, read/write distinction, frozen dependencies. Reject globs, traversal, absolute paths and M11 paths. Read scope is not write scope. |
| Acceptance | Named checks/criteria, inert command/arguments, artifact identities and frozen hashes. Results bind source SHA, test ID, status/evidence. Validator never executes commands. |
| Budgets | Engineering cost/effort ceiling, units, attempts, policy reference; separate trial ledger/allocation/remaining allowance/reconciliation. UNKNOWN or empty variants is not zero/available budget. |
| Evidence/freshness | Mutable observations bind source/time/head, maximum age and check horizon. Missing/stale/future observations block dependent recommendations. Clocks/evidence remain unauthenticated; immutable hashes must match. |
| Review | Exact head/path/blob set, kind (static/test/design), reviewer/response, findings/disposition, exclusions, test-run status. Partial review cannot satisfy full scope. |
| Resource separation | M11 state `FREE`, `BUSY` or `UNKNOWN`, observation age/source, and strategy-only external-review request scope/cost ceiling. Unknown/stale is not free. |
| Recovery | `operationKey`, previous checkpoint digest/revision, expected current head/checkpoint for compare-and-swap (CAS), current state, completed evidence references, blockers and proposed next recommendation. No credentials or permission tokens. |

UNKNOWN trial reconciliation/allowance blocks empirical recommendations, not independently bounded source/synthetic proposals. Empirical work still needs frozen hypothesis/data/execution manifest, reconciled allocation and existing owner gates. Merge/runtime have separate gates; tests/static review never substitute. No new allocation or cap increase.

## Planner, operation identity and recovery

The pure planner accepts supplied packet/artifacts/checkpoint/resource observations and returns **recommendations only**: `RECOMMEND_SOURCE_PACKET`, `REQUEST_EVIDENCE`, `DEFER`, `DUPLICATE_NO_ACTION` or `CONFLICT`. Every result explicitly carries `recommendationOnly:true`, `dispatchAuthorized:false`, `executionAuthorized:false`, `empiricalRunAuthorized:false`, `mergeAuthorized:false`, `runtimeAuthorized:false`, `evidenceAuthenticated:false`. No assertions become permissions; no network, shell, writes, dispatch, credentials or self-authorization.

Operation key hashes versioned canonical repository/lane, packet/revision/class, concepts/families, head/predecessor, paths/actions, source/acceptance/budget identities. Fix canonical encoding/hash in the next contract: suggested UTF-8 canonical JSON/SHA-256; sorted keys/sets, preserved sequence order, rejected duplicates/unsupported values. Timestamps or retry numbers must not manufacture a new logical operation. Changed scope/head requires an explicit new packet revision with predecessor linkage, never silent re-keying to evade deduplication.

Completed matching key: `DUPLICATE_NO_ACTION`; inconsistent payload/evidence: `CONFLICT`. Duplicate checkpoint records reject. Missing history is UNKNOWN. CAS compares expected head and checkpoint revision/digest with supplied observations; mismatch yields conflict, not overwrite/rebase/retry. Offline CAS is advisory; a separately authorized actor must atomically recheck real state before side effects. No durable exactly-once claim.

Proposed checkpoint states: `PROPOSED` → `VALIDATED_FOR_RECOMMENDATION` → externally reported `IN_PROGRESS` → `EVIDENCE_READY` → `REVIEWED_SCOPE_COMPLETE` → `CLOSED_SOURCE_PACKET`. Branches: `BLOCKED`, `SUPERSEDED`, `RECOVERY_REQUIRED`. States describe evidence, not permissions; transitions bind prior revision/digest and artifacts. Recovery rechecks head/checkpoint/artifacts and deduplicates. Uncertain outcomes require RECOVERY_REQUIRED, never blind retry. Source closure cannot activate empirical/merge/runtime work.

M11 has priority. `BUSY`, `UNKNOWN` or stale M11 status means **defer external Claude calls**. Even fresh FREE merely permits recommending a separately authorized, budgeted, strategy-scoped review; the planner cannot send it. Preserve reviewed head/response linkage and never describe static `TESTS_NOT_RUN` as executed validation.

## Recommended next bounded packet

Compose with existing `validate-campaign.mjs` and V2 `campaign-20261013.json`: retain source-only/no-dispatch gates and strategy-specific payoff policy. Existing ceilings are not remaining allowance; do not duplicate/reset caps. Next: pure offline manifest validator/planner plus synthetic tests, **not executor**. First freeze schema, canonical encoding, bounds/error order, review scope, exact paths and engineering ceiling. No hooks, scheduler or unattended dispatch.

Required fail-closed acceptance examples:

| Supplied situation | Required recommendation |
|---|---|
| Expected head differs from observed head or freshness expired | CONFLICT or REQUEST_EVIDENCE; no work/retry |
| Empirical request with missing/UNKNOWN cumulative allocation | REQUEST_EVIDENCE; no invented zero count or run permission |
| M11 lane/path or proposed write outside exact allowlist | CONFLICT; no cross-lane access |
| Static review covers only subset/older blobs or says TESTS_NOT_RUN | Retain scoped evidence; request missing review/test evidence |
| Repeated completed operation / inconsistent same-key payload | DUPLICATE_NO_ACTION / CONFLICT |
| Restart after uncertain dispatch or absent checkpoint history | RECOVERY_REQUIRED evidence request; no resubmission |
| M11 UNKNOWN/BUSY and Claude request | DEFER; no external call |
| Fully evidenced bounded source packet | Recommendation only, all authority flags remain false |

Design cases only, no tests executed or autonomous policy adopted.
