# M11 Paper report bridge preparation

## Status and ownership

The memecoin report bridge is wired to the authenticated M11 Paper cockpit and
the gateway's fixed report routes. The gateway implementation is present in
`server-gateway.js` and `report-transfer-gateway.mjs`; this does not establish
that a route is deployed or that a report has been transferred. The worker's
local files are not read by the browser or gateway.

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

The memecoin gateway has a fixed authenticated GET and upload route backed by
immutable private storage. The source remains `MEMECOIN_PAPER_OPERATOR_REPORT_V1`;
that validator is not used for BTC/EUR.

BTC/EUR uses a separate fixed route, table, and versioned DTO:

- `GET /api/private/spot-paper-report` requires the existing read bearer and
  serves only the pinned run `spot-paper-42395522899-1`.
- `POST /api/private/spot-paper-report/upload` requires a distinct upload
  bearer, a canonical bounded `BTC_EUR_SPOT_PAPER_REPORT_TRANSFER_V1` envelope,
  and immutable storage. It does not accept a path or run selector.
- The display DTO is `BTC_EUR_SPOT_PAPER_DASHBOARD_V1`. Its adapter binds the
  terminal readback to the paper assessment and separate signal-replay result,
  and accepts only the pinned source SHA, workflow SHA, attempt, run, and 1-hour
  profile. It does not translate BTC/EUR into the memecoin report schema.
- The spot route is disabled unless all three gates are explicitly true:
  `MERIDIAN_SPOT_PAPER_REPORT_ENABLED`,
  `MERIDIAN_SPOT_PAPER_REPORT_DEPLOYMENT_VERIFIED`, and
  `MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_APPROVED`. Upload also requires
  `MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_TOKEN_SHA256` and the existing read-token
  configuration. No values are configured or deployed by this change.
- Gateway storage requires applying
  `migrations/20261107_meridian_spot_paper_reports.sql`. The frontend read is
  manual, uses `appAccess`, and remains unavailable until an approved report is
  transferred and the route is separately enabled.

## Remaining deployment and transfer prerequisites

1. The repository retains the reconciliation summary and signal-replay result,
   but not the original terminal readback, provenance manifest, or paper
   assessment payload. The UI fixture is explicitly offline; it is not a
   reconstructed or live report.
2. Obtain the retained readback, provenance manifest, assessment, and replay
   output through the separately approved operator process. Regenerate the
   current assessment and replay outputs offline, then create the
   DTO with `scripts/spot-paper-report-bridge/create-dto.mjs`. The creator also
   requires a separately supplied, root-verified dispatch tuple; it never
   defaults that tuple from the evidence manifest.
3. Independently review and approve that exact DTO and its transfer method.
   Supply the dedicated upload token through the deployment's approved secret
   channel; do not reuse or publish the read token.
4. Apply the dedicated migration, collect deployment verification evidence, and
   only then configure the three explicit feature gates and separate upload
   token hash. Transfer the approved DTO once to the fixed upload route; verify
   immutable readback and the DTO digest.
5. Confirm the authenticated GET, CORS allowlist, no-store response, browser
   cache identity, and manual-only read behavior in the target deployment.

No retained payload was uploaded, no credential was added, and no deployment
or active Paper run was changed for this integration.

## Offline regeneration for the pinned first-hour run

The original archived outputs predate the current `profileId` fields. Do not
edit those outputs to add profile or PASS values. Retrieve the original
`paper.stdout.json`, `pilot-manifest.json`, `metadata.txt`, and retained
`data/spot-paper-42395522899-1` directory using the approved operator process;
verify the archive's `SHA256SUMS` before continuing. These files are not included
in this repository. Run the following in a clean output directory with the
repository's offline assessment and replay tools:

```sh
set -euo pipefail
INPUT=/approved/private/spot-paper-pilot-42395522899-1
OUT="$(mktemp -d)"
RUN_ID=spot-paper-42395522899-1
PAPER_EXIT_STATUS="$(awk -F= '$1 == "paper_exit_status" {print $2}' "$INPUT/metadata.txt")"
[[ "$PAPER_EXIT_STATUS" =~ ^[0-9]+$ ]]

node scripts/spot-paper-pilot/cli.mjs \
  --mode report --data-root "$INPUT/data" --run-id "$RUN_ID" \
  > "$OUT/readback.stdout.json"
printf '%s  %s\n' \
  53a32d3921bd2252ab027898a4bfc7cf609e7c66de6eff0fdfdaa136b7e1bd40 \
  "$OUT/readback.stdout.json" | sha256sum --check

node scripts/spot-paper-pilot/paper-evidence-assessment.mjs \
  "$INPUT/paper.stdout.json" "$OUT/readback.stdout.json" \
  "$PAPER_EXIT_STATUS" "$INPUT/pilot-manifest.json" \
  "$INPUT/data/$RUN_ID" "$OUT/assessment.json" BTC_EUR_PAPER_1H_V1
node scripts/spot-paper-pilot/signal-replay.mjs \
  "$OUT/readback.stdout.json" "$INPUT/pilot-manifest.json" \
  "$INPUT/data/$RUN_ID" "$OUT/signal-replay.json" \
  BTC_EUR_RUN_42395522899_V1
```

Before creating the DTO, obtain the repository, workflow path, ref, workflow
commit SHA, run ID, run number, and attempt independently from the root-verified
GitHub Actions run metadata (not from the artifact's manifest or replay JSON).
Write those values to `$OUT/expected-dispatch.json` without copying or editing
any artifact file. The required first-hour identity is pinned to source
`81edf0b5dc3d455c2c1e1906791d56c731bea0c9`, workflow
`ddae14f01583196dfc9e9da906dcd03d41d58369`, run `42395522899`, run number 1,
attempt 1, and `refs/heads/main`; a mismatch or absent value must stop DTO
creation. For example, the independently prepared JSON has this shape:

```json
{
  "repository": "Achi1984/meridian",
  "workflowPath": ".github/workflows/spot-paper-pilot-paper-once.yml",
  "ref": "refs/heads/main",
  "workflowSha": "<independently verified workflow commit SHA>",
  "workflowRunId": "42395522899",
  "workflowRunNumber": 1,
  "workflowRunAttempt": 1
}
```

Then create a new, private output file. The command rejects stale/mismatched
assessment, replay, readback, provenance, or independent dispatch inputs and
does not overwrite an existing output:

```sh
node scripts/spot-paper-report-bridge/create-dto.mjs \
  "$OUT/readback.stdout.json" "$INPUT/pilot-manifest.json" \
  "$OUT/assessment.json" "$OUT/signal-replay.json" \
  "$OUT/expected-dispatch.json" "$OUT/btc-eur-dashboard-dto.json"
```

This procedure is offline; it does not call a provider, dispatch or resume a
workflow, change a runtime, enable deployment flags, or transfer the DTO. It
must fail if the retained inputs are incomplete or if the tools return
UNKNOWN/FAILED. Do not reconstruct missing values from reconciliation prose,
hand-edit evidence to add profile/PASS fields, or substitute the active
four-hour run `42404743386`.

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
