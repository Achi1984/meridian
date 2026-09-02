# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Deployed app/UI version may remain behind research-only milestone numbering.
- Research evidence now extends through **v7.67 Challenger V3.2 Portfolio-Path Replay**.
- Baseline 6.2 remains frozen; no v7.61–v7.67 research work changed Paper execution or `server.js`.
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
Strongest durable candidates:
- `VOL_GE15_ADX_LT18`: 4/4 positive, weighted Avg R +0.131, n=976.
- `SHORT_TRANSITION_VOL_065_1`: 4/4 positive, +0.104, n=667.
- `VOL_GE15_ADX_18_25`: 4/4 positive, +0.078, n=1148.
Four weaker interactions passed 3/4; `VOL_GE15_RSI_42_50` failed 2/4.

### v7.66 — Challenger V3.2 evidence-backed soft ranking
V3.2 is research-only, independent of Baseline `READY`, and uses small additive weights from the robust interaction evidence. No new hard entry gates were added. At exactly equal signal count to Baseline READY across four 90-day periods, V3.2 improved Avg R and PF in all 4/4 periods. This confirmed signal-level ranking improvement but was not an untouched holdout.

### v7.67 — Challenger V3.2 chronological portfolio-path replay
Implementation/evidence files:
- `portfolio-path-v767.js`
- `scripts/portfolio-path-v767.mjs`
- `test/portfolio-path-v767.test.js`
- `.github/workflows/portfolio-path-v767.yml`
- `research/portfolio-path-evidence-v767.json`
- `research/portfolio-path-evidence-v767.md`

Method:
- identical 10,000 start equity for Baseline and V3.2;
- 1% risk/trade;
- max 3 open positions;
- max 3% portfolio risk;
- max 8 entries/day;
- 3% daily-loss gate;
- 8% max-drawdown gate;
- 30m symbol cooldown;
- same A_CURRENT/full-TP1 cohort outcomes;
- chronological entry/exit competition;
- no future outcome information in ranking.

Final corrected evidence:
- 30d: Baseline 139 trades, AvgR +0.157, PF 1.303, end equity 12,271.61, realized DD 8.89%; V3.2 108 trades, AvgR +0.022, PF 1.039, end equity 10,164.62, DD 9.31%.
- 60d: Baseline 203 trades, AvgR +0.159, PF 1.307, end equity 13,411.52, DD 9.55%; V3.2 only 9 trades, AvgR -1.000, PF 0, end equity 9,126.73, DD 8.73% because it hit the hard drawdown stop early.
- 90d/P0: Baseline 33 trades, AvgR +0.018, PF 1.032; V3.2 32 trades, AvgR +0.050, PF 1.089.
- P1: Baseline AvgR +0.034 / PF 1.059; V3.2 +0.094 / 1.173.
- P2: Baseline -0.354 / 0.516; V3.2 -0.169 / 0.741.
- P3: Baseline -1.000 / 0; V3.2 -0.136 / 0.787.
- Across P0–P3, V3.2 had better AvgR in 4/4 and better PF in 4/4, but lower realized DD in 0/4.

Interpretation:
- The v7.66 ranking edge survives chronological portfolio slot competition.
- Portfolio survival/risk robustness does **not** yet pass. The 60d vs later 30d contrast shows strong path dependence from the hard max-DD gate.
- Do not activate V3.2 in Shadow/Paper yet.
- Do not tune v7.66 feature weights on v7.67 evidence.
- v7.67 DD is realized-equity DD only; compact cohorts do not contain intratrade mark-to-market paths.

## Known bot findings that must not be forgotten

1. Baseline 6.2 stays frozen.
2. Shadow V1 remains the over-filtering/hard-gate control.
3. Challenger V2 remains a useful control but is restricted by Baseline READY.
4. V3/V3.1 are rejected implementations.
5. V3.2 is the first evidence-backed independent Challenger ranker; the score is now frozen for risk diagnostics.
6. V3.2 is not ready for Shadow/Paper because portfolio drawdown robustness failed v7.67.
7. LONG/SHORT must be judged in regime context.
8. Regime V2 must recompute evidence for the final selected side.
9. Frequency, drawdown, concurrency, opportunity cost, avoided losers and missed winners are mandatory.
10. More evidence must not automatically become more hard gates.
11. Exit logic remains A_CURRENT/full TP1 while entry/scoring and portfolio-risk behavior are being validated.

## Next recommended work — highest priority

### Priority 1 — v7.68 Portfolio Risk Sensitivity on the frozen V3.2 score
Do not change `V766_WEIGHTS`. Diagnose risk/path behavior instead.

Build a research-only sensitivity runner that replays Baseline and the unchanged V3.2 ranker on the same cohorts using pre-specified risk settings, for example:
- 0.25% risk/trade;
- 0.50%;
- 0.75%;
- 1.00% current control.

Keep max-open and all other portfolio assumptions identical between Baseline and V3.2 at each setting. Scale portfolio-risk capacity consistently where appropriate and record PF, AvgR, equity, realized max DD, number/timing of drawdown-stop events, trade count, concurrency and opportunity cost.

Also include a clearly labeled **diagnostic no-max-DD path** (for example maxDrawdownPct=100) with the same score and selection logic. Its purpose is to reveal the natural portfolio path and determine whether the 8% hard stop is truncating later recovery; it is not a production recommendation.

Run 30d/60d/90d and P0–P3. Do not select a preferred risk value from one period alone. Look for monotonic improvement in survival and repeatability across periods.

### Priority 2 — Full candle-level mark-to-market replay
Before any activation, replace the realized-only DD approximation with candle-level MTM equity/DD using historical 15m paths for every selected trade. Keep the V3.2 score frozen during this validation.

### Priority 3 — Prospective frozen-score holdout
Only after risk sensitivity and full MTM replay pass. No score changes during the observation window.

### Priority 4 — Regime V2
Side-specific rescoring after final side selection. Validate separately before Hybrid/Allocator.

### Priority 5 — Exit Lab integration
Only after entry/scoring and risk survival are validated. Keep entry, risk and exit attribution separate.

## Promotion gate

No automatic promotion. Require common-window evidence, adequate trade count, positive expectancy/PF, acceptable drawdown, sufficient frequency/coverage, manageable opportunity cost, stable side/regime behavior, full portfolio-path + MTM validation, prospective evidence and explicit human approval.

## New-chat startup instruction

A fresh chat should begin with:

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md` first. Treat them as the canonical MERIDIAN project memory and continue from the handoff without changing Baseline 6.2.”**

After reading, verify `version.json` and current `main` HEAD before making changes because deployment state may have advanced.
