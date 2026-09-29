# MERIDIAN Open-PR Hygiene — current-main working snapshot — 2026-09-29

Status: **WORKING SNAPSHOT — DO NOT MERGE UNTIL ACTIVE DATA DIAGNOSTIC SETTLES**  
Reference main: `aec6bd58fd75c0979672e4f88c020cba4208e9fd`  
Execution impact: **false**

## Hygiene rule

Closing a PR is not a merge and does not delete its branch/evidence. Terminal FAIL, rejected, obsolete release/UI and superseded draft PRs should be closed when their evidence is already preserved or a current-main successor exists. Prospective holdouts and unresolved research lineages are retained unless a lineage-specific audit proves them terminal.

No PR is merged merely to reduce the open count.

## Current Quarter-Hour lineage

Canonical merged main already contains:
- #340 — aggTrades Data V1 immutable FAIL evidence;
- #342 — individual-trades Source V0.1 availability foundation PASS.

Closed unmerged after current-main reconciliation:
- #333 — historical original full-run/single-writer violation;
- #337 / #338 / #339 — duplicate or superseded source-foundation work;
- #341 — obsolete V1.1 draft with unsupported contiguous-ID assumption;
- #343 — clean Data V1.1, frozen FAIL after both real-data canaries failed; full 120-shard run never authorized;
- #344 — diagnostic branch attempt that did not schedule the intended workflow; superseded by #345.

Current diagnostics / evidence:
- #345 — successful quote-semantics diagnostic. It proves sparse malformed raw `quoteQty` rows, not a global scaling convention, and exposes a separate BTCUSDT/2025-01 monthly-trades vs monthly-kline corpus mismatch.
- #348 — current-main BTC monthly/daily source-consistency diagnostic; active at this snapshot and must settle before the next source protocol is frozen.
- #347 — current-main external Quarter-Hour evidence lock, docs-only, Release Safety green after reviewer correction.
- #346 — current-main Paper-bot deep audit, docs-only, Release Safety green after reviewer correction.

## Replaced parallel-prework PRs

Closed unmerged:
- #334 — Paper-bot deep audit prepared on an older repository state; replaced by current-main #346.
- #335 — external Quarter-Hour evidence lock on older main; replaced by current-main #347.
- #336 — first hygiene document itself became stale; replaced by this current-main snapshot after the active diagnostic settles.

## Obsolete UI / snapshot-era PRs closed in this pass

- #121 — v9 Bot Control Center + BTC Hedge. Current v10 uses safely matched current private rows and protects against stale reference data; merging the old snapshot-era branch would regress current data integrity.
- #136 — v9 compact asset-pair UI. Current v10 already derives the asset universe dynamically and presents Long+Short jointly with current readiness/risk semantics.

Both were closed unmerged. Their history remains available.

## Explicitly retained categories

Do **not** mass-close these without a dedicated lineage audit:
- prospective/forward holdouts whose observation window is still live;
- historical research evidence that is a required parent/base for a prospective branch;
- unresolved research-only branches whose outcome has not been superseded canonically;
- audit/evidence PRs that contain unique reproducible artifacts not yet summarized on current main.

Examples currently retained include the FIB prospective-holdout lineage and several older research-only lines pending dedicated review.

## Merge discipline

- one Main-Agent-owned merge at a time;
- refresh current main immediately before each merge;
- exact-head CI must be green;
- no concurrent merge of branches that touch the same authority/checkpoint files;
- diagnostic FAIL/SUCCESS does not become canonical merely because an Actions run completed;
- strategy/trading/Paper parameters are never changed as part of PR hygiene.

## Next hygiene checkpoint

After #348 settles:
1. freeze the Data V1.1/source-consistency result on current main;
2. refresh `MERIDIAN_RESUME.json` from the then-current main SHA;
3. update this document with the final status of #345/#348 and any clean successor;
4. merge docs-only audit/evidence/hygiene PRs serially only after exact-head green checks;
5. continue lineage-specific review of remaining old PRs without mass-closing active holdouts.
