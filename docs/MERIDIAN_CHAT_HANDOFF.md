# MERIDIAN Chat Handoff

Status: **canonical after merge**  
Updated: **2026-09-30 23:31 Europe/Vienna**

## Current durable checkpoint

- Build: **10.0-r105**
- Canonical r105 release SHA: **1f1ce0b3450dfcdf62146290a144949deeaf682d**
- Last merged release PR: **#417 — Pionex history source alignment**
- Previous UI/data-integrity releases: **#415 r104**, **#413 r103**
- Execution impact: **false**
- Completed terminal sequence: **r93 through r105**

Repository state remains the source of truth. Use merged `main`, current CI, `MERIDIAN_RESUME.json`, and `MERIDIAN_AGENT_STATE.json` before chat history.

## Live evidence

### r102

- BUILD **R102**
- STRICT HISTORY **32 points**
- 1H **READY**
- 1D / 1W **BUILDING**
- Portfolio about **$35,371.60**
- A history artifact around **$1,798.71** was visible.

### r104

Live-verified around 23:16 Europe/Vienna:

- BUILD **R104**
- Gesamtportfolio **$35,312.88**
- Ledger **$794.41**
- OKX **$116.30**
- Pionex **$34,402.17**
- STRICT HISTORY **38 points**
- **1452 BLOCKED**
- 1H **READY** with 15 points
- 1D / 1W **BUILDING**

The old **$1,798.71 flat-line still remained**, so r104 did not fully solve the live history problem.

## r105 fix

Root cause #2 was different Pionex authority paths for live portfolio and server history.

r105 now:

- uses one shared fresh Pionex-equity resolver for live portfolio and history;
- prefers the fresh read-only Pionex Wallet API value;
- requires source timestamp age <= 15 minutes;
- allows only a fresh timestamped private-equity fallback;
- persists `tradingFresh`, `PIONEX_FRESH_V1`, source and timestamp provenance;
- rejects all older rows without this provenance from canonical chart reads;
- retains old PostgreSQL rows as audit evidence;
- does not backfill, interpolate, or fabricate history.

Exact-head r105 gates before merge:

- Release Safety: **GREEN**
- Portfolio Contract: **GREEN**
- Mobile Visual QA: **GREEN**

## Next durable step

Live-verify r105 after deployment.

Expected:

1. **BUILD R105**
2. **SPOT + FRESH PIONEX**
3. old **$1,798.71** flat-line is absent
4. pre-r105 rows are blocked
5. STRICT HISTORY may restart at 0, 1, or a few points and rebuild naturally
6. 1H / 1D / 1W become READY only with enough genuinely fresh history

Do not relax provenance or synthesize old history to make the chart look fuller.
