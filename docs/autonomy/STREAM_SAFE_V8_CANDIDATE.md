# STREAM-SAFE-V8 candidate

Proposal: https://github.com/Achi1984/meridian/issues/571#issuecomment-6096562356

Base: `256cb443b9b65debfe0fa4ba1540bf760a5ef698`.
Operation: `MERIDIAN-STREAM-SAFE-V8-CANDIDATE-20261010-001`.

This candidate replaces chat-turn caps with authorized work packages. Every
write still requires intent, ownership, expected-state guards, reconciliation
and a checkpoint. Project Owner approval, independent exact-head review and CI
remain required before merge. Nothing here implements agent dispatch, durable
replay protection or authenticated transport. No workflows or product code change.

Local evidence (2026-10-10):

- Orchestration validator, continuity audit and mailbox bridge check passed.
- Frozen research guard: 140 checked, zero mismatches.
- Transport/preflight: 33 passed, zero failed.
- Policy negative controls: six Python tests passed; Node CI wrapper passed.
- Initial full Node suite: 2008 tests, 2001 passed, seven failed test entries.
  Five entries lacked the existing `pg` dependency; after `npm ci --ignore-scripts`,
  all 49 tests in those five files passed.
- Two browser files remain unverified locally. Downloaded Chrome
  155.0.8059.39 initially lacked executable bits; after correcting those bits,
  the binary exited 139 even for `--version`. This is an environment limitation,
  not evidence of passing browser tests. Require fresh exact-head CI results.
- No full-suite PASS, independent review, production readiness or policy
  activation is claimed. Policy adoption occurs only after approved integration.

Reviewer focus: coherent bootstrap/checkpoint/state/resume policy; preserved
research and merge gates; rejection of obsolete turn caps and broadened authority;
all policy tests included through the existing Node suite; no workflow mutation.
