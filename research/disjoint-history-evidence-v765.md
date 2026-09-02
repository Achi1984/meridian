# MERIDIAN v7.65 — Disjoint Historical Validation

Generated: 2026-09-02T14:58:05.112Z

Four non-overlapping 90-day cohorts are used to retest pre-specified v7.64 interaction candidates. No candidate discovery occurs inside these historical blocks.

Minimum samples per candidate/period: **30**

## Candidate robustness

- **VOL_GE15_ADX_LT18** — positive 4/4 adequate periods (100%), weighted Avg R 0.131, n=976, robust=YES
  - P0: 0.143R, n=273, PF=1.273
  - P1: 0.117R, n=232, PF=1.219
  - P2: 0.183R, n=213, PF=1.361
  - P3: 0.088R, n=258, PF=1.162
- **SHORT_TRANSITION_VOL_065_1** — positive 4/4 adequate periods (100%), weighted Avg R 0.104, n=667, robust=YES
  - P0: 0.193R, n=163, PF=1.383
  - P1: 0.055R, n=191, PF=1.099
  - P2: 0.176R, n=153, PF=1.346
  - P3: 0.005R, n=160, PF=1.009
- **VOL_GE15_ADX_18_25** — positive 4/4 adequate periods (100%), weighted Avg R 0.078, n=1148, robust=YES
  - P0: 0.088R, n=300, PF=1.161
  - P1: 0.036R, n=271, PF=1.064
  - P2: 0.083R, n=288, PF=1.152
  - P3: 0.104R, n=289, PF=1.194
- **VOL_1_115_RSI_50_58** — positive 3/4 adequate periods (75%), weighted Avg R 0.126, n=377, robust=YES
  - P0: 0.381R, n=106, PF=1.898
  - P1: 0.129R, n=85, PF=1.244
  - P2: -0.145R, n=101, PF=0.775
  - P3: 0.129R, n=85, PF=1.244
- **VOL_1_115_READY** — positive 3/4 adequate periods (75%), weighted Avg R 0.098, n=374, robust=YES
  - P0: 0.224R, n=102, PF=1.456
  - P1: 0.125R, n=96, PF=1.235
  - P2: -0.094R, n=106, PF=0.848
  - P3: 0.166R, n=70, PF=1.322
- **VOL_GE15_RSI_50_58** — positive 3/4 adequate periods (75%), weighted Avg R 0.052, n=607, robust=YES
  - P0: 0.075R, n=163, PF=1.136
  - P1: 0.142R, n=145, PF=1.271
  - P2: 0.014R, n=161, PF=1.024
  - P3: -0.026R, n=138, PF=0.956
- **VOL_GE15_NO_SETUP** — positive 3/4 adequate periods (75%), weighted Avg R 0.049, n=982, robust=YES
  - P0: 0.094R, n=248, PF=1.172
  - P1: 0.068R, n=254, PF=1.122
  - P2: 0.083R, n=235, PF=1.15
  - P3: -0.05R, n=245, PF=0.918
- **VOL_GE15_RSI_42_50** — positive 2/4 adequate periods (50%), weighted Avg R 0.046, n=569, robust=NO
  - P0: 0.118R, n=146, PF=1.221
  - P1: -0.057R, n=140, PF=0.906
  - P2: 0.257R, n=147, PF=1.54
  - P3: -0.153R, n=136, PF=0.764

## Promotion guardrail

A candidate is marked robust only when at least 3 periods are adequate, at least 75% of adequate periods are positive, and weighted Avg R remains above zero. This remains research evidence only; Baseline 6.2 and Paper execution are unchanged.
