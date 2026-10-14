# Publisher test runner deployment contract

Status: source preparation only. No workflow installation, dispatch, credential
provisioning, database modification, publication, merge, or trading activation is
authorized by this document. Future workflow path:
`.github/workflows/meridian-negative-publisher.yml`.

TLS PR #786 merged at `62e6efb809078aec52fad68d4b5a2057ffc2325d`.
Approved owner-run `38596478549`, job `115964404663`, main/attempt 1, succeeded
at `2026-10-14T16:15:19.9994384Z`, verifying certificate and hostname for the
fixed test endpoint. That probe allowance is consumed; it does not authorize a
rerun. It supplies point-in-time TLS evidence, not database-role readiness,
credential provisioning, publication approval, or measured cold-start behavior.

## Trust and acquisition order

1. The reviewed runner wrapper captures the real runner identity/context and OIDC
   request endpoint from the independently supplied runner environment **before**
   consuming any per-run manifest. Manifest fields cannot supply or override that
   environment. Require the expected repository, owner actor, main ref,
   `workflow_dispatch`, first attempt, actual run ID, and actual control SHA.
2. Load the approved, strictly validated non-secret manifest. Check its exact
   context binding, expiry, and offline publication plan before acquiring role
   credentials. The existing Python planner runs isolated with bounded input,
   output, and execution time. A valid plan is not authorization to publish.
3. Only after offline validation and independent context checks, acquire the
   three narrowly scoped database credentials through reviewed injected code.
   Assemble the in-memory bootstrap configuration **before constructing**
   `createActionsPublicationBootstrap`: that constructor requires complete role
   credentials. Do not incorrectly defer these credentials until its pool stage.
4. The bootstrap then acquires the OIDC token, verifies identity and live evidence,
   performs preflight, and opens its dedicated pools. Bind the identity adapter to
   the independently captured endpoint, never to an endpoint trusted solely
   because it appears in the manifest.
5. Publisher credential acquisition remains deferred to the existing host's
   acknowledged reservation boundary. Supply a lazy `readCredential` function;
   do not invoke it during manifest loading, role acquisition, bootstrap
   construction, or pool opening. An uncertain reservation cannot authorize it.
6. Perform one bounded attempt and close pools. Ambiguous persistence/publication
   or cleanup failure requires owner reconciliation; never retry automatically.

## Non-secret manifest boundary

The exact approved manifest schema is `{body, trustedConfig}`. It carries only
the approved publication body, trusted policy/scope/pin data, approval timing,
and subject/environment constraints. Database identity/roles are not manifest
fields: the wrapper receives `databaseName` independently on the dedicated host,
and obtains roles exclusively from its independently supplied credential callback.
Reject unknown keys and structural fields for credentials, connection strings,
environment snapshots, OIDC endpoint/token overrides, executable hooks,
credential-file paths, or secret-location selectors. This schema boundary does
not detect arbitrary secret text embedded in otherwise allowed strings; reviewed
manifest provenance and content remain required. The manifest must not choose
a credential provider.

`trustedConfig` follows the bootstrap contract: `scopeRaw`, `policyRaw`, `pinsRaw`,
`ownerId`, `environment`, `subject`, `issuedAt`, `expiresAt`, and
`approvalUpdatedAt`. The publication body is bound by the existing offline
planner and evidence checks; the deployment must not regenerate a different body
after approval. The credential-bearing bootstrap object is an ephemeral assembled
object, **not** the approved manifest and never a log/artifact payload.

## Adapter and runtime prerequisites

- `createPublicationTestRunner(options)` returns a one-shot `run(parentSignal)`.
  Its exact options are `runnerEnv`, `databaseName`, `Pool`, `fetchFn`, `readApprovedManifest`,
  `readRoleCredentials`, `readPublisherCredential`, `clockMs`, `monotonicMs`, and
  `deadlineMs` (positive, at most 60,000). All callbacks/driver/clocks are explicit;
  the module does not read `process.env` or provide an installed CLI.
- Independently capture precisely these runner fields before manifest access:
  `GITHUB_ACTIONS`, `RUNNER_ENVIRONMENT`, `GITHUB_REPOSITORY`,
  `GITHUB_EVENT_NAME`, `GITHUB_REF`, `GITHUB_RUN_ATTEMPT`, `GITHUB_ACTOR_ID`,
  `GITHUB_RUN_ID`, `GITHUB_SHA`, `ACTIONS_ID_TOKEN_REQUEST_URL`, and
  `ACTIONS_ID_TOKEN_REQUEST_TOKEN`. Do not spread the whole environment or log
  this credential-bearing snapshot. The source currently requires GitHub-hosted
  execution, repository ID 1342084551, and owner actor ID 319562141.
- `readApprovedManifest(signal)` returns exactly the non-secret schema above.
  `readRoleCredentials(signal)` returns exactly `{reservation, senderRecord,
  sendRecordRead}`, each containing `{user,password}`. Neither callback receives
  a manifest-selected path or provider. `readPublisherCredential(signal)` remains
  a separate deferred acquisition operation.
- The wrapper internally binds `openPublicationPools(config, {Pool})` as the
  bootstrap's pool hook; `openPools` is not a wrapper option. Inject the audited
  `pg.Pool` constructor. Supply the independently verified dedicated database name
  through `databaseName`; no default test-fixture database name is assumed.
  The fixed dedicated host is
  `ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech:5432`.
- Pool configuration is exactly `{host, database, reservation, senderRecord,
  sendRecordRead}`, with a distinct `{user,password}` pair for each role. No
  financial `DATABASE_URL`, default/admin credential, host override, or fallback.
- TLS requires certificate trust and hostname verification, explicit SNI and TLS
  1.2 minimum. Bounds are 1.5 s connect, 2 s statement, 2.5 s query, 1 s lock,
  and 2 s pool closure. These are failure bounds, not measured latency claims.
- The revised pool startup contract pins `search_path=pg_catalog` through its
  trusted startup options. The corresponding readiness check must observe that
  exact value. Schema-qualified function names alone do not pin unqualified
  operator/type resolution; a role/database-default search path is not trusted.
- Install and pin the separately reviewed Node/pg runtime and Python 3 environment
  through a future approved deployment. Include the Python planner and its local
  dependencies. Importing the source modules must remain inert.
- Use bounded abort-aware fetch, real wall/monotonic clocks, and sanitized result
  handling. Do not log manifests, OIDC values, connection objects, or driver
  errors. Shutdown timeout reports uncertainty, not proof of closed handles.

## Database privileges to verify independently

Distinct role names/passwords do not prove effective grants or separation.
Provision and inspect the isolated schema outside this runner. Verify inherited
and PUBLIC privileges, forbidden writes, and unrelated-schema access as well as
the successful operations below. The observed integration contract is:

| Role | Required operation surface |
| --- | --- |
| Reservation/ledger | SELECT on reservations; INSERT only `operation_key`, `intent_sha256`, `body_sha256`, `run_id`, `run_attempt`, `status`; UPDATE only `status`, `comment_id` |
| Sender record | SELECT on reservations; UPDATE only `created_at`; SELECT and INSERT on `meridian_publisher.send_records` |
| Record reader | SELECT on reservations and send records |

For the ledger role, table-wide INSERT and column INSERT on `created_at` or
`comment_id` must be denied. This is the receipt-safe deployment contract: use
the six-column grant exercised by the receipt integration, with the two-column
settlement UPDATE grant. The older general integration role/table-INSERT fixture
comment is a legacy test profile, not permission to widen this contract. INSERT
must leave the timestamp to its database default; the reservation trigger alone
does not prevent insertion of a supplied timestamp. Actual dedicated Neon role
credentials for this profile remain unprovisioned.

All need the corresponding database CONNECT/schema USAGE. No role should obtain
admin, schema ownership, DELETE/TRUNCATE, broad UPDATE, or financial database
access. Confirm append-only/terminal-state constraints and the receipt contract;
do not derive correctness from a role-name allowlist alone.

## Unresolved release gates

- Define and approve the provisioning protocol for **actual** workflow run ID,
  exact control SHA, and fresh owner approval. These are unknown before the real
  run exists; no guessed IDs, stale approval, fixture substitution, self-approval,
  or runtime pin rewriting is permitted. The protocol must preserve first-attempt
  binding and the bootstrap's at-most-900-second validity window.
- Configure the exact protected environment, required reviewers/branch rules,
  minimal OIDC/read permissions, and separately scoped publisher credential.
  Environment names and endpoint equality alone do not establish authenticity.
- Verify the actual dedicated database name and readiness, three effective grant
  sets, secret provisioning, pinned dependencies,
  actual dedicated-host TLS reachability, and bounded cold/warm start behavior.
- Review the complete wrapper/workflow at its exact commit and obtain the
  applicable installation and test-run approvals before dispatch.

There is deliberately no runnable workflow fixture or guessed deployment value
in this contract. Passing synthetic checks means source is reviewable, not that
the publisher is deployed or live trading is enabled.
