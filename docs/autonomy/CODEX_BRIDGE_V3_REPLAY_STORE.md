# CODEX Bridge V3 Offline Replay Store

Status: offline-only local persistence for deterministic replay reconciliation. This component is unauthenticated and unauthorized by design.

## Scope and identity model
The store only accepts replay identities with exact fields:
- `repository`
- `requestId`
- `opId`
- `headSha`
- `baseSha`

Every reservation is bound to a fixed store scope (`repository` + exact `headSha` + exact `baseSha`).
Identical replay requests (`requestId` + `opId` + same scope and content) reconcile deterministically as no-op results.
Conflicting reuse fails closed:
- same `requestId` with different content -> `DUPLICATE_SCOPE_CONFLICT`
- same `opId` for another request -> `OP_ID_REUSED`
- mismatched store scope -> `STORE_SCOPE_MISMATCH`

No output from this store can authorize merge, dispatch, or activation.
Returned state always sets `authenticated=false`, `authorized=false`, `mayMerge=false`, `mayDispatch=false`, `mayActivate=false`.

## Atomicity and filesystem assumptions
Durability model is local filesystem only:
1. acquire single-writer lock (`writer.lock`) with `O_EXCL`
2. write `replay-store.pending` with `fsync`
3. `rename` pending -> `replay-store.json`
4. `fsync` directory
5. re-read and verify expected revision/hash chain before reporting success

Assumptions (explicitly limited):
- local filesystem semantics with atomic rename in one directory
- ownership/permissions are enforced (`0700` directory, `0600` files)
- symlink/path hazards are rejected (`O_NOFOLLOW`, root realpath checks)
- root safety is revalidated at snapshot/mutation entry before lock creation
- replay handles pin root directory identity (`dev`/`ino`) and reject later path substitutions

Not claimed:
- distributed safety
- adversarial rollback protection
- complete TOCTOU elimination from prechecks alone
- same-account hostile writer protection
- exactly-once external effects

## Crash and uncertain-outcome behavior
The store is fail-closed.
If a process dies or failpoint triggers after lock acquisition in uncertain persistence phases, lock is intentionally retained.
The store does not auto-expire locks and does not perform stale-lock takeover.
Read-side lock/pending checks (`openReplayStore` and `snapshot`) are separate non-atomic probes and can race with active writers.
On race, behavior remains fail-closed (`STORE_LOCKED_RECONCILE_REQUIRED` / `STORE_UNCERTAIN_RECONCILE_REQUIRED`) rather than inferring success.

`UNKNOWN_OUTCOME` is terminal for replay progression in this module.
Once a reservation is marked unknown, replay remains blocked (`UNKNOWN_OUTCOME_BLOCKED`) pending operator reconciliation.

## Corruption and incomplete-state handling
The store rejects:
- truncated or malformed JSON (`STORE_CORRUPT`)
- broken hash chain (`STORE_CHAIN_INVALID`)
- invalid history replay (`STORE_HISTORY_INVALID`)
- orphan pending file (`STORE_UNCERTAIN_RECONCILE_REQUIRED`)

The implementation does not silently delete pending files, lock files, or uncertain evidence.

## Operator recovery procedure
When `STORE_LOCKED_RECONCILE_REQUIRED` or `STORE_UNCERTAIN_RECONCILE_REQUIRED` occurs:
1. Stop all writers for the same store directory.
2. Inspect `replay-store.json`, `replay-store.pending`, and `writer.lock` manually.
3. Determine whether the last intended reservation was durably committed.
4. Preserve forensic evidence before modification (copy files elsewhere).
5. Only after explicit reconciliation, remove or replace lock/pending files.
6. Re-open the store and continue with fresh CAS token from `snapshot()`.

Never assume an uncertain reservation failed or succeeded without reconciliation evidence.
