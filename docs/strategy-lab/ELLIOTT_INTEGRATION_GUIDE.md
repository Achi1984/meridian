# Elliott synthetic subset — isolated integration

This packet transfers nine byte-identical code/test files from [pinned strategy source](https://github.com/Achi1984/meridian/tree/7e0b9f11b0280ec781353266c6ea57ce74134da0) onto main snapshot `219a1e72aa5ab3e485ff3e42d8759684900f6f02`. All selected paths were absent. No existing main file or configuration is replaced. The companion disposition JSON records all120 inventory paths:9 selected,111 retained by immutable source reference and deferred with explicit reasons. This settles selection for this packet only; it does not approve every file's contents.

## Capability and limits

Correction helpers validate closed bars, geometric confirmation/receipt ordering and signed partial-fill arithmetic. Pivot admission binds one strictly defined pivot window to supplied receipts or explicit publication assumptions. The synthetic path adapter starts with an already-open hypothetical position and applies named OHLC/stop/target conventions. Neither is a full Elliott-wave signal/entry engine. Caller data must be trusted plain JSON records, not arbitrary JavaScript getters/proxies.

The two frozen comparators intentionally preserve known defects. Their tests characterize historical behavior and verify original hashes; a passing characterization is not endorsement of those algorithms. They have no runtime importer. The three new helpers deny execution/empirical authority; fixed frozen flags remain unchanged. No historical result, profitability, fresh holdout, receipt authenticity or market-fill validity is established.

## Dependencies and verification

Runtime imports close within these five modules. Four tests depend on Node built-ins only; the frozen test reads just the comparator files for hash checks. No package dependency, network, scheduler, subprocess, production route or order interface is added. Existing main package.json uses ESM and `node --test test/*.test.js`, so standard CI discovers the four tests without workflow changes.

Local command `node --test test/elliott-*.test.js`:48/48 pass, zero fail/skip/cancel/todo using exact source bytes in an isolated subset. This is not full target-head CI; that and independent exact-diff review remain required. The earlier local newline-copy error and exact-byte restoration are recorded in the [source audit](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/ELLIOTT_SUBSET_DEPENDENCY_AUDIT_20261014.md). This transfer uses existing Git blobs directly, preserving their identity.

## Pinned design and lineage references

These documents are retained as historical source references rather than copied with stale progress statements. Read their explicit scopes and later follow-up sections together; none grants current merge/run authority.

- [CLAUDE_ELLIOTT_DISPOSITION_20261014.md](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/CLAUDE_ELLIOTT_DISPOSITION_20261014.md) — Git blob `27a8f840f1d0fbd10c9cf7a3fa3fde856d51cf3d`.
- [ELLIOTT_CORRECTION_CONTRACT_DRAFT_20261014.md](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/ELLIOTT_CORRECTION_CONTRACT_DRAFT_20261014.md) — Git blob `0820b9384f252ccbc280ee27458d7e11fa771908`.
- [ELLIOTT_CORRECTION_HELPERS.md](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/ELLIOTT_CORRECTION_HELPERS.md) — Git blob `2941edcb706c4ad2e9e533b47efe7041a8127634`.
- [ELLIOTT_PIVOT_ADMISSION_CONTRACT_20261014.md](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/ELLIOTT_PIVOT_ADMISSION_CONTRACT_20261014.md) — Git blob `b066a66f3fa6a75ae2b67b94d449b3d29915fa5b`.
- [ELLIOTT_PIVOT_ADMISSION_IMPLEMENTATION.md](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/ELLIOTT_PIVOT_ADMISSION_IMPLEMENTATION.md) — Git blob `367e7286c31f2a230fd49f7b998d6968a6f633a5`.
- [ELLIOTT_SOURCE_ASSESSMENT_20261014.md](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/ELLIOTT_SOURCE_ASSESSMENT_20261014.md) — Git blob `b3388ad2f911450f564ddceea3ba2093bb46524e`.
- [ELLIOTT_SYNTHETIC_FINDINGS_20261014.md](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/ELLIOTT_SYNTHETIC_FINDINGS_20261014.md) — Git blob `ed0a2d764bec84d60cbee108ecc1f4a41c30c332`.
- [ELLIOTT_SYNTHETIC_PATH_CONTRACT_20261014.md](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/ELLIOTT_SYNTHETIC_PATH_CONTRACT_20261014.md) — Git blob `86124d137fdb62df394b89fd4558a4a4c806ac26`.
- [ELLIOTT_SYNTHETIC_PATH_IMPLEMENTATION.md](https://github.com/Achi1984/meridian/blob/7e0b9f11b0280ec781353266c6ea57ce74134da0/docs/strategy-lab/ELLIOTT_SYNTHETIC_PATH_IMPLEMENTATION.md) — Git blob `84ffbc61781dfe4db4e3d954fdad87fc22957948`.

## Remaining package and approval boundaries

Other111paths are not dropped: immutable hashes/references are retained in the disposition manifest. Historical data/tooling remain unexecuted; data-use/licensing and previously inspected-data status are UNKNOWN. Protected campaign/payoff/ledger policies and P1/C1 cumulative trial accounting require their own reconciliation. P1 and metadata host integration remain separate work; no new allocation, reset or remaining trial budget is inferred.

Lead proposes this bounded disposition; independent reviewer and receiving-lane acceptance are still gates before merge. Once exact target CI and review pass, obtain concrete source merge approval. Research-stage, empirical/PnL, runtime activation, Paper/Live trading and M11 permission boundaries remain unchanged. No wholesale merge of PR758/768. If target moves, reconcile selected paths and revalidate integration evidence.
