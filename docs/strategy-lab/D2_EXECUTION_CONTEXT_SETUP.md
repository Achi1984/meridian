# M11 D2 execution-context setup decision

**Status: setup not approved or performed.** D2 remains `DEFER`; the profile is
`NOT_FROZEN`, no admission receipt exists, and execution authority is false.
This source-only proposal is not readiness evidence, provisioning, or permission
to inspect a journal or execute a strategy.

## What is known

| Area | Evidence | Current conclusion |
| --- | --- | --- |
| Configured capability | The inactive loader requires Linux `/proc/self/fd`; the supervisor uses POSIX process groups, local SQLite and monotonic deadlines. Journal creation is exclusive, mode `0600`, uses `BEGIN IMMEDIATE` and `synchronous=FULL`; configured limits include 1,800 seconds per batch, 60 seconds per path and 1 MiB persisted results. | These describe source behavior, not a configured or available machine. Linux/procfs compatibility must be verified before any later setup; these capabilities do not guarantee hard real-time execution, filesystem durability, resource isolation or network isolation. |
| Repository hosting | The Docker image runs the application gateway; Runtime Smoke checks the public Pages/Northflank app. Actions use ephemeral `ubuntu-latest` runners, and the snapshot workflow publishes telemetry. None designates a persistent D2 checkout, machine, volume or journal. | App hosting and CI are not evidence of a suitable D2 execution context. |
| Historical observation | The owner-authorized metadata preflight records verification of the seven pinned input identities and candidate metadata. Its receipt explicitly records execution context and journal as `NOT_OBSERVED`; no target was designated. | No actual context, journal state, attempt count or active fence was observed. `UNKNOWN` is not nonexistent and is not zero attempts. |
| Current availability | No repository deployment source or cited receipt identifies a persistent D2 target or journal path. | `BLOCKED_TARGET_NOT_DESIGNATED`. Provider, machine, capacity, cost and current availability remain `UNKNOWN`; this does not assert that none exists. |

References: [supervisor](RESEARCH_SUPERVISOR.md#contract-and-local-journal),
[request](../../research/protocols/b1-7-20261018/EXECUTION_REQUEST.md), [candidate](../research/d2-candidate/README.md),
[verifier](../../scripts/research/b1-7/verify-d2-candidate.mjs), [loader](../../scripts/research/b1-7/captured-input.mjs),
[journal](../../scripts/research-supervisor/journal.py), [D1 metadata](../research/d1-20261019/verification.json),
[Dockerfile](../../Dockerfile), [runtime workflow](../../.github/workflows/runtime-smoke.yml),
[snapshot workflow](../../.github/workflows/meridian-snapshot.yml), [owner decision](https://github.com/Achi1984/meridian/issues/942#issuecomment-6380621705),
and [context/preflight receipts](https://github.com/Achi1984/meridian/issues/935#issuecomment-6380700638).

## Proposed setup — not selected or approved

Use one dedicated, persistent Linux context with working `/proc/self/fd` and
one manual one-shot operator, but only on existing owner-controlled capacity
available at zero additional cost. No paid capacity, upgrades, subscriptions or
spend are in scope. Do not assume a free tier is available or suitable. If no
existing target meets the requirements at zero incremental cost, remain blocked;
do not select or provision another host.
Do not use chat scratch, an ephemeral Actions runner, or a scheduled workflow
as durable journal storage. Do not add a service, daemon, cron, broker, Paper
or Live integration.

Proposed layout only (no paths exist by virtue of this document):

```text
<D2_ROOT>/checkout/<reviewed-code-commit>/          # reviewed source checkout / loader root
  research/acquisitions/kraken-usd-daily-20261018/normalized/
    XBTUSD_1440_utc_normalized.csv  ETHUSD_1440_utc_normalized.csv
    SOLUSD_1440_utc_normalized.csv  XRPUSD_1440_utc_normalized.csv
    LINKUSD_1440_utc_normalized.csv AVAXUSD_1440_utc_normalized.csv
    SUIUSD_1440_utc_normalized.csv
<D2_ROOT>/state/historical-d2-r1.sqlite             # private persistent journal
<D2_ROOT>/evidence/                                 # private durable receipts
```

The production loader fixes its root to the checkout containing
`scripts/research/b1-7/captured-input.mjs` and accepts only the seven
checkout-relative normalized paths shown above. Do not put inputs in a sibling
directory, redirect them with symlinks, or change the loader/adapter to accept
another root. The code checkout identity and input-data provenance are distinct
pins: the reviewed code/source hashes identify the loader and supervisor, while
the D1 manifest records data provenance commit
`1c7b6dccd886f57e866c7d359c091b1e72a193ea` and per-file/selected-series hashes.
Do not imply these commit identities are the same. Any later preparation must
preserve the reviewed code bytes and exact accepted input bytes at the fixed
paths, with provenance and hashes independently checked. No copies, downloads
or market-file reads are performed by this proposal. Keep the checkout root
and evidence directory operator-private (proposed mode `0700`); retain journal
permissions established by exclusive creation (`0600`). Protect any SQLite
sidecar files with the same private directory and persistent-volume boundary.

Use Node 20.x as the repository-configured compatibility target
([Release Safety workflow](../../.github/workflows/backend-safety.yml)); the
repository invokes `python3` but pins no Python or SQLite version. Record
actual versions only after host selection. The app's Docker image is not a D2
runtime specification.

## Bounded setup delta for a later decision

1. Identify whether an existing owner-controlled Linux machine and persistent
   volume are available at zero additional cost, and document suitability,
   operator and filesystem evidence. If none is evidenced, stop; no paid
   alternative, upgrade, subscription or assumed free-tier option is authorized.
2. Confirm the selected Linux host exposes working `/proc/self/fd` and supports
   POSIX process groups and a monotonic clock. The existing loader resolves each
   opened descriptor through `/proc/self/fd/<fd>`, rejects symlinked components
   and root aliases, and requires the resolved descriptor path to match the
   fixed checkout-relative file. A generic POSIX label is insufficient.
3. Only after separate authorization, place the reviewed checkout and exact
   pinned input bytes in the checkout-relative paths above; keep source and
   inputs immutable to the later one-shot operator. Keep state and receipts
   private and outside ephemeral workspace storage. Record Node, Python,
   SQLite, filesystem, mount and persistence evidence. `synchronous=FULL` is
   the configured SQLite request, not proof that a provider or filesystem
   honors durable writes.
4. Preserve the existing supervisor bounds and fail-closed behavior. There
   is no configured memory/CPU quota or hostile-code/network sandbox in this
   proposal. Deadlines do not guarantee hard real-time scheduling, fsync
   latency or process reaping.
5. Do not change `historical_run_profile.json`, create a production journal,
   enqueue, claim, reconcile, start a service, or invoke an engine as part of
   setup acceptance. Roll back only unactivated source/mount setup. If a
   journal was separately created under later concrete approval, never reset
   or delete it on failure; stop and preserve its evidence for review.

## Later metadata and context acceptance plan — commands not run

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
- exact source/input identities and tool versions, using existing receipts and
  hash metadata rather than reopening captured market files;
- the effective batch/path/output limits and the selected host's clock and
  storage properties, with limitations stated. Source-level limits do not
  establish hard real-time guarantees or provider durability.

Existing focused suites include
`node --test test/b1-7-d2-candidate-verifier.test.js`,
`node --test test/research-supervisor.test.js`, and
`node --test test/research-supervisor-historical-inspection.test.js`.
Only the candidate-verifier suite is a source/metadata check. The supervisor
suite creates temporary synthetic journals/claims and invokes generated-fixture
engine paths; the historical-inspection suite also creates temporary synthetic
journals and exercises inspection. These suites are not read-only or evidence
of production journal state/captured-data readiness. If later used for
compatibility, run them only within the synthetic boundary and record scope;
this packet ran none. No captured-data read, production journal creation,
historical trial enqueue/claim, or historical strategy execution is in scope.

## Owner decision card

**Setup choice still required:** approve or decline manual persistent Linux
setup only if existing owner-controlled capacity is suitable at zero additional
cost and its machine, operator, persistent volume, `/proc/self/fd` and private
paths are evidenced. No paid capacity, upgrade, subscription or unverified
free-tier assumption is allowed. Delta: reviewed source; later-authorized,
hash-pinned inputs at fixed checkout paths; private access controls and version
recording. No target or suitability has been observed, and no provisioning or
setup approval is asserted. Current blocker: no designated target exists in
the inspected source/receipts, so actual context and journal state cannot be
observed.

**Separate later execution decision:** after setup and independent final
identity verification, the owner must make a new exact decision for one
offline trial and the existing 44 ordered paths, with the identities, limits,
cost scenarios, screen and research-only no-finite-stop exception stated in
the [execution request](../../research/protocols/b1-7-20261018/EXECUTION_REQUEST.md#proposed-bounded-run).
That future decision is not requested or implied here. D2 remains `DEFER`,
profile `NOT_FROZEN`, receipt absent, screen `NOT_RUN`, and all authority
false; no Paper or Live permission follows.
