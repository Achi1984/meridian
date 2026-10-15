# GO MERIDIAN — durable resume checkpoint

## Current handoff — 2026-10-15

This section is the current operational summary. Historical snapshots below are
retained for provenance, not as instructions or evidence of present state.

- Verified source main: `2736f9d1d98988858373c05c05a7d5a67cbca27b`; PR **#814**
  merged. FINAL_MERGE_STATUS: **6201503547**. Reviewed head
  `c9c3f9b489b3f16fb2e9d90738483f4948a317a0`, base
  `48275e8ac149806859d698e7b29cb375dee73ff3`; full-scope Claude review
  **6201457990 GREEN_LIGHT**. Exact-head Release Safety
  **38793459593/job 116648593675** succeeded: 2,525 passed, 0 failed,
  cancelled, skipped, or todo (Node **20.20.2**).
- PR **#814 source packet is complete**; this handoff refresh is still pending
  publication. All four required post-merge checks succeeded on
  `2736f9d1d98988858373c05c05a7d5a67cbca27b`: Release Safety **38801351055**,
  Runtime Smoke **38801351069**, Release Coordinator **38801351260**, and Pages
  **38801348792**. The future publication commit for this refresh is not yet known.
- Prior housekeeping evidence remains historical: #818 merged at
  `7dc94b9108e25d742bef7652fb7511c5cb5108ea` (FINAL_MERGE_STATUS **6199370528**;
  all five post-merge checks succeeded). #819 merged at
  `48275e8ac149806859d698e7b29cb375dee73ff3` (FINAL_MERGE_STATUS **6199797884**;
  Release Safety **38788973884**, Agent Orchestration **38788973900**, Release
  Coordinator **38788973917**, Runtime Smoke **38788973928**, and Pages
  **38788972716** all succeeded).
- Terminal build: **10.0-r128**; checkpoint protocol: **STREAM-SAFE-V8**.
- Active work: complete and publish this factual handoff refresh after exact-head
  CI and full-scope review. No infrastructure action is authorized by this refresh.
- Authoritative mailbox is now **#639**, predecessor **#571**; watchdog status
  comment is **6198924473**. Superseded rollover PR **#640** is closed.
  Successor read/delivery/response smoke **PASS**, response **6199499751** to request **6199490288**. Predecessor #571 is closed as completed historical archive (6199526147). Resolve routing from `MERIDIAN_LIVE_CHECKPOINT.json`.
- Four disabled Autopilot prompts now use checkpoint-driven routing (current
  mailbox **#639**) and remain disabled. The enabled management automation
  already uses dynamic routing. Read-only event pilot **#673** is unchanged.
- V2 remains **SOURCE_AUDIT**. Canonical execution, strategy PnL, Discovery,
  Validation, Holdout, Paper and Live authorization remain **false**.
- Trial-history coverage and authorized reproduction budget remain **UNKNOWN**;
  the #814 inventory is bounded/incomplete. No new empirical work, backtest, or
  strategy PnL is authorized or claimed.
- Publisher setup: failed owner attempt documented in #571 comment
  **6198795959**. The one-shot marker is preserved. Owner pause **6199968669**
  remains in force. Real provider/DB/terminal/Codespace/browser state is
  **UNKNOWN**. The prior read-only preflight remains paused; this refresh
  authorizes no publisher next step. No recovery, retry, credential, provider,
  or browser action has been performed; recovery/retry remain separately gated.
- Decision records **6103358472**, **6178949360** and **6197277097** are resolved.
  Stale items **#653, #675 (issue), #686 and #690** are closed with readback.
  Clock-skew/#811 reconciliation: **6198817919**; retrospective
  FINAL_MERGE_STATUS for #782: **6198847209**.
- Owner approved **#818 housekeeping and WIP limit 3** at
  **2026-10-15 20:16:49 Europe/Vienna**: “Ja Freigabe erteilt”, recorded
  RESOLVED in comment **6199107184**. WIP is limited to three active packages;
  remaining proposals belong in backlog. Watchdog source routing is merged and active,
  but the first hosted watchdog PATCH remains unproven. The lead activation edit is not bot evidence. Do not infer
  Codespace shutdown from this handoff.

- Historical #814 run **38776991839**, head
  `43a351328159bf9526c6bba1f8ff93f91a2298cc`, attempt 1, remains
  `action_required`/not executed. Preserve it as historical blocked evidence;
  it was not retrospectively passed by the later #814 merge.
- Six further historical decisions were marked RESOLVED in place with existing quote/time evidence: 6171848445, 6187867522, 6175341101 (SUPERSEDED), 6177231926, 6177550606, 6178534667. No new authority granted.

### Resume and completion rules

Read the checkpoint-selected mailbox, current main and relevant CI before acting.
Mailbox **#639** is active; #571 is archived. All seven research/execution
authorization flags remain false; V2 remains **SOURCE_AUDIT**. Four disabled
Autopilot prompts remain disabled, management routing remains unchanged, and
read-only event pilot #673 is unchanged. WIP limit **3** and the #818 owner
approval history remain in force.

Complete exact-head CI and full-scope review for this handoff refresh before
lead-guarded publication. Do not infer the publication commit from source main.
This refresh authorizes no infrastructure action, publisher preflight, marker
recovery, retry, or second credential-setup attempt.

Handoff-only validation run locally with Node **v24.21.0** and Python
**3.12.3**: `python3 -m json.tool MERIDIAN_LIVE_CHECKPOINT.json` **PASS**;
`node scripts/continuity-audit.mjs` **PASS** (`ok: true`, build r128);
`node scripts/frozen-research-guard.mjs` **PASS** (140 checked, 0 mismatches);
`python3 scripts/validate-agent-orchestration.py` **GREEN**; `git diff --check`
**PASS**. Node **20.20.2** is not installed locally, so these local Node audits
were not run on the CI Node version. PR #814's exact-head CI was Node 20.20.2,
but applies to that source PR, not this refresh. No new tests or external/runtime
actions were run. Unknown checks remain unknown; a source merge alone is not
runtime acceptance.

Toolchain follow-up for handoff PR **#821**, head
`50f332035d8c7c087b26597c61e52c2f53b86bce` / base
`2736f9d1d98988858373c05c05a7d5a67cbca27b`: `.github/workflows/backend-safety.yml`
selects `node-version: 20`. `ls -1 /opt/hostedtoolcache/node` returned only
**22.23.3** and **24.21.0**; active `node --version` is **v24.21.0**
(`/opt/hostedtoolcache/node/24.21.0/x64/bin/node`). Node 20 is unavailable in
this runner, so the exact-CI-toolchain checks could not be run locally. Exact-head
Release Safety run **38803617504** is `action_required`, with **0 jobs** and no
job logs; it is not a pass. No workflow dispatch/retry was attempted, and no
full-scope Claude source-acceptance request has been made. Next: obtain successful
exact-head CI under the configured toolchain, then request full-scope review.

---

## Historical archive — superseded operational snapshots


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
