# MERIDIAN v7.93 — 24h failure-window drill-down

Status: RESEARCH ONLY. No execution impact. No Pionex changes. Baseline 6.2 remains frozen.

## Scope

Drill-down of the deterministic v7.92 24h / 90d evidence, especially the negative middle chronological fold (2026-07-08 through 2026-08-07). Evidence artifact run #31, artifact `9986603874`, digest `sha256:51673cfd868364ff989a0e928bc39a5a3707a66f4994d4f26fe3dd4e9fe0db52`.

## Three-fold stability

Overall v7.92 24h folds:
- Fold 1: PF 1.52, EXP +0.720R, +50.430R.
- Fold 2: PF 0.84, EXP -0.354R, -22.646R.
- Fold 3: PF 2.00, EXP +2.210R, +143.650R.

The middle fold failure is concentrated rather than uniform.

### Side x regime

`LONG × TRANSITION` is positive in all three folds:
- Fold 1: n=16, EXP +2.241R, PF 3.33.
- Fold 2: n=16, EXP +3.314R, PF 4.19.
- Fold 3: n=18, EXP +11.240R, PF 13.28.

`SHORT × TRANSITION` is negative in all three folds:
- Fold 1: n=21, EXP -0.464R, PF 0.80.
- Fold 2: n=11, EXP -4.514R, PF 0.02.
- Fold 3: n=12, EXP -1.024R, PF 0.22.

This is the strongest recurring structural asymmetry in the current 24h evidence. It is not explained away by the v7.92 macro overlay: the middle fold contains positive expectancy in neutral/moderately aligned macro buckets, while a small strongly aligned bucket is sharply negative; fold 1 also loses on SHORT×TRANSITION despite predominantly bearish macro context.

Other observations are less stable:
- LONG×RANGE is negative in all folds but sample sizes are only 6/4/2.
- LONG×BULL is positive in fold 1 and negative in folds 2/3.
- SHORT×RANGE is positive in folds 1/2 and negative in fold 3.
- SHORT×BEAR is near-flat/positive in folds 1/2 and negative in fold 3.
- ETH remains the strongest symbol overall, but symbol effects are not clean enough for an asset gate.

## v7.93 hypothesis

Test one narrow, soft hypothesis only: in `TRANSITION`, attenuate SHORT research risk. Do not block the trade, do not boost LONG risk, do not use asset-specific rules, and do not change entry thresholds.

Rationale: the hypothesis is visible in folds 1 and 2 and then independently has the same sign in fold 3. That makes it more defensible than tuning directly to the negative middle fold alone.

Promotion remains forbidden. v7.93 must be evaluated across 30/60/90d, 12h/24h, chronological folds, drawdown, frequency and cost sensitivity before any further decision.
