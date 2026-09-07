# MERIDIAN v7.97 — Low-Liquidity Risk Attenuation Evidence

Status: RESEARCH ONLY — NO PROMOTION.

Exact-head evidence run: GitHub Actions `Hybrid Alpha v7.97 Low Liquidity Evidence` run #2 on head `9f99e11d1f0980b7f1792b229fdba6289d0be828`.
Artifact: `9990883267`.
Digest: `sha256:fdaafdbb04aea217607c3c4f1333f5e2864965247473c2392fd5b1a08cc9fa3c`.
Cutoff: `2026-09-06T13:45:00.000Z`.
Universe locked: BTC, ETH, SOL, XRP, ADA, AVAX, LINK.
Candidate locked before the run: on top of frozen v7.96, decision-time `liquidityQuality < 0.50` multiplies existing research risk by the already-used fixed factor `0.60`. No trade is blocked and side selection stays unchanged.

## 24h primary horizon

Direct v7.93 / v7.96 / v7.97 comparison:

- 30d: PF `1.82 / 1.96 / 2.04`; EXP `+1.473R / +1.490R / +1.533R`; DD `46.753R / 37.511R / 34.327R`; trades `131 / 131 / 131`.
- 60d: PF `1.11 / 1.15 / 1.19`; EXP `+0.233R / +0.281R / +0.334R`; DD `144.889R / 123.038R / 112.477R`; trades `274 / 274 / 274`.
- 90d: PF `1.25 / 1.32 / 1.36`; EXP `+0.470R / +0.502R / +0.544R`; DD `125.899R / 112.760R / 101.560R`; trades `421 / 421 / 421`.

v7.97 improves aggregate PF, expectancy and drawdown across all three primary windows versus both frozen references, with unchanged opportunity count.

## 90d chronological walk-forward

- Fold 1: PF `1.76 / 1.89 / 2.00`; EXP `+0.912R / +0.914R / +0.937R`; DD `30.671R / 27.406R / 28.751R`; trades `147 / 147 / 147`.
- Fold 2: PF `0.64 / 0.62 / 0.63`; EXP `-0.922R / -0.847R / -0.782R`; DD `147.043R / 126.798R / 118.013R`; trades `140 / 140 / 140`.
- Fold 3: PF `1.81 / 1.96 / 2.03`; EXP `+1.440R / +1.459R / +1.500R`; DD `130.514R / 118.890R / 111.254R`; trades `134 / 134 / 134`.

Fold 2 improves in expectancy and drawdown versus both references but remains materially negative with PF far below 1. Chronological robustness therefore still fails.

## 90d concentration

### Side

- LONG: v7.97 PF `1.71`, EXP `+1.203R`, DD `60.141R`, n `212`.
- SHORT: v7.97 PF `0.91`, EXP `-0.123R`, DD `53.422R`, n `209`.

SHORT remains negative. Do not create a LONG-only gate.

### Regime

- RANGE: PF `0.77`, EXP `-0.471R`, n `59`.
- TRANSITION: PF `2.29`, EXP `+1.441R`, n `201`.
- BULL: PF `0.85`, EXP `-0.296R`, n `100`.
- BEAR: PF `0.97`, EXP `-0.048R`, n `61`.

Only TRANSITION is positive; do not create a TRANSITION-only gate. RANGE slightly worsens versus v7.96.

### Asset

- BTC PF `1.48`, EXP `+0.748R`, n `69`.
- ETH PF `2.39`, EXP `+1.770R`, n `63`.
- SOL PF `1.37`, EXP `+0.515R`, n `67`.
- XRP PF `1.16`, EXP `+0.190R`, n `57`.
- ADA PF `2.05`, EXP `+1.057R`, n `66`.
- AVAX PF `0.38`, EXP `-1.777R`, n `47`.
- LINK PF `1.44`, EXP `+0.663R`, n `52`.

AVAX remains materially negative but is not removed retrospectively. BTC weakens slightly versus v7.96; breadth is not uniformly improved.

## Horizon specificity

- 4h remains negative; v7.97 is not a valid 4h candidate.
- 12h remains mixed: 60d stays negative and 30d remains weaker than v7.93.
- 24h is the only consistent aggregate improvement direction.

## Decision

NO PROMOTION. The isolated low-liquidity attenuation is a valid aggregate 24h improvement, but it does not repair the negative middle fold and does not establish uniform side/regime/asset breadth. Do not tune `0.60`, the `<0.50` threshold, alpha band, asset universe, side or regime. Per the predeclared stopping rule, the next research step should use structurally new leakage-free evidence such as true funding/order-flow/microstructure data or a clean meta-allocator rather than another threshold search.
