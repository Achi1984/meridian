# MERIDIAN — Canonical Project Context

> Single source of truth for project continuity. Read this file first in every new MERIDIAN development session, then read `MERIDIAN_DECISIONS.md` and `MERIDIAN_HANDOFF.md`.

## Project identity

MERIDIAN is a personal crypto dashboard, paper-trading engine and research platform. The canonical repository is `Achi1984/meridian`, branch `main`. Northflank deploys this repository from `main`. The old `Achi1984/achi-meridian` repository is not the current live source.

## Current architecture baseline

- Production/Paper engine: `6.2.0`
- Frozen baseline ruleset: `6.2-SIGNAL-V1`
- Main live UI before this fix: `7.62 R4`
- Portfolio Data Contract candidate: `7.63-PORTFOLIO-DATA-CONTRACT-V1` on `fix/portfolio-data-contract-v763`, draft PR #37
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
- `server.js` contains the paper-only safety assertion and remains untouched by the v7.63 portfolio fix.
- Private portfolio/trading state is stored in PostgreSQL.
- Read APIs are protected by bearer auth through `server-gateway.js`.
- `MERIDIAN_READ_TOKEN` is hashed at startup and plaintext is removed from the runtime environment.
- Release Safety checks syntax, regression tests, release consistency, privacy, secret scanning and the paper-only invariant.

## Portfolio valuation contract

The recurring Depot mismatch came from separate valuation paths for the current headline, historical chart and Pionex overlay. v7.63 establishes one canonical current snapshot:

`totalUsd = spotUsd + tradingUsd`

- `spotUsd` = non-Pionex holdings valued with live prices where available.
- `tradingUsd` = Pionex equity snapshot, preferring `portfolio.pionexEquityUsd` with manual Pionex balance fallback.
- Pionex holdings are excluded from spot to prevent double counting.
- the Depot headline and final chart point must use the same canonical current total.
- mismatch must be observable rather than silently tolerated; the contract helper exposes `PORTFOLIO_DATA_MISMATCH` and the browser exposes canonical/consistency telemetry.

Known limitation: historical Pionex equity is not reconstructed retrospectively from the current snapshot. v7.63 guarantees current endpoint identity. A later history migration should persist canonical `{spotUsd,tradingUsd,totalUsd}` values at capture time so every historical point follows the same contract.

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
2. Finish/review the v7.63 Portfolio Data Contract fix before treating the Depot chart as trustworthy.
3. After current endpoint identity is stable, persist canonical portfolio snapshots at capture time so history/1D/high-low can share one time series.
4. Keep bot research isolated from this display/data fix. Active Meta Allocator research remains on its own research branch and v7.79 prospective holdout remains locked.
5. No research bot is automatically promoted.

## Promotion principle

No research bot is automatically promoted. Promotion requires common-window evaluation, adequate samples, positive OOS expectancy/PF, acceptable later portfolio drawdown, sufficient opportunity coverage, stability across windows/regimes and explicit human approval.

## Continuity rule

For every substantial MERIDIAN release or research conclusion, update:
- `MERIDIAN_CONTEXT.md`
- `MERIDIAN_DECISIONS.md`
- `MERIDIAN_HANDOFF.md`

Do not allow implementation and documentation to drift materially apart.
