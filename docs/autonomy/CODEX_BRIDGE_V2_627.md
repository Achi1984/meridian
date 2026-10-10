# Codex Bridge V2 — Security Hardening R2

Status: **DESIGNED_NOT_ACTIVATED / OFFLINE_ONLY**. No production-readiness claim.
Issue #627; stack parent Draft PR #628.
Claude R1: [comment 6085270808](https://github.com/Achi1984/meridian/issues/571#issuecomment-6085270808),
verdict NEEDS_MORE_EVIDENCE.

Starting commit / stack base: 398674e6b24c65f319462995890377d1760f8c46.
Main / parent PR base at reconciliation: 8a8a43fc8df4e440294bf7ef5747510b6c6a44d0.
Fix branch: fix/codex-bridge-v2-security-r2-20261009.
Operation ID: MERIDIAN-BRIDGE-V2-R2-OFFLINE-HARDEN-20261009-001.

## Trust boundary and remaining P0 blockers

validateAck, validateDraftPr and every authorizing transition now reject with
AUTHENTICATED_TRANSPORT_UNAVAILABLE. Caller-controlled trustedSource,
authenticatedBy, approval strings, CI URLs and evidence booleans have no authority.
There is no receipt issuer, importable receipt or configurable callback that can
manufacture authenticated evidence. Only a deeply immutable, process-branded offline
plan can enter advance; copying or deserializing a ledger loses its brand. Its only
usable transition is a scoped local STOP. This cancels an offline plan; it does not
authenticate a productive STOP or an owner revocation.

Structural inspectors deliberately return authorized:false, even for matching
comments, Draft snapshots and GREEN reviews. They check structural bindings only.
Their GitHub metadata and pins remain caller-provided, unauthenticated data.
Do not use their output as authorization. The API exposes that limit explicitly.

A future independently reviewed adapter must own an authenticated GitHub connection,
fetch authoritative data itself and issue opaque receipts privately. Never expose a
caller-supplied fetch/verifier, issueReceipt, deserialized receipt or Boolean bypass.
Bind repository ID/name, resource type/ID, numeric actor ID, request/op IDs, exact
head/base, SHA-256 of actual UTF-8 comment content, observed edit/revision, freshness
and immutable scope fingerprint. Establish role policy from owner-approved actor
IDs, not names inside comments. A bot account alone cannot prove which agent/model
generated the body. Copied, deleted or edited comments and policy changes invalidate
receipts. The diagnostic reviewer ID 209825114 comes from R1 metadata; it is not
an approved operational identity policy.

Re-fetch the PR, owner authorization, CI and the complete review set at every gate,
including AWAITING_MERGE_DECISION. Changed head/base, revoked approvals/reviews,
conflicting verdicts, missing evidence and unknown outcomes must durably STOP.
An offline object cannot prove remote freshness. CI proof must pin repository,
run/check ID, workflow identity, attempt, completed-success, actual tested SHA and
evidence that these bridge files executed. Synthetic merge-SHA runs need exact
parent mapping. Reviewer evidence also requires independent execution, Node version,
test command/totals and reviewed head/base. Neither CI nor GREEN is owner approval.
No merge transition, productive communication or dispatch endpoint is implemented.

## Durable local idempotency and CAS

codex-bridge-journal.mjs implements an actual local filesystem store. Initialization
is explicit create-if-absent. A hash-linked history reconstructs request and operation
indexes, scope fingerprints and terminal states. Every mutation checks revision
AND journal-head hash under an O_EXCL writer lock. Persistence uses file fsync,
atomic same-directory rename, directory fsync and re-reading the intended revision.
The result is captured before releasing the lock, so another writer cannot replace
the reported result. No in-memory fallback, automatic recreation, lock expiry,
stale-writer takeover or automatic retry exists.

Reservations survive restarts and are one-shot. UNKNOWN and STOPPED are terminal.
Identical registration replay is inert and cannot dispatch or repeat any operation.
A stale CAS token fails even for an otherwise identical request. Exceptions before
lock release leave the lock; a crash during/after release can still leave an uncertain
return, which must be reconciled from durable state. Never retry an external action
based on an absent response. RESERVED_OFFLINE means reserved locally, never dispatched.
There is intentionally no endpoint for self-asserted remote completion.

This provides **local integrity and serialization**, not authenticated external
authorization. A hostile writer with the same OS account can replace/rehash valid
history, delete the directory or roll back disk. Hashes detect corruption and
impossible history, not a malicious filesystem owner. Tests explicitly demonstrate
that even a valid store replacement remains unauthorized. The store assumes a
dedicated private directory on a local filesystem supporting O_EXCL/rename/fsync.
It is not qualified for NFS, multiple hosts, Windows or unreliable disks. Crashes
may leave a lock, pending file or incomplete initialization; these block progress.
An external transactional authority with protected storage, an independent durable
anchor and authenticated crash reconciliation remains a P0 activation blocker.

## Exact SHA, scope, model, cost and STOP policy

expectedHead is the exact immutable **pre-work commit** (#628 head for this stack),
distinct from expectedMain/expectedBase and the result commit. Draft inspection
requires a separately pinned result-head argument; a future trusted adapter must
record it once under CAS and freshly re-check it at every gate. Caller-provided
snapshots and pins cannot authenticate their own provenance.

Scope is restricted to five exact bridge source/test/document paths in PATHS.
This is a deliberately narrow R2 offline policy, not a generic operational allowlist.
Noncanonical paths, case variants, globs, protected files and excess scope are
rejected by exact membership. Change inspection requires old AND new modes, only
regular 100644 files, added/modified changes, and no rename/delete/symlink/submodule
or executable mode. GitHub changed-filename lists alone are insufficient.

The model allowlist is gpt-5.3-codex; this validates a plan, not actual delivery.
Canonical JSON rejects getters, hooks, non-JSON types, cycles, sparse arrays,
unsafe numbers, malformed Unicode, unknown fields and deep/oversized inputs.
Cost flags only express prohibitions. No authenticated billing API, atomic credit
reservation or verified overage cap exists; assignment stays closed even when all
supplied billing booleans are true. SOURCE_AUDIT and research/trading gates remain.

Native agent-start integration requires a supported first-party authenticated API
that guarantees model and budget. A GitHub coordinator route requires separate
workflow/permissions/runner/secret and budget approvals. R2 implements neither.

## Claude R1 mapping

| Finding | R2 implementation / regression evidence | Remaining risk / gate |
| --- | --- | --- |
| 1 Identity spoofing | ACK/PR APIs closed; actor/comment/content/SHA binding diagnostics; forged-observed tests | Authenticated transport and operational actor policy absent; closed |
| 2 Approval/evidence/ledger spoofing | Immutable branded plans; literal/copied/deserialized ledgers rejected; all evidence booleans denied | External protected authorization authority absent; closed |
| 3 Durable dedup/CAS | Actual filesystem store, dual ID indexes, one-shot reservations, reopen tests, process-death tests, two-process CAS race | Same-account writer/rollback/multi-host protection absent; closed |
| 4 Head/base gaps | Explicit pre-work vs result SHA; exact Draft inspection; changed head/base review invalidation | Fresh remote observations and per-gate receipt/CAS binding absent |
| 5 Path/file gaps | Five exact paths, count bounds, old/new modes; rename/delete/link tests | Trusted Git-tree provenance still needed |
| 6 Model/cost gaps | Model allowlist; Boolean billing evidence cannot authorize or start | Guaranteed actual model selection, billing proof and quota reservation absent |
| 7 STOP/revocation/conflicts | Scoped terminal offline STOP; stale/revoked/contradictory review classification | Authenticated complete review set and productive STOP authority absent |
| 8 Coverage gaps | Adversarial JSON, every privileged literal/jump, forged approvals, path/ID bypasses; executed restart/CAS/race/crash cases | Local totals below; independent exact-head run pending |
| 9 Boundaries | No dispatch, network, billing or merge API; static repository no-wiring regression | Journal intentionally uses filesystem I/O; static scan cannot prove absence of every possible dynamic integration |

## Test evidence and publication gates

Local verification operation: MERIDIAN-BRIDGE-V2-R2-VERIFY-20261009-001.
Node: **v24.19.0**. These are Codex execution results, not independent reviewer or CI evidence.
Starting commit: 398674e6b24c65f319462995890377d1760f8c46. The R2 source files were
tested as an uncommitted working-tree patch. **There is no tested R2 commit yet**;
repeat verification on the resulting immutable commit before reporting exact-head evidence.

| Executed command | Pass | Fail | Cancelled | Skip | Exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| node --test --test-isolation=none --test-reporter=tap test/codex-bridge-contract.test.js test/codex-bridge-journal.test.js | 168 | 0 | 0 | 0 | 0 |
| node --test --test-isolation=none --test-reporter=tap test/stream-safe-preflight.test.js test/read-token-auth.test.js test/frozen-research-guard.test.js test/continuity-release-safety.test.js | 13 | 0 | 0 | 0 | 0 |

The standard command (node --test test/codex-bridge-contract.test.js
test/codex-bridge-journal.test.js), including a subsequent explicit TAP run,
reported only **2 file-level wrappers**, not the 168 registered checks. That result
is **not accepted as full bridge-test evidence**. The no-isolation run actually
named/executed the 168 tests. An intentional failing node:test assertion
(assert.equal(1,2)) produced exit 1 with 1 failure and 0 skips, confirming that
the local test harness detects failures. Node 20/22 compatibility and their default
runner behavior have not been tested here; the environment supplies Node 24 only.
No repository workflow or runner configuration was modified to work around this.

Additional executed checks: continuity-audit (ok=true, build 10.0-r127),
frozen-research-guard (140 files, zero mismatches), validate-agent-orchestration
(GREEN), and git diff --check (pass). These are read-only/offline validation;
no canonical research run, external provider or agent activation occurred.
The complete repository test suite was not run. Raw local test output and the
verification record are retained under /workspace/scratch/meridian-r2-*.

Tested Git source blob identities:

| Source | Git blob SHA |
| --- | --- |
| scripts/codex-bridge-contract.mjs | 9cb60c8a2fb4e1d8e4b709ab26f89fd34bef3639 |
| scripts/codex-bridge-journal.mjs | b7d98196951ff7908987f7bed1bbb463d841deef |
| test/codex-bridge-contract.test.js | 0805236815883dc76ea90f38a04d66b2d050e6d0 |
| test/codex-bridge-journal.test.js | 85acac6a96c086e46f847c6d179645c98bff0649 |

Live reconciliation confirmed parent #628 still open/Draft on the starting commit
and main/base 8a8a43fc8df4e440294bf7ef5747510b6c6a44d0. Parent CI run 37961160116
is completed/success on #628; it is not R2 CI and cannot prove these new tests ran.
Claude R1 remains NEEDS_MORE_EVIDENCE. The old document's 32-test claim is historical
and does not apply to R2. Independent exact-head execution and security review remain open.

Before publication: reconcile live #628/main, exact starting head and local scope;
execute tests and appropriate regressions; record evidence; commit locally; run
canonical source-upload preflight; publish only the isolated branch under a creation
lease/CAS; verify remote commit/source hashes; create a stacked **Draft** PR in a
separate STREAM-SAFE-V7 mutation. Never repeat a write without reconciliation.
No merge, deploy, agent start, automatic retry or productive communication.

Before real automatic ChatGPT–Codex–Claude communication, obtain owner approval for:

1. Pinned identities, operational roles and revocation policy.
2. Chosen authenticated transport/infrastructure and required permissions.
3. Protected durable transactional storage, independent anchors and crash recovery.
4. Verified included-credit/quota controls and a proven overage cap.
5. One bounded pilot with exact model, scope and budget.

Then require independent exact-head security review and authenticated end-to-end
execution evidence. None is implied by this offline hardening.
