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
  serves only the explicitly configured approved run, defaulting to
  `spot-paper-42395522899-1`.
- `POST /api/private/spot-paper-report/upload` requires a distinct upload
  bearer, a canonical bounded `BTC_EUR_SPOT_PAPER_REPORT_TRANSFER_V1` envelope,
  and immutable storage. It does not accept a path or run selector.
- The display DTO is `BTC_EUR_SPOT_PAPER_DASHBOARD_V1`. Its adapter binds the
  terminal readback to the paper assessment and separate signal-replay result,
  and accepts only the two exact registry identities below, each with its own
  workflow path, profiles and bounds. It does not translate BTC/EUR into the
  memecoin report schema or infer trusted dispatch from artifact contents.
- The spot route is disabled unless all three gates are explicitly true:
  `MERIDIAN_SPOT_PAPER_REPORT_ENABLED`,
  `MERIDIAN_SPOT_PAPER_REPORT_DEPLOYMENT_VERIFIED`, and
  `MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_APPROVED`. Upload also requires
  `MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_TOKEN_SHA256` and the existing read-token
  configuration. No values are configured or deployed by this change.
- Gateway storage requires applying
  `migrations/20261107_meridian_spot_paper_reports.sql`, followed by the reviewed
  forward migration `migrations/20261108_meridian_spot_paper_reports_two_runs.sql`
  for four-hour support. The forward migration changes only the approved run-ID
  check and repeats PUBLIC revocation; it does not delete or rewrite the
  first-hour row, primary key, hashes, envelope or timestamp. Neither migration
  is executed by this PR. The frontend read is
  manual, uses `appAccess`, and remains unavailable until an approved report is
  transferred and the route is separately enabled.

## Remaining deployment and transfer prerequisites

The observed Northflank preflight found `DATABASE_URL` with an `sslmode` query
parameter, while Node TLS verification was enabled and no report-specific CA was
configured. The dedicated report pool can now normalize a secure URL hint only
when `MERIDIAN_PAPER_REPORT_NORMALIZE_SECURE_SSLMODE=true` is explicitly set.
It accepts only the exact, single lowercase values `require`, `verify-ca`, or
`verify-full`, removes the hint before `pg` sees the URL, and always enforces
certificate-chain and hostname verification with the configured or system CA.
The default remains to reject every TLS URL override; `sslmode=disable`,
`prefer`, `allow`, unknown/mixed-case/duplicate values, other TLS URL parameters,
and `NODE_TLS_REJECT_UNAUTHORIZED=0` remain rejected. This setting affects only
the dedicated Paper report pool, not the gateway pool or global database URL.

For an operator-approved, read-only connectivity/table preflight, run from the
repository root. The command prints only verification status and whether the
spot-report table exists; errors are redacted. Keep shell tracing disabled and
provide `DATABASE_URL` and any private CA through the deployment's secret
environment, never as command-line values:

```sh
MERIDIAN_PAPER_REPORT_NORMALIZE_SECURE_SSLMODE=true \
node --input-type=module -e '
import pg from "pg";
import {createPrivatePaperReportPoolOptions} from "./private-report-store.mjs";
let pool;
try {
  pool = new pg.Pool(createPrivatePaperReportPoolOptions(process.env.DATABASE_URL));
  const result = await pool.query(
    "SELECT to_regclass($1) IS NOT NULL AS table_present",
    ["public.meridian_spot_paper_reports"]
  );
  console.log(JSON.stringify({
    tls_verification: "required",
    table_present: result.rows[0].table_present
  }));
} catch {
  console.error("private_report_preflight_failed");
  process.exitCode = 1;
} finally {
  await pool?.end().catch(() => {});
}'
```

The currently outstanding deployment gaps are `MERIDIAN_READ_TOKEN_SHA256`
(the raw read token exists, but `authorizedRead` requires its configured
SHA-256 hash), `MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_TOKEN_SHA256` (the separate
upload-token hash), and all three explicit route gates:
`MERIDIAN_SPOT_PAPER_REPORT_ENABLED`,
`MERIDIAN_SPOT_PAPER_REPORT_DEPLOYMENT_VERIFIED`, and
`MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_APPROVED`. Do not add a raw-token read fallback
or reuse the existing read/write token for upload. This change makes no hosted
environment changes, dispatches, uploads, or active Paper runtime changes.

For the observed Northflank database, the root applied the reviewed
`migrations/20261107_meridian_spot_paper_reports.sql` transactionally after the
read-only probe; `COMMIT` succeeded and the post-commit check reported
`table_present=true`. This is deployment evidence only, not an action by this
change; independently confirm migration state for any other target.

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
4. Confirm the dedicated migration is applied and collect deployment
   verification evidence; only then configure the three explicit feature gates
   and separate upload token hash. Transfer the approved DTO once to the fixed
   upload route; verify immutable readback and the DTO digest.
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
four-hour run `42404743386` in the first-hour procedure.

## Exact four-hour report preparation and explicit selection

This is report-delivery development only. The lead verified dispatch for run
`42404743386` while it was **IN_PROGRESS**. This PR contains no terminal result
or actual four-hour evidence; generated tests are synthetic. Do not wait on,
restart, dispatch, reconfigure or otherwise alter that worker.

The immutable registry in `scripts/spot-paper-report-bridge/contract.mjs`
admits exactly:

| Report run ID | Workflow SHA / path | Assessment / replay profiles | Duration / cycles / requests |
| --- | --- | --- | --- |
| `spot-paper-42395522899-1` | `ddae14f01583196dfc9e9da906dcd03d41d58369` / `.github/workflows/spot-paper-pilot-paper-once.yml` | `BTC_EUR_PAPER_1H_V1` / `BTC_EUR_RUN_42395522899_V1` | `3600000ms` / `60` / `120` |
| `spot-paper-42404743386-1` | `a960aecb467f5ab647ecfa7a1532e51ad810d6e0` / `.github/workflows/spot-paper-pilot-four-hour-once.yml` | `BTC_EUR_PAPER_4H_V1` / `BTC_EUR_PAPER_4H_V1` | `14400000ms` / `240` / `480` |

Both require repository `Achi1984/meridian`, ref `refs/heads/main`, run number 1,
attempt 1, and runtime source `81edf0b5dc3d455c2c1e1906791d56c731bea0c9`.
The first-hour identity/config hash, DTO schema and canonical transfer envelope
remain unchanged. No other run, source, workflow, path or attempt is admitted.

After **separate independent terminal acceptance**, retrieve the four-hour
archive, verify its retained checksums, and use a fresh private output directory.
Require complete readback, provenance, raw responses and a zero paper exit
status. Do not reconstruct missing inputs or copy PASS fields from another run.
Prepare `$OUT/expected-dispatch.json` independently from the verified Actions
metadata with the same seven fields shown above and the exact four-hour values
in the table. The provenance must also contain matching repository, workflow
path, ref and `BTC_EUR_PAPER_4H_V1` profile.

From the repository root, the offline tools use the existing main profiles:

```sh
set -euo pipefail
umask 077
INPUT=/approved/private/spot-paper-pilot-42404743386-1
OUT="$(mktemp -d)"
RUN_ID=spot-paper-42404743386-1
PAPER_EXIT_STATUS="$(awk -F= '$1 == "paper_exit_status" {print $2}' "$INPUT/metadata.txt")"
[[ "$PAPER_EXIT_STATUS" == 0 ]]

# Supply only after independent metadata verification, never from an artifact.
export MERIDIAN_EXPECTED_DISPATCH_REPOSITORY=Achi1984/meridian
export MERIDIAN_EXPECTED_DISPATCH_WORKFLOW_PATH=.github/workflows/spot-paper-pilot-four-hour-once.yml
export MERIDIAN_EXPECTED_DISPATCH_REF=refs/heads/main
export MERIDIAN_EXPECTED_DISPATCH_WORKFLOW_SHA=a960aecb467f5ab647ecfa7a1532e51ad810d6e0
export MERIDIAN_EXPECTED_DISPATCH_RUN_ID=42404743386
export MERIDIAN_EXPECTED_DISPATCH_RUN_NUMBER=1
export MERIDIAN_EXPECTED_DISPATCH_RUN_ATTEMPT=1

node scripts/spot-paper-pilot/cli.mjs \
--mode report --data-root "$INPUT/data" --run-id "$RUN_ID" \
> "$OUT/readback.stdout.json"
node scripts/spot-paper-pilot/paper-evidence-assessment.mjs \
"$INPUT/paper.stdout.json" "$OUT/readback.stdout.json" \
"$PAPER_EXIT_STATUS" "$INPUT/pilot-manifest.json" \
"$INPUT/data/$RUN_ID" "$OUT/assessment.json" BTC_EUR_PAPER_4H_V1
node scripts/spot-paper-pilot/signal-replay.mjs \
"$OUT/readback.stdout.json" "$INPUT/pilot-manifest.json" \
"$INPUT/data/$RUN_ID" "$OUT/signal-replay.json" BTC_EUR_PAPER_4H_V1
```

Create the independently verified dispatch JSON in that output directory, then
use the existing `create-dto.mjs` command above with these four-hour inputs.
Require assessment `COMPLETED`, replay `PASS`, matching terminal readback and
bound checks. A terminal cycle-limited run can have partial duration; full
duration must be classified consistently. Neither status asserts profitability.
Freeze and independently approve the DTO and its canonical SHA-256 transfer
digest before any import.

For a **separately approved** gateway deployment, apply/review the forward
migration and set the server-only `MERIDIAN_SPOT_PAPER_REPORT_RUN_ID` to the exact
report ID `spot-paper-42404743386-1`. The setting controls both upload and GET;
absence selects the first-hour run, while empty, numeric-only, unknown or
mixed-attempt values fail configuration. The existing three gates and distinct
upload/read token policies are still required. A selected run with no imported
row returns 404, never another run. There is no URL/query selector, automatic
newest-run preference, polling or runtime control.

Import only the independently approved DTO, wrapped as
`{"schema":"BTC_EUR_SPOT_PAPER_REPORT_TRANSFER_V1","runId":"spot-paper-42404743386-1","report":<approved DTO>}`,
serialized as canonical JSON (recursively sorted object keys, no whitespace).
Use the existing fixed upload route through the separately reviewed secret
channel. Verify the receipt digest, authenticated GET identity and exact DTO;
identical imports are idempotent and conflicting content returns 409.
Confirm the first-hour row and digest are unchanged; switching explicitly back
to `spot-paper-42395522899-1` reads that retained row.

The manual-refresh UI labels the approved duration and preserves exact run
details in the collapsed verification panel. Its `B16-M11-FIX13` module cache
identity must be served coherently. Credentials, flags, migration execution,
report import and the actual server switch are **outside this PR**, as are all
worker/runtime changes and real trading.

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
node --test test/spot-paper-report-bridge.test.js \
  test/spot-paper-report-gateway.test.js test/spot-paper-report-connector.test.js \
  test/v11-spot-paper-cockpit.test.js test/v11-spot-paper-cockpit-chrome.test.js \
  test/v11-module-cache-identity.test.js test/v11-terminal-entry.test.js
```

Tests create reports from generated fixtures and exercise the real report
projector and cockpit model. They make no provider, host, network, or live worker
calls.
