# Generated Arena campaign

`runGeneratedArenaCampaign({experimentId, fixtureId, outDir})` composes the existing
`runArenaBundle` and Arena engine into one manually invoked engineering cycle.
The only fixture ID is `eight-symbol-daily-240-v1`. Its eight symbols, 240 UTC daily
rows, observation time and USDT denomination are generated deterministically in
`test/fixtures/arena-generated-campaign.mjs`. No caller candles, collection flags,
engine injection, financial thresholds or additional options are accepted.

The driver creates a new output directory atomically. It writes generated input
and a proposal receipt before invoking the existing runner. The proposal freezes
the input, fixture, driver, runner, engine and protocol SHA-256 identities, four
cells (H1-B/H1-E/H7-B/H7-R), blocked H9, 8/16 basis-point cost views, and buy-and-hold
and cash controls. Existing runner receipts remain separate and are linked from
the completion receipt. The whole existing bundle is retained; no result is ranked,
discarded, promoted or recomputed by another reducer. Four cells and overlapping
cost views are not independent confirmations. USDT is not USD or EUR.

Receipts are write-once through this API, not OS-immutable or authenticated.
The driver checks input and engine/protocol identity agreement and reads back the
proposal and bundle before acknowledging completion. It assumes a trusted local
source tree and exclusive output ownership; it does not defeat a concurrent hostile
filesystem writer, authenticate code loaded by Node, or provide crash/power-loss
durability. A failed or partially written directory is retained and cannot be
reused. There is no retry, cleanup, resume or automatic reconciliation.

Limits: one bundle, eight symbols, 240 rows each, at most 1 MiB generated input and
8 MiB bundle. The input bound precedes evaluation. The bundle bound is checked
after the existing runner writes it, so it is an acknowledgement bound, not a disk
quota. Tests impose 20-second child-process deadlines and bounded captured output;
this synchronous engine driver adds no production wall-time/CPU/memory sandbox.
Every invocation has zero provider/model calls. A separate fresh directory allows
another synthetic demonstration; no global trial ledger or budget is implied.

All receipts say ENGINEERING_ONLY, historicalRemainingBudget UNKNOWN, and false
execution/promotion/Paper/live readiness. Existing result evidence and undefined
profit-factor values are preserved. This is not autonomous hypothesis generation,
optimization, genuine market performance, a fresh Holdout or a running Paper bot.
Historical trial reconciliation, payoff policy, source/exposure history, prospective
selection rules and actual bounded runtime authority remain separate work.

Validation: `node --test test/arena-generated-campaign.test.js`. Tests exercise the
real engine, complete bundle identities, pre-evaluation proposal sealing, changed
fixture identities/results, rejected external options, no overwrite, fixed input
byte-limit failure and retained engine failure. Modified source copies exist only
in temporary test directories; production API exposes no injection seam.
