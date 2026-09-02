# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Main contains the stable research stack through v7.51 plus preserved evidence reports for rejected Challenger V3/V3.1 experiments and Signal Calibration.
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

## Next recommended work — highest priority

### Priority 1 — Raw Feature Edge Map / Feature Attribution Lab
Before writing Challenger V3.2, measure raw feature/outcome relationships on portfolio-independent signal cohorts. Candidate features should include:
- 15m / 1h / 4h directional alignment
- ADX / trend-strength buckets
- RSI state by side
- MACD agreement across timeframes
- volume participation
- EMA20/EMA50 structure and price-to-EMA distance
- side × regime
- Baseline status as evidence only

Use normalized R outcomes, adequate samples and cross-window stability. Look for monotonic or repeatable relationships, not isolated best buckets.

### Priority 2 — Challenger V3.2 only after Feature Edge Map
Build V3.2 from evidence-backed soft features. Preserve independent opportunity discovery, but do not copy V3/V3.1 weights. Retest signal calibration first, then portfolio 30/60/90d, walk-forward, frequency and opportunity cost.

### Priority 3 — Regime V2
Recompute all directional evidence after final side selection. Test independently.

### Priority 4 — Hybrid / Allocator
Only combine validated Challenger and Regime components. Use regime primarily as a soft strategy/risk allocator rather than adding many hard gates.

### Priority 5 — Exit Lab integration
Only after entry/scoring edge is demonstrated, replay the validated entry cohort through A/B/C/D and BE probes. Do not mix entry and exit changes prematurely.

## Promotion gate

No winner on a tiny or path-dependent sample. Promotion requires common-window evaluation, adequate closed-trade count, positive PF/expectancy, acceptable drawdown, sufficient frequency/coverage, manageable opportunity cost, signal-level calibration and stability across regimes/windows. No automatic promotion.

## New-chat startup instruction

A fresh chat should begin with:

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md` first. Treat them as the canonical MERIDIAN project memory and continue from the handoff without changing Baseline 6.2.”**

After reading, verify `version.json` and current `main` HEAD before making changes because deployment state may have advanced.
