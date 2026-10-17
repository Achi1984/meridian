# Proposed one-attempt publisher database check

> **Current preparation update — 2026-10-17:** TEST credential setup completed
> in receipt6232054311; owner setup approval6231898914 is consumed. Roles remain
> NOLOGIN. Follow [the commissioning proposal](PUBLISHER_TEST_COMMISSIONING_20261017.md)
> for the next source preparation, exact pins and missing private inspection/
> activation helper. LOGIN, workflow installation and dispatch remain unapproved.
> Statements below about unprovisioned credentials are historical; the bounded
> readiness contract and separate execution gates remain applicable.

Operation: `M11-READINESS-ENTRYPOINT-20261014`. This is a source-only execution
proposal, not permission to provision credentials, install a workflow, connect
to the database, publish a comment, or activate trading. No dedicated role
credentials for this deployment profile are currently provisioned. There is no
runnable workflow or guessed approval/run identifier in this document.

The check's purpose is to obtain evidence that the actual PostgreSQL server can
execute the reviewed SQL and that three real sessions match the bounded catalog
contract. It does not assess investment performance or authorize financial trades.

## Before requesting execution approval

- Reconcile the independently observed database metadata below before execution;
  do not substitute a synthetic fixture name. Confirm PostgreSQL major 16 and the fixed dedicated
  host `ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech:5432`.
- Review and provision the canonical schema, constraints and enabled triggers
  through a separately approved change. This check does not install or verify
  complete trigger/constraint definitions.
- Provision three distinct, non-owner credentials through a separately approved
  process. Verify effective grants, PUBLIC grants, role membership, and ownership.
  Never reuse financial database credentials or an administrator connection.
- For the ledger, permit table SELECT; permit column INSERT **only** on `operation_key`,
  `intent_sha256`, `body_sha256`, `run_id`, `run_attempt`, and `status`; UPDATE
  only on `status` and `comment_id`. Deny table INSERT and INSERT on `created_at`
  and `comment_id`. Use the receipt-safe profile, not the broader legacy test role.
- For the sender, permit SELECT plus UPDATE only on `created_at` on reservations,
  and SELECT/INSERT on send records. For the reader, permit SELECT on both only.
  All three need CONNECT/schema USAGE, no applicable grant options, no CREATE,
  ownership, other-role membership, or dangerous role flags. See the bounded
  [readiness contract](PUBLISHER_DATABASE_READINESS.md) for full scope/exclusions.
- Review the protected environment, reviewers, selected branch, secret delivery,
  dependencies, and the complete execution mechanism. Workflow installation and
  secret provisioning require their own approval; this runbook installs neither.

## Exact provenance required for the proposal

On 2026-10-14 in the current preparation session, read-only Neon control-plane
`describe_project` for `wandering-queen-12324132` reported project
`meridian-publisher-pilot`, PostgreSQL 16, Frankfurt, and plan `free_v3`.
`list_postgres_databases` for exact branch `br-delicate-field-b9uijh3y` reported
one database, `publisher_ledger`, owned by `publisher_owner`. This independently
identifies the proposed database name; it is metadata evidence, not an
authenticated database-session, grant, or credential check. No SQL or credential
retrieval was involved. Reconcile the metadata and fixed endpoint/branch mapping
again before an actual approved run. `publisher_owner` is not one of the three
permitted application roles and must never be used by this entrypoint.

Preparation baseline is merged PR #794 at
`914e801eb7542c9a87534e07b9094674d2f75338`; its reviewed head was
`92418893521b53b457fb48745e424340fdc0614f`, tree
`2a686a5003eabf7154e1bba11be590b3a93d7fd8`. These identify the baseline,
not the new entrypoint's unpublished commit or an approved execution version.

Record the full 40-character immutable source commit containing the reviewed
entrypoint, readiness query, pool adapter, and tests. Record the full base commit,
reviewed diff, test results and exact Node/pg dependency version/lockfile pins.
If a workflow is proposed, also record its exact reviewed revision and dependency
pins. Branch names, short hashes, PR numbers and a green result on an earlier
commit are insufficient execution pins.

The final source SHA and any workflow/run/approval IDs must be taken from actual
published evidence after the packet exists. They are intentionally not guessed
here. The actual approved execution mechanism and credential-delivery plan remain
unresolved; this source packet is not yet a complete execution approval request.
Once those details are concrete and reviewed, obtain approval for exactly that
version, target database, three roles,
secret mechanism, deadline and **one attempt**. An already consumed TLS-probe
allowance cannot authorize this credential-bearing database check.

## Entrypoint and credential boundary

The proposed explicit CLI opt-in is `--check-test-db`; absence of the flag or any
additional/unknown argument must reject before environment/driver access. Import
alone performs no work. The entrypoint reads only these independently provisioned
environment values; it must never log their contents:

| Variable | Purpose |
| --- | --- |
| `MERIDIAN_PUBLISHER_TEST_DATABASE` | Independently verified isolated database |
| `MERIDIAN_PUBLISHER_TEST_RESERVATION_USER` | Ledger role |
| `MERIDIAN_PUBLISHER_TEST_RESERVATION_PASSWORD` | Ledger secret |
| `MERIDIAN_PUBLISHER_TEST_SENDER_USER` | Sender-record role |
| `MERIDIAN_PUBLISHER_TEST_SENDER_PASSWORD` | Sender-record secret |
| `MERIDIAN_PUBLISHER_TEST_READER_USER` | Confirmation-reader role |
| `MERIDIAN_PUBLISHER_TEST_READER_PASSWORD` | Reader secret |

The source entrypoint is
`event-adapter/review-binding/scripts/publication-database-readiness-cli.mjs`.
Its testable API is `runPublicationDatabaseReadinessCli(argv, {readEnv, loadPg,
processApi, timeoutMs = 10000})`; direct execution supplies real process bindings.
The seven `readEnv` calls are synchronous trusted runtime accesses before the
operational deadline, not arbitrary asynchronous secret-provider callbacks.

There is no host, port, connection-string, credential-file, `DATABASE_URL`,
default-role, or financial-database fallback. Validate the complete explicit
configuration before loading the pg driver. Do not paste secrets into command
arguments, source files, approval comments, screenshots, or retained artifacts.

## Permitted attempt and expected evidence

The approved execution may open the three reviewed role pools and issue **at
most three fixed catalog SELECTs**, one per role, stopping on failure. No
application rows, user-selected SQL, write query, migration, privilege change,
publisher credential, OIDC token, GitHub publication, or trading request is needed.
Creating a connection can wake a suspended database; read-only does not mean
credential-free or free of provider resource consumption.

The pool must enforce verified TLS/SNI, minimum TLS 1.2, and startup
`search_path=pg_catalog`. The server check must observe that exact search path,
2,000 ms statement timeout and 1,000 ms lock timeout. Retain the client connect,
query, overall operation and cleanup bounds. Signal, timeout or cleanup failure
must not be converted to a successful result. Never retry, reconnect to a
different target, broaden grants, or rerun under an administrator automatically.
The CLI defaults to a 10-second operation limit (maximum 15 seconds through its
explicit API), bounds stdout completion to one second, and installs an independent
hard-exit fallback at the operation limit plus three seconds. Process termination
does not demonstrate completed graceful socket cleanup. The unreferenced fallback
timer is cleared in the CLI's final cleanup; direct execution then explicitly
calls `process.exit(code)` after the bounded flush. A function return or failure
exit does not prove graceful pool closure. This is a one-attempt
process, not global replay protection: approval controls must prevent launching
another process with the same allowance.

| Readiness outcome | Interpretation and next action |
| --- | --- |
| `SCOPED_READ_ONLY_CHECKS_PASSED` | All sampled properties matched for this attempt; retain sanitized evidence for review |
| `SCOPED_CHECKS_FAILED` | Evidence mismatched the fixed contract; stop and investigate through a separate approved process |
| `INDETERMINATE` | Driver, timeout, signal, or cleanup prevented a conclusive result; stop without retry |
| `ALREADY_CONSUMED` | The one-shot checker was invoked again; no fresh attempt is authorized |

The CLI emits `PUBLICATION_DATABASE_READINESS_CLI_RESULT`. Exit 0 is reserved for
a scoped pass with successful output handling; exit 1 covers scoped failure or
indeterminate execution/output. Missing or invalid activation gives
`NOT_REQUESTED`/exit 2 without environment or pg access; invalid environment
configuration gives `CONFIGURATION_REJECTED`/exit 2 before driver loading.
Before result output, operational timeout gives `DEADLINE_EXCEEDED`/124, and
signals give `INTERRUPTED` with 130 (SIGINT) or 143 (SIGTERM). During a pass-output
flush, the same interruption codes override exit 0 even if the buffered JSON
still says scoped pass. A hard fallback may terminate
without a complete output record. Treat any nonzero exit as authoritative failure
even if an earlier partial or completed stdout line claimed a pass.

A successful report still carries `liveAuthorized:false`,
`publicationAllowed:false`, and `universalSecurityVerified:false`. Each role
query is a separate session snapshot, not an atomic cross-role observation;
permissions can change between or after checks. No result proves complete
database/financial isolation, trigger correctness, durable publication, or
future credentials/grants.

Retain only the reviewed source provenance, actual run/job IDs, timestamps,
bounded sanitized status and exit result. No raw catalog rows, manifests,
passwords, environment dump, pg options, or driver exception text. After the one
attempt, record its outcome and consume the allowance whether it succeeds or
fails. Any remediation or further attempt requires a new concrete proposal.
