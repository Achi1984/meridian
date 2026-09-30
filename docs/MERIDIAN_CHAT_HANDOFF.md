# MERIDIAN Chat Handoff

Status: **canonical after merge**  
Updated: **2026-09-30 23:11 Europe/Vienna**

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

- Build: **10.0-r104**
- Canonical UI release SHA: **65834f47a1b9850bb52e2e169e96708fd716cbe9**
- Last merged UI PR: **#415 — Portfolio history component integrity**
- Prior UI PR: **#413 — Scanner confluence explainability**
- Execution impact: **false**
- UI sequence already completed: **r93 through r104**
- Do **not** repeat these releases after a streaming interruption.

### Live verification and portfolio checkpoint

The user live-verified **r102** from the iPhone dashboard on 2026-09-30 around 22:56 Europe/Vienna:

- BUILD: **R102**
- Strict history shown: **32 points**
- 1H: **READY** (13 points)
- 1D: **BUILDING**
- 1W: **BUILDING**
- Ledger: **$798.38**
- OKX: **$116.30**
- Pionex: **$34,456.92**
- Gesamtportfolio: **$35,371.60**
- Portfolio / Bots / Market were observed **READY** after refresh.

The same live screenshot exposed a real history-integrity anomaly: the 1D chart included a legacy point around **$1,798.71** before the current ~$35.4k total.

Root cause fixed in **r104**:

- a canonical history point now requires complete **Spot/Venue authority + Pionex Equity authority**;
- canonical history marks trading provenance as `PIONEX_EQUITY`;
- incomplete legacy rows remain in PostgreSQL as audit evidence but are excluded from chart/API canonical points;
- the UI independently requires `STRICT_AUTHORITY + PIONEX_EQUITY`;
- excluded legacy rows may be surfaced as **BLOCKED**;
- no synthetic history, interpolation, backfill, or deletion is authorized.

### Exact next durable step

Live-verify **r104** after deployment:

1. confirm **BUILD R104**;
2. confirm the old ~$1,798.71 incomplete point is no longer charted;
3. record any **BLOCKED** legacy-point count;
4. confirm current 1H / 1D / 1W maturity;
5. then continue only the first incomplete UI milestone after r104.

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
