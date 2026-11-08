# One-shot host eight-hour summary publisher

This is an external operator tool for an already exported host summary. It does
not read the running host, extract journals, schedule snapshots, deploy a gateway,
or establish live automated extraction. The exporter in
`scripts/spot-paper-report-bridge/host8h-presentation.mjs` and the existing exact
host8h contract remain authoritative. Do not send raw journals or archive bytes.

Keep the current host and its empty runtime environment unchanged. A future
publisher deployment needs its own reviewed private endpoint, write credential,
network access, gateway provisioning and read/write credential separation. Code
availability is not evidence that those operational prerequisites are satisfied.

## Validate without network access

Supply a UTF-8 JSON file containing the exporter result (not a transfer envelope):

```sh
node scripts/spot-paper-report-bridge/host8h-publisher.mjs \
  --summary /operator/exported-host8h-summary.json \
  --endpoint https://reviewed-gateway.example/api/private/spot-paper-host8h-report/upload
```

This default produces `DRY_RUN` / `VALIDATED_NO_UPLOAD`. It neither reads the
credential nor calls the transport. Replace the example hostname with the
explicitly reviewed HTTPS destination; no destination is discovered automatically.
Query strings, fragments, URL credentials and other routes are rejected.

To send one request, append `--publish`. Provision the secret only through the
publisher's `MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_TOKEN` environment variable
using the deployment secret mechanism. Do not put it in command arguments, files,
receipts, logs or chat. The tool emits only fixed outcome/reason fields and does
not print endpoints, input payloads, remote error text or secrets.

## Bounds and outcomes

Input must be a regular non-symlink file of at most 256 KiB. The publisher
revalidates the exact contract, run, profile and source identity, creates the
canonical transfer envelope and checks the complete envelope's 256 KiB ceiling.
It sends one HTTPS POST with redirects disabled, a five-second overall network
and response-reading deadline, and a 4 KiB response ceiling. There are no retries.
The deadline aborts transport; it cannot establish whether a remote write occurred.
Local regular-file reading is byte bounded; synchronous local filesystem I/O is
not claimed to have a hard wall-clock deadline.

| Outcome | Meaning |
| --- | --- |
| `DRY_RUN` | Locally validated; no upload attempted |
| `ACCEPTED` | HTTP 201 and exact matching bounded receipt |
| `IDEMPOTENT` | HTTP 200 and exact matching idempotent receipt |
| `REJECTED` / `STALE` | HTTP 409 snapshot out of order |
| `REJECTED` / `CONFLICT` | HTTP 409 conflicting snapshot |
| `REJECTED` / `TERMINAL_REGRESSION` | HTTP 409 terminal regression refused |
| `UNKNOWN` | Deadline, transport error, malformed or unconfirmed receipt; write outcome uncertain |

`REJECTED` / `REDIRECT_REJECTED` means the redirect was not followed.
It does not establish that the original POST caused no remote write; inspect
destination state before choosing any subsequent action.

Only dry-run, accepted and idempotent outcomes exit zero. Successful upload is
transport acknowledgement, not a completed assessment or trading readiness.

## Freshness and replay

The supplied `observedAt`, journal sequence and every summary field are preserved.
An old snapshot must never be restamped to make it appear fresh. Replaying the
same snapshot may yield `IDEMPOTENT`; it does not refresh source observation time.
An accepted old snapshot can still be stale in the dashboard. A new observation
requires a separately obtained new exporter result, not publisher-generated data.
Resolve `UNKNOWN` by reviewing destination state and retained evidence before any
separately chosen subsequent action. Do not turn this tool into a retry loop.

## Offline verification

```sh
node --test test/spot-paper-host8h-publisher.test.js
```

Tests inject transport and use fixtures exclusively, including the real gateway
handler in memory. They cover canonical compatibility, immutable observation
time, no-send validation failures, strict receipts, stale/conflict/regression,
redirect rejection, body limits, transport/body deadlines and file bounds.
