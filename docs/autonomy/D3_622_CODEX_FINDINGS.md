# D3 #622 — Codex findings and offline regression evidence

Operation: `MERIDIAN-D3-622-REGRESSIONS-20261009-004`.
Actor: isolated Codex developer. ChatGPT remains operational lead; the user is
Project Owner. None of the execution below is independent Claude execution.

## Exact source and review gate

Live main: `8a8a43fc8df4e440294bf7ef5747510b6c6a44d0`.
Source PR #619 remains Draft on `196d95377d274447ef5908c1294cffb28989f342`, with
that main SHA as its base. Existing Release Safety run `37936527323` is successful
on the source head. Claude R3 (`#571`, comment `6081951179`) remains
`NEEDS_MORE_EVIDENCE`: the reviewer inspected source and CI but did not execute
the tests. Its reported 1861/1861 CI total is reviewer-reported CI evidence, not a
newly extracted local total. R3 did not inspect all seven Copilot threads.

Immutable source file: `test/autonomy-v2-d3-crash-cas.test.js`.

- Git blob: `d8053e3253bfb431994ae227ec47ec92db46cab4`.
- SHA-256: `005dd5b977ad286c66e9bceee6c00ed60509896627c43ed0a72f68b5675620b2`.
- 29,643 bytes, 536 lines. GitHub contents GET pinned to the exact source head;
  Codex independently calculated the Git blob hash before execution.
- Node `v24.19.0`, command `node --test --test-reporter=tap <exact-source-file>`:
  **73 tests / 73 passed / 0 failed / 0 cancelled / 0 skipped**, exit 0.
- The unchanged source hash was checked again. No #619 branch or metadata changed.

This candidate is on its own branch, stacked on that immutable #619 commit.
The Draft PR targets #619's branch so its review diff contains only these findings
and the additional model tests/guard. It does not modify that branch. Exact
candidate head and source blob are recorded in the candidate PR/status. If #619
moves, the lead must reconcile the parent explicitly; do not silently reuse this
review or merge either branch.

## Independent execution within existing permissions

The existing mailbox workflow allows read-only `gh api`, `git` and `node --test`;
Edit/Write, checkout/switch and branch mutation are prohibited for the reviewer.
Claude R3's scratch-write attempts were denied. A writable Codex scratch surface
does not establish a writable Claude surface or grant permission to it.

Codex also executed the exact unchanged source as an in-memory ESM preload:

```text
node --test --test-reporter=tap --import data:text/javascript;base64,<exact-source-base64> /dev/null
```

Result: **73/73**, exit 0, on Node `v24.19.0`. No source checkout or temporary
test-file write is needed by this command. The source imports only `node:test`,
`node:assert` and `node:crypto`; it has no external effects. Codex verified the
Git blob first and supplied the immutable contents bytes without transformation.

This establishes CLI feasibility in Codex's environment ONLY. The method was
already proposed in #619's lead-status comment; it is not a new review or a waiver.
Whether the exact command, data preload and source transfer are permitted by
Claude's existing sandbox remains unverified. The reviewer must make that check
independently before using this candidate surface. A denial must be reported;
do not switch wrappers, enable tools, alter policies or write through another
program to circumvent it. Do not invoke arbitrary mutable issue-provided code.

The same evidence rule stays in force: Claude must personally execute the
authenticated exact-head source and report command/runtime/counts/provenance.
Codex execution, lead execution and CI must remain separately identified. There
was no reviewer dispatch, duplicate R3 request or alternative evidence rule.
If no existing surface permits reviewer execution, retain the strict gate and
Draft status; any alternative standard needs a separate Project Owner decision.

## Seven original Copilot findings

All seven complete comment bodies were read at original review commit
`729808e3ae7999487a075789d50dbf4b85ef8909`, then compared against current #619
source and its executed 73-test suite. These are Codex findings, not thread
resolution, a fresh Copilot review or Claude approval.

| Comment ID | Original finding | Current #619 fix and evidence | Remaining boundary |
| --- | --- | --- | --- |
| 4230073911 | COST_INCIDENT unreachable with cost fixed at 3 | Synthetic cost 11 is accepted and settled; D3-20 asserts true cost, overrun 3, incident flag and blocked PREPARE | Synthetic receipt strings are not provider authentication |
| 4230073975 | Matching counts do not bind receipts to events | `read()` binds key/opId/kind/taskId/generation/status; D3-18 and D3-22 reject rehashed receipt corruption | No authenticated external receipt or authority |
| 4230074039 | Global reserved budget not tied to tasks | All four task sums are compared with global budget; D3-18 exercises reservation/settled divergence | Policy cap binding was missing; fixed only in this candidate |
| 4230074084 | Earlier indexed operation cannot reconcile after N+1 | `reconcile()` consults the current validated index and recomputes the staged command digest; D3-17/D3-22 | Ticket origin remains unauthenticated in this model |
| 4230074128 | C2 restarts before observing pre-materialization local state | D3-10 compares `local` to the pre-command state before restart, for all six transitions | In-memory cuts are not fsync/process crash evidence |
| 4230074181 | C3 does not observe materialized state before restart | D3-11 compares `local` to committed authority before restart, for all six transitions | No real storage/acknowledgment channel |
| 4230074225 | Cap exhaustion never reached | D3-19 settles legitimate cost 8, then rejects the second reservation with DAILY_CAP_EXCEEDED and unchanged state | Fixed synthetic day/units; no real daily rollover |

The seven original defects have corresponding source fixes and executed tests in
#619. That assessment does not close GitHub threads or transfer an earlier review
to this candidate head. D3-11 already tested replay conflict via an extra property
for all six transitions; R3's statement that conflict coverage was only INTENT
was incomplete. This candidate adds conflicts in actual semantic fields.

## Additional gap and change

The source checked `policyRoot` but did not bind `budget.cap` to
`POLICY.maxDaily`. Codex reproduced the gap in memory on the unchanged source:
settle cost 8, rehash a candidate with cap 100, then reserve another 8. `read()`
accepted the candidate and PREPARE applied, allowing total 16 under policy max 12.
The discovery run contained the unchanged 73 tests plus one characterization
probe (74/74). That passing characterization demonstrated a defect; it was not
a security PASS.

The candidate derives the initial cap from the existing policy and rejects a
persisted mismatch with `POLICY_BUDGET_MISMATCH`. Policy values are unchanged
(daily 12, task 8); the check is inside the synthetic test fixture only. It adds
no production budget, provider, durable store, authentication or witness design.

Additional coverage:

- D3-23: raised/lowered/mistyped persisted caps, actual spending-cap bypass and
  valid unchanged-policy settlement.
- D3-24: every receipt identity field and cross-task swaps with preserved counts.
- D3-25: all four independent task/global budget-sum divergences.
- D3-26: semantic command conflicts and older-operation reconciliation for all
  six transitions, with unchanged authority and zero effects.
- D3-27: legitimate 3+8 budget continuation and counter exhaustion before fsync,
  with unchanged journal/anchor/local materialization.

## Candidate execution and negative controls

```sh
node --check test/autonomy-v2-d3-crash-cas.test.js
node --test --test-reporter=tap test/autonomy-v2-d3-crash-cas.test.js
```

Codex result on Node `v24.19.0`: **108 tests / 108 passed / 0 failed /
0 cancelled / 0 skipped**, exit 0. Five added test groups contain 30 subtests,
adding 35 counted tests to the original 73. This is targeted model evidence;
no full repository-suite count or independent reviewer execution is claimed.

Eight negative controls disabled one defense at a time in ephemeral in-memory
copies. No tracked source was modified by these controls. Each exited 1 and was
detected by failing tests; the unmodified candidate SHA-256 remained unchanged.

| Disabled defense | Failed tests |
| --- | ---: |
| Original cost incident recording | 5 |
| Original receipt/event association | 12 |
| Original reserved/task sum | 4 |
| Original reconciliation after a later commit | 8 |
| Original C2 pre-materialization cut | 7 |
| Original C3 post-materialization cut | 7 |
| Original daily-cap admission | 3 |
| New persisted policy-cap binding | 9 |

Syntax/diff checks, continuity audit, frozen research guard (140 checked,
0 mismatches), and orchestration validator passed. Existing exact-head candidate
CI is documented separately by the lead-status comment; parent CI is not
candidate CI. No workflow, runner or new capacity is provisioned for evidence.

## D1/D2/D3 integration risks and next steps

Verified related refs:

- #617 D1/D2: `dce9dfbfdcac5d84384bac51301205e2878d48dd`, base live main
  `8a8a43fc8df4e440294bf7ef5747510b6c6a44d0`, 31 additive files.
- #618 D3 design: `6ec04fa1fb7f15b7be4ad467111ced9acb2836de`, same main base.
- #616 Phase 1C: `e77a5d222add6c17dad5524612a366d3f57c232e`, different base
  `bd9bf59bfa83e98c4925c4d898a0111a2f564cde` (#614).

These refs and PR descriptions were inspected; this change does not import,
execute or establish compatibility with the other modules. Disjoint file names
do not prove runtime or security integration. Open risks:

1. D3 is a self-contained schema-2 fixture with two fixed task IDs, a fixed day,
   synthetic costs, counter time and hardcoded policy. D1's version-1 task contract
   and D2 descriptors need explicit schema, identity, budget-unit, revision,
   fence, state and receipt mappings. No integration adapter is supplied here.
2. #617's admission/queue/replay authority and D3's anchor/index cannot be treated
   as one authority without tested atomicity, same-payload deduplication and
   failure ordering. Preserve exact op-ID/head/base binding across the boundary.
3. All models still depend on retained volatile synthetic authority. Coherent
   anchor-plus-journal rollback is explicitly undetected (D3-13 LIMITATION).
   Production needs an independent monotone witness and authorized durable
   transactions; matching hashes or passing model tests do not supply either.
4. Unknown ATTEMPT_INTENT deliberately retains lease and reservation and denies
   retries/refunds. D1/D2 cancellation, restart, timeout and budget release must
   not reinterpret unknown outcome as absence. Authenticated outcome resolution,
   bounded liveness and real side-effect fencing remain separate design gates.
5. #616 has different ancestry and a separate trusted-memory/HMAC/session model.
   Public fixture keys are not production identity authentication. Its CAS,
   epoch, fence and snapshot assumptions must be reviewed against the eventual
   combined D1/D2/D3 head, not inherited from #614 or this fixture.
6. A stricter offline test does not authenticate caller policy approval, real
   CI/review identity, provider receipts, symlink containment, trusted time or
   ledger retention. No autonomous execution is authorized by this candidate.

Next: keep all existing PRs unchanged and Draft; operational lead verifies this
candidate's exact-head CI, then arranges a single permitted independent review
with actual executed evidence on that new head. Separately design and test the
contract mappings on an explicit integration branch before considering #616.
If reviewer execution remains unavailable, report the concrete gate to Project
Owner without changing its standard. No merge, deployment, workflow/runner/
permission change, spending, trading or research-stage advance is authorized.
