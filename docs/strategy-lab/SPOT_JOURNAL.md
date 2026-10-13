# Local synthetic spot journal

Exports from `docs/strategy-lab/spot-journal.mjs`:

* `createSpotJournal({directory, symbol, cashMicros})`
* `readSpotJournal({directory})`
* `commitSpotJournalStep({directory, expectedVersion, envelope, policy})`

The directory must already exist and be an absolute path in a trusted, local Linux
filesystem supporting hard links, atomic rename and directory fsync. Symlinks,
untrusted directory mutation, NFS, Windows and hostile concurrent filesystem access
are outside this prototype's contract. All callers must cooperate with the lock.
There is no network, scheduler, real order, market-history processing or PnL run.

Creation accepts only a bounded uppercase symbol and canonical unsigned EUR cash
micros (at most30digits). It derives a pristine FLAT lifecycle and empty account;
arbitrary holdings/history cannot be supplied as genesis. The complete file stores
schemaVersion, genesis, version, records and book. Version equals accepted record
count. Every read and commit validates genesis, bounds all records, then replays
each envelope/policy through simulateSpotStep and compares the derived final book
exactly with the saved book. Malformed, missing, truncated, inconsistent or oversized
files reject. They are never silently reset or repaired. Coherent file forgery or
rollback of the entire journal cannot be detected: genesis immutability is a
cooperative contract, not authentication or an external monotonic version service.

Each record is at most2,048 serialized UTF-8 bytes, with at most10,003 records.
Existing strict signal/quote/policy schemas use bounded ASCII IDs, integer times
and at most30-digit strings, comfortably below the record bound. Each accepted
record consumes at least one lifecycle ID. Therefore10,003 records cover the
entire lifecycle normal budget plus close reserve without an earlier record cap.
10,003×2,048bytes is20,486,144bytes; final lifecycle and ledger ID arrays and bounded
state occupy less than2MiB, leaving margin under the32MiB file cap for compact
serialization. Excessive cosmetic whitespace in manually edited files may reject.
File size is checked before bounded reading, records before replay. Replay remains
expensive (approximately quadratic history work from copying/checking ID arrays);
this is an intentionally bounded correctness prototype, not a scalable journal.

Writers acquire `spot-journal.lock` using exclusive `wx`, recording a random token
and inode identity. expectedVersion is checked under that lock after validated
replay. Caller options and JSON record content are snapshotted before filesystem
awaits. Rejected steps and version conflicts do not replace the journal. Successful
steps write a unique temporary file, fsync its contents, and rename it over the
journal, then fsync the directory. Initial creation instead publishes via hard link
from its synced temp file: EEXIST cannot overwrite any existing journal. It removes
only its own temporary file. The lock is removed only when inode and token still
match; another owner's lock is never intentionally deleted.

Success returns `{valid:true,version,book,executionAuthorized:false,researchOnly:true}`.
Failure returns `{valid:false,code,executionAuthorized:false,researchOnly:true}`.
After publication has been attempted, an error returns COMMIT_UNKNOWN and retains
the lock. The new version may already be present: never assume rollback or retry
blindly. A changed lock or cleanup error after a successful write also reports
COMMIT_UNKNOWN. Readers can inspect and replay the atomic old/new file while a
lock exists, but cannot remove the lock or authorize continued writing.

Crash leftovers and stale locks always block writers. There is no auto-expiry or
lock stealing. Explicit manual recovery must stop all writers, inspect/replay the
journal and its version, reconcile the intended event and any temp file, then
remove only a verified stale lock. This module offers no recovery/delete API.
Lock ownership checks rely on the trusted cooperative-directory assumption; they
are not a defense against a malicious replacement between check and unlink.

Tests use synthetic subprocess restarts and crashes around publication, plus
injected I/O errors. They establish observed process-failure behavior, not physical
power-loss durability. Node documents fsync behavior as OS/device-specific:
https://nodejs.org/docs/latest-v24.x/api/fs.html#filehandlesync . Exclusive flags are
also filesystem dependent: https://nodejs.org/docs/latest-v24.x/api/fs.html#file-system-flags .
Storage hardware and filesystem guarantees require separate validation.

All inherited ID histories and close reserves remain intact; this journal never
truncates or resets them. Once the bounded history is exhausted, entry trading
remains blocked. Durable storage alone does not make these primitives runtime-ready,
continuously available, profitable or authorized for paper/live execution.
