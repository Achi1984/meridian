# MERIDIAN v7.101 — Simultaneous Portfolio Risk Budget Evidence

Status: RESEARCH ONLY — REJECTED — NO PROMOTION.

Latest evidence used for the decision: GitHub Actions `Hybrid Alpha v7.101 Portfolio Budget Evidence` #3.  
Run ID: `34105057658`.  
Artifact: `10012070009`.  
Digest: `sha256:9b83574cdae8f16924390314ab8f5312e1a6210320e813b4a5571670da6f0e4a`.  
Evidence logic head: `74457470603509573a76156196a62d4f98ecc436`.  
Cutoff: `2026-09-07T09:00:00Z`.  
Universe: BTC, ETH, SOL, XRP, ADA, AVAX, LINK.  
Primary horizon: 24h. Comparator: frozen v7.97.

## Primary 24h result

| Window | v7.97 PF | v7.101 PF | v7.97 EXP | v7.101 EXP | v7.97 DD | v7.101 DD | Trades |
|---|---:|---:|---:|---:|---:|---:|---:|
| 30d | 2.29 | 2.20 | +1.845R | +0.587R | 32.595R | 14.650R | 131 |
| 60d | 1.29 | 1.22 | +0.513R | +0.134R | 85.043R | 32.297R | 273 |
| 90d | 1.44 | 1.28 | +0.653R | +0.154R | 99.298R | 38.892R | 419 |

Opportunity count is unchanged and outgoing bundle risk never exceeds the locked 1.00 budget. Drawdown improves strongly in every primary window, but the allocator compresses the edge too aggressively: PF falls by 0.09 / 0.07 / 0.16, above the predeclared maximum 0.05 decline in every window. Expectancy falls by approximately 68% / 74% / 76%.

Net-R / max-DD also degrades versus v7.97: 7.415 -> 5.249 (30d), 1.648 -> 1.133 (60d), and 2.755 -> 1.661 (90d). This explicitly fails the predeclared portfolio-efficiency rule.

## 90d chronological folds

v7.101:
- Fold 1: PF 1.50, EXP +0.211R, DD 17.746R, 145 trades.
- Fold 2: PF 0.58, EXP -0.331R, DD 48.457R, 139 trades.
- Fold 3: PF 2.07, EXP +0.539R, DD 32.891R, 135 trades.

The portfolio cap reduces loss magnitude and drawdown in the weak period, but the middle fold remains materially negative. Positive periods surrender too much expectancy, so the improved drawdown is not sufficient evidence of a better allocator.

## 90d structure

- LONG: PF 1.65, EXP +0.391R, 210 trades.
- SHORT: PF 0.83, EXP -0.083R, 209 trades.
- TRANSITION: PF 1.72, EXP +0.373R, 201 trades.
- RANGE: PF 0.79, EXP -0.177R, 57 trades.
- BULL: PF 1.02, EXP +0.010R, 100 trades.
- BEAR: PF 0.94, EXP -0.021R, 61 trades.

Asset PF: BTC 1.50, ETH 1.84, SOL 1.24, XRP 1.14, ADA 1.77, AVAX 0.50, LINK 1.39. The allocator therefore does not solve the underlying SHORT/RANGE/AVAX weakness; it mainly shrinks simultaneous exposure.

## Scaling diagnostics

On 90d / 24h:
- 419 trades remain.
- 398 trades are scaled.
- 77 of 88 timestamp bundles are scaled.
- average scale is 0.407.
- maximum incoming bundle risk is 6.089.
- maximum outgoing bundle risk is 1.000.

The safety invariant works mechanically, but scaling roughly 95% of trades and 87.5% of timestamp bundles toward an average 0.407 multiplier is too blunt for the current independent-asset signal architecture.

## Decision

**REJECT v7.101.**

Do not tune the 1.00 budget after seeing this evidence and do not search alternative flat caps. The useful finding is architectural: simultaneous cross-asset exposure is materially concentrated, but uniform timestamp normalization destroys too much expected return. Any future portfolio allocator must be separately designed and should model correlated/cluster risk or marginal portfolio contribution instead of shrinking nearly every simultaneous bundle equally.

Return Hybrid Alpha to frozen v7.97 as the strategy-level research comparator. No Baseline, Paper/live execution, Pionex, `server.js`, entries or exits are changed. Promotion remains prohibited.
