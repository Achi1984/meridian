# Work-packet V1: offline metadata admission only

This is the first bounded slice of `STRATEGY_AUTONOMY_HANDOFF_CONTRACT_20261014.md`, not policy adoption, a full planner or an executor. `validateStrategyWorkPacket(packet, observation)` has no I/O; only Node's built-in SHA-256 is used. It neither evaluates completed reviews nor authenticates supplied evidence. Existing campaign/orchestration gates remain separate and unchanged; passing metadata does not imply passing `validate-campaign.mjs`.

## Frozen exact schema

Trusted plain JSON data records only, no getters/proxies. Exact listed keys at every level; no coercion, unknown keys, nonenumerable/symbol properties, custom array keys or sparse arrays. Every integer is safe and must not be negative zero. ASCII IDs match `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`; hashes are lowercase hex (40 for Git SHAs, 64 for operation keys). No Unicode normalization or hash authenticity claim.

Packet exact keys:

| Key | Accepted value/bound |
|---|---|
| schemaVersion | `STRATEGY_WORK_PACKET_METADATA_V1` |
| repository / lane | Exactly `Achi1984/meridian` / `STRATEGY` |
| workClass | `SOURCE_DESIGN`, `SOURCE_CHANGE`, `SYNTHETIC_CHECK` only |
| packetId / revision | ID / integer1–1000000 |
| conceptIds | 1–22 unique exact IDs C01–C22 |
| economicFamilyRefs | 1–22 unique IDs, including literal `UNKNOWN` when unresolved; labels are unauthenticated |
| objective | 1–500 printable ASCII characters (space through tilde), at least one non-space |
| expectedHeadSha | Full 40-hex SHA |
| predecessor | null at revision1; otherwise exact `{packetId,revision,operationKey}`, same packetId and immediately previous revision, 64-hex key |
| sources | 1–16 exact `{path,commitSha,blobSha}` records, unique path, both SHAs full40hex |
| allowedPaths | 1–8 unique write-eligible paths |
| proposedWrites | 0–8 unique write-eligible paths, subset of allowedPaths |
| acceptance | 1–8 exact `{id,testPath}` records, unique IDs **and** test paths; inert file references only |
| engineeringBudget | Exact `{maxAttempts,maxChangedFiles}`: integers1–3 and1–8; proposedWrites count ≤maxChangedFiles; metadata caps only, no monetary/spend approval |
| trialBudgetStatus | `UNKNOWN` or `RECONCILED`: metadata only, no allowance or ledger verification |

Path grammar is deliberately narrow. Root documentation paths are `docs/strategy-lab/NAME.EXT`, NAME `[A-Za-z0-9][A-Za-z0-9_-]{0,95}`, EXT `md`, `mjs` or `json`. Test paths are `test/NAME.test.js` with the same NAME grammar, at least one suffix character after the prefix, and prefix `strategy-`, `elliott-` or `trend-pullback-`. Acceptance requires test paths. Reject absolute/traversal/glob/backslash/encoded paths and names containing an M11 token (case-insensitive, delimited by start/end, underscore, hyphen or dot). Write paths additionally reject names starting `elliott-frozen-`. Sources may also reference the two read-only paths `docs/strategy-lab/fixtures/elliott-frozen-v1.mjs` and `docs/strategy-lab/fixtures/elliott-frozen-wave5.mjs`; never writable. Sources need not match expectedHeadSha: pinned historical predecessors are valid metadata. No source file is opened or verified.

Observation exact keys: `{headSha,observedAtMs,decisionMs,maxAgeMs,m11State}`. SHA is full40hex; times are nonnegative safe integer milliseconds; maxAgeMs integer1–300000; m11State exactly FREE/BUSY/UNKNOWN. Require observedAtMs ≤decisionMs, age ≤maxAgeMs (equality accepted), and headSha=expectedHeadSha. The one supplied observation horizon covers its head/resource assertion; neither clocks nor M11 state are authenticated.

## Canonical identity and exact output

Normalize set arrays by ASCII lexical order: concepts/families/path lists by value, sources by path, acceptance by ID. Recursively sort record keys lexically; preserve strings exactly. Encode the sorted record with JSON.stringify, UTF-8, no whitespace. `operationKey` is SHA-256 over the UTF-8 bytes of the literal version `STRATEGY_WORK_PACKET_METADATA_V1`, then byte **0x0A**, then the canonical JSON UTF-8 bytes. This separator is a newline byte, not backslash plus n. The canonical record contains **every packet field**. Observation is excluded, so fresh time/M11 observations do not create new operations. Return a new canonical packet with no mutable references shared with either input.

Success exact shape: `{valid:true,operationKey,canonicalPacket,resourceAdvice,...flags}`. Resource advice is `REVIEW_RESOURCE_AVAILABLE` only for supplied FREE, otherwise `DEFER`. Both are advisory metadata, never an external-Claude action. Failure: `{valid:false,error,...flags}` with no partial key or packet. Flags on all results are exactly `recommendationOnly:true`, `dispatchAuthorized:false`, `executionAuthorized:false`, `empiricalRunAuthorized:false`, `mergeAuthorized:false`, `runtimeAuthorized:false`, `evidenceAuthenticated:false`.

Validation first-error order:

1. `PACKET_SCHEMA`: top-level shape/version; `REPOSITORY`, `LANE`, `UNSUPPORTED_WORK_CLASS`; `PACKET_ID`, `REVISION`, `CONCEPT_IDS`, `ECONOMIC_FAMILY_REFS`, `OBJECTIVE`, `HEAD_SHA`, `PREDECESSOR`.
2. `SOURCES`: list/schema/hash/duplicate-path failures; `SOURCE_PATH` for each path, in input order. `ALLOWED_PATHS` then `PROPOSED_WRITES` for list/duplicate/grammar/subset failures. `ACCEPTANCE` for list/schema/ID/path/duplicate failures. `ENGINEERING_BUDGET` then `TRIAL_BUDGET_STATUS`.
3. `OBSERVATION_SCHEMA`, `OBSERVATION_HEAD_SHA`, `OBSERVATION_TIME`, `OBSERVATION_MAX_AGE`, `M11_STATE`, then `HEAD_MISMATCH`, `FUTURE_OBSERVATION`, `STALE_OBSERVATION`.

Source records are checked in order (shape/hashes, path, duplicate). Other arrays reject as a group under their named code. No error is permission. SOURCE classes may admit UNKNOWN trial metadata; empirical/merge/runtime classes reject even if status is RECONCILED.

## Limits and verification

There is no supplied operationKey, history input, review evidence evaluator, predecessor authenticity check, deduplication store, durable CAS, dispatch, shell command, campaign execution, resource reservation or cost/trial allocation. Head equality is only against the supplied observation, not an atomic remote compare-and-swap. Stable hashes are identities, not signatures. Revision linkage is local syntax; cross-revision scope consistency needs the missing history evaluator. Changing fields changes identity but grants no right to retry or evade prior accounting. No review completion or source correctness follows from metadata admission. Future review/history/evidence evaluation remains a separately bounded packet.

Verification: **58/58 tests pass**, comprising 10 metadata tests and all 48 unchanged existing tests. All fixtures are synthetic; no market data or remote writes.

```sh
node --test test/strategy-work-packet.test.js test/elliott-pivot-admission.test.js test/elliott-synthetic-path.test.js test/elliott-correction-helpers.test.js test/elliott-frozen-characterization.test.js
```

Tests cover exact output/authority flags, independently hardcoded SHA-256 (computed separately using Python sorted JSON/hashlib), reordered sets/record keys, observation exclusion and packet-content key changes, output isolation, unsupported work classes, schema/type/-0 faults, nonenumerable/symbol/sparse/custom-key inputs, duplicates, path/frozen boundaries, predecessor syntax, head/freshness precedence, resource advice, and lower/upper list/engineering limits. Source pins are checked as metadata only: no blobs are read and proposed writes are not judged for source correctness. The untouched campaign validator remains a separate prerequisite in any future integration.
