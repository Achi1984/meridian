# MERIDIAN v7.63 — Feature Interaction Evidence

Generated: 2026-09-02T14:48:57.352Z

Conditional raw-feature attribution on the same portfolio-independent cohorts as v7.62. Minimum adequate bucket size: 40.

## Repeatable positive interactions

- **volume15 × regime: >=1.5 × RANGE** — 30d: 0.095R (n=114, PF=1.174); 60d: 0.052R (n=187, PF=1.093); 90d: 0.14R (n=259, PF=1.266)
- **volume15 × regime: 0.65-1 × TRANSITION** — 30d: 0.07R (n=92, PF=1.125); 60d: 0.094R (n=204, PF=1.173); 90d: 0.008R (n=357, PF=1.014)
- **volume15 × regime: 1-1.15 × RANGE** — 30d: 0.056R (n=50, PF=1.1); 60d: 0.229R (n=82, PF=1.47); 90d: 0.263R (n=114, PF=1.556)
- **volume15 × regime: 1-1.15 × TRANSITION** — 60d: 0.137R (n=57, PF=1.26); 90d: 0.188R (n=103, PF=1.373)
- **volume15 × regime: 1-1.15 × BULL** — 60d: 0.171R (n=41, PF=1.333); 90d: 0.145R (n=65, PF=1.276)
- **volume15 × mtfAlignment: 1-1.15 × 2/3** — 60d: 0.105R (n=76, PF=1.195); 90d: 0.14R (n=120, PF=1.267)
- **volume15 × mtfAlignment: 1-1.15 × 0/3** — 60d: 0.222R (n=55, PF=1.452); 90d: 0.185R (n=79, PF=1.365)
- **volume15 × baselineStatus: >=1.5 × NO_SETUP** — 30d: 0.073R (n=85, PF=1.132); 60d: 0.106R (n=191, PF=1.196); 90d: 0.094R (n=248, PF=1.172)
- **volume15 × baselineStatus: >=1.5 × READY** — 30d: 0.029R (n=42, PF=1.05); 60d: 0.095R (n=103, PF=1.175); 90d: 0.001R (n=151, PF=1.002)
- **volume15 × baselineStatus: 1-1.15 × READY** — 60d: 0.182R (n=67, PF=1.359); 90d: 0.224R (n=102, PF=1.456)
- **volume15 × rsi15: 0.65-1 × 42-50** — 30d: 0.021R (n=134, PF=1.036); 60d: 0.074R (n=295, PF=1.134); 90d: 0.022R (n=458, PF=1.038)
- **volume15 × rsi15: >=1.5 × 50-58** — 30d: 0.056R (n=50, PF=1.1); 60d: 0.149R (n=117, PF=1.285); 90d: 0.075R (n=163, PF=1.136)
- **volume15 × rsi15: >=1.5 × 42-50** — 30d: 0.226R (n=47, PF=1.461); 60d: 0.135R (n=110, PF=1.255); 90d: 0.118R (n=146, PF=1.221)
- **volume15 × rsi15: 1-1.15 × 30-42** — 60d: 0.053R (n=57, PF=1.094); 90d: 0.176R (n=102, PF=1.346)
- **volume15 × rsi15: 1-1.15 × 58-70** — 60d: 0.078R (n=69, PF=1.142); 90d: 0.085R (n=104, PF=1.154)
- **volume15 × rsi15: 1-1.15 × 50-58** — 60d: 0.395R (n=74, PF=1.942); 90d: 0.381R (n=106, PF=1.898)
- **volume15 × rsi15: >=1.5 × >=70** — 60d: 0.024R (n=75, PF=1.042); 90d: 0.035R (n=109, PF=1.061)
- **volume15 × rsi15: >=1.5 × <30** — 60d: 0.029R (n=56, PF=1.05); 90d: 0.006R (n=105, PF=1.01)
- **volume15 × rsi15: 0.65-1 × <30** — 60d: 0.067R (n=45, PF=1.12); 90d: 0.018R (n=66, PF=1.032)
- **volume15 × adx15: >=1.5 × 18-25** — 30d: 0.074R (n=105, PF=1.134); 60d: 0.11R (n=201, PF=1.206); 90d: 0.088R (n=300, PF=1.161)
- **volume15 × adx15: >=1.5 × <18** — 30d: 0.025R (n=89, PF=1.043); 60d: 0.092R (n=200, PF=1.169); 90d: 0.143R (n=273, PF=1.273)
- **volume15 × adx15: 1-1.15 × 18-25** — 30d: 0.1R (n=48, PF=1.185); 60d: 0.213R (n=89, PF=1.432); 90d: 0.145R (n=132, PF=1.278)
- **volume15 × adx15: 1-1.15 × <18** — 60d: 0.015R (n=78, PF=1.027); 90d: 0.026R (n=117, PF=1.045)
- **volume15 × side × regime: >=1.5 × LONG × RANGE** — 30d: 0.2R (n=58, PF=1.4); 60d: 0.08R (n=100, PF=1.145); 90d: 0.084R (n=124, PF=1.153)
- **volume15 × side × regime: 0.65-1 × SHORT × TRANSITION** — 30d: 0.28R (n=45, PF=1.6); 60d: 0.164R (n=99, PF=1.318); 90d: 0.193R (n=163, PF=1.383)
- **volume15 × side × regime: 1.15-1.5 × SHORT × RANGE** — 60d: 0.023R (n=61, PF=1.04); 90d: 0.171R (n=82, PF=1.333)
- **volume15 × side × regime: >=1.5 × SHORT × TRANSITION** — 60d: 0.075R (n=67, PF=1.135); 90d: 0.12R (n=105, PF=1.225)
- **volume15 × side × regime: 1-1.15 × SHORT × BEAR** — 60d: 0.019R (n=73, PF=1.033); 90d: 0.117R (n=116, PF=1.219)
- **volume15 × side × regime: >=1.5 × LONG × BULL** — 60d: 0.07R (n=92, PF=1.125); 90d: 0.047R (n=133, PF=1.083)
- **volume15 × side × regime: 1.15-1.5 × SHORT × TRANSITION** — 60d: 0.029R (n=49, PF=1.05); 90d: 0.005R (n=74, PF=1.009)
- **volume15 × side × regime: 1-1.15 × LONG × RANGE** — 60d: 0.34R (n=43, PF=1.768); 90d: 0.309R (n=55, PF=1.68)

## Guardrail

Interactions remain research evidence only. Do not promote Challenger V3.2 from one attractive combination; require walk-forward validation.
