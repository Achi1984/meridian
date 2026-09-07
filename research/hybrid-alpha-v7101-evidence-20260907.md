# MERIDIAN v7.101 — Simultaneous Portfolio Risk Budget Evidence

Status: RESEARCH ONLY — REJECTED — NO PROMOTION.

Evidence run: GitHub Actions `Hybrid Alpha v7.101 Portfolio Budget Evidence` #1.  
Run ID: `34055149743`.  
Artifact: `9995750648`.  
Digest: `sha256:25a5ad1d17efb1ea9135f7fd354a8164465c64b3928cf4ca7b55ef4031179b1a`.  
Exact evidence head: `8a22b4868d1d4a9a2d2fd834b0bdc5557b198ed4`.  
Cutoff: `2026-09-06T19:15:00Z`.  
Universe: BTC, ETH, SOL, XRP, ADA, AVAX, LINK.  
Primary horizon: 24h. Comparator: frozen v7.97.

## Primary 24h result

| Window | v7.97 PF | v7.101 PF | v7.97 EXP | v7.101 EXP | v7.97 DD | v7.101 DD | Trades |
|---|---:|---:|---:|---:|---:|---:|---:|
| 30d | 2.04 | 1.86 | +1.533R | +0.447R | 34.327R | 15.365R | 131 |
| 60d | 1.19 | 1.10 | +0.334R | +0.066R | 112.477R | 44.409R | 274 |
| 90d | 1.36 | 1.20 | +0.544R | +0.109R | 101.560R | 43.551R | 421 |

Opportunity count is unchanged and the outgoing bundle risk never exceeds the locked 1.00 budget. Drawdown falls strongly in every primary window, but the allocator compresses the edge too aggressively: PF falls by 0.18 / 0.09 / 0.16 and expectancy falls by roughly 71% / 80% / 80% across 30/60/90d.

Net-R / max-DD also degrades versus v7.97: approximately 5.85 -> 3.81 (30d), 0.81 -> 0.40 (60d), and 2.26 -> 1.06 (90d). This explicitly fails the predeclared decision rule requiring improved 60d/90d portfolio efficiency without PF falling by more than 0.05.

## 90d chronological folds

v7.101:
- Fold 1: PF 1.44, EXP +0.190R, DD 17.746R, 147 trades.
- Fold 2: PF 0.61, EXP -0.289R, DD 44.157R, 140 trades.
- Fold 3: PF 1.86, EXP +0.438R, DD 32.891R, 134 trades.

Frozen v7.97 comparator:
- Fold 1: PF 2.00, EXP +0.937R, DD 28.751R.
- Fold 2: PF 0.63, EXP -0.782R, DD 118.013R.
- Fold 3: PF 2.03, EXP +1.500R, DD 111.254R.

The portfolio cap substantially reduces loss magnitude/DD in the bad middle fold, but that improvement is purchased by severe edge compression in the positive folds. The middle fold also remains negative.

## 90d structure

- LONG: PF 1.49, EXP +0.299R.
- SHORT: PF 0.83, EXP -0.083R.
- TRANSITION: PF 1.72, EXP +0.373R.
- RANGE: PF 0.44, EXP -0.488R.
- BULL: PF 1.02, approximately flat.
- BEAR: PF 0.94, slightly negative.

Asset PF: BTC 1.46, ETH 1.77, SOL 1.19, XRP 1.12, ADA 1.71, AVAX 0.37, LINK 1.17. The allocator therefore does not solve the underlying SHORT/RANGE/AVAX weakness; it mainly shrinks simultaneous exposure.

## Scaling diagnostics

On 90d / 24h:
- 421 trades remain.
- 400 trades are scaled.
- 77 of 88 timestamp bundles are scaled.
- average scale is 0.407.
- maximum incoming bundle risk is 6.089.
- maximum outgoing bundle risk is 1.000.

The safety invariant works mechanically, but scaling 95% of trades and 87.5% of bundles toward an average 0.407 multiplier is too blunt for the current independent-asset signal architecture.

## Decision

**REJECT v7.101.**

Do not tune the 1.00 budget after seeing this evidence and do not search alternative caps. The result is useful architectural evidence: simultaneous cross-asset exposure is materially concentrated, but a flat timestamp cap destroys too much expected return. Any future portfolio allocator must be separately designed and should model correlated/cluster risk or marginal portfolio contribution rather than uniformly normalizing almost every bundle.

Return Hybrid Alpha to frozen v7.97 for strategy-level research. No Baseline, Paper/live execution, Pionex, `server.js`, entries or exits are changed. Promotion remains prohibited.
