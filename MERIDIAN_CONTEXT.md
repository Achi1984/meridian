# MERIDIAN — Canonical Project Context

> Single source of truth for project continuity. Read this file first in every new MERIDIAN development session, then read `MERIDIAN_DECISIONS.md` and `MERIDIAN_HANDOFF.md`.

## Project identity

MERIDIAN is a personal crypto dashboard, paper-trading engine and research platform. The canonical repository is `Achi1984/meridian`, branch `main`. Northflank deploys this repository from `main`. The old `Achi1984/achi-meridian` repository is not the current live source.

## Current architecture baseline

- Production/Paper engine: `6.2.0`
- Frozen baseline ruleset: `6.2-SIGNAL-V1`
- Evidence layer: `6.53-EVIDENCE`
- Research Engine V2: `7.34-RESEARCH-V2`
- Privacy/security layer: `7.33-HARDENED`
- Runtime monitoring: `7.36-MONITORING`
- Regime research: `7.38-REGIME-V1`
- Paper overview UX: `7.41-OVERVIEW-FIRST`
- Header/premium brand: `7.46-PREMIUM-BANNER`
- Research telemetry: `7.47-TELEMETRY-V1`
- Exit Lab historical replay: `7.49-EXIT-LAB-REPLAY-V1`
- Fixed-entry replay mode: `7.49-FIXED-ENTRY-15M-REPLAY`
- Project continuity: `7.50-CONTINUITY-V1`
- Exit Lab evidence report: `7.51-EXIT-LAB-EVIDENCE-V1`
- Preserved rejected research: Challenger V3 (`7.52`), V3.1 (`7.53`), Signal Calibration (`7.55`)
- Raw Feature Attribution: `7.61`
- Portfolio-independent cohort evidence: `7.62`
- Feature Interaction Lab: `7.63`
- Chronological walk-forward validation: `7.64`
- Disjoint historical validation: `7.65`
- Challenger V3.2 evidence-backed soft-score lab: `7.66`
- Challenger V3.2 portfolio-path replay: `7.67`

`version.json` may remain on the deployed UI/app release while research-only milestones advance separately. The Baseline 6.2 execution is a frozen reference. Do not change its entry, sizing, risk, exit or ledger behavior unless explicitly approved. Research must never silently change Paper execution.

## Deployment and safety

- Paper only. Live trading remains disabled by invariant.
- `server.js` contains the paper-only safety assertion and should remain untouched by research-only work unless absolutely required and explicitly justified.
- Private portfolio/trading state is stored in PostgreSQL.
- Read APIs are protected by bearer auth through `server-gateway.js`.
- `MERIDIAN_READ_TOKEN` is hashed at startup and plaintext is removed from the runtime environment.
- GitHub Pages and Northflank rollout are checked by Runtime Smoke.
- Release Safety checks syntax, regression tests, release consistency, privacy, secret scanning and the paper-only invariant.
- Historical Git history may still contain old sensitive snapshots. No destructive history rewrite has been performed.

## UI principles

- Dark mode, blue/cyan accents, compact mobile-first layout.
- Minimize wasted vertical space.
- Current header uses the premium horizontal ACHI MERIDIAN banner and a compact status row.
- PAPER opens on `ÜBERSICHT`; bot tabs are ordered overview first.
- UI work must not disturb bot or research execution.

## Active bot set

### Baseline 6.2
Frozen reference benchmark.

### Shadow V1
Hard-filter research control. Useful for measuring the cost of aggressive filtering, not the preferred architecture.

### Challenger V2
Soft-confidence control. Important limitation: its executable opportunity universe still depends on Baseline `READY`.

### Regime V1
Adaptive research bot. Known limitation: a changed side can still inherit technical/candidate evidence from the source side. Regime V2 must recompute evidence for the final side.

### Challenger V3.2 Lab
Research-only independent ranking model introduced in v7.66. It does not require Baseline `READY`. It uses small additive weights from raw feature interactions that survived v7.64 walk-forward and v7.65 disjoint-history checks. v7.67 shows the ranker still improves Avg R/PF under chronological portfolio competition, but portfolio drawdown robustness is not yet adequate. It is not a Paper/Shadow bot.

## Rejected / experimental Challenger research

### Challenger V3
Removed hidden READY dependency correctly but the wider universe performed poorly. Do not promote.

### Challenger V3.1
Improved over V3 but remained unstable and weaker than V2/Baseline on the main comparison. Do not promote or resume blind threshold tuning.

### Signal Calibration Lab
Every compressed confidence bucket was negative across 30d/60d/90d and higher confidence was not monotonic with better outcomes. This invalidated the old idea that simply retuning the same confidence stack would create edge.

## Evidence path v7.61–v7.67

### v7.61–v7.62 — Raw Feature Attribution
Portfolio-independent cohorts sample one candidate per symbol per 4h across BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET and INJ. Outcomes use A_CURRENT/full TP1 normalized R with a 14-day horizon and portfolio gates excluded. Overall raw cohorts were still weak, but 15m volume participation emerged as one of the few repeatable positive single features.

### v7.63 — Feature Interactions
Conditional combinations revealed stronger structure than single indicators. Relevant examples included high 15m volume with ADX/RSI context and SHORT signals in TRANSITION regimes.

### v7.64 — Walk-forward
Chronological 45d train / 15d holdout / 15d step validation showed that many attractive training buckets did not survive. Only 42.4% of adequate selected holdouts stayed positive. This reinforced the need for out-of-sample filtering rather than visual bucket picking.

### v7.65 — Four disjoint 90-day cohorts
Strongest robust candidates included:
- `VOL_GE15_ADX_LT18`: 4/4 positive periods, weighted Avg R `+0.131`, n=976.
- `SHORT_TRANSITION_VOL_065_1`: 4/4 positive, `+0.104`, n=667.
- `VOL_GE15_ADX_18_25`: 4/4 positive, `+0.078`, n=1148.
Several weaker interactions passed 3/4; `VOL_GE15_RSI_42_50` failed at 2/4.

### v7.66 — Challenger V3.2 soft ranking
V3.2 uses small additive weights, no new hard signal gates, and independently ranks the full signal universe. At equal signal count to Baseline READY, it improved Avg R in all four historical 90-day periods:
- P0: Baseline `-0.004R` vs V3.2 `+0.039R`
- P1: `+0.007R` vs `+0.050R`
- P2: `-0.041R` vs `+0.012R`
- P3: `+0.003R` vs `+0.092R`
PF also improved in all four periods. Because the feature candidates were derived using related historical evidence, v7.66 is not an untouched holdout. Treat it as composite signal-level evidence, not promotion proof.

### v7.67 — Chronological portfolio-path replay
Baseline READY and V3.2 were replayed under identical constraints: 10,000 starting equity, 1% risk/trade, max 3 open positions, max 3% portfolio risk, max 8 entries/day, 3% daily-loss gate, 8% drawdown gate and 30m symbol cooldown. V3.2 selection at each timestamp uses only then-available raw features and the frozen v7.66 score.

Across disjoint 90-day periods P0–P3, V3.2 produced better Avg R and PF in **4/4**, confirming that the ranking advantage survives chronological slot competition. However, V3.2 had lower realized-equity drawdown in **0/4**, so it fails the portfolio-risk robustness gate. The 60-day window is highly path-dependent: V3.2 hit the drawdown gate after nine -1R trades and stopped, while a later 30-day subwindow was positive. This is evidence that ranking edge and portfolio survival must be evaluated separately.

Important measurement limitation: compact signal cohorts contain exit events, not full intratrade price paths. v7.67 therefore measures realized-equity DD, not full mark-to-market DD.

## Research philosophy

More evidence must not automatically become more hard entry gates. Prefer a small number of true safety constraints and use regime, asset history, direction, volatility, participation and other observations as calibrated soft confidence inputs.

Always evaluate performance AND trade frequency, drawdown AND opportunity cost, LONG/SHORT in regime context, avoided losers AND missed winners, and in-sample AND walk-forward/out-of-sample stability. Fewer trades are not automatically better.

## Exit Lab

Exit Lab remains research-only. Runner models can materially improve some windows but underperform in others. No runner/BE policy is promoted. Challenger experiments stay on A_CURRENT/full TP1 until entry/scoring and portfolio-risk behavior are validated.

## Current strategic direction

1. Keep Baseline 6.2 frozen and V3.2 research-only.
2. Keep the v7.66 V3.2 feature weights **frozen**; do not retune them against v7.67.
3. Build **v7.68 Portfolio Risk Sensitivity** using the unchanged scorer. Replay pre-specified fixed risk levels (for example 0.25%, 0.50%, 0.75%, 1.00%) under identical constraints for Baseline and V3.2.
4. Add a diagnostic no-max-DD path to separate raw ranking behavior from the path-dependent hard drawdown stop. This is diagnosis, not a production recommendation.
5. Measure PF/AvgR, equity, realized DD, stop-out timing, frequency, concurrency and opportunity cost across 30/60/90 and P0–P3. Do not choose a risk setting from one winning window.
6. Before any Shadow activation, add a full candle-level mark-to-market replay because v7.67 compact cohorts only provide realized DD.
7. Only after portfolio-risk behavior is robust should the frozen V3.2 scorer enter a prospective/future untouched holdout.
8. Regime V2 remains a separate research axis and requires side-specific rescoring after final side selection.
9. Exit Lab can be layered only after entry/scoring and risk survival pass these gates.

## Promotion principle

No research bot is automatically promoted because it has the best current P&L. Promotion requires common-window evaluation, adequate sample size, positive expectancy/PF, acceptable drawdown, sufficient opportunity coverage, reasonable stability across windows/regimes, full portfolio-path validation, prospective evidence and human approval.

## Continuity rule

For every substantial MERIDIAN release or research conclusion, update these three files when project state or reasoning changes:
- `MERIDIAN_CONTEXT.md`
- `MERIDIAN_DECISIONS.md`
- `MERIDIAN_HANDOFF.md`

Do not allow implementation and documentation to drift materially apart.
