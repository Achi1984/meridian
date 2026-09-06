# MERIDIAN v7.95 — Failure-State Attribution

Status: RESEARCH ONLY — NO PROMOTION.

Run: GitHub Actions #43 `Hybrid Alpha v7.95 Failure Attribution`.
Artifact: `9987676090`.
Digest: `sha256:1ba694f4d4311327cb18e07972e2743f1cc489696a4531ee9c4f7ca3017b3faf`.
Source candidate: frozen v7.93 on the locked v7.94 7-asset universe.
Primary horizon/window: 24h / 90d.

## Method
Bucket boundaries were predeclared before reading v7.95 output in `research/hybrid-alpha-v795-failure-attribution-design.md`. The attribution copies decision-time diagnostics into research rows only; it changes no decision, risk, trade count, execution or outcome.

## Repeated single-dimension failure states
The cleanest repeated failures are:

- **WEAK alpha (`|alpha| 0.20–0.35`)**: failing fold n=52, EXP `-0.507R`; full 90d n=129, EXP `-0.261R`; negative in both other chronological folds with adequate samples. This is structurally important because v7.93 uses alpha magnitude to cross the entry threshold but does not monotonically scale risk by alpha strength after entry.
- **LOW liquidity (`liquidityQuality <0.50`)**: failing fold n=14, EXP `-1.411R`; full 90d n=52, EXP `-0.878R`; negative in both other folds. The existing liquidity haircut reduces risk but does not eliminate the negative residual.
- **SHORT**: failing fold n=79, EXP `-1.216R`; full 90d n=209, EXP `-0.157R`; negative in one other fold. This remains a broad asymmetry, but a SHORT-only rule would be too coarse and is not recommended.
- **LOW volatility**: failing fold n=32, EXP `-1.791R`; full 90d n=134, EXP `-0.665R`; negative in one other fold. This may overlap with regime/side effects and is not yet clean enough for a new rule.

## Repeated cross-state failures
- **BULL × macro ALIGNED**: failing fold n=14, EXP `-3.918R`; full 90d n=66, EXP `-1.455R`; negative in both other folds.
- **LONG × macro ALIGNED**: failing fold n=30, EXP `-1.717R`; full 90d n=111, EXP `-0.754R`; negative in both other folds.
- **SHORT × TRANSITION** remains poor despite v7.93 attenuation: failing fold n=28, EXP `-3.190R`; full 90d n=111, EXP `-0.800R`; negative in one other fold.

The macro-aligned result is counterintuitive and may indicate late trend-chasing/overextension rather than a universal anti-trend effect. It should not become a hard anti-momentum rule from this sample alone.

## Decision
No promotion and no retrospective filtering. Do not drop AVAX, create LONG-only/SHORT-off rules, alter the v7.93 0.60 factor, or move bucket boundaries.

## Preferred next hypothesis — v7.96
If research continues, test exactly one soft change: **WEAK-alpha risk attenuation**, not a gate. For `|alpha| 0.20–0.35`, multiply the already-calculated v7.93 research risk by the existing fixed attenuation constant `0.60`; medium/strong alpha remain unchanged. Reusing 0.60 avoids introducing a newly tuned parameter. Trade count must remain unchanged. Compare 30/60/90d, 90d chronological folds, DD, side/regime/asset breadth and opportunity cost. LOW-liquidity attenuation is the secondary hypothesis only if weak-alpha attenuation fails.
