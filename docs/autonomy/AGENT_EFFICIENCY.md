# Bounded agent work packages

Use this contract to reduce repeated work while preserving Meridian's existing
approval, exact-head review, runtime and research boundaries. This document grants
no new permissions. ChatGPT remains lead and sole merge owner; keep the existing
limit of three active work packages, including review and continuity work.

## Before starting

Use [the work-package template](../../.github/ISSUE_TEMPLATE/agent-work-package.md).
Name one objective, the allowed files, exact base and input evidence, dependencies,
acceptance checks, prohibited effects and a stopping condition. Assign one writer
per worktree. Delegate independent bounded work only within existing authority;
do not assume a GitHub writer agent exists or provision one implicitly.

Read relevant source and project rules before changing files. Resolve a concrete
uncertainty; do not add framework exploration or unrelated cleanup to the packet.

## Evidence and review

Record each check's exact command, result, tested head or local candidate identity,
base, relevant input/dependency hashes and environment/toolchain. Reuse prior
verified evidence only when its covered inputs, dependencies and environment are
unchanged and its scope still applies. Identify the original receipt and explain
why it remains applicable; never relabel an older run as a new-head execution.

After a complete prior review, review the delta and uncovered dependencies rather
than rereading already covered unchanged material. List every reused dependency by path/hash and prior coverage receipt; record
the coverage mapping and any invalidated evidence. The final verdict must still cover the full requested
scope and bind to the exact final head/base. This optimization cannot waive a
mandatory check, exact-head CI, required local execution or independent review.
If a required check cannot run, report the missing evidence and stop at that gate.

GitHub CI provides execution evidence. The existing Claude mailbox job is a
reviewer only under its current permissions: it may inspect evidence and run
permitted read-only checks, but cannot change checkout/worktree, edit source or
act as an implementation agent. Its only permitted remote mutation is the
requested review response in Mailbox639. A green CI run is not a review verdict.
A local test against another checkout is not an exact-head test. Neither this
contract nor an evidence link overrides the reviewer's mandatory checks.

## Pinned Claude image preparation (#983)

Owner dispatch M11-983-PINNED-IMAGES-R1 authorizes preparation only. The bounded
helper `scripts/claude-pinned-images.mjs` runs before Claude in the existing #942
mailbox workflow, from the trusted checkout, never from PR code. A recognized
owner-authored `@claude CROSS_MODEL_REQUEST` must include exactly one standalone
line in this format (replace the placeholder with the current lowercase full SHA):

```text
PINNED_PR_IMAGES PR=975 HEAD=<40 lowercase hex characters>
```

The marker is authoritative; duplicate/malformed marker lines, extra path/URL
arguments, missing pins, other repositories and stale heads are blocked. Ordinary
requests without the marker do no API reads or image writes and add no reviewer
context. The helper parses `GITHUB_EVENT_PATH` as JSON; comment text never becomes
a shell command. Both PR base and head must belong to `Achi1984/meridian`, and PR
metadata is checked before retrieval and again before publication.

Only these eight fixed PNG names under `docs/v11/evidence/b11-bots-presentation/`
are read; callers cannot select files:

- `after-320x568-enlarged-text.png`
- `after-320x568.png`
- `after-390x844.png`
- `before-320x568.png`
- `before-390x844.png`
- `command-320x568-enlarged-text.png`
- `command-320x568.png`
- `command-390x844.png`

Fixed-host GitHub GETs read pinned commit/trees and raw git blobs, without redirects,
PR checkout, installs, PR scripts or PR tests. Tree traversal rejects missing or
ambiguous entries, symlinks, submodules and nonblobs. Limits are **2 MiB per PNG,
12 MiB total**, and **1 MiB per JSON response/event**. These conservative ceilings
bound memory/network consumption for eight mobile screenshots, not arbitrary
downloads. Declared sizes are checked before blob requests; streamed response
sizes, PNG signatures and Git blob SHA-1 digests are checked before any image write.
Each API request has a 10-second timeout; the preparation step has a three-minute cap.

Success creates only a fresh private `RUNNER_TEMP/claude-pinned-images-*` directory
outside the tracked checkout. Existing scratch paths are not touched. Its
`manifest.json` binds repository, PR, head, all eight source/absolute paths, sizes,
Git blob IDs and SHA-256 digests. The supported action input `claude_args` appends
the manifest pointer to the existing system context; no tools, permissions,
credentials, max-turns or concurrency change. No images, base64, environment
values, raw API errors or private data are logged/uploaded. Failure emits a fixed
blocking reason to reviewer context and requires `NEEDS_MORE_EVIDENCE`, not visual
acceptance. The reviewer must recheck the head before its final verdict.

Receipt status: source preparation and synthetic mocked-API regression coverage
only (`node --test test/claude-pinned-images.test.js`); no live Claude image Read,
visual review, merge or runtime activation is claimed. Next gates are independent
security review and full appropriate exact-head CI/workflow review. Once approved,
perform one authorized capability smoke request pinned to the current PR975 head:
record the workflow/head and manifest digests, require Claude to Read all eight
PNGs without writes and report honest per-image findings. Missing access or any
uninspected image keeps visual acceptance blocked; do not broaden permissions.
Lead/owner-approved merge remains separate and mandatory. No trading/research
activation, scheduler or service is authorized.

## Scheduling and measurement

The existing mailbox workflow already has a 35-turn limit, a 35-minute job timeout
and issue-scoped concurrency with cancellation disabled. Do not reduce these
blindly or change workflows, credentials, permissions or schedules through this
contract. Investigate a measured bottleneck before proposing a separate change.

Record CI/review run and job IDs, attempt, conclusion and observed elapsed job
seconds when available. Elapsed job seconds are **not billed minutes**. Queue time,
local elapsed time and job duration are different measurements; label each.
Actual token usage is unknown unless the provider reports it for the identified
run. Do not infer tokens from turns or invent euro costs, billing or savings.

Update MERIDIAN_LIVE_CHECKPOINT.json in the SAME PR whenever that PR changes the
work state. Describe verified starting evidence and the intended transition;
never predeclare a merge or postcheck success. A separate consolidated handoff is
for explicit reconciliation requests, not routine delayed checkpoint maintenance.
Request review only after completed successful exact-head CI, using the REQUEST
form also for supplements. A self-reported review gap blocks merge even with GREEN.
After verified postchecks, post FINAL_MERGE_STATUS PR<n> on the PR and mirror it in
Mailbox639. Mirror direct owner decisions as RESOLVED with verbatim quote, exact
scope and consumption state. Preserve single-writer and independent-review gates.

## Completion report

Return the exact files and candidate identity, objective outcome, actual checks and
receipts, reused evidence with its scope, unresolved risks and the next gate.
Separate source completion, publication, merge/postchecks and runtime readiness.
Do not claim results for pending jobs or actions not performed. Stop optional
retesting once acceptance is satisfied; mandatory gates remain mandatory.

Do not install an entire ECC or other plugin bundle merely to accelerate work.
Evaluate only a concrete missing capability, its provenance, dependencies and
permissions within a separately bounded proposal. Existing agents and tooling are
the default; no blanket plugin installation or new external access is authorized.

## Owner resource preference — 2026-10-17

Prefer existing GitHub-hosted agents for substantial bounded implementation proposals, code and checks; the lead retains scope, integration and acceptance, with a separate independent reviewer. Start with one substantial packet, avoid duplicate local/subagent implementation and repeated polling. Verify assignment and report it separately from execution. Report decisions and owner-only blocks, not repetitive owner-Go requests. Keep the existing hourly coordinator's scope and end time unchanged; do not expand automation policy, schedules, workflows or permissions. Use existing permissions only; reviewer-only Claude must not be repurposed as a writer. Exact-head CI, independent review and post-merge gates remain mandatory. Owner evidence: Mailbox639/comment6238672603; first assigned packet: #861 (Copilot).
