# M11 Paper cockpit

## Owned paths

This delivery owns read-only Paper cards and their focused verification:

- `v11/paper-cockpit-model.js` — injected report reader, DTO presentation adapter, and generated demo fixture.
- `v11/paper-cockpit-view.js` — accessible text-only cockpit rendering.
- `v11/spot-paper-cockpit-*` — separate BTC/EUR DTO, manual reader, and card.
- `scripts/spot-paper-report-bridge/contract.mjs` — versioned BTC/EUR display and transfer contracts.
- `spot-paper-report-gateway.mjs` — separate disabled-by-default authenticated route.
- `migrations/20261107_meridian_spot_paper_reports.sql` — isolated immutable report table.
- `v11/strategy-workspace-bootstrap.js` — mounts the panel at the top of the existing Strategies workspace.
- `test/v11-spot-paper-cockpit.test.js` and `test/spot-paper-report-*.test.js` — generated BTC/EUR contract, gateway, and cockpit tests.
- `test/v11-module-cache-identity.test.js` — served V11 module graph assertion.
- `docs/v11/M11_PAPER_COCKPIT.md` — scope and connection contract.

The cards use existing M11 Strategies navigation and add no dashboard route.
BTC/EUR has a separate gateway route and table; the memecoin validator is
unchanged. No worker, filesystem, report producer, workflow, or runtime-control
path is changed.

The reviewed Paper-bot overview and paired comparison are mounted separately
inside the same Strategies workspace. The overview's explicit manual read uses
the existing authenticated `/api/private/spot-paper-report` endpoint through
the existing BTC/EUR report connector. That endpoint's DTO is pinned to
`BTC_EUR_SMA5_SMA20_V1`; it is not evidence for the
`BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1` candidate, so the
new candidate remains `UNKNOWN` and no values are copied across identities.
USD Lives remains `UNKNOWN`, and LowVol V2 remains `PREPARED` in its native
USDT unit. The paired panel mounts against the shared paired DTO contract but
has no authenticated paired-report route or composed report source yet; its
status and all run/source/profile/fingerprint/host identities remain unknown.
It performs no paired fetch. Neither component is shown as a completed
production integration or deployment confirmation.

## Evidence shown

The adapter consumes the `MEMECOIN_PAPER_OPERATOR_REPORT_V1` DTO described by
the #1104 operator-report contract. It preserves unknown counts and exact
integer-cent strings. Candidate totals are shown with their coverage metadata;
truncation or unaccounted observations remain visibly partial. Rejection
reasons, stops, open-position rows, and unresolved fills are rendered only from
their report arrays. Empty arrays are distinct from omitted arrays.

`READ_ONLY_PAPER_CHECKPOINT_RECEIPTS` is shown as observation-only with the
contract's caller-label-not-authenticated caveat. A synthetic report is shown
as simulated fixture evidence, never as a production run. `FINISHED` and
`INCOMPLETE` are report lifecycle values; neither is a live-worker signal.
Operational liveness is always **NOT EVIDENCED** here. A non-terminal lock is
not proof that a worker is alive.

The operator report does not include trade-level rows, so the cockpit displays
only its evidenced paper-entry-fill count and says that trade detail is
unavailable. Missing fill counts and PnL remain unavailable, not zero. PnL
colors are applied only to known signed amounts. The panel separately reports
that a DTO is present and that its storage durability is not established by
this projection.

The source report provides observation timestamps but explicitly does not
recompute freshness against the wall clock. The UI therefore defaults to
freshness **UNKNOWN**. A caller may inject a display-only clock and
`staleAfterMs` policy to label an observation stale; that is not a producer
health check or operational freshness guarantee.

While the cockpit is selected, a successful report schedules one local,
one-shot display update at the strict stale boundary. It reclassifies the
retained report without reading the endpoint again, and is not polling. Replacing
or clearing the report and disposing the cockpit cancel or replace the timer.
Freshness-only revalidation updates the report in place, keeping the live-region
node, refresh control, and generated-demo disclosure mounted so focus and
disclosure state remain stable. Locking and navigation still clear private
report data.

## Connection status and contract

The memecoin connector uses the existing authenticated report route on explicit
manual refresh; its route implementation does not prove deployment or report
availability. The BTC/EUR card also makes only an explicit manual GET through
`appAccess`. It shows a completed report snapshot, not worker liveness, and its
generated preview explicitly says it is not connected live data.

The BTC/EUR endpoint is not available by default. It requires the separate
spot-report migration, deployment verification, an approved report transfer,
and explicit `MERIDIAN_SPOT_PAPER_REPORT_ENABLED`,
`MERIDIAN_SPOT_PAPER_REPORT_DEPLOYMENT_VERIFIED`, and
`MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_APPROVED` gates. The upload route requires a
dedicated upload token; the browser GET uses the existing read token. This
change does not configure or deploy any of these.

The repository includes the first-run reconciliation summary and separate
signal-replay JSON, but not the retained terminal readback, provenance, or paper
assessment payload. Therefore no verified terminal report DTO can be generated
from the checked-in material. Unknown or absent amounts remain UNKNOWN; the
fixture preview does not use or invent historical run values.

The spot adapter accepts only the versioned BTC/EUR schema and pins run,
source, workflow, and profile identity. It preserves exact cent strings and
keeps the original assessment's `signalReplay: NOT_PERFORMED` distinct from the
separate replay result. Neither reports profitability, strategy quality, or a
current running worker.

Connected balances and PnL are formatted from integer cents as exact German
EUR values; missing amounts remain `Unbekannt`. The visible financial summary
uses German labels and readable elapsed durations. Source/workflow identifiers
and verification enums remain in a collapsed technical-details disclosure.
When a valid report is displayed, the offline preview disclosure is hidden.

## Focused verification

```sh
node --test test/v11-paper-cockpit.test.js test/v11-spot-paper-cockpit.test.js test/spot-paper-report-bridge.test.js test/spot-paper-report-gateway.test.js test/v11-module-cache-identity.test.js
```

The tests use only generated report-shaped objects. They do not access a
provider, worker, checkpoint store, filesystem data source, network, or browser
runtime.
