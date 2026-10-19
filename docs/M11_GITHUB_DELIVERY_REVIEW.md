# M11 GitHub delivery review

Evidence checked 2026-10-19. The first live-main fetch at 17:45 UTC matched the
issue's stated base, `6d6d2a8d09608ea972b017a40cae9ba0af984e9b`. Lead merged
PR #900 at 17:48:56 UTC; a subsequent fetch confirmed current `main`
`496360869171f0a29e3efbc7ec216ffc1833c6a0` (merge commit for #900). All four
post-merge checks succeeded: Release Safety `39297340489`, Runtime Smoke
`39297340509`, Release Coordinator `39297340538`, and Pages `39297339543`.
PR #901 then merged at 18:04:39 UTC as `e0e7472f74a05cb2a9cedb1a758abe8816b93aa6`.
At the latest fetch, its Release Safety postcheck `39299510601` was in progress;
Runtime Smoke `39299510602`, Release Coordinator `39299510619`, and Pages
`39299510213` had succeeded. The active mailbox is #639
(`MERIDIAN_LIVE_CHECKPOINT.json:5`); the roadmap's recorded source SHA
`6f720373af5439af70c54e6cb2f1c17abaf8b877`
(`docs/MERIDIAN_STAGE_ROADMAP.md:8`) is older than both observations. This
comparison is evidence and a proposal, not a policy change or activation.

## Delivery mechanisms

| Mechanism | Configured capability | Observed result | Skipped / unproven |
| --- | --- | --- | --- |
| **Work-agent implementation** | Issues can bound a writer's scope; PR #900 implemented observation history and #901 added Arena inspection. | #900 head `2dfca128aa10b9bcd503f7de840c145f240cac8f` passed PR CI `39295964418`, received Work's exact-head GREEN_LIGHT at #639 comment #6273568843, and merged as `496360869171f0a29e3efbc7ec216ffc1833c6a0` with four successful postchecks. #901 head `4ab4a4493cb06d7d48e827c9b820b4ea973bca50`, based on `496360869171f0a29e3efbc7ec216ffc1833c6a0`, passed CI `39298670431`, received Work GREEN_LIGHT #6273851825, and merged as `e0e7472f74a05cb2a9cedb1a758abe8816b93aa6`. Three of its four postchecks had succeeded at this evidence check; Release Safety `39299510601` remained in progress. | Work's reviews are actual independent reviews, not Claude verdicts. The exact Claude request #6273526552 failed without a verdict (run `39297009463`, recorded at #6273553826). Both product packets now own observation history and synthetic Arena inspection—do not duplicate them. |
| **GitHub Copilot issue assignment** | Issue #902 is assigned to Copilot and Achi1984. Receipt #902/#6273526932 records accepted assignment, connected issue events, and Draft PR #903 creation at initial head `157d90d89b86b027861fcf7397fb8ab597d44f10`. This is observed task start, not completed delivery. | The separate one-shot native-assignment workflows ran once: `.github/workflows/native-assignment-pilot-once-20261012.yml` run `38288536320` (head `9bb4037a5054ca11992461fecef43d0b1e4fe3fc`) and `native-assignment-pilot-second-once-20261012.yml` run `38291703961` (head `34e35028c4bdc779755f1907e731ef2b3d358837`) both failed. | Native issue assignment and the custom one-shot pilots are distinct paths. The #902 receipt confirms one successful assignment/start; the failed pilot runs do not negate it or prove a general authenticated API. Do not retry or bypass the pilots. |
| **Pinned Copilot coding pilot** | `.github/workflows/copilot-coding-pilot.yml:3-17,36-73` has a fixed packet, actor/head gates, pinned Copilot CLI `1.0.95`, short-lived artifact, and an isolated publisher stage (`:75-103`). | Run `39297667162` observed on the new main SHA `496360869171f0a29e3efbc7ec216ffc1833c6a0`; earlier runs `39296673692` and `39296351487` were on the prior main. | All cited runs are `skipped`: the workflow requires source head `99eff9111d4ca42d8d89cd88ee5b2831c36282bb`, not these main SHAs. This is a narrow configured pilot, not proof of a usable general issue-to-PR publisher or a successful current task. |
| **Claude mailbox review** | `.github/workflows/claude-mailbox-review.yml:3-24,41-57` accepts an owner comment on #639 containing `@claude` and `CROSS_MODEL_REQUEST`; tools are read-only except the requested mailbox response. `MERIDIAN_GO.md:42-46` assigns Claude independent review, not implementation. | Request #6273526552 triggered run `39297009463`/job `118212015917`; the credential check passed, but the reviewer step failed and no verdict was available. Sanitized receipt #6273553826 says `sdk_error` / `rate_limit_marker`, with root cause unproven. | Other non-matching comment runs, including `39297368207`, were `skipped`; distinguish those from this actual failed request. Work's fallback GREEN_LIGHT #6273568843 is not a Claude review. No retry or cause inference is supported. |
| **Actions tests and artifacts** | `.github/workflows/backend-safety.yml:3-12,57-87` runs on PRs and main, includes `node --test test/*.test.js`, and attempts to upload V11 visual PNGs (7-day retention). | PR CI succeeded on both merged product heads (`39295964418`, `39298670431`). All four #900 postchecks succeeded. Of #901's postchecks, Runtime Smoke `39299510602`, Coordinator `39299510619`, and Pages `39299510213` succeeded; Release Safety `39299510601` was in progress at this evidence check. | An upload step is configured; this review does not establish a downloadable artifact for every run. CI is a test/check producer, not an author, reviewer, assignment service, or merge authority. |

The #900/#901 receipts distinguish agent output, independent Work review, CI,
and Claude's failed request. Work GREEN_LIGHT #6273568843 covered both original
pre-merge heads on base `6d6d2a8`; #901's aligned head received a separate
GREEN_LIGHT #6273851825. D1's technical verification is recorded through
#895/#896; #896 says the manifest remains `NOT_FROZEN` and not admitted. D1 is
not D2 authorization or a strategy run.

## Cost points and bounded handoff proposal

Observed manual publication work includes selecting and sending source blobs,
checking per-file/tree transport limits, and verifying returned blob/tree SHAs.
For #901 the lead receipt #6273433124 records budget-checked blobs and a
347,398-byte tree request followed by SHA verification. After publication, the
lead separately reconciles exact PR head/base, CI runs, review request IDs and
responses, and posts status; #900/#901 each have a PR-local status receipt and
share the exact-head mailbox review request. These are repeated authenticated
reads and handoffs, not measured time savings. `MERIDIAN_GO.md:67-75,101` and
`MERIDIAN_AGENT_WORKFLOW.md:353-360` already bound source budgets, deduplication,
single-writer work, and status polling (at most once per session for unchanged
external work).

**Proposal only; do not change current policy or activate a workflow:**

1. Lead opens one bounded issue with a unique operation ID, exact base, file
   allowlist, acceptance checks, stop conditions, and an explicit “no runtime /
   research-stage transition” boundary. Check WIP before assigning.
2. Assign one implementation agent only when the authenticated GitHub interface
   confirms availability. Require one writer on one new branch; if assignment
   or capability is unavailable, stop and report it rather than switching
   credentials or invoking a pilot.
3. Have that writer publish one Draft PR, then verify the uploaded source/tree
   identities and exact head/base. Do not treat a Draft PR or artifact as
   acceptance.
4. Wait for the existing exact-head Actions checks. Request one independent
   Claude review on #639 only after successful CI; bind request and verdict to
   the same PR head. Any changed head invalidates both gates.
5. Lead checks scope, CI, review, and authority separately and remains sole
   merge owner. No handoff here grants merge, runtime, spending, or stage
   authority. Record the result in the PR-local status and active mailbox as
   already required.

## Candidate M11 packages after #900/#901

These are sequenced proposals, not active work orders. Initially #900, #901,
and #902 occupied the three-packet WIP limit. Both product PRs have since
merged; #902 (Draft PR #903) is the one active packet, while #901's Release
Safety postcheck remains in progress. Do not dispatch a follow-on packet until
that postcheck and this review's gates are reconciled.

| Package | Dependency and allowed files | Roles | Acceptance and stop conditions |
| --- | --- | --- | --- |
| **1. Supervisor observation status projection** | After both #900/#901 postchecks succeed and #903 is reviewed. The current `v11/research-evidence.js` and catalog already show a static source/D1 snapshot and blocked execution states; this package adds only a separate projection of #900's validated observation history into the existing research status surface. The Python validator is not browser-importable: use a bounded browser-safe serialized contract with the same schema/invariants (256 observations, 16 KiB per envelope, 4 MiB combined input, 16 KiB summary), not a direct Python import. Candidate allowlist: `v11/research-evidence.js`, new `v11/research-observation-history.js`, `v11/strategy-catalog.js`, `v11/index.html`, `test/v11-strategy-catalog.test.js`, and new `test/v11-research-observation-history.test.js`. | One assigned writer; Lead owns scope/integration; Claude reviews exact head after CI. | Synthetic fixtures check bounds and ordering/identity/fence/terminal invariants; missing/conflicting evidence stays `UNKNOWN`. A valid digest or imported summary establishes supplied-data consistency only, never authenticity, durable history, or authority. Leave D2/Paper/Live blocked; stop if the work repeats the static projection, grants trust by label, or adds enqueue/retry/reconciliation/activation. |
| **2. Experiment-ledger/Arena evidence links** | After package 1 and #900/#901 are accepted. PR #901 already renders manual synthetic supervisor reports; this package is limited to linking trial-ledger identities to Arena evidence, not rebuilding that panel. Reuse the existing trial-ledger validator and Arena UI; candidate allowlist: `docs/strategy-lab/validate-trial-ledger.mjs`, `test/strategy-trial-ledger.test.js`, `v11/strategy-arena.js`, `v11/index.html`, `test/strategy-paper-arena-receipt.test.js`, `test/strategy-paper-arena-ui.test.js`. | One assigned writer; Lead owns data/evidence semantics and integration; Claude reviews exact head after CI. | Synthetic-only cases bind displayed evidence to exact source/protocol/input/attempt/result identities; conflicting or corrupt links fail closed; failed, partial, and unknown attempts remain visible; no supplied report is promoted to empirical evidence. Stop if implementation requires replay, market-data access, PnL, or modifying frozen evidence. |
| **3. D2 decision/readiness gate** | Depends on packages 1–2 and a new explicit owner decision. **Allowed files now: none**; if authorized, Lead must first create a separate issue with an exact file list. Use #878's R3 design and #895/#896 D1 receipts as inputs, not as execution permission. | Owner decides whether the specifically bounded historical diagnostic is authorized; Lead prepares/reconciles the request; Claude independently challenges methodology; no implementation or execution agent before the decision. | The gate is satisfied only by a recorded decision that pins the protocol, input scope, budget, and criteria; otherwise record BLOCKED and stop. Even after approval, strategy execution is a separate bounded task with its own CI/review and run receipts. No historical strategy run, recovery, or data read is authorized by this proposal. |

## Stage and authority matrix

The current checkpoint keeps canonical execution, strategy PnL, Discovery,
Validation, Holdout, Paper, and Live authorization false
(`MERIDIAN_LIVE_CHECKPOINT.json:34-40`).

| Stage | Current scope/status | Separate authority and stop |
| --- | --- | --- |
| **Technical preparation** | Source, contracts, provenance mapping, and read-only projection only. | No stage transition follows from source acceptance or CI. Stop on any need for credentials, workflow/permission/schedule changes, or runtime action. |
| **Synthetic tests** | Generated fixtures and deterministic tests only; supervisor B1 calculations are limited to its immutable generated synthetic series (`docs/strategy-lab/RESEARCH_SUPERVISOR.md:1-9`). | Does not establish market evidence, profitability, or readiness. Stop if real/captured data or a strategy run is introduced. |
| **Historical D2** | Not authorized. D1 verification work is recorded complete via #895/#896; its manifest remains `NOT_FROZEN`. #878 explicitly separates design preparation from the concrete D2 decision. | Requires new, explicit owner authorization for the exact historical protocol, inputs, budget, and criteria. Historical diagnostic is not a fresh holdout. No market-data read, strategy run, return calculation, recovery, or D2 implementation here. |
| **Forward Paper** | Not authorized; no forward Paper work or activation. | Requires its own explicit owner authorization after separately assessed evidence. D2 or source completion does not grant it. |
| **Live** | Not authorized; no Live work or activation. | Requires separate explicit Live authorization and its own risk, deployment, and operational gates. Paper or historical evidence does not grant it. |

No authority flags, workflow behavior, schedules, permissions, credentials, or
billing are changed by this review. All recommendations remain proposals until
the relevant owner decision is recorded.

## This review's integration gates

Immediately before this reconciliation, PR #903 was Draft at head
`6de0c92b9216730c013d4f0a30c4b752d867cf87`, based on `6d6d2a8` and behind
`4963608` (then-current main). Since then #901 has merged and current `main`
is `e0e7472f74a05cb2a9cedb1a758abe8816b93aa6`. Release Safety run
`39299462513` on that earlier PR head was `action_required`.
The PR records a CHANGES_REQUESTED review on its earlier `e364bd9` head
(#5575659024); those findings were addressed in subsequent revisions, not
accepted on the current head. This revision creates another head; no
successful exact-head CI or final PR review is recorded for it. The prose diff
and secret scan passed locally; no broad suite was run. Keep this PR Draft and
do not integrate until its base is reconciled and the required CI and
independent review succeed on the exact head.
