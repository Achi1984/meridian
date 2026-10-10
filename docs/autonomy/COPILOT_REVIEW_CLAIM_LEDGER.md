# Copilot review claim ledger — source only

`scripts/copilot-review-claim-ledger.py` is an inactive Python standard-library
SQLite implementation of the external `acquireOneUseClaim(binding)` boundary in
the reviewer runtime. It performs no work at import time and makes no network or
model calls. It is not wired into or an activation of that runtime.

The caller supplies one JSON object with exactly these fields:

```json
{
  "repository": "Achi1984/meridian",
  "pr": 666,
  "headSha": "<40 lowercase hexadecimal characters>",
  "baseSha": "<40 lowercase hexadecimal characters>",
  "requestId": "unique-request-id",
  "packetSha256": "<64 lowercase hexadecimal characters>",
  "modelId": "claude-<explicit-model-id>",
  "expiresAt": 1791665760000
}
```

`expiresAt` is Unix epoch milliseconds, must still be in the future, and may be
at most five minutes ahead; replace the illustrative timestamp with a fresh
value when preparing a real request. The JSON input is limited to 4 KiB, duplicate keys,
unknown fields, invalid types, implicit Claude model aliases, and malformed
identity values are rejected. Example:

```sh
python3 scripts/copilot-review-claim-ledger.py --db /durable/review-claims.sqlite consume < binding.json
```

Success writes the runtime-compatible receipt to stdout:
`{"claimId":"<random-id>","binding":{...}}`. A failed claim returns a bounded
error code on stderr and a nonzero exit status. A transaction starts with
`BEGIN IMMEDIATE`; the request ID is unique in the database and the consumed
binding is committed with SQLite `synchronous=FULL`. Exact replays and changed
payloads using the same request ID fail closed. Claims are never released or
expired out of the ledger; a process crash after commit does not make a request
reusable.

Uniqueness is deliberately per authorization request (`requestId`), not a
lifetime ban on reviewing the same head or packet. Distinct, separately
authorized requests may review the same source, including independent model
reviews and an explicitly authorized follow-up. The ledger accepts distinct
request IDs even when all other supplied binding fields match; each consumed
ID remains permanently unavailable, including when its payload is altered.
Changing or inventing an ID does not create authorization. The trusted upstream
coordinator must authenticate each separately authorized request, deduplicate
accidental deliveries and same-head triggers, and enforce the shared review
budget. Retries, duplicate deliveries and unknown outcomes must retain the
original request ID; automatic retry by minting a new ID is prohibited.

The runtime also binds the request ID inside the hashed review packet. A new
authorized runtime request therefore needs a matching packet and digest;
changing only the descriptor's ID cannot reuse the old packet. The ledger's
API-level acceptance of distinct IDs is not proof of runtime acceptance or
upstream authorization.

The database must be durable and shared by every worker that may claim the same
request. A local SQLite file is not automatically shared between GitHub runners;
deployment must provide a single suitable storage location with correct SQLite
locking and durability semantics. Do not copy independent database files to
workers or delete consumed rows to recover a failed invocation.

This source-only boundary validates and consumes supplied fields; it does not
authenticate the caller, repository observations, packet digest provenance,
model execution, or any CI evidence. The trusted caller must authenticate those
inputs and preserve the receipt. The receipt is not evidence that a model ran,
and cannot grant merge authority.
