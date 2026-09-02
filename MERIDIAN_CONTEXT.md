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

The Baseline 6.2 execution is a frozen reference. Do not change its entry, sizing, risk, exit or ledger behavior unless explicitly approved. Research must never silently change Paper execution.

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
Reference bot. Frozen execution. Its purpose is to provide the unchanged benchmark against which all research variants are measured.

### Shadow V1
Hard-filter research control. It only acts on Baseline-ready candidates and adds strict technical/candidate/regime gates. Useful to measure the cost and benefit of aggressive filtering, but not intended as the preferred architecture.

### Challenger V2
Soft-confidence research bot. It currently scores technical quality, candidate quality, entry distance and regime adjustment. Important limitation: its real Paper trade universe still depends on Baseline `READY`, so it cannot discover opportunities outside the Baseline-ready pool.

### Regime V1
Adaptive research bot. Can alter direction and strategy behavior by regime. Known methodological limitation: when it changes side, parts of `technical` and `candidate` scoring still originate from the original Baseline direction. This must be corrected in a future Regime V2 rather than silently changing V1.

## Research philosophy

More evidence must not automatically become more hard entry gates. Prefer a small number of hard safety constraints and use regime, asset history, directional evidence, volatility and other observations as soft confidence/scoring inputs.

Always evaluate:
- performance AND trade frequency
- drawdown AND opportunity cost
- LONG and SHORT in their market-regime context
- avoided losers AND missed winners
- in-sample AND walk-forward/out-of-sample stability

Do not assume fewer trades are automatically better. A research variant that improves PF merely by removing most opportunity is not necessarily superior.

## Research telemetry

`7.47-TELEMETRY-V1` reads persistent ledgers and produces comparable analytics without changing execution. Important metrics include expectancy, payoff ratio, historical max drawdown, trade frequency, open risk, holding duration, LONG/SHORT split, symbol split, regime split, exit-reason split and Challenger opportunity-cost counterfactuals.

## Exit Lab

Exit Lab is research-only. It tests the same historical entry cohort under different exit policies, avoiding entry-selection contamination.

Current policies/probes:
- A Current: full position exits at TP1
- B Protected Runner: 50% at TP1, remainder protected at break-even plus fees/slippage and runs toward TP2
- C ATR Runner: 50% at TP1, then protected runner with ATR trailing
- D Adaptive Runner: partial realization and trailing behavior adapt to market regime
- B Confirm Close: arm BE only after a confirming 15m close through TP1
- B +0.10R: protect remaining position at BE + 0.10R after TP1
- B +0.25R: protect remaining position at BE + 0.25R after TP1

Historical replay uses only candles closing after the original entry timestamp to avoid entry-candle look-ahead.

### v7.51 evidence checkpoint

A reproducible 12-asset 30/60/90-day report showed that no single exit model is robust enough for promotion yet. Runner models materially improved the 90-day window and often the 30-day window, but several underperformed the current full-TP1 exit in the 60-day window. Challenger D_ADAPTIVE was +1.502R vs A in 30d and +5.712R in 90d, but -1.447R in 60d. Challenger B_PROTECTED was +0.422R, -1.838R and +4.243R respectively. Therefore Challenger V3 must initially retain A_CURRENT so entry/scoring changes are isolated from exit changes.

## Current strategic direction

1. Build Challenger V3 as an independent soft-score model evaluating the full valid scanner universe instead of only Baseline `READY`.
2. Keep Challenger V3 initial exit behavior equal to A_CURRENT/full TP1 for clean attribution.
3. Replay Challenger V3 entries through Exit Lab only after V3 entry behavior is measured.
4. Build Regime V2 with side-specific scoring recomputed after final side selection.
5. Combine Challenger/Regime ideas into Hybrid/Allocator only if independent evidence supports both.

## Promotion principle

No research bot is automatically promoted because it has the best current P&L. Promotion requires a common evaluation window, adequate sample size, positive expectancy/PF, acceptable drawdown, sufficient opportunity coverage and reasonable stability across windows/regimes. Human approval remains mandatory.

## Continuity rule

For every substantial MERIDIAN release, update these three files when the project state or reasoning changes:
- `MERIDIAN_CONTEXT.md`
- `MERIDIAN_DECISIONS.md`
- `MERIDIAN_HANDOFF.md`

Do not allow implementation and documentation to drift materially apart.
