# MERIDIAN Chat Handoff

Status: **canonical after merge**  
Updated: **2026-10-01 06:32 Europe/Vienna**

## Current durable checkpoint

- Build: **10.0-r106**
- Canonical r106 release SHA: **77f7154e0a71021a427957dbf9b321d5a5fb308a**
- Last merged release PR: **#419 — market freshness lifecycle**
- Previous release: **#417 r105 Pionex history source alignment**
- Execution impact: **false**
- Completed terminal sequence: **r93 through r106**

Repository state is the source of truth. Reconcile merged `main`, current CI, `MERIDIAN_RESUME.json`, and `MERIDIAN_AGENT_STATE.json` before using chat history.

## r105 live acceptance

Live-verified on iPhone at 23:37 Europe/Vienna:

- BUILD **R105**
- Gesamtportfolio **$35,275.04**
- Ledger **$796.70**
- OKX **$116.30**
- Pionex **$34,362.04**
- STRICT HISTORY **2 points**
- **1489 BLOCKED**
- **SPOT + FRESH PIONEX**
- 1H / 1D / 1W **BUILDING**
- chart range shown: **$35,181.56 → $35,275.04**

The previous ~$1,798.71 history artifact was absent. r105 is therefore **live PASS**. Do not reopen r93-r105 portfolio/history work unless new evidence contradicts this.

## r106 root cause and fix

After r105 passed, the header still showed **MKT STALE** and **BOT SAFETY**.

r106 addresses the market-freshness lifecycle without weakening safety:

- explicit market sync states: IDLE / RUNNING / OK / PARTIAL / ERROR;
- header shows **MKT SYNCING** while technical refresh is actually running instead of evaluating the old timestamp as a settled stale state;
- gateway stale fallback reserve reduced from the 3-minute decision boundary to **90 seconds**;
- client independently rejects over-age gateway stale fallbacks;
- stale technical data remains fail-closed;
- BOT SAFETY and decision-ready guards are unchanged;
- no trading, signal threshold, sizing, risk, order, or execution behavior changed.

Exact-head r106 gates before merge:

- Release Safety: **GREEN**
- Portfolio Contract: **GREEN**
- Mobile Visual QA: **GREEN**

## Next durable step

Live-verify r106 after deployment.

Expected flow:

1. confirm **BUILD R106**;
2. press the refresh control;
3. while technical refresh is running, header should show **MKT SYNCING**;
4. after completion, market should settle to **READY** or **PARTIAL** only when freshness and coverage qualify;
5. if market remains **STALE**, inspect transport/error diagnostics and upstream availability;
6. do not weaken freshness thresholds or BOT SAFETY to force READY.

Do not repeat r93-r106 work.
