# M11 Paper cockpit connection

The cockpit uses the existing `appAccess` session and the fixed authenticated
`GET /api/private/paper-report` route. Its origin is the approved gateway
origin already used by M11 reads. It sends the session bearer only in the
existing `Authorization` header; there is no Paper password field, credential
storage, run selector, path selector, polling, or read on unlock/navigation.
The only read affordance is the explicit **Paper report manuell laden /
aktualisieren** button.

The frontend accepts the existing bounded Paper report envelope through
`createPaperReportConnector()` and presents its DTO with the existing cockpit
model and view. Missing or disabled reports remain unavailable. Authentication
required, loading, rejected, stale, partial, terminal-report, and unknown states
remain explicit. A terminal report describes the report's lifecycle only; it
does not establish that a worker is currently running. Exact integer-cent
strings and unknown values are preserved. The generated demo remains in its
separate, visibly synthetic disclosure.

One injected display-only freshness policy is shared by the bridge and cockpit
model. Its default stale threshold is five minutes; it does not change source
evidence or assert operational health. Lock, session expiry, navigation away,
pagehide, and disposal clear the private report view and abort the current read.
If an aborted transport does not settle, its connector remains reserved and a
new connector is not created until that source settles.
After a back/forward-cache restore, a previously selected cockpit regains its
manual refresh affordance, but its report remains cleared; unlock and a new
explicit read are required.

## Deployment boundary

The frontend change does not implement, deploy, enable, or provision the
gateway route or report transfer. It does not claim that a report is present or
that live data was read. The separate backend/transfer review and an approved
transferred report are prerequisites for an available response.

## BTC/EUR spot-paper connection

The BTC/EUR card is a separate read-only contract and does not use or weaken the
memecoin report validator. It uses
`GET /api/private/spot-paper-report` and
`POST /api/private/spot-paper-report/upload`, with the existing read bearer for
GET, a distinct upload bearer for POST, a bounded canonical transfer envelope,
and isolated immutable storage. The fixed accepted run identity is
`spot-paper-42395522899-1`.

The spot route fails closed unless all of
`MERIDIAN_SPOT_PAPER_REPORT_ENABLED`,
`MERIDIAN_SPOT_PAPER_REPORT_DEPLOYMENT_VERIFIED`, and
`MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_APPROVED` are explicitly `true`. A separate
upload-token hash and the existing read-token configuration are also required.
The new table migration must be applied. No route deployment, env configuration,
secret, report transfer, or hosted verification was performed here.

The checked-in reconciliation and replay records do not contain the original
terminal readback, provenance, or paper assessment payload. The generated
preview is therefore disconnected and does not represent that run. Before any
transfer, retrieve those exact retained inputs through the approved operator
process, regenerate current assessment/replay fields with the offline tools
documented in `PAPER_REPORT_BRIDGE.md`, and provide the independently
root-verified first-hour Actions dispatch tuple to
`scripts/spot-paper-report-bridge/create-dto.mjs`. Review and approve the exact
generated DTO, transfer it once to the fixed upload route, and verify immutable
GET readback. Do not reconstruct missing fields from the reconciliation
document, hand-edit evidence, or treat signal replay as the original
assessment's signal-replay result.

After merging and publishing to Pages, verify that both imported bridge modules
are served with a JavaScript MIME type (for example `text/javascript` or
`application/javascript`), not `application/octet-stream`:

```sh
curl -sSI 'https://<published-pages-origin>/scripts/memecoin-paper-report-bridge/index.mjs?v=B16-M11-FIX12'
curl -sSI 'https://<published-pages-origin>/scripts/memecoin-paper-report-bridge/contract.mjs?v=B16-M11-FIX12'
```

Then open the published M11 page, unlock through the existing access gate,
navigate to Strategies, and confirm the native module graph loads without MIME
or CSP errors. Only the explicit Paper button should request the fixed report
route. The deployed Pages MIME check is **pending post-merge**; local browser
fixtures do not establish deployment behavior.

## Focused local acceptance

```sh
node --test test/v11-paper-cockpit-controller.test.js test/v11-paper-cockpit.test.js test/memecoin-paper-report-bridge.test.js
node --test test/v11-paper-cockpit-chrome.test.js test/v11-terminal-entry.test.js test/v11-module-cache-identity.test.js
```

These tests use generated report fixtures and local browser/gateway-response
mocks. They do not call the provider, hosted gateway, worker, or Pages.
