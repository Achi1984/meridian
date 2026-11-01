# M11 Paper report bridge preparation

## Status and ownership

This is an offline, read-only preparation package. It adds a bounded DTO
validator/source-reader boundary and an opt-in browser connector. It does not
add a route, start a listener, read a worker file, mount a volume, change the
gateway or authentication implementation, or wire the connector into the
cockpit/bootstrap. No live report is connected or claimed.

The existing producer remains
`scripts/memecoin-paper/operator-report.mjs` and continues to own
`MEMECOIN_PAPER_OPERATOR_REPORT_V1`. The worker-side
`scripts/memecoin-paper/pilot-online.mjs` `readPilotReport(dataDirectory)`
reader checks the persisted report against the local worker status/config
identity and provider accounting, then returns the DTO. The bridge does not
reconstruct, augment, or recalculate report fields.

The bridge envelope is a strict, bounded transfer wrapper:

```json
{
  "schema": "MEMECOIN_PAPER_REPORT_BRIDGE_ENVELOPE_V1",
  "runId": "the-report-experiment-id",
  "report": {"schema": "MEMECOIN_PAPER_OPERATOR_REPORT_V1"}
}
```

The duplicated `runId` must match `report.experiment.id`; there is no request
parameter for choosing a run or filesystem location. Projection accepts only
the current DTO's allowlist and omits no supplied contract fields. Absent
amounts, counts, timestamps, and coverage members remain absent; explicit
`null` remains null. Exact integer-cent strings are not converted to numbers.
Observation timestamps in the future are rejected. Staleness is classified
only when an explicit display threshold is configured; it is not a producer
health or liveness check. Observation provenance remains
`CALLER_LABEL_ONLY_NOT_AUTHENTICATED`; synthetic evidence remains
`SYNTHETIC_FIXTURE_DECLARED`.

The source reader and browser transport are injected and invoked only after
explicit opt-in. Each instance admits one source operation at a time, passes an
`AbortSignal`, applies a bounded timeout, limits response bytes, rows, nesting,
nodes, and strings, and aborts on disposal. A timed-out source that ignores
cancellation retains the single in-flight slot until it settles; subsequent
reads return `BUSY` instead of accumulating unbounded work. A production source
reader/transport must honor cancellation. The browser connector accepts no URL,
path, run ID, or credential; its injected transport must use a reviewed fixed
endpoint and existing authentication. It does not poll, retain credentials, or
bootstrap itself.

## Authenticated integration and blockers

The existing gateway has a protected-read convention: `MERIDIAN_READ_TOKEN_SHA256`
is checked against a bearer `Authorization` header using a timing-safe hash
comparison, and `/api/private/` is already within the protected route prefix.
That is suitable for the future browser **GET** only, after an endpoint and
storage source have been reviewed. The connector must receive an authenticated
transport from the existing access owner; it must not copy, persist, or invent
a token.

There is no current report endpoint or report-specific gateway store. The
Northflank observation worker has no public port or shell access. Its durable
volume is attached only to that worker; no shared filesystem between it and the
gateway is established. The existing report reader requires access to the
worker-local data directory, so the gateway cannot call it or read that volume.
The existing bearer read token authenticates a gateway read; it is not a
worker-to-gateway upload credential. No upload endpoint, worker credential,
automatic job, or public artifact transfer is introduced here.

Therefore the currently feasible part is the **read-side contract**: a future
reviewed browser GET through the existing protected-read authentication pattern
can return a fixed, bounded DTO from gateway-owned private storage. The missing
piece is a separately reviewed, authenticated way to transfer the completed
worker report into that storage **after the run**. Until an owner-approved
transfer and destination exist, the connector must stay disabled and the
cockpit stays unavailable. Do not treat logs, an assumed shared mount, a
caller-supplied path, or a public artifact as that transport.

## Future handler shape (disabled; not implemented)

After transfer is designed, reviewed, and separately authorized:

1. A fixed handler under the gateway's protected private-read namespace serves
   only the latest approved report from gateway-owned storage. It accepts no
   path or run selector from the browser and performs no filesystem lookup on
   the worker.
2. The handler requires the existing bearer read authorization, uses
   `Cache-Control: no-store`, emits the bounded envelope, and fails closed if
   the report is absent, invalid, or mismatched. It must not add an unauthenticated
   route or reuse write authorization for a read.
3. A separately reviewed post-run transfer is responsible for preserving the
   exact DTO and binding its report ID to the envelope. Its identity, encryption,
   retention, replay/replace policy, and access controls must be approved before
   any implementation or data movement.
4. An owner may then inject a fixed authenticated GET transport into
   `createPaperReportConnector()`. The connector can pass the returned DTO to
   `createPaperCockpitAdapter({readReport})` and the existing model/view. This
   package does not wire that call or select an endpoint.

## Post-run acceptance procedure

1. Wait until the authorized observation run is terminal. Do not restart, update,
   or alter the active worker or its configuration to obtain a report.
2. Through a separately approved operator-access method, run the existing
   read-only report reader against its worker-local store. Require its
   `AVAILABLE` result and identity/accounting checks; do not generate a report
   from a controller summary or an incomplete/mismatched snapshot.
3. Freeze the exact DTO and report identity. Validate its schema and limits
   locally with generated test data first. Record a digest and transfer evidence
   without copying report contents into public logs, issues, or artifacts.
4. Use only a separately reviewed authenticated post-run transfer into
   gateway-owned private storage. Confirm that the gateway has no worker-volume
   dependency and that missing/corrupt/mismatched data fails closed. No such
   transfer is available in this preparation.
5. In a separate integration review, verify that the fixed GET rejects absent
   or invalid credentials, serves no-store bounded JSON with the existing
   read-token policy, and exposes no arbitrary path/run selection. Then inject
   the authenticated transport once, with timeout and cancellation, into the
   browser connector.
6. Compare the returned report identity, mode/provenance, exact amount strings,
   timestamps, and coverage with the frozen DTO. Verify stale, future, partial,
   missing, and rejected states remain visible through the existing cockpit
   model. Confirm text is rendered as text and that no polling or runtime
   controls were added.
7. Record the exact source/base and transfer/handler review evidence. This
   acceptance is a read-only report-delivery check only; it does not establish
   source authenticity, durable worker state, liveness, fills, PnL, or trading
   permission.

## Focused tests

```sh
node --test test/memecoin-paper-report-bridge.test.js
```

Tests create reports from generated fixtures and exercise the real report
projector and cockpit model. They make no provider, host, network, or live worker
calls.
