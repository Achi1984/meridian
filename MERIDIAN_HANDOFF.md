# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Current research stack through v7.49 includes Research Engine V2, Regime V1, Research Telemetry V1 and Exit Lab Historical Replay.
- v7.50 adds the project continuity layer only. It must not change trading behavior.

## Latest completed development

### v7.47 — Research Telemetry
Added comparable ledger analytics including expectancy, payoff ratio, historical max drawdown, frequency, holding duration, side/symbol/regime/exit splits and Challenger opportunity-cost counterfactuals.

### v7.48 — Exit Lab V1
Added research-only exit models:
- A full TP1
- B protected runner: 50% TP1 then BE+cost toward TP2
- C ATR runner
- D adaptive runner

### v7.49 — Historical fixed-entry replay
Attached Exit Lab to historical 15m replay using identical original entries for each exit model. Added probes for:
- TP1 close-confirmation before BE
- BE +0.10R
- BE +0.25R

No existing Paper execution was changed.

## Known bot findings that must not be forgotten

1. **Baseline 6.2** is the frozen benchmark and should not be optimized in place.
2. **Shadow V1** is useful as the over-filtering/hard-gate control; low DD alone is not sufficient evidence of superiority.
3. **Challenger V2** currently depends on the Baseline `READY` universe for executable Paper opportunities despite using soft confidence. This is the main architectural limitation to remove in Challenger V3.
4. **Regime V1** can adapt side, but its technical/candidate inputs can still reflect the original Baseline side. Regime V2 must recompute evidence for the final selected direction.
5. Do not compare LONG/SHORT without regime context.
6. Always include trade frequency and opportunity cost when judging improvements.
7. Do not add hard gates merely because more evidence is available.

## Exit-management hypothesis under test

The preferred candidate to beat the current full-TP1 exit is:

**TP1 → realize part of the position → move remaining stop to break-even plus costs → allow runner toward TP2.**

However this is not yet a promoted rule. Immediate BE must be compared with confirmed-close BE, +0.10R and +0.25R protection, ATR trailing and regime-adaptive exits. The winner must be chosen from historical evidence rather than intuition.

## Next recommended work

### Priority 1 — Analyze Exit Lab historical results
Run/inspect the cloud backtest output and compare exit policies across all bot cohorts. Focus on robustness, not only the best aggregate R.

Required comparison:
- total and average/median R
- win rate in R
- giveback
- TP1→BE stop rate
- TP2 continuation
- LONG/SHORT
- coin
- regime
- time-window stability

### Priority 2 — Challenger V3
Build a new research-only bot with:
- independent opportunity universe from valid scanner candidates
- Baseline status only as optional soft evidence, not a hard dependency
- side-specific technical/candidate scoring
- soft TRADE / CAUTION / SKIP confidence
- separate ledger and telemetry
- frequency/opportunity-cost comparison against Baseline and Challenger V2

Do not modify Challenger V2 in place; preserve it as a control.

### Priority 3 — Regime V2
Recompute all directional evidence after the final side is selected. Then test Regime V2 independently before combining it with Challenger V3.

### Priority 4 — Hybrid / Allocator
Only after Challenger V3 and Regime V2 have independent evidence, test a hybrid where setup quality and regime influence position sizing/strategy/exit behavior through soft allocation rather than excessive hard gates.

## Promotion gate

Do not declare a winner on a tiny sample. Research promotion requires a common evaluation window, adequate closed-trade count, positive PF/expectancy, acceptable drawdown, sufficient frequency/coverage, manageable opportunity cost and stability across regimes/windows. No automatic promotion.

## New-chat startup instruction

A fresh chat should begin with:

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md` first. Treat them as the canonical MERIDIAN project memory and continue from the handoff without changing Baseline 6.2.”**

After reading, verify the current `version.json` and current `main` HEAD before making changes because deployment state may have advanced since this handoff was written.
