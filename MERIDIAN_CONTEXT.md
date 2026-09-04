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
- Preserved rejected-research evidence: Challenger V3 (`7.52`), V3.1 (`7.53`), Signal Calibration (`7.55`)
- Adaptive Evidence research core: `7.74-ADAPTIVE-EVIDENCE-V1` on branch `research/adaptive-evidence-v774` until reviewed/merged

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

## Rejected / experimental Challenger research

### Challenger V3
V3 correctly removed the hidden Baseline `READY` dependency, but the wider opportunity universe performed poorly in 30d/60d and was weaker than V2/Baseline in the 90d comparison. Do not merge or promote V3 as implemented.

### Challenger V3.1
V3.1 increased entry-distance/status penalties and reduced non-READY risk. It improved substantially over V3 but still failed the robustness/promotion standard. Do not promote it and do not keep tuning thresholds blindly.

### Signal Calibration Lab
A portfolio-independent signal calibration sampled one candidate per symbol per 4h across BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET and INJ. Each candidate received an A_CURRENT normalized-R outcome with a 14-day horizon and portfolio gates excluded.

Key result: **every confidence bucket was negative across 30d/60d/90d, and higher confidence was not monotonic with better outcomes.** This means the current compressed technical/candidate/distance/regime/status score stack is not sufficiently calibrated at signal level. Positive portfolio windows cannot be treated as proof of signal-score edge because portfolio gates/path dependence select subsets.

## Adaptive Evidence Lab

`adaptive-evidence.js` is the research-only foundation for Challenger V3.2. It derives side-aware raw context observations and consumes measured cohort statistics rather than fixed context bonuses. Small samples are shrunk toward neutral, cross-window agreement affects reliability, and missing evidence remains neutral.

The current dimensions are side, regime, MTF alignment, momentum, volume, volatility, asset history and Baseline status as evidence only. The module also reports Market Capture / Opportunity Cost through coverage, missed-winner R, avoided-loser R and net skipped-signal opportunity cost.

No Paper execution path imports this module at this checkpoint.

## Research philosophy

More evidence must not automatically become more hard entry gates. Prefer a small number of hard safety constraints and use regime, asset history, directional evidence, volatility and other observations as soft confidence/scoring inputs.

Always evaluate performance AND trade frequency, drawdown AND opportunity cost, LONG/SHORT in regime context, avoided losers AND missed winners, and in-sample AND walk-forward/out-of-sample stability.

Do not assume fewer trades are automatically better. A research variant that improves PF merely by removing most opportunity is not necessarily superior.

## Exit Lab

Exit Lab remains research-only. The 12-asset 30/60/90-day evidence showed that runner models can materially improve some windows, especially 90d, but can underperform full TP1 in others, especially 60d. No runner/BE policy is promoted yet. Challenger experiments remain on A_CURRENT/full TP1 until entry/scoring edge is established.

## Current strategic direction

1. Keep Baseline 6.2 frozen and existing bots as controls.
2. Complete the **Adaptive Evidence / Feature Attribution data pipeline** by generating portfolio-independent normalized-R cohorts for the raw observations used by `adaptive-evidence.js`.
3. Validate feature effects across 30d / 60d / 90d and walk-forward windows; require adequate sample size and repeatability rather than isolated best buckets.
4. Measure Market Capture / Opportunity Cost alongside PF, expectancy and DD so low-frequency variants are not rewarded merely for avoiding trades.
5. Only after the evidence table demonstrates predictive signal quality should Challenger V3.2 consume it in portfolio replay.
6. Regime V2 still requires side-specific rescoring after final side selection; test independently before Hybrid/Allocator.
7. Exit Lab can be layered onto a validated entry model later.

## Promotion principle

No research bot is automatically promoted because it has the best current P&L. Promotion requires a common evaluation window, adequate sample size, positive expectancy/PF, acceptable drawdown, sufficient opportunity coverage, reasonable stability across windows/regimes and human approval.

## Continuity rule

For every substantial MERIDIAN release or research conclusion, update these three files when project state or reasoning changes:
- `MERIDIAN_CONTEXT.md`
- `MERIDIAN_DECISIONS.md`
- `MERIDIAN_HANDOFF.md`

Do not allow implementation and documentation to drift materially apart.