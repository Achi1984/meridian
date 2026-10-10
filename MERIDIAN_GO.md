# MERIDIAN GO

Canonical quick-start for the user command: **Go Meridian**

## Meaning
When the user says **Go Meridian**, continue MERIDIAN autonomously from the real live repository state. Do not rely on stale chat handoffs or remembered SHAs.

## Bootstrap order
1. Read `MERIDIAN_LIVE_CHECKPOINT.json`.
2. Resolve the active Claude mailbox from `mailboxIssue`; read only the bounded latest relevant request/response/status items.
3. Fetch live `main` SHA, `version.json -> terminalBuild`, the one relevant PR and its relevant runs.
4. Reconcile any interrupted operation before writing. Repository state is authoritative.
5. Continue the authorized work package unless a real user decision or authorization gate is required.

## Roles
- ChatGPT: Lead architect, implementer and merge owner; Christoph/Achi1984 is Project Owner.
- Claude: independent read-only reviewer/challenger. Exact-head review before critical merge.
- Claude may use the read-only surfaces granted by the mailbox workflow, but may not edit/write repository content or mutate GitHub except the requested mailbox response comment.

## STREAM-SAFE-V8 — recoverable work packages

1. Before work, resolve `mailboxIssue` from `MERIDIAN_LIVE_CHECKPOINT.json`, read its bounded latest relevant items and reconcile live main, branch, PR and CI.

A task is bounded by its authorized objective, allowed files, branch owner, acceptance tests, budget constraints and stopping conditions, rather than by chat turns. One Go resumes the first incomplete authorized step after reconciliation; it never repeats the previous write blindly.

- Multiple sequential reads, implementation steps, tests and guarded writes are allowed within one authorized work package. No 30-second or one-tool-group chat limit applies.
- Before each write, record intent and a unique op-id, check branch ownership and expected head/base/blob. Use atomic expected-state guards where required; unavailable guards block the write.
- After each write, reconcile the actual effect and record a durable checkpoint before dependent work. A checkpoint is not proof of durable replay protection or authenticated transport.
- One writer per branch; integration and release numbering belong to the lead. Isolated agents may implement, test and prepare a Draft PR only within their delegated scope.
- Stop dependent writes on conflicts, unknown outcomes or scope drift. Read-only diagnosis may continue immediately. Retry at most once after verified OP_ABSENT; never replay OP_APPLIED. A second interruption yields BLOCKED_STREAM.
- Read bounded successful-CI evidence as well as named failures. Preserve payload/source budgets and mailbox tail limits. Never dump entire mailboxes.
- No sleep or polling loops. Poll unchanged external work at most once per session. WAITING records request/run IDs and the resume condition. Existing authorized agents may finish their packet; future dispatch requires a real, separately authorized mechanism.
- Keep one edited progress comment per PR. Deduplicate reviewer requests by request ID and exact head. Give concise milestone updates without requiring a new Go for each internal step.
- Stop at completion, missing authorization, unresolved conflict, exhausted authorized budget, unavailable capability or external dependency. End unfinished reports with NEXT.
- Exact-head/base CI and independent review remain mandatory. Changed heads invalidate prior gates. Project Owner approval of the concrete merge candidate remains required.
- This policy does not authorize production activation, trading, extra spending, workflow/permission/secret/scheduler changes, or a continuously running chat. Existing research and release boundaries remain.

Proposal: mailbox #571 comment 6096562356. This candidate requires independent review and explicit Project Owner merge approval before adoption.

### Source transport budgets (approved Transport & Feedback V1)
`maxPayloadBytes=4096` bounds rendered progress/log excerpts only. Source uploads use
`maxSourceFileBytes=262144` UTF-8 bytes per file and
`maxSerializedUploadBytes=393216` bytes per complete encoded request.
Run `node scripts/stream-safe-preflight.mjs --upload-budget contents` (or `blob` / `tree`)
with the actual complete tool arguments on stdin before upload. Verify source blob
SHA before/after publication and preserve the expected-head/CAS checks. A budget
pass is not authorization, CI, review or permission to bypass operation guards.
Full details and approval provenance: `MERIDIAN_AGENT_WORKFLOW.md`, Transport V1.
Watchdog suppression is a separate implementation; these budget changes do not enable it.

### Recovery classification
After reconciliation classify the prior operation:
- `OP_APPLIED`: intended effect exists -> do not repeat; advance.
- `OP_ABSENT`: effect absent and expected base/head unchanged -> eligible for one guarded retry.
- `OP_CONFLICT`: head/base moved or different operation owns the state -> stop dependent writes, diagnose read-only and supersede only after ownership/scope reconciliation.
- `WAITING`: external work still running -> report exact IDs/status and end the turn.
- `BLOCKED_STREAM`: second interruption of the same step -> stop automatic retries.

Evidence > assumptions.

## Mailbox hygiene
Use the mailbox issue resolved from `MERIDIAN_LIVE_CHECKPOINT.json`.
Mailbox is reserved for:
- `CROSS_MODEL_REQUEST`
- `CROSS_MODEL_RESPONSE`
- `CROSS_MODEL_STATUS NEEDS_USER_DECISION`
- `FINAL_MERGE_STATUS`

INTENT/progress belongs in one continuously updated PR-local lead-status comment. Rollover the mailbox when the configured comment threshold is exceeded, and update routing coherently before archiving the predecessor.

## Product-owner governance
- Standard UI/presentation terminal cadence: maximum one UI release merge per calendar day. Genuine bugfix/trust/safety fixes are excepted.
- Any additional same-day UI release requires a release-specific `CROSS_MODEL_STATUS NEEDS_USER_DECISION` that names the blocked release and the cadence conflict, followed by an explicit user answer authorizing that exact release. The authorization is single-use and does not carry forward to later releases.
- A prior user override may never be generalized into a standing exception. In particular, "Go – Regel ändern und R125 heute mergen" authorized R125 only.
- Before every `@claude` request, inspect the authoritative mailbox for the same Request-ID + exact head. If an unanswered matching request already exists, do not repost. If a matching response already exists, do not repost.
- Changes to autonomy rules, release cadence, watchdog/workflow behavior, scheduler behavior, or 24/7 operating rules always require `CROSS_MODEL_STATUS NEEDS_USER_DECISION @Achi1984` and an explicit user answer before merge. Post-hoc authorization is invalid.
- Current 24/7 MERIDIAN operation is explicitly user-authorized. ChatGPT Autopilot and Claude Watchdog may run 24/7; quota protection must come from state-change detection, deduplication and staggered scheduling rather than quiet hours.
- Scheduling target: ChatGPT Autopilot at minute :27 and Claude Watchdog at minute :57, avoiding intentional parallel starts.
- GitHub scheduled workflows are best-effort. Do not open further Ops PRs solely to make cron delivery "reliable"; only act if a completed source/expected workflow demonstrates a real configuration defect.
- These governance rules never relax exact-head CI/review, expected-head merge protection, Single-Writer, research-stage, PnL, execution, privacy or safety gates.

## Hard research / trading boundaries
The live checkpoint is authoritative. Unless it explicitly says otherwise, do not perform or authorize:
- canonical execution
- strategy PnL
- Discovery
- Validation
- Holdout
- Paper transition
- Live transition
- trading actions

Vision is not authorization.

## Product principle
**Complex inside – simple outside.**

Priority:
QUALITY > SPEED
EVIDENCE > ASSUMPTIONS
CLARITY > FEATURE COUNT
ROBUST EDGE > WIN RATE
PAPER FIRST > LIVE
RISK > PROFIT MAXIMIZATION

## Completion behavior
Do not ask the user to repeat context already recoverable from GitHub.
Keep user-facing replies short.
Do not narrate routine reads or long tool chains.
If no user decision is needed, advance the authorized work package and end with `NEXT:`.
