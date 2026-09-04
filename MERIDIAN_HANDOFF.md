# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Main contains the stable research stack through v7.51 plus preserved evidence reports for rejected Challenger V3/V3.1 experiments and Signal Calibration.
- The active research continuation is branch `research/adaptive-evidence-v774` and draft PR #30.
- Adaptive Evidence remains research-only and is not connected to Paper execution.
- The rejected V3/V3.1 implementation branches must not be treated as production candidates or silently merged.

## Latest durable research findings

### v7.51 — Exit Lab Evidence
Runner/BE exits can materially outperform full TP1 in some windows but are not robust across 30d/60d/90d. No exit promotion yet. Keep A_CURRENT/full TP1 when testing entry/scoring architecture so attribution remains clean.

### Challenger V3 — rejected experiment
V3 removed the Baseline `READY` hard dependency as intended, but simply widening the opportunity universe performed badly. In the tested 30d and 60d windows PF/expectancy deteriorated sharply and most V3 trades were outside READY. 90d remained positive but weaker than Baseline/V2 and with higher drawdown. Preserve the evidence; do not promote the implementation.

### Challenger V3.1 — improved but still rejected
V3.1 strengthened soft penalties for entry distance/status and reduced risk outside READY. It improved materially over V3, including lower 90d DD, but still failed robustness and remained weaker than Challenger V2/Baseline on the key comparison. Do not continue tuning thresholds by intuition.

### v7.55 — Signal Calibration Lab
Portfolio-independent calibration sampled one candidate per symbol per 4h across 12 assets and evaluated A_CURRENT normalized R with a 14-day horizon, excluding portfolio max-position/daily-loss/max-DD gates.

Critical result: **all confidence buckets were negative over 30d, 60d and 90d. Higher confidence was not monotonic with better normalized outcome.** This means the current compressed confidence stack is not a validated predictor of edge. Positive portfolio windows can be caused by path-dependent portfolio selection and must not be used to declare the score calibrated.

### v7.74 — Adaptive Evidence Lab current checkpoint
The research branch now contains the complete first calibration pipeline from prepared research events to out-of-sample evidence reporting.

Implemented:
- `adaptive-evidence.js` — side-aware raw observations plus reliability-weighted soft evidence; no fixed LONG + RANGE or other context bonus.
- `adaptive-evidence-cohorts.js` — portfolio-independent A_CURRENT normalized-R cohorts, default one sample per symbol per 4h.
- full-horizon guard — recent signals without the complete 14-day outcome horizon are excluded by default to prevent right-censoring bias.
- `adaptive-evidence-walkforward.js` — expanding out-of-sample validation with an explicit train/test overlap guard.
- `adaptive-evidence-report.js` — 30d/60d/90d multi-window evidence report, reliable positive/negative feature summaries and Market Capture / Opportunity Cost.
- `scripts/adaptive-evidence-report.mjs` — reproducible JSON/Markdown report CLI for prepared MERIDIAN research events.
- tests for observations, shrinkage, cohort construction, no look-ahead, horizon censoring, leakage prevention, walk-forward, report output and market capture.

GitHub Release Safety passed on the cohort-builder checkpoint commit `458b52e4ade75ba83916b45f6954449bc3a0d1ea`. Later commits must still be verified by CI before merge.

Preserved evidence files:
- `research/challenger-v3-evidence-v752.md`
- `research/challenger-v31-evidence-v753.md`
- `research/signal-calibration-v755.md`
- `research/adaptive-evidence-v774.md`

## Known bot findings that must not be forgotten

1. **Baseline 6.2** remains frozen.
2. **Shadow V1** remains the over-filtering/hard-gate control.
3. **Challenger V2** has a Baseline-READY dependency but currently remains the stronger Challenger control versus rejected V3/V3.1.
4. Removing READY as a hard gate remains architecturally desirable, but the replacement scoring model must first demonstrate real signal-level edge.
5. **Regime V1** can adapt side while technical/candidate inputs can still reflect the source side; Regime V2 must recompute evidence for the final side.
6. LONG/SHORT must always be interpreted in regime context.
7. Trade frequency, opportunity cost, avoided losers and missed winners remain mandatory metrics.
8. More evidence must not automatically become more hard gates.
9. Fixed context bonuses are not considered durable evidence; future V3.2 scoring should be fed by measured cohorts.
10. Training evidence must strictly predate each evaluated walk-forward slice; no same-window calibration.
11. Signals without a complete configured outcome horizon must not enter calibration by default.

## Next recommended work — highest priority

### Priority 1 — Connect the report pipeline to canonical Research Engine events
The v7.74 report CLI currently consumes prepared MERIDIAN research events. Add the thinnest possible research-only adapter/export from `cloud-backtest.js` so the same canonical `candidate()` / `prepareEvents()` path can feed the report without duplicating signal logic.

Guardrails:
- do not change candidate calculations,
- do not change Baseline/Shadow/Challenger/Regime execution,
- do not touch `server.js`,
- export/reuse existing research functions rather than cloning them into a second implementation.

### Priority 2 — Generate actual 12-asset evidence reports
Use BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET and INJ. Produce 30d / 60d / 90d JSON + Markdown reports with 14-day full-horizon outcomes and expanding walk-forward slices.

Interpretation must include:
- sample adequacy and feature reliability,
- avg/median R and PF,
- LONG/SHORT × regime,
- market coverage,
- missed-winner R,
- avoided-loser R,
- net opportunity cost,
- Market Capture,
- cross-window and out-of-sample stability.

### Priority 3 — Challenger V3.2 portfolio replay only after calibration
Only if Adaptive Evidence shows repeatable out-of-sample predictive value should a Challenger V3.2 portfolio replay be implemented. Do not reuse V3/V3.1 threshold tuning and do not auto-promote it.

### Priority 4 — Regime V2
Recompute all directional evidence after final side selection. Test independently.

### Priority 5 — Hybrid / Allocator and Exit Lab integration
Only combine validated components. Exit changes remain separate until entry/scoring edge is established.

## Promotion gate

No winner on a tiny or path-dependent sample. Promotion requires common-window evaluation, adequate closed-trade count, positive PF/expectancy, acceptable drawdown, sufficient frequency/coverage, manageable opportunity cost, signal-level calibration and stability across regimes/windows. No automatic promotion.

## Save-progress rule

Do not leave meaningful MERIDIAN work only in chat. Save every substantial implementation/research checkpoint to GitHub with a descriptive commit. Keep experimental work on a named research branch until it is reviewed, then merge deliberately.

## New-chat startup instruction

A fresh chat should begin with:

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md` first. Treat them as the canonical MERIDIAN project memory and continue from the handoff without changing Baseline 6.2.”**

After reading, verify `version.json`, current `main` HEAD and active research branches before making changes because deployment state may have advanced.