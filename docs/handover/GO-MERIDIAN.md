# GO MERIDIAN — durable resume checkpoint

Updated: 2026-10-07
Resume keyword: **Go Meridian**

## Operating mode
- ChatGPT = Lead Architect / Lead Developer / Product Owner / sole Merge Owner.
- Claude = independent cross-model reviewer, challenger and second developer in read-only mode unless explicitly authorized otherwise.
- User wants MERIDIAN developed autonomously 24/7 and only wants to be involved for major product/risk decisions, protected-gate authorizations, secrets/permission changes, waivers, or blockers that genuinely need manual input.
- User approval in chat: **MERIDIAN 24/7 AUTONOMY V1**.
- iPhone / ChatGPT app does **not** need to stay open for GitHub Actions or configured ChatGPT automations.

## Mandatory resume protocol
Before every MERIDIAN work step:
1. Read latest comments in GitHub Issue #571.
2. Read `MERIDIAN_LIVE_CHECKPOINT.json`.
3. Check live `main` SHA and terminalBuild.
4. Check relevant CI/gates.
5. Check only relevant open PRs/branches.
6. Treat GitHub live state as authoritative; never repeat an uncertain write after a stream interruption.

Follow the active protocol in `MERIDIAN_LIVE_CHECKPOINT.json` and `MERIDIAN_GO.md`.
V8 uses authorized work packages with guarded atomic writes and checkpoints,
independent exact-head review and explicit Project Owner merge approval.
A policy update does not authorize dispatch, spending or workflow changes.
Historical snapshots below are not live-state evidence.

## Current live state
- Repository: `Achi1984/meridian`
- main: `5fe94a77749d8d73df431b0104d8d870fa07dbf6`
- checkpoint protocol: STREAM-SAFE-V7
- terminalBuild: **10.0-r126**
- Durable handover path: `docs/handover/GO-MERIDIAN.md`

## Claude Development Watchdog
- Workflow: `.github/workflows/claude-watchdog-15m.yml`
- First real scheduled watchdog run succeeded overnight:
  - run: `37553049529`
  - head: `5fe94a77749d8d73df431b0104d8d870fa07dbf6`
  - result: SUCCESS
  - active PR: #585
  - verdict: CHALLENGE
- First real watcher status fingerprint:
  `8e410b13bc96bec5b4217d1f3f26d0b6a5195874b2484aa1dc80cbd10abd06f3`
- No second recurring run appeared for ~1h40m after the first run.
- Claude independently diagnosed this as **PLATFORM_STALL** / GitHub best-effort schedule throttling, not workflow logic, not config block.
- Claude recommended moving the cron away from quarter-hour load peaks:
  - old: `*/15 * * * *`
  - new: `7,22,37,52 * * * *`
- Neutral branch created:
  `ops/watchdog-offset-cron`
- Cron offset commit:
  `b37a282c6c57281a88d89e9ed56f711e103e917d`
- That branch currently contains the one-line cron fix.
- The next planned step was: reconcile exact head `b37a282c6c57281a88d89e9ed56f711e103e917d`, check whether a PR already exists; if not, create a small Draft PR, let exact-head CI run, request Claude exact-head review, then merge only after GREEN.

## Watchdog verification rule
Do **not** claim fully verified autonomous operation until:
1. a real watchdog run completed successfully; **done**.
2. a subsequent unchanged tick proves dedupe/skip with no extra Claude invocation/token spend; **not yet proven**.

Only after both are proven say exactly:
**AUTONOMER BETRIEB VERIFIZIERT – du kannst schlafen gehen.**

## Stage 2
- PR #585: **Stage 2 Draft: Asset Detail decision surface**
- head: `665201f63811c6ed0b9454c1ab74682fafac91f7`
- base: `e304f1b480c92f9432d9eca0271fdd879acc3d65`
- draft: true
- mergeable reported: true
- Claude watchdog found a semantic/scope mismatch:
  - PR body says “no hero reorder”
  - implementation moves accounting guard above hero
- Claude recommendation:
  - make the intended order explicit;
  - either restore hero-before-guard and satisfy invariant another way,
  - or keep guard-before-hero, correct PR body, and add a DOM-order test:
    `topbar > data-state > guard > hero`
- Keep #585 Draft until resolved and re-reviewed.
- No terminalBuild/release change for Stage 2 until then.

## 24/7 control-plane roadmap
After watchdog recurrence is stable:
1. machine-readable work queue: READY / IN_PROGRESS / WAITING_CI / WAITING_USER / FROZEN / DONE;
2. heartbeat / dead-man state;
3. stuck-state counter;
4. failure classification: TRANSIENT / PLATFORM_STALL / CODE_RED / CONFIG_BLOCK;
5. bounded retry/backoff;
6. Claude run/comment budget + per-fingerprint retry cap;
7. mechanically checkable single-writer lease;
8. low-noise status output;
9. prompt-injection / security hardening.

## Hard research/trading boundaries
These remain false unless the user explicitly approves the protected gate:
- canonicalExecutionAuthorized=false
- strategyPnlAuthorized=false
- discoveryAuthorized=false
- validationAuthorized=false
- holdoutAuthorized=false
- paperAuthorized=false
- liveAuthorized=false
Current V2 stage remains **SOURCE_AUDIT**.
No live trading action.

## Automation context
- ChatGPT task **Meridian Autopilot** exists on an hourly exact schedule.
- GitHub Claude Development Watchdog is intended to run four times per hour.
- Unchanged state should skip Claude/model-token spend via fingerprint/dedupe.
- Phone/app may be closed; server-side automation is independent.

## Immediate NEXT
1. Reconcile #571 + checkpoint + main + Actions + branch `ops/watchdog-offset-cron`.
2. Confirm branch head still `b37a282c6c57281a88d89e9ed56f711e103e917d`.
3. Check whether a PR for `ops/watchdog-offset-cron` already exists.
4. If none exists, create exactly one small Draft PR for the cron-offset fix.
5. Let exact-head CI run.
6. Request Claude exact-head review on that exact head.
7. Merge only after GREEN and normal release safety.
8. Observe at least two recurring offset ticks, with the second unchanged tick skipping Claude.
9. Then declare full autonomous verification.
10. After watchdog stability, implement the 24/7 control-plane roadmap and then resolve Stage 2 #585.

## Latest Claude scheduler diagnosis
Mailbox comment id: 6029495669. Classification: PLATFORM_STALL. Recommendation: offset cron to 7,22,37,52 and validate exact-head via CI + Claude.

---
When the user says **“Go Meridian”** in a new chat, start from this file **plus live GitHub reconciliation**. Never trust this snapshot over newer GitHub state.
