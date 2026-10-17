# Publisher database execution proposal

> **Current preparation update — 2026-10-17:** Receipt6232054311 records completed
> TEST secret/password preparation with NOLOGIN preserved; approval6231898914 is
> consumed. The [commissioning proposal](PUBLISHER_TEST_COMMISSIONING_20261017.md)
> selects the existing inactive fixture and unchanged application source, plus
> explicit inspection, LOGIN, one-dispatch and closure gates. Historical role/
> secret-creation instructions below are not a retry or recreation instruction.
> A safe private inspection/activation launcher remains to be implemented and
> reviewed before execution approval can be requested. This update installs or
> activates nothing.

> **Execution hold (2026-10-14):** The local-PC/password procedure below is
> superseded by the candidate [browser setup](PUBLISHER_DATABASE_BROWSER_SETUP.md).
> Do not use its `psql \password` step: Neon's documented password-input
> requirements conflict with the assumed client-hashed input. Review and verify
> the replacement before credential entry. The source-only workflow fixture
> remains inactive; no provisioning or diagnostic attempt is implied.

Operation: `M11-READINESS-EXECUTION-PROPOSAL-20261014`.
Status: concrete source proposal pending exact-version review and owner approval.
Nothing here installs a workflow, provisions a role/secret, or authorizes a run.

## Selected execution design

Use one manually dispatched GitHub-hosted check in `Achi1984/meridian`, main
branch, protected environment `meridian-publisher-test`. Require owner actor and
triggering actor `Achi1984`, workflow run number 1 and attempt 1. The job
has read-only contents permission, no OIDC permission, no publisher token, and
no route to publication or trading. One process performs at most three fixed
catalog SELECTs, using the already reviewed readiness CLI.

The inactive fixture is
`event-adapter/review-binding/fixtures/meridian-database-readiness.yml` under this
document's directory. Proposed installed path is
`.github/workflows/meridian-database-readiness.yml`. Keeping the fixture outside
`.github/workflows` makes it reviewable without installing or enabling a workflow.

The selected target was observed through read-only Neon control-plane metadata
on 2026-10-14 in this preparation session:

| Property | Selected value |
| --- | --- |
| Project | `wandering-queen-12324132` / `meridian-publisher-pilot` |
| Branch | `br-delicate-field-b9uijh3y` |
| Database | `publisher_ledger` |
| Host / port | `ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech:5432` |
| Server major / region | PostgreSQL 16 / Frankfurt |
| Observed database owner | `publisher_owner` — never use for the check |

`describe_project` and `list_postgres_databases` establish metadata, not role
authentication, grants, enabled triggers or credential readiness. Reconcile the
fixed endpoint/branch mapping and current metadata before the approved attempt.
The earlier successful TLS probe allowance is consumed and is not reused here.

## Separate role-provisioning scope

Request a separate, explicit approval to create only these dedicated login roles
and apply the reviewed minimal grants on the selected isolated database:

| Role | Permitted publisher-table operations |
| --- | --- |
| `meridian_test_reservation` | SELECT reservations; column INSERT only `operation_key`, `intent_sha256`, `body_sha256`, `run_id`, `run_attempt`, `status`; column UPDATE only `status`, `comment_id` |
| `meridian_test_sender` | SELECT reservations and column UPDATE only `created_at`; SELECT/INSERT send records |
| `meridian_test_reader` | SELECT reservations and send records only |

Each needs CONNECT and publisher-schema USAGE; none receives ownership, other-role
membership, CREATE, broad UPDATE, grant options, administrator attributes, or
financial database access. Reservation table-wide INSERT and INSERT on
`created_at`/`comment_id` remain denied. Distinct names/passwords do not prove
effective privilege separation; inherited and PUBLIC rights must be checked.

These are write-capable application credentials, even though this diagnostic
issues only SELECTs. In particular, sender table INSERT can supply
`send_records.created_at`; its default is not enforced against an explicit value.
`guard_send_record` rejects UPDATE, DELETE and TRUNCATE, but does not guard
INSERT. The reviewed sender inserts `operation_key` and `comment_id`, allowing
the timestamp default; its reader and confirmation/recovery consumers never read
that timestamp or use it as freshness, approval or provenance evidence.

The foreign key, unique constraints and positive comment-ID check do not prove
that a supplied comment ID came from GitHub. The trusted sender must retain its
actual publication response; confirmation separately verifies the binding,
published comment and current admission evidence. This profile therefore trusts
the sender credential holder and must not be described as database-enforced
comment authenticity or timestamp authenticity. Restricting sender INSERT to
two columns would be a further least-privilege change requiring a separate
readiness-profile/test revision; it is not silently included in this proposal.

No roles or credentials have been created for this proposal. Password generation
and delivery belong to a secure owner-controlled provisioning step, never this
document, source, chat, logs or SQL committed to GitHub. The separate
[role-creation constraints and grant proposal](PUBLISHER_DATABASE_ROLE_SETUP.md)
must be reviewed before execution. Do not automatically revoke PUBLIC rights,
change existing owners, replace triggers, or broaden grants to make the check pass.
Unexpected existing access or schema drift stops provisioning for reconciliation.

The selected operator procedure is now concrete: Christoph uses PostgreSQL 16
`psql` on his trusted PC, with the fixed TEST endpoint, independently verified
administrator identity, local trusted CA bundle and `sslmode=verify-full`.
The linked role plan specifies fresh ordinary roles created **NOLOGIN**, aborts
on any existing proposed name, records role OIDs/attributes/membership, and uses
interactive `\password` with verified SCRAM encoding. Passwords move from his
password manager to the six protected environment secrets, never through chat.
Only after grant review and secret handoff does the same verified administration
session recheck the new role identities and enable their LOGIN attributes.
Uncertainty leaves the roles disabled. Neon UI/API role creation is not the
selected path because automatic privileged membership would violate this profile.
This procedure is proposed and unexecuted; no administrator username, credential,
CA path, role OID, environment setup, or prior run history has been fabricated.

The proposed administration model retains the creator's **ADMIN OPTION only on
these three newly created roles** for password maintenance. For those membership
edges, INHERIT and SET must both be false. This is distinct from the application
roles' restrictions: the three new roles must have zero outbound membership in
other roles and must not acquire administrative authority. Creator maintenance
authority is not an application credential or a runtime fallback.
The trusted creator remains privileged: retained ADMIN OPTION can permit later
changes to membership options, including granting itself SET/INHERIT, so their
current false values are not a tamper-proof restriction on that administrator.

Before creation, the verified PostgreSQL 16 administration session must explicitly
verify `createrole_self_grant` is empty and inspect the creator's relevant role
flags/capability using the linked procedure. The selected prerequisite is exactly
`publisher_owner` as current/session user, with CREATEROLE and without SUPERUSER,
and direct ownership of `publisher_ledger`, the publisher schema and both tables.
These are required observations, not a claim that a session has confirmed them.
After creation, inspect the actual
membership edge direction and ADMIN/INHERIT/SET flags rather than assuming
NOINHERIT controls them. Unexpected or missing required creator authority, extra
membership, wrong flags, or unverified role identity is a stop condition; do not
repair roles or transfer ownership silently.

The role plan's concrete effective-privilege verification must return **zero
mismatches** before LOGIN is enabled or an execution approval is requested.
Its cardinality checks require three roles, two ordinary tables, eleven exact
columns and 186 privilege checks. SQL errors or any GRANT warning mean STOP;
successful COMMIT alone is insufficient. Record exactly the three expected
incoming creator membership edges and zero outgoing new-role membership edges;
record their actual grantor rather than guessing it.
Identity, role flags, ownership, table/column privileges and grant options must
be checked, not inferred from successful GRANT statements. Database TEMPORARY
access is observed and recorded separately; it is not a reason for an automatic
PUBLIC revoke, nor evidence that complete database isolation has been verified.
Require three non-NULL TEMPORARY observations and include them in owner review.
These checks remain proposed source steps until independently reviewed and
actually executed under the separate provisioning approval.

## Protected environment and secrets

After approval, configure `meridian-publisher-test` with the owner as required
reviewer and a main-only deployment branch restriction. For this sole-owner,
manually dispatched diagnostic, set **Prevent self-review: disabled**, so
`Achi1984` can approve the owner-initiated job. This is the proposed setting,
not a claim that it is configured. Verify that the GitHub plan/settings support
required reviewer enforcement. If it is unavailable, stop and revise the approval
mechanism before installing or running anything.

This is a sole-owner approval pause, **not independent second-person review**.
The environment's branch restriction does not bind its secrets to this one
workflow: another main-branch workflow can request the same environment, subject
to its required owner review. Before approving a job, the owner must verify the
exact installed workflow revision and permitted job, not merely the environment
name. No new CODEOWNERS or repository-governance rule is installed by this packet;
additional governance can be considered separately.

The environment's existence, reviewers, branch restrictions and secrets have
not been verified. No environment/secret installation capability is assumed from
the available tools. These protected settings and secret values must be entered
through a supported owner-controlled GitHub interface after approval.

| Environment secret | Exact value source |
| --- | --- |
| `MERIDIAN_PUBLISHER_TEST_RESERVATION_USER` | `meridian_test_reservation` |
| `MERIDIAN_PUBLISHER_TEST_RESERVATION_PASSWORD` | Fresh reservation-role password |
| `MERIDIAN_PUBLISHER_TEST_SENDER_USER` | `meridian_test_sender` |
| `MERIDIAN_PUBLISHER_TEST_SENDER_PASSWORD` | Fresh sender-role password |
| `MERIDIAN_PUBLISHER_TEST_READER_USER` | `meridian_test_reader` |
| `MERIDIAN_PUBLISHER_TEST_READER_PASSWORD` | Fresh reader-role password |

The non-secret database variable is fixed to `publisher_ledger`. Only the check
step receives these six secrets, mapped to the CLI's exact environment names.
The dependency-install step receives no database secrets. There is no host,
connection-string, file-path or default-credential override.

## Immutable source and dependency evidence

Deploy the exact reviewed merged source containing the readiness module, pool
adapter and CLI from PR #796, plus the separately reviewed workflow fixture.
The source baseline is `817e18d06c453bbd6a01fa44abe1de778dc94cc9`;
PR #796's reviewed head was `ca9f1ce40c9d45f3d4dea85c98e7c317e74d23cb`,
tree `00c1c1d3346af632c7fb97a3e62c9842f54e9ff6`. The workflow's application
checkout must pin that independently reviewed baseline, not its own future
installation commit. Pin and record the actual installed workflow revision
separately after its installation proposal is approved.
Record the full source commit, final fixture commit and installed workflow diff
in the approval record. The new fixture's commit is unknown until publication;
it must be copied from the actual published review result, never guessed or
replaced by a mutable branch name. The fixture must not claim its own unpublished
commit as a usable execution pin.

The selected runtime is Node 22.23.3 on `ubuntu-24.04`, with an exact runtime
version assertion, and the existing reviewed npm lockfile containing
`pg` 8.23.0. Verify lockfile Git blob
`55a78f3b27fd823008b77dde8d77219bd0fbef2d` before installation. Use
`npm ci --ignore-scripts --no-audit --no-fund` and independently reviewed immutable
GitHub Action commits. Any mismatch blocks the run. Exact action/source pins and
the final installation diff remain part of final source review, not values for
the owner to invent.

The inactive fixture pins `actions/checkout` to
`11d5960a326750d5838078e36cf38b85af677262` and `actions/setup-node` to
`49933ea5288caeca8642d1e84afbd3f7d6820020`. The final review must confirm the
published fixture retains those approved action revisions and exact application
source pin; any subsequent change invalidates that approval record.

## Installation and one-attempt approval scope

Once the source and provisioning plan are reviewed, request explicit owner
approval for these distinguishable actions:

1. Create the three named roles and minimal grants through the separate approved
   provisioning plan; configure the protected environment and six secrets.
2. Install exactly the reviewed inactive fixture at the proposed workflow path,
   with its approved immutable source/action/dependency pins.
3. Dispatch exactly one owner-triggered main-branch run, run number 1/attempt 1,
   against the fixed isolated database. No rerun, retry, alternate credentials,
   migration, publication, discovery or trading is included.

Before requesting dispatch approval, confirm that the workflow path has no prior
run history that would defeat the first-run guard. A consumed run number or
rerun restriction is a stop condition, not a reason to rename/recreate the
workflow or weaken its guard. Actual run/job IDs are recorded after dispatch.

The job's outer bound is five minutes; the CLI's default operation deadline is
ten seconds with bounded output/cleanup handling. The pool enforces verified TLS,
catalog-only search path and reviewed connection/query/lock/statement limits.
The workflow keeps only sanitized CLI JSON and the exit result, suppresses raw
stderr, and uploads no artifact. Logs still require review before treating them
as durable evidence. Nonzero exit wins over an earlier buffered success line.

Success means `SCOPED_READ_ONLY_CHECKS_PASSED` with exit 0 for the sampled
PostgreSQL 16 catalog/session properties. Other outcomes stop without retry;
signal/timeout/cleanup uncertainty is not success. This check does not prove
cross-role atomicity, trigger semantics, complete isolation, or publication
durability. It does not authorize live financial activity.

## Minimal owner actions after review

The architecture and names above are selected; no design choice is delegated to
the owner. Once exact source review is complete, the owner approves the scoped
provisioning/installation/one-attempt proposal, performs the linked verified-PC
psql procedure and secure environment/secret setup through GitHub's supported
interface, and approves the
protected job when ready. We can prepare and verify the reviewable source and
available metadata; unsupported secret entry must not be simulated or exposed
in chat. A missing capability or protection remains an explicit blocker.

The approval record must identify the sole-owner pause explicitly, acknowledge
that the credentials remain write-capable beyond the SELECT-only diagnostic,
and explicitly cover the creator's retained ADMIN OPTION on only the three
new TEST roles, with INHERIT/SET false on those edges. The record must also
bind the exact reviewed workflow/source pins, role/grant procedure and
one-attempt scope. Before approval to execute, record observed role setup,
protected-environment configuration, secret-name completion and unused workflow
run history. Source GREEN does not establish those remaining operational facts.

After the attempt, record actual source/run/job/timestamps and sanitized outcome;
consume the allowance on either success or failure. Any remediation or second
attempt requires a new concrete proposal. This document alone is not that
approval and no execution is underway.
