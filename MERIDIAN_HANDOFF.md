# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Deployed app/UI version may remain behind research-only milestone numbering.
- Research evidence now extends through **v7.66 Challenger V3.2 Soft Score Evidence**.
- Baseline 6.2 remains frozen; no v7.61–v7.66 research work changed Paper execution or `server.js`.
- Rejected V3/V3.1 branches remain evidence only and must not be silently merged.

## Latest durable research findings

### v7.55 — Signal Calibration
The old compressed confidence stack failed signal-level calibration: every confidence bucket was negative across 30d/60d/90d and confidence was not monotonic with outcome. Do not return to blind threshold/weight tuning of that stack.

### v7.61–v7.62 — Raw Feature Attribution + portfolio-independent cohorts
One candidate per symbol per 4h across 12 assets, A_CURRENT/full-TP1 normalized-R, 14-day horizon, portfolio gates excluded. Raw overall signal expectancy remained weak. 15m volume participation was one of the few repeatable positive observations.

### v7.63 — Feature Interaction Lab
Interactions exposed conditional edge that single indicators hid. Important families: 15m volume × ADX/RSI and volume × side × regime.

### v7.64 — Chronological walk-forward
45d train / 15d holdout / 15d step. Only 42.4% of adequate selected holdouts remained positive. Particularly durable holdouts included SHORT × TRANSITION × volume 0.65–1 and high-volume RSI/ADX contexts.

### v7.65 — Four disjoint 90-day validation blocks
Pre-specified candidates were retested without discovery inside the blocks. Strongest durable candidates:
- `VOL_GE15_ADX_LT18`: 4/4 positive, weighted Avg R +0.131, n=976.
- `SHORT_TRANSITION_VOL_065_1`: 4/4 positive, +0.104, n=667.
- `VOL_GE15_ADX_18_25`: 4/4 positive, +0.078, n=1148.
Four weaker interactions passed 3/4; `VOL_GE15_RSI_42_50` failed 2/4.

### v7.66 — Challenger V3.2 evidence-backed soft ranking
Files:
- `challenger-v32.js`
- `scripts/challenger-v32-v766.mjs`
- `test/challenger-v32.test.js`
- `.github/workflows/challenger-v32-v766.yml`
- `research/challenger-v32-evidence-v766.json`
- `research/challenger-v32-evidence-v766.md`

Architecture:
- Research-only, `executionImpact:false`.
- Independent of Baseline `READY`; ranks the full portfolio-independent signal universe.
- Small additive evidence weights only; no new hard entry gates.
- Baseline status is at most a weak soft feature.
- Equal-coverage comparison: V3.2 selects exactly the same candidate count as Baseline READY in each 90-day period.

Evidence:
- P0: Baseline n=1657, AvgR -0.004, PF 0.994; V3.2 n=1657, AvgR +0.039, PF 1.068.
- P1: Baseline n=1675, AvgR +0.007, PF 1.013; V3.2 n=1675, AvgR +0.050, PF 1.089.
- P2: Baseline n=1672, AvgR -0.041, PF 0.931; V3.2 n=1672, AvgR +0.012, PF 1.021.
- P3: Baseline n=1550, AvgR +0.003, PF 1.006; V3.2 n=1550, AvgR +0.092, PF 1.168.
- V3.2 AvgR better in 4/4 periods with equal coverage.
- V3.2 replaces a large part of the READY cohort, so opportunity-cost accounting is mandatory. Example P0: overlap 360, discovered/displaced 1297, avoided losers 765, missed winners 532.

Important limitation: v7.66 combines features selected using related historical evidence, so these four periods are **not a fresh untouched holdout**. Do not call v7.66 promotion proof and do not tune weights further just to optimize these blocks.

## Known bot findings that must not be forgotten

1. Baseline 6.2 stays frozen.
2. Shadow V1 remains the over-filtering/hard-gate control.
3. Challenger V2 remains a useful control but is restricted by Baseline READY.
4. V3/V3.1 are rejected implementations.
5. V3.2 is the first evidence-backed independent Challenger candidate, but is still a lab model, not an active Paper/Shadow bot.
6. LONG/SHORT must be judged in regime context.
7. Regime V2 must recompute evidence for the final selected side.
8. Frequency, drawdown, concurrency, opportunity cost, avoided losers and missed winners are mandatory.
9. More evidence must not automatically become more hard gates.
10. Exit logic remains A_CURRENT/full TP1 while entry/scoring is being validated.

## Next recommended work — highest priority

### Priority 1 — v7.67 Portfolio-Path Replay for Challenger V3.2
Build a research-only chronological portfolio simulator that compares **Baseline READY vs V3.2** under identical execution assumptions rather than signal-level top-N alone.

Requirements:
- same starting capital/risk model for both;
- same A_CURRENT/full TP1 outcome/exit policy;
- chronological entries and exits;
- max-open/concurrency constraints applied equally;
- no future information in ranking or portfolio selection;
- common evaluation periods;
- record PF, expectancy/AvgR, total R/equity, historical max DD, frequency, concurrency/exposure, avoided losers, missed winners and opportunity cost;
- include 30/60/90 and/or the four disjoint 90-day blocks where feasible;
- do not alter v7.66 weights based on replay results during the same test.

Decision after v7.67:
- If V3.2 keeps its edge with acceptable DD and coverage, freeze the scorer and start a prospective/future holdout before Shadow activation.
- If it fails portfolio-path replay, do not threshold-tune blindly; diagnose feature/interaction attribution and portfolio selection effects.

### Priority 2 — Prospective frozen-score holdout
Only after v7.67 passes. No score changes during the observation window.

### Priority 3 — Regime V2
Side-specific rescoring after final side selection. Validate separately before Hybrid/Allocator.

### Priority 4 — Exit Lab integration
Only after entry/scoring is validated. Keep entry and exit attribution separate.

## Promotion gate

No automatic promotion. Require common-window evidence, adequate trade count, positive expectancy/PF, acceptable drawdown, sufficient frequency/coverage, manageable opportunity cost, stable side/regime behavior, portfolio-path validation, prospective evidence and explicit human approval.

## New-chat startup instruction

A fresh chat should begin with:

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md` first. Treat them as the canonical MERIDIAN project memory and continue from the handoff without changing Baseline 6.2.”**

After reading, verify `version.json` and current `main` HEAD before making changes because deployment state may have advanced.
