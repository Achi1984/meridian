# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Current research stack includes Research Engine V2, Regime V1, Research Telemetry V1, Exit Lab Historical Replay and the v7.51 Exit Lab evidence report.
- v7.50 added the project continuity layer only; trading behavior remained unchanged.

## Latest completed development

### v7.47 — Research Telemetry
Comparable ledger analytics including expectancy, payoff ratio, historical max drawdown, frequency, holding duration, side/symbol/regime/exit splits and Challenger opportunity-cost counterfactuals.

### v7.48 — Exit Lab V1
Research-only exit models: full TP1, protected BE runner, ATR runner and adaptive runner.

### v7.49 — Historical fixed-entry replay
Same historical entries replayed through all exit policies on subsequent 15m candles. Added TP1-close confirmation, BE+0.10R and BE+0.25R probes.

### v7.51 — Exit Lab Evidence Report
Ran a reproducible 12-asset fixed-entry comparison over 30d, 60d and 90d windows using BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET and INJ.

Key evidence:
- Runner exits were materially better in the 90d window for Baseline, Shadow and Challenger.
- Challenger D_ADAPTIVE improved vs full TP1 by +1.502R in 30d and +5.712R in 90d, but lost -1.447R vs full TP1 in 60d.
- Challenger B_PROTECTED improved +0.422R in 30d and +4.243R in 90d, but lost -1.838R in 60d.
- Immediate BE protection generated meaningful TP1→BE stop rates; it is not a free improvement.
- No exit model is robust enough yet to replace current execution.
- The first report formatting used wrong aggregate field names for giveback/BE/TP2; this was caught and corrected before interpretation.

## Known bot findings that must not be forgotten

1. **Baseline 6.2** is the frozen benchmark and should not be optimized in place.
2. **Shadow V1** is the over-filtering/hard-gate control; low DD alone is not sufficient evidence of superiority.
3. **Challenger V2** still depends on Baseline `READY` for executable opportunities despite using soft confidence. This is the next architectural limitation to remove.
4. **Regime V1** can adapt side while technical/candidate inputs may still reflect the original Baseline side. Regime V2 must recompute evidence for the final direction.
5. Do not compare LONG/SHORT without regime context.
6. Always include trade frequency and opportunity cost.
7. Do not add hard gates merely because more evidence exists.

## Exit-management conclusion at this checkpoint

Do **not** promote a runner/BE policy yet. Exit Lab remains research-only.

For the first Challenger V3 evaluation, keep **A_CURRENT / full TP1** unchanged. This isolates the effect of the new independent entry/scoring architecture. After Challenger V3 has independent evidence, replay the same V3 entries through the Exit Lab policies.

## Next recommended work

### Priority 1 — Challenger V3
Build a new research-only bot with:
- independent opportunity universe from all valid scanner candidates
- Baseline status as soft evidence only, never a hidden hard dependency
- side-specific technical/candidate scoring
- soft TRADE / CAUTION / SKIP confidence
- separate ledger and telemetry
- current full-TP1 exit for the initial comparison
- frequency/opportunity-cost comparison against Baseline and Challenger V2

Do not modify Challenger V2 in place; preserve it as a control.

### Priority 2 — Challenger V3 Exit Replay
Once V3 entries exist, replay those identical entries through A/B/C/D plus the BE probes. Only then decide whether a runner should be coupled to V3.

### Priority 3 — Regime V2
Recompute all directional evidence after final side selection. Test independently before combining with Challenger V3.

### Priority 4 — Hybrid / Allocator
Only after Challenger V3 and Regime V2 have independent evidence, test soft allocation of setup quality + regime into risk/strategy/exit behavior.

## Promotion gate

Do not declare a winner on a tiny sample. Promotion requires common-window evaluation, adequate closed-trade count, positive PF/expectancy, acceptable drawdown, sufficient frequency/coverage, manageable opportunity cost and stability across regimes/windows. No automatic promotion.

## New-chat startup instruction

A fresh chat should begin with:

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md` first. Treat them as the canonical MERIDIAN project memory and continue from the handoff without changing Baseline 6.2.”**

After reading, verify `version.json` and current `main` HEAD before making changes because deployment state may have advanced.
