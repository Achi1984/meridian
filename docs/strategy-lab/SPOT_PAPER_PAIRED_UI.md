# Paired BTC/EUR paper comparison panel

The v11 panel is intentionally mountable and does not change the v11 entrypoint,
authentication flow, network routes, or trading controls. It renders three
virtual arms—Baseline, `CONFIRM2_COOLDOWN10`, and Cash—with EUR 1,000 per arm
(EUR 3,000 virtual total). These amounts are not account balances; the panel
does not read actual holdings.

## Integration seam

Import `mountSpotPaperPairedPanel` from
`/home/runner/work/meridian/meridian/v11/spot-paper-paired-controller.js` and
pass the existing container plus a sanitized shared dashboard DTO:

```js
import {mountSpotPaperPairedPanel} from './spot-paper-paired-controller.js';

const panel = mountSpotPaperPairedPanel(container, {
  dto: pairedDashboardDto,
  document
});
```

The panel imports and invokes `projectSpotPaperPairedDashboard` itself. It does
not define a parallel DTO or accept an alternate projector. For a host-managed
loading transition, call `panel.setLoading(true|false)`; pass new DTO data with
`panel.render(nextDto)`.

The canonical DTO uses `evidenceStatus`, `evidenceQualification`, `timing`,
`identity`, `assumptions`, `arms`, and direction-labelled `deltas`. Its
verified-complete status means structural reconciliation only, not independent
authentication. Run-stop and valuation timestamps are kept distinct and
rendered in the `Europe/Vienna` time zone. Freshness is explicitly “Unbekannt”:
the shared DTO has no freshness timestamp/policy. The UI does not synthesize a
freshness or live-health claim.

The model, controller, tests, and browser preview all use the shared
`projectSpotPaperPairedDashboard` export. Tests exercise a visibly synthetic
payload accepted by that real projector, including the canonical statuses,
reasons, run timings, arm metrics, and signed/unavailable deltas. No
production demo or fallback report is provided.
The actual shared contract from #1304 is present on the base branch. The
integration test imports the owner's export directly and intentionally fails
to load if that dependency is absent; it does not skip or recreate the contract.

## Display and evidence boundaries

The panel preserves `VERIFIED_COMPLETE`, `INTERRUPTED`, `RUNNING_SNAPSHOT`, and
`CORRUPT_UNKNOWN`; displays observed coverage against the requested eight
hours, run-stopped time separately from valuation time, and all three arm
summaries; and shows deltas only when the shared evaluator marks them
`AVAILABLE`. Delta direction follows the canonical names:
challenger-minus-baseline, baseline-minus-cash, and challenger-minus-cash.
Missing or invalid metrics remain “Unbekannt” with the shared reason code.
Negative PnL uses a minus sign, loss text, and the danger tone; positive PnL
uses a plus sign, gain text, and the safe tone. No winner or profitability
badge is rendered.

Fees and slippage are modeled costs, not an exchange statement. An eight-hour
sample and sampled drawdown are limited evidence, not a claim about future
performance. Leverage is not represented by the sanitized dashboard DTO and
is therefore shown as unknown. The UI has no fetch, polling, start, stop, or
trading action. The host supplies the DTO; it is not fetched or fabricated by
this panel.

Run the focused shared-DTO presentation tests with:

```sh
node --test test/v11-spot-paper-paired-panel.test.js
```

The mobile browser test records screenshots to
`V11_SPOT_PAPER_PAIRED_EVIDENCE_DIR`, `V11_PAPER_COCKPIT_EVIDENCE_DIR`, or
`V11_A2_EVIDENCE_DIR` when one of those variables is set. Synthetic fixtures
are visibly labelled from `syntheticFixture: true`; loading state is
host-driven and does not imply a run is active.
