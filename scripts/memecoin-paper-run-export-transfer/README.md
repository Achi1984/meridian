# Private paper run-export transfer (source-only)

This package is a default-disabled, one-shot transfer boundary for the existing
`memecoin-paper-run-export/v1` bytes. It is isolated from the paper controller,
composition, and source pipeline. It performs no startup I/O, network request,
deployment, key lookup, provider call, or paid-service activity.

The client accepts only the caller's original envelope bytes, capped at 16 MiB.
It binds their SHA-256 and length to independently supplied `runId`,
`configSha256`, and `producerRevision`. The transfer acknowledgement is
`TRANSFER_ACKNOWLEDGED`; it explicitly says `checkpointAcknowledged: false` and
is not a checkpoint acknowledgement or strategy `PASS`. The per-client transfer
method accepts at most one attempt, including an attempt whose outcome becomes
`UNKNOWN`. It never retries.

## Local API and storage

`createExportTransfer({enabled, privateOrigin, transport, timeoutMs})` is
disabled unless `enabled: true` is supplied. An enabled instance requires one
fixed HTTPS origin and an injected transport with `put(request)` and
`get(request)` methods. The operation must be explicitly authorized with
`explicitlyAuthorized: true`, a write authorization, and an independently
provided read authorization. Write and read authorization values must differ.
The adapter contract requires redirect rejection; a redirect, timeout,
cancellation, partial/ambiguous response, or lost acknowledgement is reported
as `UNKNOWN`, never retried. The deadline is at most 30 seconds. Async sources
are limited to 4096 iterator reads (including empty chunks), check cancellation
and a monotonic deadline while consuming, and yield every 64 reads. Iterator
cancellation is best-effort and is never awaited.

`createFileReceiver({directory, privateOrigin, authorizeWrite, authorizeRead})`
provides the concrete receiver/storage implementation. Its `put` and `get`
methods check the fixed origin and invoke separate authorizers. It stores one
immutable export per run ID in a private `0700` directory, with `0600` files,
atomic staging/no-replace installation, bounded reads, and SHA-256 verification. Identical bytes
return `DUPLICATE`; any different identity or bytes for that run return
`CONFLICT` without replacing the original. This local receiver is not an HTTP
server and is not exposed as a remote service.

`createInProcessTransport(receiver)` is an offline adapter for exercising the
same transport interface. There is deliberately no built-in HTTP client,
endpoint, credentials provider, route, or remote server implementation.

Readback requires independently supplied expected run/config/producer identity,
uses the distinct read authorization, downloads the stored bytes, checks their
actual digest/length against the original pre-dispatch upload digest/length and
the bound identity, then invokes
`evaluateMemecoinPaperRunExport()` on those bytes. The original envelope is
passed through unchanged, including full checkpoint/start binding, open
positions, null/unvalued fields, and any evaluator `UNKNOWN`. Readback `UNKNOWN`
means retrieval or certainty remains unresolved; evaluator `UNKNOWN` remains
the evaluator's honest result and is never upgraded. A successful readback
returns the verified original byte buffer as `bytes`; callers must use it rather
than serializing the parsed `exportValue` when exact-byte identity matters.

## Focused offline acceptance

From the repository root:

```sh
node --test scripts/memecoin-paper-run-export-transfer/test/transfer.test.mjs
node --check scripts/memecoin-paper-run-export-transfer/index.mjs
node --check scripts/memecoin-paper-run-export-transfer/test/transfer.test.mjs
node scripts/secret-check.mjs
```

Tests create an actual synthetic composition export, transfer and independently
read it back, and exercise immutable duplicates/conflicts, identity/digest/auth
rejection, size and deadline bounds, cancellation, redirects, partial writes,
lost acknowledgements, unvalued positions, and evaluator readback. They use no
network or real credentials.

## Server integration handoff (not registered)

No existing server route is changed or claimed as available by this package. The
server-route owner must review and explicitly register both private routes on
the single configured origin before any deployment wiring:

- `PUT /private/run-exports/v1/{runId}`: raw original export bytes as the body;
  bind the path run ID plus independently supplied config SHA-256, producer
  revision, export SHA-256, and byte length; return `STORED`, `DUPLICATE`,
  `CONFLICT`, `REJECTED`, or `UNKNOWN` with the bound identity/digest/length.
- `GET /private/run-exports/v1/{runId}`: return the original bytes and bound
  identity/digest/length only when the stored run/config/producer identity
  exactly matches the request, or an honest `NOT_FOUND`/`UNKNOWN`. A mismatch
  must not disclose whether the run ID exists or return bytes.

The route adapter must map those requests to `createFileReceiver().put/get`,
authenticate writes and reads with separate scopes, reject redirects, avoid
filesystem path selectors, cap request/response streams at 16 MiB, and enforce
the same operation deadline and stream work limit. It must not log authorization
values or export bytes. These paths are a proposed registration contract only; this repository
contains no HTTP route or ready remote endpoint. Registration, TLS/network
privacy review, durable storage provisioning, and owner review are separate
handoffs and are not authorized by this source-only package.

Before any separately authorized deployment, the deployment manifest must
identify at least:

- transfer schema and canonical export schema;
- exact private HTTPS origin and the two fixed route paths;
- transfer state: disabled by default, with the owner-approved one-shot run ID;
- independent write/read secret-manager references (never secret values);
- private absolute storage location, retention policy, and 0700/0600 access
  policy;
- 16 MiB request/read limits, maximum 30-second deadline, and redirect/retry
  policy (`reject`, `none`);
- route owner, authorization scope owners, and durable one-shot admission
  control across process restarts.

The client enforces one attempt per instance; deployment integration must
provide a durable one-shot gate across restarts. No activation or live-readiness
claim is made here. Keep real authorization material and private exports out of
GitHub, logs, and test fixtures.
