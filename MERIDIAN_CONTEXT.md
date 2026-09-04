# MERIDIAN — Canonical Project Context

> Single source of truth for project continuity. Read this file first in every new MERIDIAN development session, then read `MERIDIAN_DECISIONS.md` and `MERIDIAN_HANDOFF.md`.

## Project identity

MERIDIAN is a personal crypto dashboard, paper-trading engine and research platform. The canonical repository is `Achi1984/meridian`, branch `main`. Northflank deploys this repository from `main`. The old `Achi1984/achi-meridian` repository is not the current live source.

## Current architecture baseline

- Production/Paper engine: `6.2.0`
- Frozen baseline ruleset: `6.2-SIGNAL-V1`
- Main/live UI: `7.63 R1` after merged PR #37
- Active portfolio-history candidate: `7.64-CANONICAL-PORTFOLIO-HISTORY-V1` on `fix/canonical-portfolio-history-v764`, draft PR #38
- v7.64 build metadata: `7.64-20260904-R2`
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

The Baseline 6.2 execution is a frozen reference. Do not change its entry, sizing, risk, exit or ledger behavior unless explicitly approved. Research and display/data consistency work must never silently change Paper execution.

## Deployment and safety

- Paper only. Live trading remains disabled by invariant.
- `server.js` contains the paper-only safety assertion and remains untouched by v7.63/v7.64 portfolio work.
- Private portfolio/trading state is stored in PostgreSQL.
- Read APIs are protected by bearer auth through `server-gateway.js`.
- `MERIDIAN_READ_TOKEN` is hashed at startup and plaintext is removed from runtime environment.
- Release Safety checks syntax, regression tests, release consistency, privacy, secret scanning and the paper-only invariant.

## Portfolio valuation and history contract

v7.63 established one canonical current value:

`totalUsd = spotUsd + tradingUsd`

- `spotUsd` = non-Pionex holdings valued with live prices where available.
- `tradingUsd` = Pionex equity snapshot.
- Pionex is excluded from spot to prevent double counting.
- Depot headline and final chart point must use the same canonical current total.
- mismatch is observable through `MERIDIAN_PORTFOLIO_CONSISTENCY` rather than silently tolerated.

v7.64 extends the same contract into time series instead of rebuilding history from mixed sources:

- PostgreSQL table `meridian_portfolio_history` persists `spotUsd`, `tradingUsd`, `totalUsd`, optional cashflow-adjusted total, cumulative cashflow, revision and source status.
- runtime captures every five minutes using public Binance prices for spot valuation and preserves BETH→ETH / OKSOL→SOL aliases.
- protected read API: `/api/private/portfolio-history?range=1d|1w|1m|6m|1y`.
- Depot R2 consumes canonical history only after a warm-up gate; until then v7.63 current-value alignment remains fallback.
- once 1D history is mature, Chart, High, Low and 1D Performance derive from the same stored series.
- longer time ranges stay on fallback until enough canonical coverage exists rather than stretching a short history across a long window.

## Verification state

The full v7.64 R2 validation run on implementation head `de73c10c6f5d3114b9b571e8e0c0a69ae23e8fdf` completed successfully: deterministic install, history tests, gateway/Depot syntax checks and Release Safety all passed. Later commits only update continuity documentation; always recheck the latest PR head before merge.

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
Soft-confidence research control. Its executable universe still depends on Baseline `READY`.

### Regime V1
Adaptive research control with the known side-rescoring weakness. Regime V2 must recompute directional evidence after final side selection.

## Research philosophy

More evidence must not automatically become more hard entry gates. Prefer few true safety constraints and use regime, asset history, directional evidence, volatility and other observations as soft evidence.

Always evaluate performance AND frequency, drawdown AND opportunity cost, LONG/SHORT in regime context, avoided losers AND missed winners, and in-sample AND walk-forward/OOS stability.

Full-window attribution is not OOS proof. Negative results are preserved rather than tuned away.

## Current strategic direction

1. Keep Baseline 6.2 frozen.
2. Finish/review v7.64 canonical portfolio history and its Depot warm-up/fallback behavior.
3. After deployment, verify real PostgreSQL point accumulation and that the 1D chart transitions only after sufficient coverage.
4. Keep bot research isolated. Active Meta Allocator research remains on its research branch and v7.79 prospective holdout remains locked.
5. No research bot is automatically promoted.

## Promotion principle

No research bot is automatically promoted. Promotion requires common-window evaluation, adequate samples, positive OOS expectancy/PF, acceptable later portfolio drawdown, sufficient opportunity coverage, stability across windows/regimes and explicit human approval.

## Continuity rule

For every substantial MERIDIAN release or research conclusion, update:
- `MERIDIAN_CONTEXT.md`
- `MERIDIAN_DECISIONS.md`
- `MERIDIAN_HANDOFF.md`

Do not allow implementation and documentation to drift materially apart.
