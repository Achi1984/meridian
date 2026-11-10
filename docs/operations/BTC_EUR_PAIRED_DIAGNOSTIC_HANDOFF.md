# BTC/EUR paired diagnostic image — disabled handoff

This packet closes the preparation work for #1340 against the exact #1339
source commit `ae924141854362257738322ac9a1022cd47e0b02`. The actual acceptance
receipt and candidate identity are
[machine-readable acceptance](receipts/btc-eur-paired-diag-20261110-001.acceptance.json)
and
[provisional identity](receipts/btc-eur-paired-diag-20261110-001.identity.json).
Consumers should use the standalone, canonical expected-identity document
[here](receipts/btc-eur-paired-diag-20261110-001.expected-identity.json) for
evaluator/ingester input. It preserves the raw host identity schema; account
contract selection remains wrapper metadata and is not an identity field.

The acceptance passed from a Git archive of the pinned source. It verified the
pinned Node base digest and layer ancestry, confirmed the default image command
is `DISABLED` / `NO_RUN_REQUESTED`, matched source and container identities,
imported all 16 packaged modules, and rejected the invalid selections and
existing evidence path. The image is available only as local immutable image ID
`sha256:9e5f7a26a9c3827d4f0935da31568d39d38c0507a24c0999674b3c70877cdae1`;
it has no registry digest and was not pushed. Do not treat the local ID as a
deployable registry reference.

The provisional identity uses runId `btc-eur-paired-diag-20261110-001`, account
`BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2`, and model pair
`BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1`. Identity-only evaluation ran in the
accepted image with network disabled, a read-only root filesystem, and tmpfs
for `/tmp` and `/evidence-root`. No host paper run, feed, persistent volume,
credential, registry push, activation, or promotion was performed. The
candidate remains provisional until an independent host uniqueness check; it
must not be treated as assigned or executing.

The identity retains the original three model IDs, the 20 bps/side EEA
taker-fee assumption, 10 bps/side slippage, and the unchanged budget/runtime
limits. Its config digest is
`a055960c9d6041fb32988d578d8f5f1b0d5c779eb1861ae8db836bc2ddaeef2e`;
the accepted research digest remains
`dc7be719198ff3c936354c75352dfb782eaece65761b4fb47ba5d3fc0f756e25`.

Promotion waits for the #1339 postchecks: Safety42862034874,
Runtime42862034724, Coordinator42862034745, and Pages42862033804. All four
postchecks are now `SUCCESS` (completion 6774630648). Promotion remains blocked
pending a registry digest, host uniqueness check, and activation authorization.
The historical 002 export is separate and is not included in this handoff.
