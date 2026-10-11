# D1/D2 offline validation evidence

This is local candidate evidence, not an exact-head CI verdict or approval.
No operational Codex runner or GitHub adapter is enabled.

## Reconciliation

Live main was independently read as
`8a8a43fc8df4e440294bf7ef5747510b6c6a44d0` and the original checkout stayed clean.
Checkpoint mailbox #571, CHATGPT lead lease HELD, terminal build 10.0-r127,
SOURCE_AUDIT and all research/trading authorization flags remain unchanged.

Inspected #607, #608, #611, #613 and #614; #612 was comparison/history only.
Reuse baseline: #614 head `bd9bf59bfa83e98c4925c4d898a0111a2f564cde`,
canonical #613 semantics. Twenty-two carried source/test/document blobs were
verified byte-for-byte against GitHub blob SHAs. The old closure proposal doc
with stale PR identity is omitted; the D1/D2 contract documents this candidate.

Existing exact-head Release Safety metadata: #607 run 37786206667 success;
#608 run 37810416671 failure; #611 run 37814460784 success; #613 run 37834096755
success; #614 run 37892987483 success. Main Release Safety 37774285315,
Runtime Smoke 37774285413 and Coordinator 37774285237 were success.
These historical results and old Claude reviews do not approve the new head.
#611's adverse review remains authoritative over its conflicting older GREEN.

## Executed local checks

- Unchanged complete offline baseline: 174/174 actual tests pass.
- Final integrated offline suite: 288/288 actual tests pass; zero skips,
  failures or cancellations. Includes 86 independent adversarial D1/D2 cases.
- Python unittest discovery: 189/189 pass.
- Full ordinary Node suite: 2076 tests, 2067 pass, 5 fail, 4 cancelled, zero
  skipped. Failures/cancellations are confined to existing R131 lifecycle and
  V11 CDP browser tests: Chrome timeouts, parent timeout and remaining lifecycle
  cases cancelled. This is a failed complete local gate, not a whole-suite PASS.
- Continuity audit, frozen research guard (140 checked, zero mismatches),
  orchestration validator, release sync/check, V10 UI regression, public privacy
  and high-confidence secret checks passed.
- New module syntax and staged diff checks are required before publication.

An earlier restricted-sandbox run produced child-spawn/socket EPERM and CLI
collection failures. Supported command permissions fixed normal Node child
transport and the non-browser safety gates; the browser limitations remained.
No tests, CI workflows, permission settings or browser assertions were edited
to suppress these failures. The existing Release Safety workflow must validate
the published exact head; fresh Claude review is required after CI.

## Security findings resolved

Negative-zero counters, accessor execution at configuration boundaries, omitted
terminal expected SHAs, malformed scenario defaults and early attempt consumption
on a rejected duplicate completion were corrected before final offline testing.
The queue exposes a read-only preflight using the same reducer and authority CAS
as commit; a denied attempt leaves state, budget, audit and ID history intact.
Crash/rebuild, lost acknowledgements, global ID collisions, rollback/tampering,
fence/clock regression, single-writer contention, budget and timeout rejection
have dedicated adversarial coverage.

## Remaining gates

Fresh exact-head CI and independent review are still pending. D3 additionally
requires durable transactional authority, authenticated approvals/actors/reviews,
trusted time, external rollback anchor, side-effect fencing, symlink containment,
bounded replay retention and explicit Product Owner permissions/budget approval.
The current memory model proves none of those operational guarantees. No merge,
D3/D4 activation, paid job or research/trading authorization is granted.
