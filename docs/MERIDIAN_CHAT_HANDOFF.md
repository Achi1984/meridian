# MERIDIAN Chat Handoff

Status: **canonical after merge**  
Updated: **2026-09-30 21:49 Europe/Vienna**

## Why this file exists

ChatGPT streaming may be interrupted or a new chat may start with little visible context. The chat transcript is therefore **not** the project source of truth.

Canonical continuation state is:

1. merged `main`
2. green current-base CI / release gates
3. `MERIDIAN_RESUME.json`
4. `MERIDIAN_AGENT_STATE.json`
5. related PR / branch evidence
6. chat transcript last

The full recovery protocol is in `docs/AGENT_ORCHESTRATION.md`.

## Current durable checkpoint

- Build: **10.0-r100**
- Canonical main SHA: **575c51abda11662c20babd81653bdd6b712697b5**
- Last merged UI PR: **#404 — Scanner priority surface**
- Execution impact: **false**
- UI sequence already completed: **r93 through r100**
- Do **not** repeat these releases after a streaming interruption.

### Portfolio checkpoint

Last user-verified live composition:

- Ledger: **$790.08**
- OKX: **$116.30**
- Pionex: **$34,329.97**
- Gesamtportfolio: **$35,236.35**
- Portfolio: **READY**
- Bots: **READY**
- Market: **READY**

The 1H / 1D / 1W portfolio chart is deliberately built only from canonical `STRICT_AUTHORITY` history points. It must never synthesize or backfill fake history.

## Exact next-chat recovery procedure

When the user says **"Meridian fortsetzen"**, **"Fortsetzen"**, or similar:

1. fetch latest `main` SHA;
2. read `MERIDIAN_RESUME.json`;
3. read `MERIDIAN_AGENT_STATE.json`;
4. inspect relevant open PRs and branches;
5. inspect current CI / release gates;
6. compare reality with this checkpoint;
7. find the **first incomplete durable step**;
8. continue from there only.

Never ask the user to restate information already available in repository state.

## Streaming-interruption rule

If the app shows **"Streaming unterbrochen"**, do not assume the repository operation failed. Before retrying any write, PR, merge, or release action, inspect the repository to see whether it already completed.

The sustainable mitigation is **short atomic work bursts + durable checkpoints**, not relying on one long streamed answer.

## Ready-to-use prompt for a new chat

> Meridian fortsetzen. Hole dir zuerst den tatsächlichen aktuellen Stand aus `main`, `MERIDIAN_RESUME.json`, `MERIDIAN_AGENT_STATE.json`, offenen relevanten PRs/Branches und CI. Verlasse dich nicht auf den letzten sichtbaren Chattext. Wiederhole keine bereits gemergten Arbeiten. Setze beim ersten unvollständigen dauerhaften Schritt fort und arbeite stream-safe in kurzen atomaren Bursts mit Repository-Checkpoint nach Mutationen.

