# BTC/EUR CONFIRM2 versus five-minute trend next-run preparation

This is preparation only. It does not launch a host, acquire public data, deploy
an image, authorize orders, or alter the stopped eight-hour journal.

## Frozen composition

The prepared model-pair identity is
`BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1`:

| Arm | Model identity | Account |
| --- | --- | --- |
| Baseline | `BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1` | Independent EUR 1,000 account |
| Challenger | `BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1` | Independent EUR 1,000 account |
| Control | `CASH_CONTROL_V1` | Independent EUR 1,000 cash account |

Both trading arms use the existing paired runner, journal, feed parser, fee-aware
EUR ledger, stops, exposure/loss limits, and shared Kraken observations. Only
the entry decision differs: CONFIRM2/COOLDOWN10 versus the causal closed-five-
minute trend filter. Exits and risk effects are not filtered.

The explicit account contract is
`BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2` (version 2): 20 bps taker-fee assumption and
10 bps adverse slippage per side. The fee basis is an assumption, not a verified
Kraken rate; the account tier remains unknown. Starting cash, maximum entry,
sampled 2% stop, EUR 20 session-loss limit, and the eight-hour/480-cycle/960-
request limits remain unchanged. V1/50-bps evidence and fixed model identifiers
are not relabelled.

The config digest binds the three model identities, account IDs, V2 fee
contract, and bounded run settings. The new research-source digest includes the
comparison, CONFIRM2, and five-minute-trend source bytes under their repository
paths; it does not replace the historical two-source pin.

## Synthetic verification

Run the end-to-end shared-runner fixture without network access:

```sh
node --test test/spot-paper-paired-next-run-composition.test.js
```

The test uses the real paired runtime and 20-bps fee ledger with deterministic
provider receipts. Its injected trend-export fixture validates adapter wiring
and replay reconciliation; it is not a substitute for re-running the test
against the actual five-minute research exports after #1311 merges. It covers
different entry outcomes on identical market inputs, fees/slippage, stop and
exit handling, common-horizon replay, interruption, and stale-quote rejection.

The existing paired report and offline evaluator support the V2 fee assumptions
and three-arm identity fields. However, the production host and evidence
evaluator do not yet bind this new model-pair source to the trend exports.

## Host and image handoff status

**Do not run the host for this model pair yet.** The current host accepts an
explicit `--account-contract` but composes the existing SMA baseline and
CONFIRM2 challenger. Invoking its current command with the V2 contract would
therefore run the wrong pair:

```text
run --data-root /evidence-root --run-id <new-run-id> \
  --account-contract BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2
```

The current `Dockerfile.spot-paper-paired` also does not include
`next-run-composition.mjs` or the unmerged five-minute trend module. No image
build, registry push, job creation, deployment, or live-feed run is an approved
handoff from this preparation.

After #1311 merges, the remaining code handoff is to bind its exact exports and
source digest in the live host and offline replay/evaluator, expose a host
selection that requires both the V2 account contract and the exact model-pair
ID, include the required modules in the paired image, and add an actual-export
integration test. Only then should the final run command and manifest be
published. The final host command must preserve the existing one-shot bounds,
new-volume isolation, and no-retry/no-resume policy in
`/home/runner/work/meridian/meridian/docs/operations/BTC_EUR_PAIRED_LAUNCH.md`.

The trend's fixed 24-hour activity diagnostic must remain
`PARTIAL_COVERAGE` for this unchanged eight-hour operational window. Do not
extend the deadline or force trades to meet the activity threshold. Remaining
host-only prerequisites include final-head CI, immutable image build and digest,
approved registry/project/job/volume identifiers, writable unprivileged volume
verification, and Lead's final host acceptance. No host acceptance or launch
readiness is claimed here.
