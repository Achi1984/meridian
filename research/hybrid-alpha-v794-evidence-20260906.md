# MERIDIAN v7.94 — 7-Asset Robustness Evidence

Status: RESEARCH ONLY — NO PROMOTION.

Run: GitHub Actions #37 `Hybrid Alpha v7.94 Robustness Evidence`.
Artifact: `9987284945`.
Digest: `sha256:31f5c2954488dd056fc65ad07813f902cbb16405a9b69713c6af09ed8277b58a`.
Universe locked before the run: BTC, ETH, SOL, XRP, ADA, AVAX, LINK.
Candidate frozen before the run: v7.93 with TRANSITION×SHORT risk factor 0.60.

## 24h headline
- 30d: PF 1.82, EXP +1.473R, DD 46.753R, 131 trades.
- 60d: PF 1.11, EXP +0.233R, DD 144.889R, 274 trades.
- 90d: PF 1.25, EXP +0.470R, DD 125.899R, 421 trades.

## 90d chronological folds
- Fold 1: PF 1.76, EXP +0.912R, 147 trades.
- Fold 2: PF 0.64, EXP -0.922R, 140 trades.
- Fold 3: PF 1.81, EXP +1.440R, 134 trades.

The middle fold fails materially. v7.93 is therefore not stable enough for promotion.

## 90d asset breadth
- BTC: PF 1.45, EXP +0.814R, 69 trades.
- ETH: PF 2.11, EXP +1.763R, 63 trades.
- SOL: PF 1.29, EXP +0.491R, 67 trades.
- XRP: PF 1.05, EXP +0.082R, 57 trades.
- ADA: PF 1.62, EXP +0.872R, 66 trades.
- AVAX: PF 0.41, EXP -2.017R, 47 trades.
- LINK: PF 1.31, EXP +0.581R, 52 trades.

Breadth is better than a one-asset effect because six of seven assets are non-negative/positive on 90d, but AVAX is a severe outlier and may not simply be removed after the fact.

## 90d side and regime concentration
- LONG: PF 1.53, EXP +1.088R, 212 trades.
- SHORT: PF 0.90, EXP -0.157R, 209 trades.
- TRANSITION: PF 2.05, EXP +1.435R, 201 trades.
- RANGE: PF 0.75, EXP -0.607R, 59 trades.
- BULL: PF 0.81, EXP -0.482R, 100 trades.
- BEAR: PF 0.93, EXP -0.109R, 61 trades.

The aggregate edge is highly concentrated in LONG and TRANSITION. Other regimes are negative and SHORT remains negative even after the v7.93 attenuation.

## Horizon check
- 4h remains negative across 30/60/90d and is rejected.
- 12h is mixed: positive 30d, approximately flat 60d, modestly positive 90d.
- 24h remains the only serious candidate, but fails chronological stability and concentration robustness.

## Decision
NO PROMOTION. Do not tune the 0.60 factor, drop AVAX, create LONG-only/TRANSITION-only hard gates, or change thresholds based on this evidence. The next research question must test whether the failure is explained by market-state structure using predeclared, side-specific evidence rather than retrospective filtering.
