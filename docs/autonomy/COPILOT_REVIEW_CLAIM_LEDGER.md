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
