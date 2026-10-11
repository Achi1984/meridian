# D3 offline design — evidence and blockers

Operation: `MERIDIAN-D3-OFFLINE-DESIGN-20261009-001`, 2026-10-09.
Completed scope: security design, canonical state selection, failure matrix,
42 deterministic adversarial acceptance scenarios, migration/rollback and gated
PR sequence. No D3 storage, adapter or execution implementation was authorized
or added. Scenario IDs D3-01..42 are **planned**, not passing D3 tests.

## Live input reconciled

GitHub main was independently read as
`8a8a43fc8df4e440294bf7ef5747510b6c6a44d0`. The live checkpoint uses
STREAM-SAFE-V7 and mailbox #571; all research/trading authorizations remain false.
The checkpoint's older `liveMainAtCreation` is historical, not today's main.

#617 was OPEN/Draft, head `dce9dfbfdcac5d84384bac51301205e2878d48dd`, base
`8a8a43fc8df4e440294bf7ef5747510b6c6a44d0`. Its work order is comment
6076481009. Claude's response 6076423542 is NEEDS_MORE_EVIDENCE on that head/base.
The associated request 6076420558 was already answered; it was not reposted.
The PR-triggered Release Safety run 37897614416 was observed completed/success.
This is CI metadata only; no logs or assertion totals were read. Claude's cited
push run 37897199286 is his evidence, not a new independently read log here.

#616 was separately OPEN/Draft, head `e77a5d222add6c17dad5524612a366d3f57c232e`,
base `bd9bf59bfa83e98c4925c4d898a0111a2f564cde`; review response 6076044215
is NEEDS_MORE_EVIDENCE. That boundary is preserved. Neither PR was edited,
retargeted, marked ready or merged. No comment/review request/dispatch was posted.

## Isolated source provenance

The original `/workspace/meridian` checkout stayed on main with no file changes.
An isolated filesystem copy under `/workspace/meridian-d3-offline/baseline`
was reconstructed from the local exact-main archive and the 31 additive files
fetched at exact #617 head. All 31 Git blob hashes matched the GitHub contents
metadata. Recomputing Git tree hashes over the complete copied tree matched
`07e1ff07a83dc9ad45a9ce498c493d921d015c2f`, the published #617 tree.
This provides exact source provenance without moving any repository branch.

Captured local evidence files live in the packet's `evidence/` directory:
`source-manifest.json`, `source-verification.json`, assertion-level TAP outputs,
syntax results and guard outputs. Proposed additions live in `changes/`.
The snapshot is a development copy, not a new durable queue/storage authority.

The shell tarball/network attempt was interrupted before any download existed;
it was reconciled as absent. Exact-head files were subsequently read through the
available GitHub connector. No credential values were read or printed. No remote
write was retried after interruption. All remote use was read-only; the user's
larger isolated offline block was used for local analysis/document preparation.
No transport rule, workflow or autonomy policy file was modified.

## Tests actually executed locally

Node v24.19.0, exact reconstructed baseline source. Authoritative assertion totals
use `--test-isolation=none`, as the existing D1/D2 local verification guidance
specifies. Initial default-isolation runs reported only file-level summaries
(14 files and 1 security file); those are not used as assertion-level proof.

| Command | Actual result | Evidence file |
| --- | --- | --- |
| `node --test --test-isolation=none --test-reporter=tap test/autonomy-v2-*.test.js` | 288 tests, 288 pass, 0 fail/cancel/skip/todo | `autonomy-baseline-isolation-none.tap` |
| `node --test --test-isolation=none --test-reporter=tap test/autonomy-v2-d1d2-security.test.js` | 86 tests, 86 pass, 0 fail/cancel/skip/todo; included in the 288, not additional | `d1d2-security-isolation-none.tap` |
| `node --check` for every `scripts/autonomy-v2-*.mjs` | 13/13 syntax checks pass | `syntax.json` |
| `node scripts/continuity-audit.mjs` | ok=true, build 10.0-r127; next research stage remains gated | `continuity.json` |
| `node scripts/frozen-research-guard.mjs` | ok=true, 140 checked, zero mismatches | `frozen-guard.json` |
| `python3 scripts/validate-agent-orchestration.py` | MERIDIAN agent orchestration safety: GREEN | `orchestration.txt` |

The whole application/browser suite and general Python suite were not rerun:
this packet adds documentation only and does not alter baseline runtime/test
code. The exact-head historical CI metadata is not CI for these new documents.
No full-suite or D3 persistent implementation PASS is claimed.

## Read-only design challenge and local validation

Root was sole writer. A parallel read-only subagent examined baseline trust
boundaries and the proposed design. It challenged unbounded ledger/ID retention,
ambiguous expiry fields and the treatment of true over-reserve costs. The final
design specifies authenticated archive manifests with CAS and admission capacity
bounds, minimum task/lease/timeout deadlines, and truthful overrun accounting
which disables new attempts rather than discarding costs. This is an internal
design challenge, not Claude's independent exact-head GitHub review or approval.
Final read-only review found no material design blocker. The daily-cap scenario
was clarified to test a free execution lock, so a SINGLE_WRITER_BUSY rejection
cannot be mistaken for proof of budget enforcement.

Local packet checks verify all 42 numbered scenarios, document links, source
hashes, file sizes, absence of trailing whitespace and a cleanly applicable
three-file documentation patch. They validate the packet, not a D3 state machine.
Patch application is tested in a disposable copy; original PR/checkouts are
unchanged. Hashes and publication preconditions are in the packet manifest.

## Publication recheck — documentation-only candidate

The user separately authorized publication as a new Draft on 2026-10-09. Main,
#617 and #616 heads/base pairs were re-read and unchanged; searching D3 branches
and existing PRs found no prior publication of this packet. The candidate uses
main `8a8a43fc8df4e440294bf7ef5747510b6c6a44d0` as its parent, adding only the
three D3 documents. The D1/D2 modules are not copied into this PR; the 288 tests
below are source-verified #617 baseline evidence, not tests of modules on main.

Repeated baseline command:
`node --test --test-isolation=none --test-reporter=tap test/autonomy-v2-*.test.js`
returned 288 pass, zero fail/cancel/skip/todo. The packet's 42 scenario IDs,
relative links, source hashes and byte-verified patch application were rechecked.
The documentation candidate's continuity, frozen-research (140 checked, zero
mismatches) and orchestration guards passed; staged whitespace checks passed.
Publication does not request a Claude review or change any workflow/permission.
Publication operation: `MERIDIAN-D3-DESIGN-PUBLISH-20261009-001`.

## Open gates and original offline publication disposition

- Real durable storage and independently retained authority are unimplemented;
  subprocess rollback/crash/race tests cannot be run yet.
- Authenticated policy/identity/time/CI/review readers and actual provider
  idempotency/CAS/cost enforcement are unimplemented and not approved.
- The existing v1 queue deliberately retains caller-context, memory-authority,
  non-idempotent duplicate, conservative budget-charge and no-lease behavior.
  This design does not fix it in place or claim it is production-safe.
- #617 and #616 exact-head reviews remain NEEDS_MORE_EVIDENCE. These local runs
  add implementer evidence, not independent Claude execution or GREEN_LIGHT.
- Actual D3 implementation scope, storage/provider/permission/cost choices and
  any pilot require the specific owner approvals listed in the design before
  dependent work. No decision is needed to finish the offline design packet.

During the original offline block no remote Draft PR was created: #617 is already Draft, and this design was prepared
as a separate three-document patch to preserve its reviewed head. Publication is
a separate STREAM-SAFE-V7 atomic operation after live head/base reconciliation,
source-transport preflight and expected-head/CAS checks. The packet includes a
proposed Draft description; neither it nor the packet grants permission to run
jobs, spend, provision storage, change workflows/permissions or merge.
