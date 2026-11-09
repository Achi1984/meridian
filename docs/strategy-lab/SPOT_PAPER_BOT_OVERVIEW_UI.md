# Mountable paper-bot overview

The v11 overview is an isolated, read-only UI component for three distinct
prospective paper-bot identities: a BTC/EUR trend candidate, a separate BTC/USD
Lives challenge, and LowVol V2. It does not replace the paired-paper comparison:
Baseline, challenger, and cash remain arms within a single BTC/EUR run, not
independent bots. No entrypoint, network route, authentication flow, runtime,
deployment, or trading control is changed.

## Mount seam

Import `/home/runner/work/meridian/meridian/v11/spot-paper-bot-overview-controller.js`
from a host and inject one sanitized report and its explicit projector per bot:

```js
import {mountSpotPaperBotOverview} from './spot-paper-bot-overview-controller.js';

const overview = mountSpotPaperBotOverview(container, {
  adapters: [
    {id: 'btc-eur-trend', report: sanitizedTrendReport, project: projectTrendReport},
    {id: 'btc-usd-lives', report: sanitizedLivesReport, project: projectLivesReport}
  ],
  document
});

overview.update(nextAdapters);
overview.dispose();
```

Adapter IDs are `btc-eur-trend`, `btc-usd-lives`, and `lowvol-v2`. Each projector
must map its owning source's already-sanitized report to the view model's
per-bot fields; the component does not guess schemas, retrieve reports, or
provide a production fixture. A missing adapter leaves a bot unknown, except
LowVol V2, which is explicitly shown as “In Vorbereitung” with no runtime
metrics. That prepared placeholder is not a running state. The view imports no
backend or network module, and a host may update or dispose it without adding
controls.

## Adapter presentation fields

Projectors may return `state` (`PREPARED`, `RUNNING`, `PAUSED`, `COMPLETED`, or
`UNKNOWN`), `runtimeEvidence: 'VALIDATED'` for any runtime state, strategy and
version labels, exact market and quote currency, and the reported metrics:
`capital`, `netPnl`, `equity`, `realizedPnl`, `unrealizedPnl`, `fees`,
`slippage`, and `funding` as `{amount, currency}`. `netPnlPercent` is shown only
with `{value, basis: 'INITIAL_CAPITAL'}`. The projector also supplies
`roundTrips`, `timeInvestedMs`, `lastTradeAt`, `freshness` (`status`, `at`,
`ageMs`, `reason`), and the applicable `pauseReason` or `noTradeReason`.
Trade details are an optional bounded `trades` array of timestamp, side,
quantity, currency-tagged price and amount, and an optional reason. All strings
are inserted as text, not markup.

Only `EUR` and `USD` are currently accepted. BTC/EUR and BTC/USD identity and
currency must match their respective overview cards. A mismatch fails closed
for that bot. Missing or invalid values remain “Unbekannt” with a reason.
Stale or unknown freshness suppresses financial and trade details; the component
does not calculate freshness from the machine clock.

The Lives card shows net-equity high-water drawdown and remaining USD 100 loss
allowance only when its projector sets `risk.status: 'VALIDATED'`, confirms a
USD 100 limit, and supplies nonnegative values in USD. Otherwise both remain
unknown. The UI does not calculate either risk value.

Normalized curves are omitted unless all three projectors provide an
`INITIAL_CAPITAL_INDEX_100` basis, identical explicit coverage bounds, and the
same validated timestamps for every point. No aggregate EUR/USD amount or
cross-horizon ranking is presented.

## Status and integration boundary

Runtime states are rendered only from the injected projector. Missing or
invalid adapter evidence is “Unbekannt”; LowVol V2 remains “In Vorbereitung”
until a source adapter has genuine validated runtime evidence. At present this
is a mountable UI preparation only: no production adapters, v11 integration,
runtime behavior, or deployment are claimed.

Run the focused model and mobile-render tests with:

```sh
node --test test/v11-spot-paper-bot-overview.test.js
```

The mobile test writes visibly synthetic preview screenshots to
`V11_SPOT_PAPER_BOT_OVERVIEW_EVIDENCE_DIR`, or to the default temporary
`meridian-spot-paper-bot-overview-evidence` directory.
