# MERIDIAN Open PR Hygiene Audit — 2026-09-29

Status: **FIRST CLEANUP PASS**  
Base main: `41b1f6e43b3e2a35e8d8d259c124e347e1bd2455`  
Execution impact: **false**

## Rule

Open PRs are not a durable research archive.

A PR should remain open only when it still represents:
- an intended merge candidate;
- an active prospective/holdout experiment;
- an unresolved implementation review;
- or a deliberately active integration branch.

Completed FAIL/REJECT/NO-PROMOTION experiments should be closed while their branches, commits, workflow runs, artifacts and reports remain preserved.

Closing a PR does not delete its branch history or research evidence.

## Close now — explicit terminal research outcomes

### Elliott lineage

- **#88 — Elliott Wave V1 historical near-pass**
  - frozen;
  - promotionPermitted=false;
  - failed sample/breadth/concentration gates;
  - superseded by the later disjoint-year replication and Wave-5 experiment.

- **#89 — Elliott V2 strong replication / sample fail**
  - formal sample fail;
  - promotionPermitted=false;
  - exact interval intentionally not extended;
  - superseded by the subsequent Wave-5 test.

- **#90 — reject Elliott Wave-5 V1**
  - explicit REJECTED;
  - insufficient opportunity/sample/breadth;
  - no promotion;
  - terminal point for that Elliott branch.

Disposition for #88/#89/#90:
**CLOSE — retain immutable evidence, no merge.**

### Hybrid Alpha / OKX threshold lineage

- **#82 — reject v7.98 funding crowding attenuation**
  - explicit rejection;
  - no tuning/no promotion.

- **#83 — reject v7.99 relative OI expansion**
  - explicit rejection;
  - no threshold search/no promotion.

- **#84 — reject v7.100 taker-flow and stop microstructure thresholds**
  - explicit rejection;
  - states the entire isolated microstructure-threshold series is stopped.

- **#85 — reject v7.101 simultaneous portfolio risk budget**
  - explicit rejection;
  - uniform risk normalization destroys too much edge.

- **#87 — reject v7.102 correlation-cluster allocator**
  - explicit rejection;
  - no tuning/no promotion.

Disposition:
**CLOSE — terminal negative experiments, no merge.**

### Predecessor data-source lineage

- **#80 — Market Microstructure Data Foundation V1**
  - Binance endpoint transport fail (HTTP 451);
  - no alpha evidence;
  - explicitly required a separately predeclared accessible provider;
  - superseded by #81.

- **#81 — OKX public microstructure source V2**
  - data foundation PASS only;
  - no alpha evidence / no promotion;
  - its authorized downstream experiments are #82/#83/#84, all later rejected.

Disposition:
**CLOSE — lineage completed; evidence remains in commits/artifacts.**

### Volatility-context lineage

- **#34 — Volatility context robustness — FAIL**
  - explicit robustness FAIL;
  - no promotion/no threshold rescue;
  - next step moved to prospective holdout (#35).

Disposition:
**CLOSE — superseded by the prospective holdout stage.**

## Explicitly retain open in this pass

### Active Data V1
- **#333** Quarter-Hour Imbalance Data V1
  - active 120-shard run;
  - do not touch/merge until aggregate gate is complete.

### Product / UI work
- **#136** compact asset-pair bot UI
- **#121** Bot Control Center + BTC Hedge

These need separate current-main review before any decision.

### Current/possibly relevant research
- **#119** BTC NEXT RANGE / COMPOUND V1
- **#103** research replay coverage and gap-fill audit
- **#93** Paper stop fills and re-entry audit
- **#77/#76/#75/#74** FIB lineage
- **#35** locked prospective holdout
- **#36** Meta Allocator design
- **#40/#39** breakout lineage
- **#42** canonical Paper Activity owner

No closure decision is made for these without a separate lineage/current-main audit.

### Older Hybrid Alpha lineage
- #66/#67/#68/#69/#71/#73 remain open for a second pass.

Reason:
Their role in the later frozen/failed lineage must be reconciled against current canonical research state before closing them in bulk.

## Safety invariants

- no stale PR is merged merely to "clean up";
- closing a PR is not treated as deleting evidence;
- branches/artifacts remain immutable evidence;
- active holdouts stay open;
- Paper/UI work is not closed based only on age;
- main is not modified during the active Data V1 full run;
- PR #333 remains the only current Quarter-Hour Data V1 integration candidate.

## Next hygiene pass

After Data V1 is resolved:
1. audit #66/#67/#68/#69/#71/#73 as one Hybrid Alpha lineage;
2. audit #74/#75/#76/#77 as one FIB lineage;
3. audit #39/#40 as one breakout lineage;
4. reconcile #42/#93/#103 against the current Paper architecture;
5. rebase or close stale UI PRs #121/#136 only after current product state comparison.
