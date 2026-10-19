# M11 GitHub delivery review

Evidence checked 2026-10-19 against fetched `main`. Live `main` is
`6d6d2a8d09608ea972b017a40cae9ba0af984e9b`, unchanged from the issue's stated
base. The active mailbox is #639 (`MERIDIAN_LIVE_CHECKPOINT.json:5`); the
roadmap's recorded source SHA `6f720373af5439af70c54e6cb2f1c17abaf8b877`
(`docs/MERIDIAN_STAGE_ROADMAP.md:8`) is an older snapshot, not live main.
This comparison is evidence and a proposal, not a policy change or activation.

## Delivery mechanisms

| Mechanism | Configured capability | Observed result | Skipped / unproven |
| --- | --- | --- | --- |
| **Work-agent implementation** | Issues can bound a writer's scope; current examples are PR #900 (observation history) and #901 (Arena display). | Both are open Draft PRs targeting `main` at base `6d6d2a8`. #900 head `2dfca128aa10b9bcd503f7de840c145f240cac8f`; Release Safety run `39295964418` succeeded. #901 head `f9367eb90fa127551f222e74a9e09c729284aa6a`; run `39296295983` succeeded. Their lead-status receipts are #6273388802 and #6273433124. | Source/tests and exact-head CI are evidenced, not an autonomous end-to-end cycle. Both receipts say final Claude review is pending; neither PR is merged. These packets own observation history and synthetic Arena inspection—do not duplicate them. |
| **GitHub Copilot issue assignment** | GitHub issue #902 is assigned to Copilot and Achi1984; associated Draft PR #903 and initial commit `157d90d89b86b027861fcf7397fb8ab597d44f10` are observable. This confirms one assigned task and draft, not a completed deliverable or general availability. | The separate one-shot native-assignment workflows ran once: `.github/workflows/native-assignment-pilot-once-20261012.yml` run `38288536320` (head `9bb4037a5054ca11992461fecef43d0b1e4fe3fc`) and `native-assignment-pilot-second-once-20261012.yml` run `38291703961` (head `34e35028c4bdc779755f1907e731ef2b3d358837`) both failed. | No successful assignment receipt is evidenced by those pilots. Their user-token, claim, owner, and one-shot gates are not a general assignment service; don't retry or bypass them. Availability of native assignment for future issues must be verified at the issue/agent UI and evidenced by an actual result. |
| **Pinned Copilot coding pilot** | `.github/workflows/copilot-coding-pilot.yml:3-17,36-73` has a fixed packet, actor/head gates, pinned Copilot CLI `1.0.95`, short-lived artifact, and an isolated publisher stage (`:75-103`). | Recent runs on current main, including `39296673692` and `39296351487`, are recorded. | Both are `skipped`: the workflow requires source head `99eff9111d4ca42d8d89cd88ee5b2831c36282bb`, not current main. This is a narrow configured pilot, not proof of a usable general issue-to-PR publisher or a successful current task. |
| **Claude mailbox review** | `.github/workflows/claude-mailbox-review.yml:3-24,41-57` accepts an owner comment on #639 containing `@claude` and `CROSS_MODEL_REQUEST`; tools are read-only except the requested mailbox response. `MERIDIAN_GO.md:42-46` assigns Claude independent review, not implementation. | The exact-head review request for #900/#901 is recorded at #639 comment #6273526552. | Recent trigger runs including `39296297948` are `skipped`; the PR status receipts report no final Claude verdict. A configured trigger or green CI is not an independent review. |
| **Actions tests and artifacts** | `.github/workflows/backend-safety.yml:3-12,57-87` runs on PRs and main, includes `node --test test/*.test.js`, and attempts to upload V11 visual PNGs (7-day retention). | Release Safety succeeded for #900 and #901 on their exact heads (runs above). Main's post-#898 Release Safety run `39294577029` succeeded. | An upload step is configured; this review does not establish a downloadable artifact for every run. CI is a test/check producer, not an author, reviewer, assignment service, or merge authority. |

The #900/#901 receipts distinguish Work-agent output from CI: tests ran and
passed, but the independent Claude merge verdict is still pending. D1's
technical verification is recorded through #895/#896; #896 says the manifest
remains `NOT_FROZEN` and not admitted. D1 is not D2 authorization or a strategy
run.

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

These are sequenced proposals, not active work orders. PR #900 and #901 plus
this review occupy the three-packet WIP limit; do not dispatch another packet
until a slot is free and dependencies are reconciled.

| Package | Dependency and allowed files | Roles | Acceptance and stop conditions |
| --- | --- | --- | --- |
| **1. Supervisor observation status projection** | First reconcile and accept #900/#901. The current `v11/research-evidence.js` and catalog already show a static source/D1 snapshot and blocked execution states; this package adds only a separate projection of the validated #900 observation history into the existing research status surface. Candidate allowlist: `v11/research-evidence.js`, `v11/strategy-catalog.js`, `v11/index.html`, `test/v11-strategy-catalog.test.js`, and new `test/research-supervisor-observation-history.test.js`. | One assigned writer; Lead owns scope/integration; Claude reviews exact head after CI. | Synthetic fixtures show validated observation lifecycle separately from source/D1/authority, preserve missing/conflicting evidence as `UNKNOWN`, and leave D2/Paper/Live blocked. Reuse #900's validator and the read-only supervisor inspection; do not add enqueue, retry, reconciliation, or activation. Stop if the work merely repeats the existing static projection or infers readiness from a status label. |
| **2. Experiment-ledger/Arena evidence links** | After package 1 and #900/#901 are accepted. PR #901 already renders manual synthetic supervisor reports; this package is limited to linking trial-ledger identities to Arena evidence, not rebuilding that panel. Reuse the existing trial-ledger validator and Arena UI; candidate allowlist: `docs/strategy-lab/validate-trial-ledger.mjs`, `test/strategy-trial-ledger.test.js`, `v11/strategy-arena.js`, `v11/index.html`, `test/strategy-paper-arena-receipt.test.js`, `test/strategy-paper-arena-ui.test.js`. | One assigned writer; Lead owns data/evidence semantics and integration; independent reviewer checks identity and UI behavior after CI. | Synthetic-only cases bind displayed evidence to exact source/protocol/input/attempt/result identities; conflicting or corrupt links fail closed; failed, partial, and unknown attempts remain visible; no supplied report is promoted to empirical evidence. Stop if implementation requires replay, market-data access, PnL, or modifying frozen evidence. |
| **3. D2 decision/readiness gate** | Depends on packages 1–2 and a new explicit owner decision. **Allowed files now: none**; if authorized, Lead must first create a separate issue with an exact file list. Use #878's R3 design and #895/#896 D1 receipts as inputs, not as execution permission. | Owner decides whether the specifically bounded historical diagnostic is authorized; Lead prepares/reconciles the request; Claude independently challenges methodology; no implementation or execution agent before the decision. | The gate is satisfied only by a recorded decision that pins the protocol, input scope, budget, and criteria; otherwise record BLOCKED and stop. Even after approval, strategy execution is a separate bounded task with its own CI/review and run receipts. No historical strategy run, recovery, or data read is authorized by this proposal. |

## Stage and authority matrix

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
