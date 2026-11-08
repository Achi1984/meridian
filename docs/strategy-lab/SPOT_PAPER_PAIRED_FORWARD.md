# BTC/EUR paired shared-feed forward adapter

**Status: integration blocked; no launch or readiness claim.** This change
provides a bounded feed/lifecycle boundary and offline contract tests only.
PR #1299 remains a draft and its exports are not in this checkout. Its current
draft head exposes `createEntryConfirmationState`,
`advanceEntryConfirmation`, `recordEntryConfirmationSell`, and
`compareSpotPaperStrategies`; this adapter binds those exact exports through an
explicit host-supplied export object. Do not substitute a simulator, mock
adapter, or other comparison engine for the accepted exports. The test-only
adapters exercise ordering and safety boundaries; they are not a strategy
integration, evidence, or technical acceptance.

## Frozen experiment contract

The eventual comparison is three independent EUR 1,000 accounts on the same
BTC/EUR observations:

| Arm | Frozen model | Account treatment |
| --- | --- | --- |
| Baseline | `BTC_EUR_SMA5_SMA20_V1` | Existing SMA(5/20) parser, ledger and risk calculations |
| Challenger | `BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1` | Must bind the accepted #1299 exports; no implementation is copied here |
| Control | `CASH_CONTROL_V1` | EUR 1,000 cash, no strategy decisions, exposure, or fills |

The per-arm account contract is EUR 1,000 initial cash, at most EUR 100 entry,
no leverage or short positions, existing sampled 2% stop, and EUR 20 loss
limit. The common modeled costs remain 50 bp fee and 10 bp adverse slippage per
side. These cost values are assumptions, not verified Kraken rates. The adapter
does not tune, validate, or change them.

The hard run limits are eight hours, 480 cycles, 960 total public requests
across the entire run (including warmup), 64 MiB total response bytes, 256 KiB
per response, five-second request timeouts, 10-second ticker freshness,
120-second closed-candle freshness, and at least 60 seconds between cycle
starts. Each cycle gets one OHLC response and one shared ticker response,
regardless of the number of arms. Decision callbacks for all three arms finish
before the ticker request begins. The existing Kraken parsers and baseline
strategy preserve closed-candle, startup/warmup, backfill, and no-catch-up
semantics.

## Adapter boundary and current blocker

`scripts/spot-paper-paired/forward.mjs` reuses
`scripts/spot-paper-pilot/core.mjs` for Kraken response parsing and the
unchanged baseline ledger/risk calculation, and
`scripts/spot-paper-pilot/journal.mjs` for exclusive run creation, checksummed
response persistence, and durable event publication.
`scripts/spot-paper-paired/feed.mjs` wraps the existing fixed public Kraken
provider for `XBTEUR`; the runner rejects providers without its source identity.
Constructing the provider is inert; network requests begin only when the live
runner is invoked after source-pin validation. The adapter exposes the baseline
and cash-control arms and the challenger export binder; it does not provide a
challenger implementation.

The live entrypoint reads and hashes the two #1299 source files, checks them
against the accepted source pin, then imports the exact challenger exports and
comparison function from those paths. It builds the challenger arm from
`createEntryConfirmationState`, `advanceEntryConfirmation`, and
`recordEntryConfirmationSell`, and binds `compareSpotPaperStrategies` under
`SPOT_PAPER_SMA_COMPARISON_V1`. That arm reuses the existing baseline ledger
for fills, fees, and risk. The comparison replay receives the raw, persisted
shared-observation inputs; it is not replaced by a new comparison engine.
The live entrypoint creates only the fixed public Kraken provider after the
source pin passes; caller-supplied providers, strategies, and comparison
engines are rejected or ignored. Until the accepted #1299 source is present and
bound by the pinned digest, integration is blocked. There is no CLI, deployment
configuration, or launch entrypoint. A test double is not an allowed substitute
for any missing export.

The live `runSpotPaperPaired` entrypoint is additionally fail-closed while
`SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256` is `null`; it requires the
exact accepted research-source digest before it can create an evidence path or
request data. The separate `runSpotPaperPairedSynthetic` path accepts only the
`SYNTHETIC_TEST_ONLY` feed identity and labels its report `testOnly`. It cannot
be used as a live-feed substitute or evidence of integration.

After #1299 is accepted and present at its exact reviewed commit, calculate the
source pin from the two research exports with this deterministic command (run
from that checkout; path names are included in the hash):

```sh
node --input-type=module -e '
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const paths = ["scripts/spot-paper-research/comparison.mjs", "scripts/spot-paper-research/entry-confirmation.mjs"].sort();
const hash = createHash("sha256");
for (const path of paths) {
  hash.update(path); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0");
}
console.log(hash.digest("hex"));
'
```

Only the lead-reviewed digest from the accepted commit may replace the current
`null` source pin. Do not copy a digest from the current draft head.

For every accepted observation the journal records one causally ordered shared
OHLC/ticker pair and separate arm decisions, fills, risk states and valuations.
An arm-specific stop latches trading off for that arm but continues preserving
its account state without invoking later decision or effect callbacks. The original
stop reason and effect timestamp remain attached to that account; later quotes
cannot trigger a sell or other fill. There is no separate mark-only API in the
reused ledger, so a stopped open position is not advanced to later marks. It does
not fabricate a liquidation. A common-horizon value is available only when that
position has a valid mark at the shared horizon; otherwise remaining marked
equity and the comparison result are unknown, not compared against a stale mark.
Terminal summaries and the replay use the final shared observation's `effectAt`
as their stated horizon; the report separately records whether that quote was
still fresh when terminal persistence began.
Reports carry costs, net/marked
equity, sampled drawdown from starting capital, exposure, turnover, open
positions, unresolved observations, and the shared-horizon status. The cash
control is not evidence of alpha; fewer challenger trades alone do not show
improvement.

Each persisted shared observation and replay input now carries distinct
`decisionAt` and `effectAt` timestamps; the legacy replay `at` remains the
effect-time alias for source compatibility. Decisions are made before the ticker
request, while fills and risk effects occur only after its causal quote. The
currently inspected #1299 draft comparison consumes `observation.at` for both
decision and effect processing, so it does not yet honor this distinction. The
adapter keeps the accepted research-source pin `null`; it must not be bound until
the accepted engine supports the explicit timestamp contract and the actual-export
cooldown/parity test passes. An available replay is also reconciled against the
forward fills, costs, account balances/equity, stop state, and remaining inventory;
any mismatch makes the comparison unavailable rather than publishing an unrelated
replay as the executed ledger.

Any invalid/stale/future/pre-decision quote or shared-feed error stops the
paired run. Ambiguous journal writes are terminal unknown and must not be
retried, resumed, or overwritten. A caller/operator stop is recorded as
interrupted, never as a completed eight-hour run. There is no auto-promotion,
authenticated provider, order, wallet, or real-execution path.

The future host must map `SIGTERM` to the runner's supplied `AbortSignal`, allow
its separate five-second terminal-journal grace to finish, and retain the
interrupted report. No signal-handling host entrypoint is included here.

For a future approved run, the retrieval sequence is: independently confirm
the writer is stopped; inspect status/report read-only; preserve the complete
new run directory, including incomplete or corrupt files; package the directory
and manifest with bounded byte-preserving tooling; retrieve both files using the
separately approved host's native download path; verify archive and member
hashes; then perform an offline assessment against independently reviewed
source/config/evidence identities. Never repair, delete, resume, or overwrite
ambiguous evidence. The paired host's concrete status/package command remains
part of the documented host-composition work; do not apply the old runbook's
fixed run/image/volume identifiers to a paired run.

## Offline validation command

Run the focused synthetic acceptance suite from the repository root:

```sh
node --test test/spot-paper-paired-forward.test.js
```

The tests inject an in-memory provider and synthetic account/comparison
callbacks. They make no network or order calls and establish only feed/lifecycle
contract behavior. They do not prove #1299 integration or launch readiness.
An actual-export integration test is enabled only when both #1299 source files
are present and their digest is explicitly pinned. It checks the cooldown
decision/effect boundary, runs the actual comparison on a provider-shaped
snapshot longer than 21 candles, and requires the replay to reconcile with the
forward ledger. The test is skipped in this checkout because those sources are
absent and the accepted source pin is null. The inspected draft currently
rejects such a snapshot and reads one timestamp for both decision and effect;
full multi-cycle cooldown decision/fill/equity parity remains blocked on the
accepted #1299 engine supporting both timestamps.

## Lead review identity and future host work

There is deliberately no command to launch the paired experiment in this
change. After #1299 is accepted, lead review must bind all of the following
before any separate operating approval:

| Identity | Required review value |
| --- | --- |
| Source | Exact reviewed commit and SHA-256 identity of the packaged adapter, baseline, accepted challenger and comparison sources |
| Image | Immutable image digest built from that exact reviewed source; not a moving tag |
| Research pin | Exact accepted #1299 research-source SHA-256 pinned in `SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256` |
| Configuration | SHA-256 of the frozen three-arm BTC/EUR configuration, feed source, bounds, account IDs, research pin, and explicit cost assumptions |
| Evidence | A fresh run ID and previously nonexistent evidence path; the journal manifest binds source/config hashes, models, accounts, run limits, and comparison-engine ID |
| Model/export binding | Accepted #1299 challenger model and comparison-engine exports, including their reviewed source identities |

No values for the future image, accepted #1299 source, frozen paired
configuration, or evidence run are assigned here. Do not reuse
`btc-eur-paper-host-8h-001`, its image, its evidence directory, or its volume.
That stopped run and its existing evidence remain untouched; its captured
snapshot is development evidence, not untouched validation.

The remaining minimal work is to bind the accepted #1299 export API in a
disabled composition entrypoint confined to `scripts/spot-paper-paired/`; map
SIGTERM to an `AbortSignal` and allow the bounded journal shutdown; define the
host-specific read-only status/report and byte-preserving retrieval commands;
then review the exact source/config/image/evidence identity and independently
approve any future host and egress arrangement. No deployment change or launch
command is part of this adapter. The exact focused validation command is
`node --test test/spot-paper-paired-forward.test.js`; the exact future host
command cannot be fixed until the host composition and retrieval mechanism are
selected and reviewed. For a future approved run, retain the entire new evidence
tree and use a separately reviewed, read-only status/report, byte-preserving
packaging, authenticated retrieval, hash verification, and offline assessment
sequence.
The existing
[BTC/EUR post-run retrieval runbook](../operations/BTC_EUR_8H_POSTRUN_20261108.md)
describes that sequence for the old run identity only; it is not approval or
identity for a new paired run. If a future run is interrupted or evidence is
ambiguous, preserve it and report the incomplete/unknown outcome rather than
restarting.
