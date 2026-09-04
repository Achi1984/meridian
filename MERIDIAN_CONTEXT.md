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
- Project continuity: `7.50-CONTINUITY-V1`
- Exit Lab evidence report: `7.51-EXIT-LAB-EVIDENCE-V1`
- Preserved rejected-research evidence: Challenger V3 (`7.52`), V3.1 (`7.53`), Signal Calibration (`7.55`)
- Adaptive Evidence V1 (`7.74`) — completed negative signal-edge checkpoint on `research/adaptive-evidence-v774`
- Context Interaction / Hierarchical Evidence V1 (`7.75`) — completed negative combined-selector checkpoint on `research/context-interaction-v775`
- Interaction Family Ablation (`7.76`) and Volatility Context Drilldown/Robustness (`7.77`/`7.78`) — preserved research checkpoints; no promoted rule
- Prospective locked holdout (`7.79`) — active, independent, and frozen pending matured future outcomes
- Meta Allocator Decision Matrix (`7.80`) — active research line on `research/meta-allocator-v780-design`

The Baseline 6.2 execution is a frozen reference. Do not change its entry, sizing, risk, exit or ledger behavior unless explicitly approved. Research must never silently change Paper execution.

## Deployment and safety

- Paper only. Live trading remains disabled by invariant.
- `server.js` contains the paper-only safety assertion and should remain untouched by research-only work unless absolutely required and explicitly justified.
- Private portfolio/trading state is stored in PostgreSQL.
- Read APIs are protected by bearer auth through `server-gateway.js`.
- `MERIDIAN_READ_TOKEN` is hashed at startup and plaintext is removed from the runtime environment.
- Release Safety checks syntax, regression tests, release consistency, privacy, secret scanning and the paper-only invariant.

## UI principles

- Dark mode, blue/cyan accents, compact mobile-first layout.
- Minimize wasted vertical space.
- Current header uses the premium horizontal ACHI MERIDIAN banner and a compact status row.
- PAPER opens on `ÜBERSICHT`; bot tabs are ordered overview first.
- UI work must not disturb bot or research execution.

## Active bot controls

### Baseline 6.2
Frozen reference benchmark.

### Shadow V1
Hard-filter/low-DD research control. Fewer trades are not automatically better.

### Challenger V2
Current strongest existing Challenger control. Uses soft confidence but still depends on Baseline `READY` for its executable universe.

### Regime V1
Adaptive research control with a known side-rescoring methodological weakness. Regime V2 must recompute directional evidence after final side selection.

## Rejected / non-promotable research checkpoints

### Challenger V3 / V3.1
Independent opportunity discovery was architecturally useful but empirical performance was not robust. Do not promote or resume blind threshold tuning.

### Signal Calibration v7.55
Every tested confidence bucket was negative over 30d/60d/90d and higher confidence was not monotonic with better outcomes.

### Adaptive Evidence v7.74
The full portfolio-independent 12-asset pipeline used one signal/symbol/4h, a 14-day A_CURRENT/full-TP1 outcome horizon, strict full-horizon censoring and expanding train-before-test validation.

- 30d: 2,160 signals, avg -0.403R; OOS selected 0
- 60d: 4,320 signals, avg -0.314R; OOS selected 3 at -1.133R / PF 0
- 90d: 6,480 signals, avg -0.270R; OOS selected 397 at -0.203R / PF 0.711

Conclusion: marginal Adaptive Evidence V1 does not establish predictive signal-level edge.

### Context Interaction v7.75
v7.75 residualized predefined child interactions against broader parent cohorts and compared the combined interaction selector to v7.74 on the identical master cohort.

- 30d interaction: 113 selected, avg -0.657R, PF 0.324, 6.5% coverage
- 60d interaction: 977 selected, avg -0.377R, PF 0.531, 28.3% coverage
- 90d interaction: 978 selected, avg -0.300R, PF 0.604, 18.9% coverage

The method increased coverage but selected OOS expectancy remained negative in every window. It is not a promotion candidate.

A notable repeated attribution is `LONG|BULL|NORMAL volatility` versus `LONG|BULL`, with positive residuals in 30d, 60d and 90d. This is a hypothesis for family-level OOS testing, not a fixed bonus.

### Volatility-context sequence v7.76–v7.79
Family ablation identified `SIDE_REGIME_VOLATILITY` as the only positive family in the 90d OOS slice, but follow-up context robustness failed. The predeclared `LONG|TRANSITION|NORMAL` context was negative over the full historical same-sample robustness check (107 signals, avg -0.043R, PF 0.93). v7.79 therefore freezes that hypothesis prospectively instead of tuning history further.

### Meta Decision Matrix v7.80 R2
v7.80 introduces a research-only matrix that synchronizes Baseline, Shadow, Challenger and Regime opinions for the same canonical research opportunity. R2 connected the matrix to the existing cloud-candidate pipeline and ran a 12-asset 30d/60d/90d evidence pass.

Result: naive vote count, side conflict and hard disagreement do **not** establish edge in the broad sampled universe. Every support-count cohort remained negative in every window. `SUPPORT_3` was least negative in 60d/90d (-0.212R / PF 0.705 and -0.191R / PF 0.730), but still not promotable. Four-bot agreement was not consistently better than three-bot agreement, so consensus strength is non-monotonic.

Durable evidence:
- `research/adaptive-evidence-live-v774.md`
- `research/context-interaction-live-v775.md`
- `research/volatility-context-robustness-live-v778.md`
- `research/meta-decision-matrix-live-v780-r2.md`

## Research philosophy

More evidence must not automatically become more hard entry gates. Prefer few true safety constraints and use regime, asset history, directional evidence, volatility and other observations as soft evidence.

Always evaluate performance AND frequency, drawdown AND opportunity cost, LONG/SHORT in regime context, avoided losers AND missed winners, and in-sample AND walk-forward/OOS stability.

Full-window attribution is not OOS proof. Negative results are preserved rather than tuned away.

## Exit Lab

Exit Lab remains research-only. Runner/BE models were not robust enough across 30d/60d/90d for promotion. Keep exit research separate until entry/scoring edge is established.

## Current strategic direction

1. Keep Baseline 6.2 frozen and all current bots as controls.
2. Keep v7.79 locked and prospectively monitored; do not rewrite its hypothesis.
3. Continue Meta Allocator research as an **allocation/risk-information** layer rather than another raw-indicator bot.
4. Do not use naive bot vote count, universal side-conflict blocks or hard disagreement as allocator rules based on v7.80 R2.
5. Next run a predeclared **v7.80 R3 executable-universe attribution**: `BASELINE_READY`, `ANY_SUPPORT`, and `REGIME_ONLY`, with chronological fold stability.
6. Inside those universes, compare Shadow support, Challenger TRADE vs CAUTION/SKIP, Regime agreement/conflict and 3-vs-4 support without changing existing thresholds.
7. Only after repeatable OOS differences exist should a Shadow Meta Allocator map evidence to FULL / REDUCED / EXPLORATORY / SKIP.
8. Regime V2 remains important before final allocator integration because V1 can retain original-side technical scoring after changing side.
9. Portfolio cluster/correlation risk is a later overlay after decision-quality evidence exists.

## Promotion principle

No research bot is automatically promoted. Promotion requires common-window evaluation, adequate samples, positive OOS expectancy/PF, acceptable later portfolio drawdown, sufficient opportunity coverage, stability across windows/regimes and explicit human approval.

## Continuity rule

For every substantial MERIDIAN release or research conclusion, update:
- `MERIDIAN_CONTEXT.md`
- `MERIDIAN_DECISIONS.md`
- `MERIDIAN_HANDOFF.md`

Do not allow implementation and documentation to drift materially apart.
