# D2 manual one-shot launcher — source-only acceptance

`scripts/research-supervisor/historical_one_shot.py` is a manually invoked,
fail-closed wrapper around the existing B1 historical journal and supervisor.
It does not initialize, repair, reset, discover, inspect by glob, or reconcile a
journal. It has no import-time writes and no default target. The checked-in
`historical_run_profile.json` remains `NOT_FROZEN`, with null manifest and
approval receipt; this source change is not an execution grant.

## Preconditions and deliberate invocation

Use only after a separate owner execution decision, final review, and explicit
selection of an already existing journal and a new private receipt location.
Both paths must be exact, absolute, canonical paths outside the repository.
The journal must be a private regular historical-profile database with no jobs,
budget reservations, or active fence. The receipt must not already exist, and
its existing parent directory must be private and owner-controlled. Existing
journal files and SQLite sidecars must be regular, private, single-link files;
the exclusively created receipt is checked for the same single-link property.
The launcher rejects any existing `b1_path_payloads` rows, including orphans,
and validates the
Linux host, source pins, frozen profile/admission,
journal schema and fence, all of these filesystem properties, and the fixed
44-path/60-second/1,800-second/1-MiB bounds before its first write. Its
read-only runtime preflight resolves Python and Node and checks executable
availability and privilege bits/capabilities before creating a receipt or
calling enqueue, claim, or run. Launch-time checks remain in place.
These checks run before a receipt is created or any enqueue, claim, or run call.

The command requires an explicit subcommand and owner; placeholders below must
be replaced with the operator's exact paths and owner:

```sh
python3 -B scripts/research-supervisor/historical_one_shot.py execute \
  --journal '<EXACT_EXISTING_PRIVATE_JOURNAL>' \
  --evidence '<EXACT_NEW_PRIVATE_RECEIPT>' \
  --owner '<EXPLICIT_OWNER>'
```

The exact command is not permission to execute. Do not run it against a real
journal or captured data as part of source review or CI. No source-only test
invokes this launcher against a production target.

After preflight, it creates the receipt using exclusive creation, applies
`fchmod(0600)` to correct the inherited access-ACL mask, verifies the resulting
regular-file owner/mode, and syncs the file and parent directory. The private
receipt records intent and each returned or ambiguous enqueue, claim, and run
boundary as bounded JSON lines. It excludes raw results, candle contents,
account details, and production paths. Standard output contains only a bounded
state; errors use stable codes. A receipt or journal is never removed on
failure.

The lifecycle is exactly one `enqueue_b1(database, "trial-historical-d2-r1")`,
one enabled `scheduler_tick_b1` with the explicit owner, identity validation of
that claim, and one `run_b1_batch` with the fixed limits. No loops, retries,
second scheduler tick, automatic initialization, fallback path, or
reconciliation are performed. An ambiguous call is recorded and never retried.
The run call's supervisor batch deadline starts when `run_b1_batch` begins;
profile/journal preflight, receipt setup, enqueue, and claim setup are outside
that timer (the existing scheduler still reserves its fixed 1,800-second
budget). Unexpected claims and existing/nonempty journals stop before engine
execution. An interrupted or unresolved claim retains its attempt, budget, and
fence for separate review.

## Direct-worker parent-death boundary

For B1 only, the supervisor starts a fresh isolated Python bootstrap without
`preexec_fn`. Before it execs the resolved Node binary, the bootstrap sets
`PR_SET_PDEATHSIG(SIGKILL)`, reads it back, checks the expected supervisor PID
to close the startup race, then signals protected-worker readiness. A bootstrap
failure or parent mismatch cannot produce the Node protocol's ready event. The
existing monotonic deadlines, session/process-group cleanup, descriptor
protocol, and normal readiness validation remain in force.

The protection is deliberately limited to the current direct Node worker. The
reviewed B1 engine, historical adapter, input loader, and validator do not spawn
child processes or workers. The launcher checks that the Python and Node
executables have no set-user-ID/set-group-ID mode bits or Linux file
capabilities, so their exec does not perform a privileged credential
transition that clears the parent-death signal. It passes only the existing
sanitized worker environment and explicit result descriptor.

This does not contain arbitrary descendants, guarantee graceful settlement on
parent death, provide a hostile-code/network sandbox, or provide hard
real-time behavior. Graceful SIGTERM of the launcher unwinds through the
existing supervisor cleanup; SIGKILL relies on the direct worker's
parent-death signal. If the parent dies before the bootstrap arms the signal,
the expected-parent check prevents Node exec. Parent death can leave the journal
`RUNNING`/unresolved and the receipt ending at an invocation-intent boundary;
neither is replayed or reconciled automatically. Process tests treat a zombie
as exited work, not as a running worker.

## Future profile preparation is a separate owner gate

Only after separate owner execution approval may a later, reviewed preparation
update the fixed local profile artifact. That preparation may change exactly
`status`, `inputManifest`, `inputManifestSha256`, `inputSha256`, and
`approvalReceipt`; it must preserve the strict stored JSON key set and
`sourceCommit` `1c7b6dccd886f57e866c7d359c091b1e72a193ea`. It must use the
existing accepted D1 `manifestDraft` identity without reopening captured CSVs,
and must use a fresh process after profile changes because modules cache the
profile at import. The checkout/source identity is distinct from the D1 data
provenance commit. This launcher cannot create the approval, freeze a profile,
admit data, or invent an approval timestamp.

The regenerated D2 candidate remains metadata-only: its D1 manifest/input
identity, 44 path IDs and order, protocol, and engine identity must remain
unchanged; only the affected supervisor/bridge source identities and derived
source/profile digests change. Historical records are retained as history.
The strict 11-file admission source map does not include this launcher. A later
execution package must separately bind the exact reviewed source head and the
SHA-256 of `historical_one_shot.py`; do not widen the admission schema to imply
that this new file is already covered. The current proposed launcher file SHA-256 is
`915dccdd705d7251b00567e8c3ba4dbc0f978e3eb63ffa0fccecc7d928f3f951`; refresh
it after every source change. This is not yet a reviewed binding.

Focused generated-fixture acceptance is run through the existing Node test
glob:

```sh
node --test test/research-supervisor-historical-one-shot.test.js
```

No captured CSV or real journal is used. Run `40177333973` attempt 2 failed on
the prior `b8e738d` head (2,735 passed, 13 failed, 0 skipped): 11 historical
export tests failed on a stale synthetic source-map binding, the historical
inspection wrapper failed because its test hook did not recognize the isolated
bootstrap (three internal Python failures), and the five-width Chrome wrapper
failed for the same stale exporter binding before browser acceptance. Run
`40180765963` on R3 head `1f361e3` is `action_required` with zero jobs, not a
test result. R4 focused validation passed 11 historical-export tests and 7
historical-inspection Python tests (the existing Node wrapper passed). The
five-width Chrome test was attempted locally but could not start DevTools within
the existing timeout, so no widths are claimed as validated. A fresh successful
exact-head Actions run and then a mandatory complete-scope final Claude
`GREEN_LIGHT` are required, in addition to the Lead's decision, before any later
decision.
