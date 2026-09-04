# MERIDIAN — Next Session Handoff

> Read `MERIDIAN_CONTEXT.md` and `MERIDIAN_DECISIONS.md` before acting on this handoff.

## Current release track

- Baseline engine: `6.2.0`
- Baseline ruleset: `6.2-SIGNAL-V1`
- Main/live is now `7.63 R1` after PR #37 was merged.
- Active portfolio-history branch: `fix/canonical-portfolio-history-v764`
- Draft PR #38: `MERIDIAN v7.64: Canonical Portfolio History`
- v7.64 R2 build metadata: `7.64-20260904-R2`
- Trading/Paper execution and `server.js` remain unchanged.

## Why v7.64 exists

v7.63 solved current endpoint identity: the Depot headline and final chart point use one canonical `spotUsd + Pionex equity` value. It could not make historical points trustworthy because past Pionex equity was never stored.

v7.64 therefore persists the full canonical valuation at capture time and exposes it through one protected history API.

## v7.64 implemented

Server/data layer:
- `portfolio-history-store.js`
- `portfolio-history-runtime.js`
- PostgreSQL table `meridian_portfolio_history`
- captures every 5 minutes
- stores Spot USD, Pionex/trading USD, total USD, optional cashflow-adjusted total, cumulative cashflow, source revision and source status
- public Binance pricing refresh for Spot valuation
- aliases preserved: `BETH→ETH`, `OKSOL→SOL`
- Pionex remains an equity component rather than being double counted as Spot
- protected endpoint: `/api/private/portfolio-history?range=1d|1w|1m|6m|1y`

Depot R2:
- `app-v7.61-depot-audit.js` upgraded to v7.64 behavior
- selected time range requests the same protected canonical history
- canonical history replaces the legacy chart only after a warm-up gate
- 1D requires enough points and approximately half-window coverage before switching
- longer ranges remain on fallback until sufficient canonical coverage exists
- after 1D is ready, High, Low and 1D Performance derive from the same stored series
- final point is still aligned to the live canonical current total
- browser telemetry identifies source as `V7.64_POSTGRES_CANONICAL_HISTORY` vs `V7.63_CURRENT_FALLBACK`

## Verification

The dedicated v7.64 workflow checks deterministic npm install, canonical history store/runtime regression tests, syntax for history store/runtime, gateway bootstrap, `server-gateway.js` and Depot adapter, plus Release Safety.

A temporary npm-integrity failure occurred while release files were being manually synchronized. It was corrected by restoring the exact dependency checksums from `main` and changing only the release version fields. The corrected validation head is `de73c10c6f5d3114b9b571e8e0c0a69ae23e8fdf`; recheck its workflow before merge.

## Deployment verification after merge

1. confirm Northflank reports v7.64 R2;
2. verify `meridian_portfolio_history` starts accumulating points roughly every five minutes;
3. verify protected history endpoint returns `POSTGRES_CANONICAL_HISTORY`;
4. during warm-up, Depot must explicitly remain on v7.63 fallback rather than stretching a tiny sample;
5. once 1D coverage passes the gate, verify chart endpoint = current total and High/Low/1D all agree with the same history rows;
6. only then consider long-range migration complete as those windows naturally accumulate coverage.

## Separate research track

Do not mix this fix with bot research. Meta Allocator work remains on `research/meta-allocator-v780-design`; v7.79 prospective holdout remains locked. Baseline 6.2 stays frozen.

## Save-progress rule

Do not leave meaningful MERIDIAN work only in chat. Save every substantial implementation/research checkpoint to GitHub with descriptive commits.

## New-chat startup instruction

**“Open `Achi1984/meridian` and read `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md`. Check `main`, draft PR #38 and the latest v7.64 workflow. Keep Baseline 6.2 frozen and continue from the highest-priority handoff.”**
