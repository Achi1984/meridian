# BTC/EUR host eight-hour status panel

## Scope

`v11/spot-paper-host8h-model.js` and `v11/spot-paper-host8h-view.js` define a
separate presentation contract for host8h reports. The panel is mounted in the
V11 Strategies workspace and reads only through
`v11/spot-paper-host8h-controller.js`, which uses the existing authenticated
Dashboard read token. It does not connect to the host or access a host volume.
The host8h report gateway, table, and upload admission are separate from the
legacy spot-paper terminal DTO, connector, private endpoint, and admission
rules.

The offline preview accepts a caller-injected `readSnapshot` function. It has
no default fixture or current-run data; without the function, it renders an
offline/unavailable state. Inputs must use
`SPOT_PAPER_HOST8H_PANEL_INPUT_V1` and fit within 256 KiB. They include the
observed timestamp, source label, pinned run/profile/source identity, a host
inspection snapshot, and optionally an offline assessment.

## Status and evidence

The presentation keeps `RUNNING_OBSERVED`, `VERIFIED_TERMINAL`,
`INCOMPLETE_UNKNOWN`, failed assessment, unavailable, stale, and out-of-order
states distinct. A running process observation is not a terminal report or
health check. A terminal display requires the host snapshot's
`verifiedTerminal: true`; summary metrics additionally require a matching
`SPOT_PAPER_HOST_OFFLINE_ASSESSMENT_V1` whose nested assessment confirms the
run, profile, source fingerprint, and `terminalVerified: true`.

Completed metrics require a matching terminal assessment with bounded
termination. While a checked journal checkpoint is running, available metrics
are explicitly provisional. Partial duration and coverage remain partial;
absent values remain unknown, not zero. The exporter reports cash, equity,
realized/unrealized/total PnL, fill and close counts, open BTC inventory, booked
modeled fees, and separately estimated exit fee and slippage. EUR amounts use
integer cents and inventory is labeled in satoshis. Cost assumptions use the
pilot's modeled 50 bps fee and 10 bps slippage per side; these are not verified
exchange rates and estimated exit costs are not subtracted from PnL a second
time. The USD challenge is shown as `NOT_STARTED`; EUR values are never
relabelled as USD. PnL uses the existing muted/red/green tone convention.

The authenticated response is bounded and contains a summary only; raw journal
rows and credentials are not exposed to the browser. Refresh is triggered when
the Strategies view opens or by an explicit refresh, with a five-second timeout
and bounded error backoff. Freshness and transport errors are visible. The
backend stores only the latest host8h envelope in its dedicated table and
rejects out-of-order timestamps or journal sequences. None of these controls
authenticate the host's claims: provenance is bound to the pinned run, profile,
source fingerprint, pair, model, and EUR identity, while terminal verification
still comes from the existing offline assessment.

The existing one-hour and four-hour gateway identifiers and their admission
rules are unchanged.

## Next wiring boundary

The code path is deliberately fail-closed until Lead provisions and reviews:

1. Apply `migrations/20261108_meridian_spot_paper_host8h_reports.sql` to create
   the dedicated, access-restricted report table.
2. Configure `MERIDIAN_SPOT_PAPER_HOST8H_REPORT_ENABLED`,
   `MERIDIAN_SPOT_PAPER_HOST8H_REPORT_DEPLOYMENT_VERIFIED`, and
   `MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_APPROVED` to `true`, and provision
   `MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_TOKEN_SHA256` plus the existing
   Dashboard read-token hash in the Meridian gateway environment. Keep the
   corresponding upload token in the separately authorized host-side secret
   store; it must never be sent to the browser.
3. Provision a reviewed, read-only host-volume publisher that calls
   `exportSpotPaperHost8hSummary` with the authorized evidence directory and
   assessment host context, then posts only the bounded
   `BTC_EUR_SPOT_PAPER_HOST8H_REPORT_TRANSFER_V1` envelope to
   `/api/private/spot-paper-host8h-report/upload` using the dedicated upload
   token.
4. Deploy the reviewed gateway and Dashboard changes, then verify the
   authenticated read route and visible freshness/error handling before
   considering the panel live.

None of these provisioning or deployment steps was performed for this change.
No host volume or current-run data was accessed. Until the migration, explicit
gateway admission, and host-side summary publisher are provisioned, the UI
reports the missing transport/summary instead of fixture data. The host8h path
does not expand the approved one-hour or four-hour gateway IDs and does not
affect pilot execution or post-run assessment.

## Focused offline verification

```sh
node --test test/spot-paper-host8h.test.js test/spot-paper-host8h-integration.test.js
```

Tests use injected in-memory fixtures only; they do not call the host, a
provider, a deployed private endpoint, or a gateway.
