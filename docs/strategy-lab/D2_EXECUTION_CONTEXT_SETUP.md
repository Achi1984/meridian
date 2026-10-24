# M11 D2 execution-context setup decision

**Status: setup not approved or performed.** D2 remains `DEFER`; the profile is
`NOT_FROZEN`, no admission receipt exists, and execution authority is false.
This is a source-only setup proposal, not readiness evidence, provisioning, or
permission to inspect a journal or run a strategy.

## What is known

| Area | Evidence | Current conclusion |
| --- | --- | --- |
| Configured capability | The inactive supervisor assumes a POSIX host, local SQLite, monotonic deadlines and process-group cleanup. Journal creation is exclusive, mode `0600`, uses `BEGIN IMMEDIATE` and `synchronous=FULL`; configured limits include 1,800 seconds per batch, 60 seconds per path and 1 MiB persisted results. | These describe source behavior, not a configured or available machine. They do not guarantee hard real-time execution, filesystem durability, resource isolation or network isolation. |
| Repository hosting | The Docker image runs the application gateway; Runtime Smoke checks the public Pages/Northflank app. Actions use ephemeral `ubuntu-latest` runners, and the snapshot workflow publishes telemetry. None designates a persistent D2 checkout, machine, volume or journal. | App hosting and CI are not evidence of a suitable D2 execution context. |
| Historical observation | The owner-authorized metadata preflight records verification of the seven pinned input identities and candidate metadata. Its receipt explicitly records execution context and journal as `NOT_OBSERVED`; no target was designated. | No actual context, journal state, attempt count or active fence was observed. `UNKNOWN` is not nonexistent and is not zero attempts. |
| Current availability | No repository deployment source or cited receipt identifies a persistent D2 target or journal path. | `BLOCKED_TARGET_NOT_DESIGNATED`. Provider, machine, capacity, cost and current availability remain `UNKNOWN`; this does not assert that none exists. |

References: [supervisor contract](RESEARCH_SUPERVISOR.md#contract-and-local-journal),
[execution request](../../research/protocols/b1-7-20261018/EXECUTION_REQUEST.md),
[candidate and verifier](../research/d2-candidate/README.md),
[candidate verifier source](../../scripts/research/b1-7/verify-d2-candidate.mjs),
[journal source](../../scripts/research-supervisor/journal.py),
[supervisor source](../../scripts/research-supervisor/supervisor.py),
[container definition](../../Dockerfile),
[runtime smoke workflow](../../.github/workflows/runtime-smoke.yml),
[snapshot workflow](../../.github/workflows/meridian-snapshot.yml),
and the owner decision and context/preflight receipts in
[issue #942](https://github.com/Achi1984/meridian/issues/942#issuecomment-6380621705)
and [issue #935](https://github.com/Achi1984/meridian/issues/935#issuecomment-6380700638).

## Proposed setup — not selected or approved

Use one dedicated, persistent POSIX context and one manual one-shot operator.
First assess whether owner-controlled persistent capacity already exists and
can be evidenced. If not, present a named hosting option and verified cost for
a separate owner decision; do not infer a provider, machine, price or budget.
Do not use chat scratch, an ephemeral Actions runner, or a scheduled workflow
as durable journal storage. Do not add a service, daemon, cron, broker, Paper
or Live integration.

Proposed layout only (no paths exist by virtue of this document):

```text
<D2_ROOT>/source/<reviewed-commit>/                 # exact reviewed source; read-only
<D2_ROOT>/inputs/<accepted-input-identity>/         # only the seven pinned inputs
<D2_ROOT>/state/historical-d2-r1.sqlite             # private persistent local journal
<D2_ROOT>/evidence/                                 # private, durable receipts
```

The final checkout, protocol, implementation, input, profile and ordered-path
identities must be immutable and independently verified against the accepted
source pins and existing receipts. The input identity already reviewed is not
a new acquisition instruction: no reread, substitution, repair or additional
data is in scope here. Keep the root and evidence directory operator-private
(proposed mode `0700`); retain journal permissions established by exclusive
creation (`0600`). Protect any SQLite sidecar files with the same private
directory and persistent-volume boundary.

Use Node 20.x as the repository-configured compatibility target
([Release Safety workflow](../../.github/workflows/backend-safety.yml)); the
repository invokes `python3` but does not pin an exact Python or SQLite
version. Record actual versions only after a host is selected and verify
compatibility there using existing synthetic-only tests. The app's Docker
image is not a D2 runtime specification.

## Bounded setup delta for a later decision

1. Select and document the actual owner-controlled POSIX machine, persistent
   volume, operator, filesystem and verified cost. If no evidenced capacity
   is suitable, stop for a named hosting/cost decision.
2. Place only the reviewed checkout and exact pinned input identities in the
   proposed layout; make source and inputs immutable to the operator running
   the later one-shot. Keep state and receipts private and outside ephemeral
   workspace storage.
3. Confirm the selected host supports POSIX process groups and a monotonic
   clock. Record Node, Python, SQLite, filesystem, mount and persistence
   evidence. `synchronous=FULL` is the configured SQLite request, not proof
   that a provider or filesystem honors durable writes.
4. Preserve the existing supervisor bounds and fail-closed behavior. There
   is no configured memory/CPU quota or hostile-code/network sandbox in this
   proposal. Deadlines do not guarantee hard real-time scheduling, fsync
   latency or process reaping.
5. Do not change `historical_run_profile.json`, create a production journal,
   enqueue, claim, reconcile, start a service, or invoke an engine as part of
   setup acceptance. Roll back only unactivated source/mount setup. If a
   journal was separately created under later concrete approval, never reset
   or delete it on failure; stop and preserve its evidence for review.

## Later read-only acceptance plan — commands not run

First review the exact source pins and metadata. The accepted verifier is a
library (not a standalone CLI); this command form calls its existing API and
reads only the candidate JSON. It can confirm `PROPOSAL_ONLY` metadata, not
final admission, consent, runtime readiness or journal state.

```sh
node --input-type=module -e '
import {readFile} from "node:fs/promises";
import {verifyD2Candidate} from "./scripts/research/b1-7/verify-d2-candidate.mjs";
const report = verifyD2Candidate(await readFile("./docs/research/d2-candidate/admission-candidate.json"));
console.log(JSON.stringify(report));
if (!report.ok || report.executionAuthorized !== false) process.exitCode = 1;
'
```

For an already existing journal only, after an exact path and trial are
designated and read-only inspection is separately in scope, reuse the existing
inspector. Both placeholders below are literal placeholders, not paths or
identities to guess:

```sh
python3 -B scripts/research-supervisor/historical_inspection_report.py \
  '<EXACT_EXISTING_JOURNAL_PATH>' '<EXACT_TRIAL_SHA256>'
```

The inspector accepts one exact journal/trial, does not initialize or recover,
and reports `NOT_OBSERVED` on missing or invalid input. Never respond to an
inspection error by calling `initialize`, searching for a database, or
choosing another trial. Preserve state, attempts, timestamps and fence exactly;
an unresolved `unknown` state is not resumable.

The alternative new-journal branch is permitted only after a later concrete
setup decision designates a new path and explicitly approves creation. The
existing `journal.initialize(path, HISTORICAL_PROFILE_NAME)` implementation
uses exclusive creation and mode `0600`; it refuses an existing file and has
no reset or migration path. Do not invoke it now or use it as an inspection
fallback. A newly created empty schema with no trial is not an `OBSERVED`
historical trial or proof of zero prior attempts. Do not enqueue a trial to
manufacture readiness, and do not add a global all-history gate.

Before accepting a selected context, retain a bounded evidence bundle for:

- persistent volume identity, filesystem/mount, available capacity, owner and
  access modes, plus evidence that the location survives the provider's
  documented restart/replacement boundary;
- exact source/input hashes and tool versions, without reopening captured
  market files;
- existing synthetic-only supervisor test results for process-group
  termination/reaping, monotonic timeout behavior, pipe/result bounds and
  SQLite create-new/`0600`/`synchronous=FULL` behavior, tied to the reviewed
  source revision; and
- the effective batch/path/output limits and the selected host's clock and
  storage properties, with limitations stated. Tests establish the tested
  behavior, not hard real-time guarantees or provider durability.

Existing focused suites include
`node --test test/b1-7-d2-candidate-verifier.test.js`,
`node --test test/research-supervisor.test.js`, and
`node --test test/research-supervisor-historical-inspection.test.js`.
They use source and generated fixtures; do not use them to manufacture an
actual historical trial or readiness. No market-data reread, engine run,
journal creation, enqueue, claim, retry or reconciliation is part of this
acceptance plan.

## Owner decision card

**Setup choice still required:** approve or decline the proposed manual,
persistent POSIX setup after a concrete machine/provider, operator, persistent
volume, cost and exact private paths are identified. The bounded operations
would be pinned source/input placement, private storage/access controls,
version recording, and synthetic-only compatibility/inspection acceptance.
No such target, price, provisioning, setup approval or actual readiness is
asserted here. Current blocker: no designated target exists in the inspected
source/receipts, so actual context and journal state cannot be observed.

**Separate later execution decision:** after setup and independent final
identity verification, the owner must make a new exact decision for one
offline trial and the existing 44 ordered paths, with the identities, limits,
cost scenarios, screen and research-only no-finite-stop exception stated in
the [execution request](../../research/protocols/b1-7-20261018/EXECUTION_REQUEST.md#proposed-bounded-run).
That future decision is not requested or implied here. D2 remains `DEFER`,
profile `NOT_FROZEN`, receipt absent, screen `NOT_RUN`, and all authority
false; no Paper or Live permission follows.
