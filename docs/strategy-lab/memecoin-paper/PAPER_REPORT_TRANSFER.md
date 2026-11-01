# Post-run Paper report transfer

## Contract

The optional transfer is a one-shot operation. It is disabled unless the worker
has `MERIDIAN_PAPER_REPORT_TRANSFER_ENABLED=true`; no pilot lifecycle operation
is started, stopped, or retried. The worker reads the existing
`readPilotStatus()` and `readPilotReport()` results, the persisted run config,
lock, and terminal marker. It sends nothing unless all four identify the pinned
run and config hash and the terminal marker and report are `FINISHED`. A durable
lock without a terminal marker, an `UNKNOWN` terminal, a partial report, a
symlink, and a mismatched run/config all fail closed. The reporter does not
reconstruct or regenerate report contents.

The worker sends a canonical JSON envelope, at most 256 KiB:

```json
{
  "schema": "MEMECOIN_PAPER_REPORT_TRANSFER_ENVELOPE_V1",
  "runId": "pinned-run-id",
  "configHash": "64 lowercase hex characters",
  "report": {"schema": "MEMECOIN_PAPER_OPERATOR_REPORT_V1"}
}
```

The gateway validates the envelope with the existing Paper report DTO contract,
rejects observations in the future, and binds `runId` and `configHash` to its
single configured run. It stores a content digest and immutable JSON in the
dedicated `meridian_paper_reports` table. The GET response omits `configHash`
and is the existing bounded
`MEMECOIN_PAPER_REPORT_BRIDGE_ENVELOPE_V1`:

```json
{
  "schema": "MEMECOIN_PAPER_REPORT_BRIDGE_ENVELOPE_V1",
  "runId": "pinned-run-id",
  "report": {"schema": "MEMECOIN_PAPER_OPERATOR_REPORT_V1"}
}
```

The upload acknowledgement is a bounded JSON object with exactly `ok`, `runId`,
`configHash`, `digest`, and `idempotent`. A first insert returns `201` with
`idempotent: false`; an identical replay returns `200` with `idempotent: true`.
The exporter reports `TRANSFERRED` only after it has read the complete bounded
acknowledgement and matched `ok`, the pinned run/config, the locally calculated
SHA-256 of the canonical transfer envelope, and the status/idempotency pair.
Malformed, empty, oversized, mismatched, or timed-out receipts are never success.

Neither endpoint establishes provider authenticity, liveness, fill execution,
or trading permission. The report's provenance remains caller-labelled and
unauthenticated.

## Endpoints and responses

| Method and path | Authentication | Success | Errors |
| --- | --- | --- | --- |
| `POST /api/private/paper-report/upload` | Dedicated upload bearer only | `201` committed; `200` identical replay | `400 invalid_request_body`, `invalid_content_length`, `invalid_report_envelope`, or `paper_report_query_not_supported`; `401 paper_report_upload_auth_required`; `405 method_not_allowed`; `408 request_body_timeout` or `request_cancelled`; `413 request_body_too_large`; `415 unsupported_content_type`; `409 paper_report_conflict`; `503 paper_report_upload_disabled`, `paper_report_busy`, `paper_report_store_unavailable`, or `paper_report_outcome_unknown`; `403 origin_not_allowed` when an Origin is disallowed |
| `GET /api/private/paper-report` | Existing `MERIDIAN_READ_TOKEN_SHA256` bearer | `200` bounded report envelope with `Cache-Control: no-store` | `400 paper_report_query_not_supported`; `401 read_token_required`; `404 paper_report_not_found`; `405 method_not_allowed`; `503 paper_report_disabled`, `paper_report_busy`, `paper_report_store_timeout`, `paper_report_store_unavailable`, or `paper_report_corrupt`; `403 origin_not_allowed` when an Origin is disallowed |

`OPTIONS` uses the gateway's existing CORS preflight (`204` when allowed,
`403 origin_not_allowed` otherwise).

The GET has no run, path, or filesystem selector. The upload route authenticates
before reading any request body and requires JSON. Both routes reject request
selectors, enforce applicable body limits and deadlines, and return generic
storage failures without database details or paths. Upload credentials and
bodies are never placed in a URL or logged. The read token cannot upload.
At most four report HTTP requests may be admitted simultaneously. The dedicated
report PostgreSQL pool has at most two connections, a 1.5-second connection
budget, a 3.5-second statement budget, a 1-second lock-wait budget, and a
4.5-second idle-transaction budget. Report store operations admit at most two
operations and return by a 6-second caller deadline. An operation that remains
in flight continues to occupy its slot after the caller receives a response;
it is never detached and counted as finished.

An upload receiving `paper_report_outcome_unknown` may have committed even
though the response could not confirm it. Do not change the report or start an
automatic retry loop. Once the outstanding DB operation settles, resend the
same pinned report once: a completed prior commit will return `200` as an
identical replay; if the prior transaction rolled back, it can return `201`.
While a timed-out/cancelled operation is still active, the bounded store returns
`paper_report_busy` rather than admit additional DB work. A conflicting payload
still returns `409` and never overwrites.

The worker's bounded caller returns status `UNKNOWN` with reason
`transfer_outcome_unknown` if its deadline expires before fetch and response-body
cleanup settle. Missing, malformed, oversized, or mismatched acknowledgements
also return `UNKNOWN` (`upload_receipt_unverified`), because the gateway may
already have committed the report. It retains one
process-local transfer slot until that transport and cleanup settle; another
invocation in that process returns `transfer_busy`. Do not launch parallel
exporters. Once the previous operation is known to have settled, a manual retry
uses the immutable same-report policy above.

The worker command exits `0` only after a `200`/`201` gateway response with a
verified acknowledgement and prints only a bounded status/reason code. It
rejects disabled or invalid configuration,
run-directory/config/terminal mismatch, missing or partial reports, invalid
origin, timeout, and transport failure without printing source paths, report
contents, or credentials.

Upload scope is pinned by gateway deployment configuration:

* `MERIDIAN_PAPER_REPORT_UPLOAD_ENABLED=true`
* `MERIDIAN_PAPER_REPORT_EXPECTED_RUN_ID=<one validated run id>`
* `MERIDIAN_PAPER_REPORT_EXPECTED_CONFIG_SHA256=<64 lowercase hex>`
* `MERIDIAN_PAPER_REPORT_UPLOAD_TOKEN_SHA256=<SHA-256 of the dedicated upload secret>`

The gateway stores only the upload-token hash. Keep the existing
`MERIDIAN_READ_TOKEN_SHA256` separate and unchanged. The worker-side, separately
provisioned secret is:

* `MERIDIAN_PAPER_REPORT_TRANSFER_ENABLED=true`
* `MERIDIAN_PAPER_REPORT_DATA_ROOT=<absolute parent directory containing run-id directories>`
* `MERIDIAN_PAPER_REPORT_EXPECTED_RUN_ID=<same pinned run id>`
* `MERIDIAN_PAPER_REPORT_EXPECTED_CONFIG_SHA256=<same pinned config hash>`
* `MERIDIAN_PAPER_REPORT_GATEWAY_ORIGIN=<one HTTPS origin, without path/query/fragment>`
* `MERIDIAN_PAPER_REPORT_UPLOAD_TOKEN=<dedicated bearer secret>`

The transfer CLI accepts only `--run-id`; the selector must equal the pinned
expected run. The endpoint path is fixed in source. Origin validation permits
only one configured HTTPS origin, disallows URL credentials and extra path
components, and fetch uses `redirect: "error"`. There is no automatic retry.
Choose a random, high-entropy upload secret using the deployment's existing
secret manager, then set its SHA-256 digest on the gateway and the secret itself
on the worker. Provisioning and activation are not performed by this change.

## Operator handoff

This is **code-ready only**. The report-transfer migration, gateway deployment,
worker configuration, and credentials have not been applied or provisioned.
Before enabling either side, apply
`migrations/20261101_meridian_paper_reports.sql` through the operator-reviewed
migration process and deploy the gateway code/configuration. The gateway must
receive `MERIDIAN_PAPER_REPORT_UPLOAD_ENABLED`,
`MERIDIAN_PAPER_REPORT_EXPECTED_RUN_ID`,
`MERIDIAN_PAPER_REPORT_EXPECTED_CONFIG_SHA256`, and
`MERIDIAN_PAPER_REPORT_UPLOAD_TOKEN_SHA256` (hash only). Inject
`MERIDIAN_PAPER_REPORT_TRANSFER_ENABLED`,
`MERIDIAN_PAPER_REPORT_DATA_ROOT`,
`MERIDIAN_PAPER_REPORT_EXPECTED_RUN_ID`,
`MERIDIAN_PAPER_REPORT_EXPECTED_CONFIG_SHA256`,
`MERIDIAN_PAPER_REPORT_GATEWAY_ORIGIN`, and
`MERIDIAN_PAPER_REPORT_UPLOAD_TOKEN` into the worker configuration/secret
manager. Keep `MERIDIAN_READ_TOKEN_SHA256` separate.

Do not treat the planned run end time (nominally `2026-11-02T03:02:21.383Z`,
`2026-11-02T04:02` Vienna time) as terminal evidence. First independently verify
the preserved run is actually terminal `FINISHED`; confirm the same pinned run
ID and config SHA-256 in persisted config, status, lock, terminal marker, and
existing report identity/accounting. `AVAILABLE` alone, a lock, or elapsed time
is not proof. Do not modify or restart the observation to obtain evidence.

Only after those checks and prerequisites, invoke from the configured worker
runtime with the required settings already present in its environment (the
secret value is never placed in the command):

```sh
MERIDIAN_PAPER_REPORT_TRANSFER_ENABLED=true \
  node scripts/memecoin-paper-report-transfer/transfer.mjs \
  --run-id "$MERIDIAN_PAPER_REPORT_EXPECTED_RUN_ID"
```

`TRANSFERRED` means the exporter verified the complete acknowledgement (at most
2,048 bytes), its `ok`, exact run ID/config hash, SHA-256 of its canonical
envelope, and `201` /
`idempotent:false` or `200` / `idempotent:true` pairing. `UNKNOWN` means delivery
may have committed; do not mutate the source report or loop/retry automatically.
Wait until the exporter has settled its in-flight request/body cleanup, then a
single manual resend of the same pinned report is safe: the gateway returns
`200` for an identical committed replay or `201` if the earlier transaction did
not commit. Stop and investigate a conflict; it never overwrites the stored row.

To roll back, disable worker transfer and gateway upload first, then remove the
worker upload secret and gateway upload hash. Preserve the private report row
and migration unless the retention owner separately authorizes deletion. Rollback,
UNKNOWN handling, and retry never restart, stop, or otherwise alter the
observation.

## Persistence and replay policy

Apply `migrations/20261101_meridian_paper_reports.sql` through the normal
operator-reviewed database migration process before enabling the feature. This
change does not execute migrations against any database.

`run_id` is the table's unique key. A transaction inserts once; an existing row
with the same config hash and canonical content digest is an idempotent replay.
Any different digest or config for that run returns `409` and never overwrites
the original. The same uniqueness rule serializes concurrent uploads; the
losing identical request observes the committed row, while different content
conflicts. The digest covers the canonical transfer envelope, including the
config hash. GET rechecks the digest and scope before returning data.

For per-run revocation, disable upload or clear/replace the expected run and
config settings; disable GET by setting the feature flag false. To revoke a
compromised uploader, replace the worker secret and gateway hash (or clear the
hash to disable upload). A token for one pinned run cannot upload another run.
GET access remains separately controlled by the existing read token.

## Activation and rollback

Activation is deliberately not part of this change. Before provisioning any
credential or enabling the worker transfer:

1. Independently verify the exact observation has reached terminal `FINISHED`;
   preserve the existing run evidence and do not modify, restart, or otherwise
   touch the active worker/run to obtain it.
2. Independently verify the persisted config, run ID and SHA-256, terminal
   marker, and `readPilotReport()` identity/accounting. Confirm the expected run
   and hash with the gateway operator. Do not use `AVAILABLE` alone as proof of
   a `FINISHED` terminal.
3. Review the migration, create a dedicated high-entropy upload secret in the
   normal secret manager, provision only its hash to gateway configuration and
   the secret to the worker, and pin the same run/config values on both sides.
4. Enable and invoke the one-shot exporter only after those independent checks.
   Verify its generic result, then authenticate to the fixed GET using the
   existing read token and compare the returned report identity/digest with the
   preserved source. Do not copy secrets or report contents into logs, issues,
   or public artifacts.

To roll back, first set the transfer-enabled flag false on the worker and
upload-enabled flag false on the gateway, then remove the worker secret and
gateway upload hash. This disables both upload and report GET; the read token
does not gain write authority. Preserve the private database row and migration
unless the normal retention owner separately authorizes deletion. No deployment
or credential provisioning is made by this change.

## Focused tests

```sh
node --test test/memecoin-paper-report-transfer.test.js
```

Tests use generated reports, temporary directories, injected transports, and
injected database clients. In particular, the transaction/concurrency store
tests use an in-memory SQL client stub; they do not establish PostgreSQL's actual
unique-key locking/transaction behavior. These tests do not contact a host,
provider, or real database. Validate those semantics against a separately
provisioned test PostgreSQL instance before deployment; no database was
provisioned or contacted for this change.
