# MERIDIAN v7.64 — Walk-Forward Interaction Validation

Generated from 6468 chronological 90d cohort samples.

Config: 45d train / 15d holdout / 15d step. Train bucket minimum 50; holdout minimum 15; train Avg R threshold 0.03.

Folds: **3** · selected train buckets: **160** · adequate holdouts: **151** · positive holdouts: **64** · retention: **42.4%**

## Repeated holdout behavior

- **volume15 × side × regime: 0.65-1 × SHORT × TRANSITION** — positive 3/3 folds (100%), weighted holdout Avg R 0.214, n=87
- **volume15 × rsi15: >=1.5 × 50-58** — positive 3/3 folds (100%), weighted holdout Avg R 0.122, n=77
- **volume15 × mtfAlignment: >=1.5 × 1/3** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.09, n=207
- **volume15 × mtfAlignment: 1.15-1.5 × 1/3** — positive 2/3 folds (66.7%), weighted holdout Avg R -0.096, n=154
- **volume15 × adx15: >=1.5 × <18** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.055, n=141
- **volume15 × baselineStatus: >=1.5 × NO_SETUP** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.131, n=140
- **volume15 × side: 1-1.15 × SHORT** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.118, n=118
- **volume15 × adx15: >=1.5 × 18-25** — positive 2/2 folds (100%), weighted holdout Avg R 0.078, n=98
- **volume15 × side: 1-1.15 × LONG** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.084, n=93
- **volume15 × baselineStatus: 1.15-1.5 × READY** — positive 2/3 folds (66.7%), weighted holdout Avg R -0.019, n=93
- **volume15 × regime: >=1.5 × BULL** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.101, n=85
- **volume15 × rsi15: 1.15-1.5 × 42-50** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.063, n=79
- **volume15 × rsi15: >=1.5 × 42-50** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.135, n=74
- **volume15 × adx15: 1-1.15 × 18-25** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.165, n=68
- **volume15 × mtfAlignment: 1-1.15 × 2/3** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.139, n=59
- **volume15 × rsi15: 1-1.15 × 50-58** — positive 2/3 folds (66.7%), weighted holdout Avg R 0.289, n=54
- **volume15 × baselineStatus: 1-1.15 × READY** — positive 2/2 folds (100%), weighted holdout Avg R 0.4, n=36
- **side × regime: SHORT × RANGE** — positive 1/2 folds (50%), weighted holdout Avg R -0.019, n=411
- **side × regime: SHORT × TRANSITION** — positive 1/3 folds (33.3%), weighted holdout Avg R 0.028, n=357
- **volume15 × adx15: <0.65 × 25-35** — positive 1/2 folds (50%), weighted holdout Avg R -0.032, n=253

## Decision rule

Only interactions that survive unseen chronological holdouts are candidates for a future calibrated soft score. This does not change Baseline 6.2 or Paper execution.
