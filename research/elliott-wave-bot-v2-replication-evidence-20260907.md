# MERIDIAN — Elliott Wave Bot V2 Historical Replication Evidence

Status: STRONG REPLICATION / FORMAL SAMPLE FAIL / NO PROMOTION.

Initial evidence: GitHub Actions `Elliott Wave Bot V2 Historical Replication` #1.  
Run ID: `34145724424`.  
Artifact: `10027592247`.  
Digest: `sha256:639d7dfa0c164c0dc6d6e9ef27c20b6af4c0fdefe1f1c0c47ca384489bf97e44`.  
Evidence logic head: `c45b1694314ac8541ebf6973ee69675e1523a3e4`.

## Locked older year

- Period: 2022-09-06 16:00Z through 2023-09-06 16:00Z.
- 101 closed trades from 246 setups.
- PF `1.39`; expectancy `+0.158R`; net `+16.001R`.
- Maximum drawdown `9.514R`; win rate `61.4%`.

Chronological folds:

- Fold 1: n `34`, PF `1.29`, EXP `+0.124R`.
- Fold 2: n `34`, PF `1.10`, EXP `+0.050R`.
- Fold 3: n `33`, PF `2.07`, EXP `+0.306R`.

Both sides replicate:

- LONG: n `53`, PF `1.28`, EXP `+0.124R`.
- SHORT: n `48`, PF `1.53`, EXP `+0.196R`.

Breadth improves materially versus V1:

- Five adequately sampled assets are positive.
- Highest positive contribution is ETH at `33.1%`, below the locked `40%` maximum.
- Daily LONG and SHORT structural contexts are both positive.
- BTC is slightly negative: PF `0.94`, EXP `-0.023R`; this remains descriptive and is not a filter.

## Decision

Seven of eight gates pass. The only failure is the locked sample requirement: `101 < 120` closed trades. The period will not be extended after seeing the result.

The older year strongly supports the existence of a mechanical Wave-3 effect, but the formal replication decision remains `historicallyReplicated=false` and `promotionPermitted=false`.

Do not tune parameters, extend dates, remove BTC, isolate ETH, or select a side/context. No Baseline 6.2, Hybrid Alpha, FIB V3, Paper/live execution, Pionex, `server.js`, sizing, orders or ledgers changed.
