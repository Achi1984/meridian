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
paths; the accepted digest is
`dc7be719198ff3c936354c75352dfb782eaece65761b4fb47ba5d3fc0f756e25`. It does
not replace the historical two-source pin.

## Synthetic verification

Run the end-to-end shared-runner fixture without network access:

```sh
node --test test/spot-paper-paired-next-run-composition.test.js
```

The test uses the actual CONFIRM2 and merged five-minute trend exports, the real
paired runtime and 20-bps fee ledger, and deterministic provider receipts. It
covers divergent entry filtering on identical inputs, unfiltered exits and risk
stops, fee/slippage application, replay-to-runtime agreement, common-horizon
marking, interruption, stale/missing data rejection, and the complete 480-cycle
bound. The trend diagnostic remains `PARTIAL_COVERAGE` because its fixed
24-hour measurement window is longer than the eight-hour run limit.

## Host and image handoff status

The existing paired host now selects the new pair only when both the V2 account
contract and explicit model-pair ID are supplied. It pins the source bytes for
all three research modules; it does not change the fixed legacy V1 pair or the
historical two-source research pin. The host remains inert unless `run` is
explicitly selected.

```text
RUN_ID=${RUN_ID:?set a fresh, unique run ID}
docker build --file Dockerfile.spot-paper-paired \
  --tag "${IMAGE:?set the approved registry/image:immutable-tag}" .

node scripts/spot-paper-paired/host.mjs identity \
  --data-root /evidence-root --run-id "$RUN_ID" \
  --account-contract BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2 \
  --model-pair BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1 \
  > "/tmp/$RUN_ID.expected-identity.json"

node scripts/spot-paper-paired/host.mjs run \
  --data-root /evidence-root --run-id "$RUN_ID" \
  --account-contract BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2 \
  --model-pair BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1
node scripts/spot-paper-paired/host.mjs status \
  --data-root /evidence-root --run-id "$RUN_ID"
node scripts/spot-paper-paired/host.mjs export \
  --data-root /evidence-root --run-id "$RUN_ID" \
  > "/tmp/$RUN_ID.host-export.json"
node scripts/spot-paper-paired/fee-scenario.mjs \
  "/tmp/$RUN_ID.expected-identity.json" \
  "/tmp/$RUN_ID.host-export.json" /evidence-root
node scripts/spot-paper-paired-report/cli.mjs \
  "/tmp/$RUN_ID.expected-identity.json" \
  "/tmp/$RUN_ID.host-export.json"
```

The `identity` command emits the exact expected identity to retain with the
evidence; the host manifest binds the three selected model/account IDs, model
pair, 20/10-bps assumptions, and source/config hashes. Fee-scenario replay now
reconstructs the selected CONFIRM2 and trend strategies from journaled shared
observations and requires its 20-bps replay to match the original run. The report
evaluator then reconciles the host export against the expected identity. These
are preparation commands only: this change did not build/push an image, create a
job, access a live feed, or launch a host.

Lead retains image build/digest verification, approved registry/project/job/
volume identifiers, writable unprivileged volume verification, final host
acceptance, and any later launch decision. Any host run must preserve the
existing one-shot bounds, new-volume isolation, and no-retry/no-resume policy in
`/home/runner/work/meridian/meridian/docs/operations/BTC_EUR_PAIRED_LAUNCH.md`.

The trend's fixed 24-hour activity diagnostic must remain
`PARTIAL_COVERAGE` for this unchanged eight-hour operational window. Do not
extend the deadline or force trades to meet the activity threshold. Remaining
host-only prerequisites include final-head CI, immutable image build and digest,
approved registry/project/job/volume identifiers, writable unprivileged volume
verification, and Lead's final host acceptance. No host acceptance or launch
readiness is claimed here. The 20-bps account contract is a model assumption,
not a verified personal or Kraken account fee schedule.
