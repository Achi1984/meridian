# Paper journal: host preflight and bounded next packet

**Status: host capability probe only; no Paper ledger or reconciliation implementation.**
Source baseline: `ad276e787078b5afdb2260a5f3e703bd9fd4da28`.
The proposed reconciliation amendment remains `PROPOSED_NOT_ADOPTED`.
No run, strategy, provider, capital, cost, timing or authority choice is selected.

## Verified existing resources

| Evidence | Observed fact | Consequence |
| --- | --- | --- |
| `package.json` | Only runtime dependency is `pg`; test entry is `node --test test/*.test.js`. | No SQLite npm package is assumed or installed. |
| `.github/workflows/backend-safety.yml` | Existing Release Safety uses `ubuntu-latest`, Node 20 and the existing test entry. | Do not use local Node 24 features to infer CI compatibility. |
| `test/research-supervisor.test.js` | Existing suite already invokes Python using `spawnSync` and bounded output/time. | Python is an existing testing resource expectation; fresh CI must still prove it on its actual runner. |
| `scripts/research-supervisor/journal.py` | Existing Python stdlib SQLite transaction mechanics. | Reuse the resource and the transaction approach only; do not import its B1 schema, scheduler, configuration, identities or authority. |
| `Dockerfile` | `node:20-alpine`; no Python installation step. | Neither Python nor Node's newer built-in SQLite API is established for production. No production compatibility claim or deployment proposal. |
| Local host capability observation, 2026-10-31 | Node 24.22.1, Python 3.12.14, SQLite 3.53.1, POSIX. | Local proof is limited to this host. No new dependency, resource or service was provisioned. |

**Chosen resource for the next test-only packet:** existing Python 3 standard
library `sqlite3` in an isolated temporary directory, called by Node's existing
test runner with a bounded child process. This is not a production storage
selection. The probe is executable now because it writes only artificial
capability markers, not a domain journal, account, event or reconciliation record.

## Delivered executable preflight

- `test-support/synthetic-paper/storage-capability-probe.py` has no import-time
  effects, accepts no external arguments, creates a private temporary directory
  and new mode-0600 SQLite file, and removes the directory on normal completion.
- A single `markers` table holds strings of at most 32 characters. At most four
  fixed marker insertions are attempted across normal rollback/commit and two
  child exits; no user data, money or account state enters the probe.
- `journal_mode=DELETE`, `synchronous=FULL`, 4096-byte pages and a 64-page database
  ceiling are set and checked. Local artifacts are checked against a 1 MiB
  completion ceiling. This is not a claim of a filesystem quota or a general
  bound for arbitrary data.
- It verifies explicit rollback, explicit commit, process exit before COMMIT,
  and process exit after COMMIT but before normal child acknowledgment. A fresh
  read validates exact marker contents and SQLite integrity after each boundary.
- Reopening SQLite may recover SQLite's own hot rollback journal. That is
  storage-engine recovery, not reconstruction of domain receipts, operator
  reconciliation, an authorization decision or a retry of the original action.
- Two fixed Python children receive only PATH/LANG; no shell, provider client,
  inherited secret dump, market input or network operation. Child output is
  discarded. Each child wait is at most five seconds, then the process is killed
  and reaped. The probe has a 20-second monotonic work deadline; parent Node has
  a 25-second timeout and 8 KiB output cap. The outer SIGTERM handler unwinds the child cleanup and temporary-directory
  context instead of abandoning the child on ordinary watchdog termination.
  Cleanup is claimed only for a completed PASS report. The SIGTERM unwind path
  is source-reviewed here but has not been forced by a dedicated signal test;
  the ordinary child exit/reap paths are exercised. These bounds are not hard-real-time
  guarantees against an uninterruptible kernel/filesystem call.
- Missing Python, SQLite failure, unexpected exit, integrity mismatch or exceeded
  bounds fail the test. There is no successful skip, automatic retry or invented
  compatibility result. Diagnostics do not echo temporary paths or raw errors.

Local validation: `node --test test/synthetic-paper-storage-capability.test.js`
passed **1 test, 0 failures, 0 skips** (about 0.16 s total). This tests actual
temporary marker transactions and process exits, not the Paper contract.
Hosted CI for these new files has not run at preparation time.

## What that evidence does not prove

Process exit is not machine power loss. The probe does not cut power, interrupt
fsync, simulate disk corruption/full media, authenticate a storage host, exercise
concurrent domain writers, or establish crash durability on Northflank. It proves
only the observed SQLite behavior across local process boundaries. The container
filesystem, underlying volume, sync semantics and production Python availability
remain unverified. Passing does not authorize a Forward Paper run.

## Exact next engineering packet

After independent review of this resource choice and finite test bounds, build
an isolated **synthetic temporary-journal adapter**, not a production observer.
Keep the existing `test-support/synthetic-paper/harness.mjs` in-memory accounting
model as its own reference; do not turn its fixture-specific cents/whole-shares
serialization into the canonical Forward Paper wire protocol. Its WeakMap-bound
proposal/claim handles cannot simply be serialized and restored across processes.
The adapter must first define a separately reviewed generated-fixture boundary
that binds immutable snapshots/proposals to persisted state without accepting
caller-created account mutations. Never claim the existing harness is already
restartable.

Proposed ownership and limits for that later packet (not implemented here):

| Owner surface | Exact responsibility |
| --- | --- |
| `test-support/synthetic-paper/temporary-journal.py` | New test-only schema/transactions; synthetic namespace only; expected-state/fence checks; no import of B1 journal. |
| `test-support/synthetic-paper/journal-fixture.mjs` | Explicit generated inputs and exact fixed-point values; closed envelope validation; no strategy calculations or provider data. |
| `test/synthetic-paper-journal.test.js` | Parent orchestration, bounded child fault points and readback invariants. |
| `docs/strategy-lab/SYNTHETIC_PAPER_JOURNAL_RECEIPT.md` | Exact resource/version, commands, guarantees tested and untested, no operational readiness claim. |

Proposed **test-fixture** hard ceilings: one isolated account, one database per
case, two workers maximum, 16 operations, 32 immutable receipts/claims total,
32-byte artificial identifiers, 64 KiB request, 8 KiB response, 1 MiB database,
five-second child wait and 30-second total case deadline. Validate caller bounds
against these ceilings before any claim; do not truncate or partially mutate.
All values remain test parameters, never financial or production defaults.
The exact wire schema/serialization and disk-growth enforcement need acceptance
with implementation; changing any ceiling requires explicit reviewed source.

## Later crash and transaction acceptance matrix

| Boundary/case | Required observation; all with artificial fixtures |
| --- | --- |
| Before claim | No claim, fence, account or receipt effect. |
| After durable claim, before proposal | One consumed attempt and active fence; no inferred account effect; remain blocked. |
| Before atomic commit | No partial account/receipt/sequence/fence update. |
| After commit, before ACK | Exact original committed account/receipt/sequence/fence result recoverable through lookup, no replay. |
| Two workers with same expected state | One winning claim; loser has no consumed attempt or state effect. |
| Stale historical fence | No new account or receipt effect; current winner remains valid. |
| Duplicate identity/digest | Exact prior result with no second fee/effect; changed digest blocks. |
| Ambiguous I/O or truncated/corrupt history | Unavailable/unknown with retained fence; no fabricated receipt, silent repair or automatic retry. |
| Missing/lagging derived snapshot | Authoritative atomic result remains decisive; snapshot cannot manufacture or erase commit. |
| At bound / limit+1 | Exact boundary allowed if valid; one above rejects before claim or leaves post-claim uncertainty blocked. |
| Timeout / abnormal child exit | Child killed/reaped; exact committed boundary inspected; no background worker or implicit retry. |

Atomicity must be one transaction across account state, original receipt,
sequence and winning claim resolution. Claim creation is a separate transaction.
Monetary values use exact integers/decimal strings, not SQLite REAL. A checksum
proves byte agreement only, not authenticity or permission. Do not replace the
canonical RFC 8785 requirement with JSON.stringify or Python sorted JSON and
call it interoperability; exact serialization vectors remain a distinct gate.

## Narrow prerequisites and stop line

The canonical `SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md` permits a later bounded
temporary-journal packet **after verifying an existing suitable resource and
separate review**. This probe supplies resource evidence only; it does not
declare that separate review complete. The canonical journal spec still marks
M3 acceptance pending. PR1082 draft2 still declares the resolution envelope
unadopted. Before implementing any reconciliation, accept the versioned schema,
whole-evidence precedence, intact CAS boundary, grant/read separation and
storage-specific authority proof. This packet implements none of those.

The next concrete approval/review item is the isolated fixture adapter's closed
schema, identity binding, transaction layout and crash matrix above, with this
host result attached. It can continue retaining UNKNOWN without a resolver.
Resolving UNKNOWN, sealing an absent original fence, production journal setup,
provider/source-time validation and actual Paper admission remain separate gates.
All twelve real operating-choice groups remain unset. No running Paper bot,
strategy P/L computation, captured-data execution or trading occurred here.
