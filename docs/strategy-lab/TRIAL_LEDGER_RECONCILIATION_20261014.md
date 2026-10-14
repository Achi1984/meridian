# Partial trial-ledger reconciliation — 14 October 2026

**PARTIAL SOURCE AUDIT; not a canonical ledger or completed budget reconciliation.**
Pinned repository: `Achi1984/meridian`, commit `7d019f82be76cf0a9cefbb5c5e6537c182be7546`.

The untruncated tree contains 1358 entries. This bounded audit read 18 targeted source files and checked each returned blob SHA against that tree. It inspected recorded decisions and configuration metadata only: no strategy execution, PnL recalculation or evaluation of market history. A complete tree listing does not make its contents an exhaustive lineage audit. Other branches, deleted history, issues and referenced workflow artifacts were not audited.

`completeLineageAudit` remains **null**. Cumulative trials, cumulative variants, per-family usage, remaining campaign slots and remaining first-tranche slots remain **UNKNOWN** (JSON null). All execution, canonical research, dispatch, order and promotion authorization flags are false. The campaign itself is unchanged.

## Concrete accounting discrepancy

S01's twelve concept cards contain empty variant arrays. S02 explicitly proposes **H1.P1.DAILY.V1** and **H1.C1.NONCROSSING.V1**, both `countsAgainstBudget:true`, while retaining `DRAFT_BLOCKED` and `trialLedgerReconciled:false`. These are budget-intended proposed candidates, not verified registered slots and not evidence of completed empirical trials. Empty arrays must not become an invented zero historical count.

S13 requires reconciliation with earlier H1/H5/H7, cross-market and manual work, the four-candidate first tranche, three-per-family and 36-total limits. The original first-tranche plan has only been discovered in this packet and still requires content reconciliation. Caps remain unchanged: 12 families, three variants per family, 36 candidates, three finalists. No reset or spare-slot claim is made.

P1 versus C1 removes only the prior-%R crossing requirement; C1 is **not** a pure SMA control. The three compulsory cost sensitivities create six candidate/scenario combinations, not automatically six independent candidates. Selecting favorable sensitivities or changing parameters still requires variation accounting. S14's simple SMA200 Long/Cash context remains proposed and non-selectable; record any future run, and count selection/tuning/promotion as candidate work requiring budget review.

## Recorded decisions retained

These are verified **source statements**, not recomputed results. Related lineage is not proof of identical strategy or transferred validation.

| Record | Recorded decision | H mapping and limit | Sources |
|---|---|---|---|
| Trend pullback V1 R34 | REJECTED; no Paper launch | Related H1 predecessor; not identical Williams P1 | S06 |
| Regime trend/breakout V1 | REGIME_TREND_BREAKOUT_V1_HOLDOUT_FAIL | H1 related lineage; H5 contrasting continuation comparator | S07, S01 |
| Taker order flow V1 | DEVELOPMENT_FAIL_RESEARCH_REDESIGN | H3/H8 explicit failure comparators | S08, S01 |
| Taker flow relative strength V2 | FEATURE_VALIDATION_FAIL_RESEARCH_STOP | H8 comparator; empirical feature trial despite no portfolio PnL | S09, S01 |
| Regime-gated grid V2 | DISCOVERY_FAIL_RESEARCH_REDESIGN | Known failed comparator; no forced H assignment | S11, S01 |
| LowVol rank weighted V2 | HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY | Frozen separate reference; H7 cannot inherit PASS | S10, S01 |
| Paper Edge V1 | EDGE_V1_DISCOVERY_FAIL; V1 closed | Pullback-related; precise H assignment unresolved | S12, S03 |
| Pairs offline V1 | NO_ROBUST_PAIR_IN_WALK_FORWARD | Related H6 predecessor, not identical design | S17, S05 |
| R42 momentum | HISTORICAL_WALK_FORWARD_REJECTED | Related H1 momentum predecessor | S18, S05, S04 |

A discovery/holdout pair is not automatically two variants. A result document may summarize multiple candidates: grid V2 explicitly does, so one file must not become one inferred variant. Pair scan statistical tests and pairs are not automatically campaign variants; zero eligible trades does not erase the empirical scan or walk-forward attempt. Failed lines remain failed regardless of new labels or schema revisions. LowVol remains immutable, with its correction/prospective history not exhaustively reconciled here.

## Record types and authority

- **Concept register:** S01 holds unvalidated H1–H12 ideas; not a complete run log.
- **Proposed candidates/context:** S02/S13/S14 describe P1/C1 and SMA context. They do not demonstrate an executed historical comparison.
- **Synthetic engineering:** S16 records synthetic P1 timing/core tests. Unit tests and fixture combinations are not empirical strategy trials.
- **Data probes:** S15 explicitly states format/checksum-only probes and `strategyPnlCalculated:false`. Track data inspection provenance without treating probes as strategy performance.
- **Empirical records:** the table retains historical recorded strategy, feature, scan and walk-forward outcomes.
- **Trade accounting/ledgers:** S03 governs trade/fill/split accounting; S04 is experimental signal code and S05 a trade-state ledger. Their names do not establish a complete experiment registry.

The exact corpus-wide registry authority remains unestablished. H2/H4/H9/H10/H11/H12 have no empirical lineage reconciled in this bounded packet; this is **not** a finding that no such work exists. Further funding, reversal, TSMOM, cross-market and LowVol correction sources were found in the tree but not content-read. They are listed as `TREE_ONLY_NOT_CONTENT_VERIFIED` in the companion JSON.

## Next evidence needed

1. Read the original benchmark first-tranche and cross-market allocations, and recover prior H1/H5/H7/manual candidate identities.
2. Obtain a stable cumulative candidate/run manifest including failed, aborted, discarded and manually changed variants; deduplicate stages, repeats and source-correction runs using evidence rather than filename counts.
3. Reconcile discovered LowVol correction and other research families before any complete-lineage assertion.
4. Only then reconcile proposed P1/C1 slots and any future context runs against all caps.

Earlier historical-contract unresolved flags remain unchanged. This document clears neither a historical-run gate nor a cost/data/review/owner-execution gate. It grants no empirical trial registration, run, merge, Paper or Live authority.

## Pinned source inventory

Git blob SHA-1 values identify source versions; they are not dataset hashes or new runtime attestations.

| ID | Repository path | Git blob SHA |
|---|---|---|
| S01 | `docs/strategy-lab/campaign-20261013.json` | `0e9db15f6155eda1d98c86d4eda9081ecec6d02a` |
| S02 | `docs/strategy-lab/p1-historical-experiment-draft.json` | `5234ffc13d65084ca31df22bbe0e44f16ed2b615` |
| S03 | `research/PAPER-EDGE-V1-DISCOVERY-ACCOUNTING.md` | `9cf7f2177fca99f9d0a4c354319d1a69b302725a` |
| S04 | `research/r42-candidates.js` | `f7f7c309582aab76bb8a47844f3ce19c37eafa0d` |
| S05 | `research/r42-ledger.js` | `3562f09de24f075f4dedcf51d1f3d29e59956de2` |
| S06 | `research/trend-pullback-v1-evidence-r34.md` | `49caf33e654bf99e9346a66010c254b3c1a61ca6` |
| S07 | `research/results/regime-trend-breakout-v1-holdout-result.json` | `f68452cae0bad17448a336113a9a264c3c999213` |
| S08 | `research/perpetual-taker-order-flow-v1-development-result.json` | `4acc8cbbe3b77a653400720cd9d874a2631ad6e3` |
| S09 | `research/results/perpetual-taker-order-flow-relative-strength-v2-result.json` | `6494dbfb5760671eadbde7b77ff619acd1f5073d` |
| S10 | `research/results/low-volatility-rank-weighted-v2-holdout-frozen-summary.json` | `4e59899559fefe5c8f6697f9f4fc320fc9ed8516` |
| S11 | `research/REGIME-GATED-GRID-V2-RESULT.md` | `f0c41ebcf5b30f6dd5a12bf4054eda151c1079f6` |
| S12 | `research/PAPER-EDGE-V1-DISCOVERY-DECISION.md` | `6221e3fd9645a7f1bd577b98c46662974127f070` |
| S13 | `docs/strategy-lab/P1_HISTORICAL_EXPERIMENT_DRAFT.md` | `e5ec3241d2d4664e0fa13cb2305657428426b545` |
| S14 | `docs/strategy-lab/CLAUDE_CONCEPT_DISPOSITION_20261014.md` | `1eaa37c8971aed5b37c976af16b11b1122c8e9a9` |
| S15 | `docs/strategy-lab/data-probe-results-20261013.json` | `73c430bb4086f41a5b870c713bba7da02941e3ad` |
| S16 | `docs/strategy-lab/P1_TIME_SEPARATION.md` | `fedfb3cb78064309df936051417486e3c19bad4c` |
| S17 | `research/PAIRS-OFFLINE-V1.md` | `f1d2f40ffe5b7fb0c915ed146e164e7cbb82e5e3` |
| S18 | `research/R42-MOMENTUM-CARRY-AUDIT-2026-09-14.md` | `58e4c9e4af8617e4ec79445407736fe6f667809e` |

The companion `trial-ledger-reconciliation-20261014.json` contains structured record classifications, source status locations, unresolved counts, preserved limits and discovered-but-unread paths.

