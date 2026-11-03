# Private HTTPS paper-export adapter (source-only)

This package adds an optional Node HTTPS adapter around the frozen
`scripts/memecoin-paper-run-export-transfer/` contract. It does not start a
listener on import, register a gateway route, enable transfers, change the
paper controller, or contact a remote service by default.

The client uses Node's normal certificate and hostname verification, accepts
only one fixed HTTPS origin, exact private routes and methods, and does not
follow redirects or retry. Upload/readback operations preserve the transfer
contract's 16 MiB limit, 4096 stream-read bound, and one 30-second maximum
deadline. Header parsing is capped; upload and download streams apply
backpressure and cancellation destroys their request/response streams.

`createPrivateReceiverHandler()` adapts exactly `PUT` and `GET` requests to
`createFileReceiver()`. It rejects non-TLS sockets, paths outside the fixed
route, duplicate/oversized headers, partial or oversized request bodies, and
reads without exact run/config/producer identity plus expected export digest
and byte length. It returns bytes only after the receiver's read authorizer and
full identity check succeed. The adapter trusts no forwarded-protocol or
forwarded-identity headers.

`readExportOverHttps()` supports a separate read-only process. The caller must
supply the expected run ID, config SHA-256, producer revision, export SHA-256,
byte length, and read authorization. It hashes the downloaded raw bytes and
invokes the existing evaluator without reserializing the export.

## Operator CLI

The CLI is not enabled unless `PAPER_EXPORT_HTTPS_ENABLED=true`. Runtime
configuration uses these environment variable names; authorization values
must come from the operator's secret manager and must never be placed in
arguments, logs, source control, or test data:

- `PAPER_EXPORT_HTTPS_ORIGIN`
- `PAPER_EXPORT_HTTPS_WRITE_AUTHORIZATION`
- `PAPER_EXPORT_HTTPS_READ_AUTHORIZATION`
- `PAPER_EXPORT_HTTPS_ATTEMPT_DIRECTORY` (upload only; a durable private
  absolute directory with mode `0700`)

An upload requires both distinct authorization scopes. It creates a run-keyed
attempt record using exclusive creation, syncs the record and directory before
network dispatch, then appends and syncs the outcome. A restart that finds an
existing gate returns `UNKNOWN` and does not dispatch again, even if the
previous process stopped before recording its result. The gate stores identity,
digest, length, and status only; it never stores authorization material.

```sh
node scripts/memecoin-paper-run-export-https/cli.mjs upload \
  --export /absolute/path/memecoin-paper-run-export.json \
  --run-id approved-run-id \
  --config-sha256 independently-recorded-config-sha256 \
  --producer-revision paper-pilot-composition/3

node scripts/memecoin-paper-run-export-https/cli.mjs readback \
  --run-id approved-run-id \
  --config-sha256 independently-recorded-config-sha256 \
  --producer-revision paper-pilot-composition/3 \
  --export-sha256 independently-recorded-export-sha256 \
  --byte-length independently-recorded-byte-length \
  --output /absolute/path/readback.json
```

`readback` needs only the independent read authorization; it is available in a
new process and does not consult or claim an upload gate. It writes the verified
original bytes to a new mode-`0600` file and never overwrites an existing path.
Exit codes are `0` for acknowledged upload or evaluator `PASS`, `1` for rejected
input/transfer or evaluator `FAIL`, and `2` for `UNKNOWN` or evaluator
`UNKNOWN`. `TRANSFER_ACKNOWLEDGED` is not checkpoint acknowledgement; neither
it nor evaluator `PASS` means a strategy outcome or live readiness.

## Private server integration handoff (not registered)

The new handler is a hosting adapter, not a server registration. An authorized
route owner must review and explicitly register both paths on the one fixed,
private HTTPS origin:

- `PUT /private/run-exports/v1/{runId}` accepts original export bytes with
  `application/octet-stream`. It requires headers
  `x-paper-transfer-schema`, `x-paper-run-id`, `x-paper-config-sha256`,
  `x-paper-producer-revision`, `x-paper-export-sha256`,
  `x-paper-byte-length`, and a write-scoped `Authorization` header. It returns
  `STORED`, `DUPLICATE`, `CONFLICT`, `REJECTED`, or `UNKNOWN`.
- `GET /private/run-exports/v1/{runId}` requires the same schema and identity
  headers, expected digest and length, and the separate read authorization.
  The handler calls `createFileReceiver().get()` before sending any bytes.
  It returns the original bytes with identity/digest/length headers only for
  an exact match; mismatch, missing data, or uncertainty returns no export
  bytes.

Bind the handler only to a private HTTPS listener. TLS must terminate at that
listener so `request.socket.encrypted` is true; this implementation does not
trust proxy headers. Configure separate write and read authorizers on
`createFileReceiver()`. Use the receiver's fixed absolute volume root; there
are no path selectors. No route registration or host retrieval has been
verified by this source change.

The host manifest handoff must specify:

- route paths/methods above and the exact fixed HTTPS origin;
- TLS listener/certificate binding and private network ingress restrictions;
- independent secret-manager reference names
  `PAPER_EXPORT_HTTPS_WRITE_AUTHORIZATION` and
  `PAPER_EXPORT_HTTPS_READ_AUTHORIZATION` (values are not part of this source);
- a durable private absolute volume root, suggested
  `/var/lib/meridian/paper-run-exports`, with `0700` directory and `0600` files,
  retention, backup, and recovery policy;
- image digest, source commit, transfer schema
  `memecoin-paper-run-export-transfer/v1`, export schema
  `memecoin-paper-run-export/v1`, owner-approved config binding, and
  `PAPER_EXPORT_HTTPS_ENABLED=false` by default;
- 16 MiB request/response bounds, 30-second deadline, bounded headers, no
  redirects, no retries, authorization scopes, route owner, and durable
  operator attempt-directory provisioning.

The exact gateway registration is outside this owned module and must be
reviewed by the gateway owner before any separate deployment decision. No
production route, credentials, private export, runtime activation, external
network, provider, or paid service is included or claimed here.

## Focused acceptance checks

```sh
node --test scripts/memecoin-paper-run-export-https/test/https.test.mjs
node --check scripts/memecoin-paper-run-export-https/https.mjs
node --check scripts/memecoin-paper-run-export-https/cli.mjs
node --check scripts/memecoin-paper-run-export-https/test/https.test.mjs
node scripts/secret-check.mjs
```

The HTTPS tests generate a test CA and server certificate in a temporary
directory, trust that CA only in the test client, and use a local HTTPS server.
They create a real synthetic composition export, transfer and read it back,
and exercise authorization, identity/digest checks, conflict behavior,
redirects, cancellation, unknown-length/partial/chunk-flood requests, oversized
and hanging streams, lost acknowledgement, and the durable restart gate. They do
not disable certificate verification, use external network access, or contain
actual private data.

Frozen dependency head: `7c043ecabaa4516aff3ca8488bd22e22fcc57d43`. Its final
safety review remains pending. The lead owns combined CI, final review, and
integration; this package makes no host-side availability or deployment claim.
