# Paired BTC/EUR paper comparison panel

The v11 panel is intentionally mountable and does not change the v11 entrypoint,
authentication flow, network routes, or trading controls. It renders three
virtual arms—Baseline, `CONFIRM2_COOLDOWN10`, and Cash—with EUR 1,000 per arm
(EUR 3,000 virtual total). These amounts are not account balances; the panel
does not read actual holdings.

## Integration seam

Import `mountSpotPaperPairedPanel` from
`/home/runner/work/meridian/meridian/v11/spot-paper-paired-controller.js` and
pass the existing container plus an explicitly supplied DTO and projector:

```js
import {mountSpotPaperPairedPanel} from './spot-paper-paired-controller.js';

const panel = mountSpotPaperPairedPanel(container, {
  dto: sanitizedReport,
  projectReport: sharedPairedReportProjector,
  document
});
```

`projectReport(dto)` is the seam for the shared validation/projection export
owned by issue #1302. Its result is a presentation projection, not an
alternative report schema: it supplies `status`, `identity.runId`,
`observedAt`, `feed`, `freshness`, `coverage.actualDurationMs`, role-keyed
`arms`, and `comparison`. The feed projection must explicitly confirm the
shared BTC/EUR source and no-leverage mode. Each arm supplies its own `runId`,
metric value/reason pairs, and `positionStatus`, keeping the old baseline run
distinct from challenger and cash evidence; `comparison` supplies an explicit
`valid` flag, the shared `horizonKey`, and precomputed net-PnL deltas. The
panel does not infer a report identity, valuation, comparison horizon, or
delta.

As of this preparation, the #1302 branch has only its initial-plan commit and
does not yet publish its DTO or validation exports. Therefore actual DTO
integration is pending; the focused tests use only an explicitly marked
synthetic fixture and an injected projection function. The `test.todo` in
`test/v11-spot-paper-paired-panel.test.js` must be replaced with a test against
the actual #1302 exports before integration is accepted. No production demo or
fallback report is provided.

## Display and evidence boundaries

The panel preserves `RUNNING`, `INTERRUPTED`, `VERIFIED_COMPLETE`, and
`UNKNOWN`; displays the observed data time, freshness, actual coverage against
the requested eight hours, and all three arm summaries; and only shows
challenger/cash deltas when the shared projector explicitly validates a
matching horizon for every arm. Missing or invalid metrics remain
“Unbekannt” with a reason when supplied. Negative PnL uses a minus sign, loss
text, and the danger tone; positive PnL uses a plus sign, gain text, and the
safe tone. No winner or profitability badge is rendered.

Fees and slippage are modeled costs, not an exchange statement. An eight-hour
sample and sampled drawdown are limited evidence, not a claim about future
performance. The UI has no fetch, polling, start, stop, or trading action.
The host supplies the DTO and projector; neither is fetched or fabricated by
this panel.

Run the focused presentation tests with:

```sh
node --test test/v11-spot-paper-paired-panel.test.js
```

The mobile browser test records screenshots to
`V11_SPOT_PAPER_PAIRED_EVIDENCE_DIR`, `V11_PAPER_COCKPIT_EVIDENCE_DIR`, or
`V11_A2_EVIDENCE_DIR` when one of those variables is set. Synthetic fixtures
are shown only when the caller explicitly requests `preview: true`; loading
state is likewise host-driven and does not imply a run is active.
