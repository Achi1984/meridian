# MERIDIAN — Elliott Wave Bot V1 Wave-3 Evidence

Status: RESEARCH ONLY — HISTORICAL NEAR-PASS — NO PROMOTION.

Initial evidence: GitHub Actions `Elliott Wave Bot V1 Evidence` #1.  
Run ID: `34143213079`.  
Artifact: `10026726992`.  
Digest: `sha256:d54b885299d3164bf8aedeb70dacf238e62e8a34e1a392e58f1dc4c268a00187`.  
Evidence logic head: `1b486a48745e4be5dfbf87365de2274741527b8c`.

## Primary unused period

- 144 closed trades; 334 setups; 148 fills.
- PF `1.21`; expectancy `+0.088R`; net `+12.615R`.
- Maximum drawdown `8.814R`; win rate `59.0%`.
- Median time in trade: 16 × 4h bars.

Chronological folds:

- Fold 1: n `48`, PF `1.68`, EXP `+0.255R`.
- Fold 2: n `48`, PF `0.92`, EXP `-0.036R`.
- Fold 3: n `48`, PF `1.11`, EXP `+0.044R`.

Both sides are positive:

- LONG: n `81`, PF `1.18`, EXP `+0.081R`.
- SHORT: n `63`, PF `1.25`, EXP `+0.096R`.

## Breadth and stability

- Adequately positive assets: four of seven; the locked requirement is at least five.
- ETH contributes `60.2%` of positive primary net R, exceeding the locked `40%` maximum.
- SOL is negative: PF `0.61`, EXP `-0.236R`.
- The first secondary year is only marginal: n `133`, PF `1.05`, EXP `+0.021R`.
- The second secondary year is stronger: n `148`, PF `1.25`, EXP `+0.100R`.

## Locked gate

Pass: aggregate edge, fold sample, fold PF floor and both-side breadth.  
Fail: primary sample (`144 < 150`), asset breadth (`4 < 5`) and concentration (`ETH 60.2% > 40%`).

Decision: `historicallyRobust=false`; `promotionPermitted=false`.

V1 shows a plausible mechanical Wave-3 signal, but it is not broad or independent enough. Do not extend the sample boundary, isolate ETH, drop SOL, select a side/context, or tune pivot width, noise floor, retracement or targets after seeing the evidence.

No Baseline 6.2, Hybrid Alpha, FIB V3, Paper/live execution, Pionex, `server.js`, sizing, orders or ledgers changed.
