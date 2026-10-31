# One-candidate review handoff

Use with the delivery model in `MERIDIAN_GO.md`: one coherent feature PR, disjoint agent work, one branch writer, focused author validation, full hosted candidate CI, independent Claude review, guarded merge, main postchecks and live acceptance. This template changes no workflow, permission, test gate or activation authority.

## Prepare once, then freeze

Lead integrates the complete agreed feature packet, including cache/release metadata, tests and bounded continuity updates. Authors provide final manifests, focused test receipts and concrete residual risks; no second agent repeats the same diagnosis or tests. Preserve source attribution. Freeze head/base before requesting review. Read back the actual PR head and bind hosted CI to its synthetic merge plus both parent SHAs. Send one complete handoff only after required candidate checks pass.

## Copy into the review request

**Identity:** request ID `<id>` · PR `<url>` · head `<full SHA>` · base `<full SHA>` · synthetic merge `<full SHA>` · writer `<owner>`. All reads use these immutable revisions.

**Outcome and scope:** `<one paragraph: concrete problem, resulting behavior, acceptance criteria; link feature PLAN>`. Changed paths `<count>`; attached/linked complete manifest and untruncated base-to-head diff. No unlisted files are implied reviewed.

**Candidate evidence:** `<CI run/job URLs, exact tested binding, passed/failed/skipped totals, every required step conclusion>`. Author/local agent evidence `<focused receipts, clearly attributed>` is not Claude review or hosted CI. Any prior failed attempt remains recorded with its disposition.

**Required reading map — include every changed path individually:**

| Exact path | Classification | Complete required read at pinned head | Acceptance/risk checked |
| --- | --- | --- | --- |
| `<behavior file>` | Behavioral | Entire small file, or exact inclusive ranges covering full affected functions AND invoked helpers/data producers; always full diff | `<concrete invariant>` |
| `<test file>` | Behavioral test | Entire small test, or full changed tests PLUS their fixtures/helpers/import setup; always full diff | `<failure actually detected>` |
| `<cache-only file>` | Cache-only | Complete diff; verify changes really are only identity/import/harness tokens | `<coherent graph, preserved historical pins>` |
| `<continuity file>` | Continuity | Complete patch plus baseline invariant comparison and exact cited receipts | `<no routing/authority/history rewrite>` |

Use source line numbers from the frozen head. Follow real producer→normalizer→consumer paths where coercion, units or provenance matter. A helper's existence is not evidence that the actual production path uses it. Cache-only large browser files do not require rereading unchanged blobs; any behavioral change moves that file into behavioral scope. Do not treat fixture mocks as a live database/browser check.

**Concrete residual risks:** `<only evidence-backed limitations relevant to this change, with planned acceptance or an explicit unresolved blocker>`. Distinguish unavailable evidence from a discovered defect. Name the exact missing capability or observation; avoid speculative redesigns and unrelated hardening.

**Requested response:** exact head/base; completed reading coverage; findings with severity/path/line and concrete trigger; `GREEN_LIGHT`, `REVISION_REQUIRED` or `NEEDS_MORE_EVIDENCE` under existing policy. No source edits, publication, runtime/provider action or additional permission is requested by the review.

## Reviewer coverage before verdict

- [ ] All manifest paths and complete diffs read; truncated output retrieved in bounded follow-up reads.
- [ ] Every behavioral function, required producer/helper and test fixture in the map read in full.
- [ ] Cache-only classification verified; continuity receipts and unchanged historical/authority invariants checked.
- [ ] Exact-pair CI and required conclusions verified; source changes since the handoff ruled out.
- [ ] Remaining concrete defects or genuinely inaccessible evidence named precisely. Local agent GREEN is not presented as Claude's own work.

Complete missing reads on the same head before giving a verdict whenever access permits; do not issue a partial review merely because a first tool result was truncated. If evidence cannot be accessed, state exactly what is missing. Full review coverage remains mandatory.

## Changes, retests and release closure

A new head/base invalidates the old candidate binding: Lead supplies the new pair, diff since reviewed head, applicable fresh validation and updated coverage. Reuse unchanged findings/receipts honestly; never carry an old GREEN over to changed source. A same-head missing-read follow-up completes that review, not a new implementation cycle.

Authors run meaningful focused checks; hosted CI runs the complete final candidate. Do not request duplicate full local suites or rerun passed tests/reviews without changed source, a failure, or a concrete unresolved concern. A retry needs its observed cause and the existing bounded policy; browser transport failure does not justify repeating source CI. This never skips required checks.

After full independent GREEN and applicable standing authorization, Lead performs expected-head guarded merge. Record one closure receipt containing PR/head/base/merge SHA; candidate CI; review request/verdict/coverage; required exact-merge main postchecks; actual deployed SHA; and live acceptance with surface, result and remaining limits. Use `POSTCHECKS_GREEN_LIVE_ACCEPTANCE_PENDING` while actual acceptance is still open; use `COMPLETE` only when all applicable acceptance is evidenced. Preserve failures and unknowns; no private amounts, tokens or raw errors in public receipts.

For a larger feature delivery, all disjoint source packets converge into this single PR and reading map. Update one progress record, then one final closure receipt; close/supersede source PRs only after verified incorporation. Root selects the live checkpoint's mailbox before posting. This document itself requests no external comment or workflow change.
