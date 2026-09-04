# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Main/live remains `7.62 R4` until the portfolio fix is deliberately reviewed and merged.
- Active portfolio fix branch: `fix/portfolio-data-contract-v763`
- Draft PR #37: `MERIDIAN v7.63: Portfolio Data Contract V1`
- v7.63 build metadata: `7.63-20260904-R1`
- Trading/Paper execution and `server.js` are unchanged.

## Why v7.63 exists

A Depot screenshot showed a contradictory state: current Gesamtportfolio about `$27,783`, while the rightmost chart value/high remained about `$28,165`. The displayed 1D number was also calculated through a separate path. This exposed a structural issue: current headline, chart and Pionex overlay could follow different valuation paths.

Existing dashboard logic had been adding the current Pionex trading total onto historical spot points. That could make a chart look hybrid without guaranteeing that the final plotted value equaled the actual current total.

## v7.63 Portfolio Data Contract V1

Canonical current value:

`totalUsd = spotUsd + tradingUsd`

where:
- `spotUsd` = non-Pionex holdings, live-price valued when available;
- `tradingUsd` = Pionex equity snapshot;
- Pionex holdings are excluded from spot to avoid double counting.

Implemented:
- `portfolio-data-contract.js` pure contract helper;
- `test/portfolio-data-contract.test.js`;
- Depot adapter publishes `MERIDIAN_PORTFOLIO_CANONICAL`;
- Depot headline uses canonical `totalUsd`;
- final Depot chart point is forced onto the same canonical `totalUsd` after resampling;
- `MERIDIAN_PORTFOLIO_CONSISTENCY` exposes endpoint consistency;
- helper exposes `PORTFOLIO_DATA_MISMATCH` rather than silently accepting drift;
- release metadata synced to v7.63 R1;
- dedicated workflow `.github/workflows/portfolio-contract-v763.yml`.

The regression suite explicitly reproduces the observed `$28,165` chart vs `$27,783` current-value mismatch and verifies it is detected/aligned.

## Verification

Latest full v7.63 workflow on implementation head `a8a8958359f40dad5fb607fd8db5771bf1f94443`:
- run `33918275835`
- Portfolio contract tests: SUCCESS
- Depot adapter syntax: SUCCESS
- Release Safety: SUCCESS
- overall job: SUCCESS

Subsequent continuity-document commits only update project memory and should not alter runtime behavior; recheck the latest branch run before merge.

## Important limitation / next architecture step

v7.63 guarantees **current endpoint identity**. It does not invent historical Pionex equity.

The next structural improvement should persist canonical snapshots at capture time, minimally:
- timestamp
- spotUsd
- tradingUsd
- totalUsd
- optional cashflow-adjusted total/source metadata

Then 1D performance, high/low and every historical chart point can derive from the same stored time series instead of reconstructing history with today's Pionex equity.

## Separate research track

Do not mix this fix with bot research. The Meta Allocator work remains on `research/meta-allocator-v780-design`; v7.79 prospective holdout remains locked. Baseline 6.2 stays frozen.

## Save-progress rule

Do not leave meaningful MERIDIAN work only in chat. Save every substantial implementation/research checkpoint to GitHub with descriptive commits.

## New-chat startup instruction

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md`. Check `main`, draft PR #37 and latest workflow status. Keep Baseline 6.2 frozen and continue from the highest-priority handoff.”**
