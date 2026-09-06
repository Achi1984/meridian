# MERIDIAN v7.96 — Weak-Alpha Risk Attenuation Evidence

Status: RESEARCH ONLY — NO PROMOTION.

Evidence run: GitHub Actions `Hybrid Alpha v7.96 Weak Alpha Evidence` run #1.
Artifact: `9987935487`.
Digest: `sha256:02655147b818529ae09d62fce8174ca256bcaafb11ef08d2fbe4d45efa49a56d`.
Universe locked: BTC, ETH, SOL, XRP, ADA, AVAX, LINK.
Candidate change locked before the run: if `|alpha|` is in `[0.20, 0.35)`, multiply existing v7.93 research risk by the already-used factor `0.60`. Side selection and trade count stay unchanged.

## 24h primary horizon
Compared with frozen v7.93:
- 30d: PF `1.82 -> 1.96`; EXP `+1.473R -> +1.490R`; DD `46.753R -> 37.511R`; trades `131 -> 131`.
- 60d: PF `1.11 -> 1.15`; EXP `+0.233R -> +0.281R`; DD `144.889R -> 123.038R`; trades `274 -> 274`.
- 90d: PF `1.25 -> 1.32`; EXP `+0.470R -> +0.502R`; DD `125.899R -> 112.760R`; trades `421 -> 421`.

The predeclared weak-alpha attenuation improves PF, expectancy and drawdown on all three primary 24h windows without reducing opportunity count.

## 90d chronological folds under v7.96
- Fold 1: PF `1.89`, EXP `+0.914R`, DD `27.406R`, 147 trades.
- Fold 2: PF `0.62`, EXP `-0.847R`, DD `126.798R`, 140 trades.
- Fold 3: PF `1.96`, EXP `+1.459R`, DD `118.890R`, 134 trades.

The middle fold remains materially negative. Expectancy improves versus v7.93's failing middle fold, but chronological stability still fails. No promotion is permitted.

## Horizon specificity
The effect is not universal:
- 4h is negative before and after v7.96; v7.96 slightly worsens PF/EXP across 30/60/90d.
- 12h is mixed and v7.96 weakens the already modest edge.
- 24h is the only horizon where the predeclared attenuation consistently improves the aggregate metrics.

Therefore v7.96 must not be generalized as an all-horizon rule. The evidence supports only continued research of the 24h candidate.

## Decision
NO PROMOTION. Keep v7.96 isolated. Do not tune the `0.60` factor or the `[0.20,0.35)` band after seeing this result. Do not drop assets or add hard regime/side gates. The unresolved question is the persistent negative middle chronological fold; any next hypothesis must be independently predeclared from already-known v7.95 attribution evidence rather than optimized against this fold.
