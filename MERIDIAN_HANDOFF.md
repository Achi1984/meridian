# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Main contains the stable research stack through v7.51 plus preserved evidence reports for rejected Challenger V3/V3.1 experiments and Signal Calibration.
- The active research continuation is branch `research/adaptive-evidence-v774`.
- `adaptive-evidence.js` is research-only and is not connected to Paper execution.
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

### v7.74 — Adaptive Evidence Lab checkpoint
A new research-only core now converts raw context observations into reliability-weighted soft evidence. There is no built-in LONG + RANGE or other context bonus. Small samples are shrunk toward zero; cross-window agreement affects reliability; missing evidence is neutral.

The first implementation covers:
- side,
- regime,
- 15m / 1h / 4h alignment,
- momentum,
- volume participation,
- volatility,
- asset × side,
- Baseline status as evidence only,
- Market Capture / Opportunity Cost metrics.

Files:
- `adaptive-evidence.js`
- `test/adaptive-evidence.test.js`
- `research/adaptive-evidence-v774.md`

Preserved evidence files:
- `research/challenger-v3-evidence-v752.md`
- `research/challenger-v31-evidence-v753.md`
- `research/signal-calibration-v755.md`

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

## Next recommended work — highest priority

### Priority 1 — Historical cohort generator for Adaptive Evidence
Build a portfolio-independent research script that samples valid signal candidates and writes normalized-R cohorts for the exact dimensions consumed by `adaptive-evidence.js`.

Required windows:
- 30d
- 60d
- 90d
- walk-forward / out-of-sample slices

Required output per cohort:
- sample count `n`
- average / median R
- win rate
- positive / negative R totals
- window-level avgR for stability
- feature key / side / regime context

The generator must avoid portfolio gates so signal quality is measured separately from path dependence.

### Priority 2 — Feed measured evidence into Adaptive Evidence replay
After cohorts exist, replay Adaptive Evidence labels against the same historical opportunity stream and compare:
- expectancy / PF
- max DD
- trade frequency / coverage
- missed-winner R
- avoided-loser R
- net opportunity cost
- market-capture percentage
- LONG/SHORT × regime behavior

### Priority 3 — Challenger V3.2 only after calibration
Only when the Adaptive Evidence score is demonstrably predictive at signal level should a Challenger V3.2 portfolio replay be built. Do not reuse V3/V3.1 threshold tuning.

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