# Event runtime preparation — local persistent inbox

This package is source-only, same-host processing preparation. No receiver, workflow, model, GitHub writer, merge service or hourly automation is activated. It does not provide an always-running worker.

## Inbox reuse decision

The implementation first inspected the existing `scripts/event-write-fence.py` and `scripts/copilot-review-claim-ledger.py`. It reuses their SQLite `BEGIN IMMEDIATE`, `synchronous=FULL`, irreversible identity consumption and explicit unknown-outcome patterns. It does not modify either existing module.

A write reservation cannot safely be coerced into this read-only inbox: that contract requires an intendedHead different from expectedHead and represents reservation/start/settlement of an external branch write. This inbox instead queues a supplied event revision for one read-only processing attempt. Fabricating an intended Git commit would misrepresent its authority and evidence. The review ledger also consumes a model review-request ID; it is not an event queue. No external write fence or model request is issued here.

## API and identity

- `initialize(db)`: explicit one-time local provisioning with exclusive file creation. Existing stores are never reset. Other operations open `mode=rw`; a missing, empty or wrong-version store fails closed.
- `enqueue(db, binding)`: binding fields are exactly repository, eventIdentity, revisionDigest, headSha, baseSha and payloadSha256. Repository is fixed to Achi1984/meridian. Head/base are full lowercase Git SHAs; digests are SHA256. Event identity is bounded ASCII. Identity plus revision permanently identifies one row. Exact duplicates return the current record; any changed head/base/payload for the same event+revision is a conflict.
- `claim(db, event_id, owner)`: consumes the one allowed attempt and obtains a monotonically increasing local fence. A global repository lock permits only one active row across all branches/events; this is stricter than per-branch isolation.
- `start(db, receipt)`: transitions CLAIMED to STARTED once, before the worker calls its fixed local processor. Repeated starts reject.
- `complete(db, receipt, result_sha256, result_json=None)`: only STARTED may complete; stores the outcome and releases the active scope.
- `unknown(db, receipt, result_sha256, result_json=None)`: CLAIMED or STARTED may become UNKNOWN. Its global lock remains held permanently pending separately designed operator recovery.
- `inspect_event(db, event_id)`: retrieves one bounded record.

Receipts contain exact event/binding/owner/fence identity; wrong owners, fences or bindings reject. Claim attempts remain consumed after completion, failure, process exit and re-enqueue. There is deliberately no TTL, lease expiry, automatic reclaim, reset, retry, row deletion or unlock. A process crash after committed claim/start leaves the scope blocked. New revisions may be enqueued, but cannot bypass an unresolved active/UNKNOWN scope.

Event identity and revision are caller claims at this layer. The companion worker must compare actual normalized event identity/revision and exact head/base plus raw input digest before processing; schema validation here does not authenticate a delivery. Deliberately invented event identities are not semantic deduplication or authorization.

## Metadata-only storage and bounds

No event payload, comment body, token or raw log is stored. Binding metadata has six exact fields. An optional result summary is a UTF-8 string of at most 512 bytes containing exactly `{decision,reason}`: decision must be one supported adapter outcome (or UNKNOWN), reason is an uppercase ASCII code of at most 120 characters. Arbitrary JSON keys, free-form reasons and larger summaries reject. A COMPLETE settlement rejects an UNKNOWN summary; UNKNOWN settlement accepts only an UNKNOWN summary when supplied, preventing contradictory metadata from releasing the lock.

`resultSha256` is the separate digest of the full worker result supplied by the caller. It is not the hash of the small stored summary, and the inbox cannot verify absent result bytes. The trusted local worker computes it from its actual bounded result. No arbitrary full result is persisted.

Capacity is 1000 permanent rows and at most 1 MiB combined serialized binding/summary bytes. The database uses explicit 4096-byte pages and a 1024-page SQLite cap (4 MiB database file); SQLite journal/temporary files and filesystem overhead are separate. Capacity exhaustion blocks additions/settlement; it never prunes replay identities. An UNKNOWN call without a summary remains possible when result-summary space is exhausted.

## Persistence limits

Transactions and synchronous FULL are tested using real local SQLite files and competing OS processes sharing the same database. This proves only cooperating processes on one host with correct filesystem locking/durability. Independent GitHub Actions runners do not share this database automatically. No distributed persistence, authenticated rollback resistance, power-loss proof, hostile database/file protection, symlink containment, administrator isolation or external-effect exactly-once guarantee is claimed. Deployment storage placement, permissions, backups, missing-store detection and external monotonic rollback protection remain separate requirements. Deleting/replacing the file or restoring an old backup can lose history; this package does not authorize doing so.

All authentication/provenance/authorization/dispatch/merge/write flags remain false. Local SQLite fencing does not fence any external service. Owner authorization, trusted receiver provenance and current repository/CI/review evidence remain external gates.

## Inbox tests

```sh
python -I docs/autonomy/event-runtime/test_durable_inbox.py
```

Fifteen tests cover explicit initialization, missing/corrupt stores, duplicate and conflicting revisions, claim/start/complete, durable summary, UNKNOWN blocking a different revision, monotone fences, stale owners/receipts, six competing processes, two different events competing for the one scope, abrupt subprocess exit after STARTED, row/byte capacity, metadata-only restrictions, invalid input and false authority.
