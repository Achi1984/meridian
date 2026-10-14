# Publisher database readiness: bounded evidence contract

Source preparation for issue #792. No provisioning, credential acquisition,
database connection, publication, or live trading is authorized by this document.
Synthetic tests exercise decisions against supplied rows; they do not demonstrate
that PostgreSQL has parsed or executed the query on the dedicated Neon branch.

## Intended evidence

`createPublicationDatabaseReadiness(trustedConfig, {Pool, timeoutMs = 10000})`
returns a one-shot `check(parentSignal)`. The trusted configuration uses the
existing explicit pool configuration shape; no environment lookup or driver
installation occurs. The maximum requested operation deadline is 15 seconds;
pool cleanup has its separate two-second bound. Exactly one fixed SELECT is
attempted for each role, stopping at the first failed or indeterminate check.

A future approved check uses three independently scoped role connections and a
fixed catalog-only SELECT. Invoking it uses the supplied real role credentials;
this is not the credential-free TLS probe. It reads no application rows and performs no DDL,
INSERT, UPDATE, DELETE, SET ROLE, or privilege changes. The trusted database name
and expected users come from deployment configuration, not query output. One
successful check is a snapshot of explicitly checked properties, not proof of
universal least privilege, durable writes, safe publication, or future grants.
Each role query captures a separate session snapshot; the three checks are not
an atomic cross-role or global-time observation. Permissions and other checked
properties can change between role queries or after any successful result.

Reject absent, ambiguous, malformed, unsupported, timed-out, or mismatched
results. Never treat missing catalog visibility or NULL as a successful denial.
Report sanitized status and coverage; never return connection credentials or
raw driver errors. Do not retry failed readiness automatically.

The result kind is `INACTIVE_DATABASE_READINESS_RESULT`. Its outcomes distinguish
`SCOPED_READ_ONLY_CHECKS_PASSED`, `SCOPED_CHECKS_FAILED`, `INDETERMINATE`, and
`ALREADY_CONSUMED`. The fixed scope is
`PUBLISHER_TEST_CATALOG_PRIVILEGES_AND_CURRENT_SESSIONS`; `liveAuthorized`,
`publicationAllowed`, and `universalSecurityVerified` remain false even on pass.

## Required privilege interpretation

| Dedicated role | Reservations | Send records |
| --- | --- | --- |
| Ledger | Table SELECT; column INSERT only the six receipt fields listed below; column UPDATE only `status`, `comment_id` | No table or column access |
| Sender writer | Table SELECT; column UPDATE only `created_at` | Table SELECT/INSERT; no UPDATE |
| Confirmation reader | Table SELECT; no writes | Table SELECT; no writes |

The ledger's exact INSERT columns are `operation_key`, `intent_sha256`,
`body_sha256`, `run_id`, `run_attempt`, and `status`. Table-wide INSERT must be
false; INSERT on `created_at` and `comment_id` must also be false. The database
default supplies the reservation timestamp. Combined with UPDATE only on
`status` and `comment_id`, this supports both fresh receipt acquisition and
terminal settlement without permitting caller-supplied timestamps.

This is the intended receipt-safe deployment profile, not a claim about installed
roles. No actual dedicated Neon role credentials have been provisioned for this
profile. The legacy `publication-postgres-integration.mjs` app role grants
table-wide INSERT, and the ledger fixture's older comment describes that broader
profile. Neither is the receipt-safe deployment authority. The dedicated
`publication-reservation-receipt-integration.mjs` role grants the six columns and
tests rejection of explicit `created_at` INSERT/UPDATE. The reservation trigger
does not reject a caller-supplied timestamp during INSERT; its later immutability
checks do not substitute for these narrower INSERT privileges.

All three require database CONNECT and publisher-schema USAGE. The sender's narrow
UPDATE grant supports `SELECT FOR UPDATE`; it is not permission to change the
reservation's timestamp under the reviewed trigger contract.
The query also requires effective CONNECT, denies CREATE on the current database,
and denies the grant option for both of those privileges.

Table-level checks alone are insufficient. Examine every non-dropped user column
on both exact ordinary tables, including unexpected columns, using effective
column privilege checks. Table-wide privileges also satisfy column checks. Reject
broad UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, and grant options. Required
read/insert grants must exist, not merely an absence of forbidden grants. An
additional PostgreSQL-major privilege such as MAINTAIN needs explicit coverage;
an unreviewed server version must not silently inherit this matrix.
The implemented check accepts PostgreSQL 16 only and rejects both RLS flags,
unexpected columns, ownership, any other-role membership, and all five checked
dangerous role flags (superuser, create database/role, replication, bypass RLS).

Effective privilege functions account for available grants, including PUBLIC
and inherited permissions; an ACL text search or an empty explicit ACL is not
an adequate replacement. Separately exclude ownership and dangerous role flags.
For these dedicated roles, rejecting membership in every other role is a
conservative way to exclude inherited and future SET ROLE escalation paths.
Membership is distinct from currently inherited permission and from SET ROLE
eligibility in PostgreSQL 16. Inspect the actual session/current identities;
matching only a configured role name proves nothing about its grants.

## Transport and time limits

The revised pool contract pins `search_path=pg_catalog` at connection startup;
the readiness evidence must require that exact setting. Qualified catalog
functions alone do not prevent an explicitly reordered search path from changing
unqualified operator/type resolution. This is a startup configuration and fixed
catalog check, not a diagnostic SET command or permission to modify roles.

Use `pg_stat_ssl` only for `pid = pg_backend_pid()`. A positive result establishes
encryption for that PostgreSQL backend; it does not independently prove the
client checked certificate trust, hostname, or SNI, especially across a proxy.
Retain the pool adapter's verified TLS configuration and separate TLS diagnostic.
The separately approved fixed-endpoint probe succeeded in run `38596478549`,
job `115964404663`, at `2026-10-14T16:15:19.9994384Z` after PR #786 merge
`62e6efb809078aec52fad68d4b5a2057ffc2325d`. Its allowance is consumed. This
point-in-time transport result does not establish database credentials/grants
or authorize a fresh readiness connection.

Read effective server `statement_timeout` and `lock_timeout` values with their
units; PostgreSQL may render equivalent settings in different textual forms.
The reviewed pool limits are 2,000 ms and 1,000 ms respectively. Connection and
client query timeout are driver settings, not equivalent server GUCs. Keep a
separate bounded overall operation and cleanup path. A returned timeout does
not by itself prove the driver released all sockets or cancelled server work.

## Separate deployment gates and exclusions

- Independently verify the actual database name, branch, users, and provisioning
  evidence. A source literal, fixture name, or pool construction is not readiness.
- Audit callable routines and SECURITY DEFINER paths. PUBLIC receives EXECUTE
  on newly created functions by default; NULL function ACL does not mean denial.
  An accessible SECURITY DEFINER function can act with its owner's authority.
  The implemented query rejects executable SECURITY DEFINER routines outside
  `pg_*` and `information_schema`. It does not audit routine definitions, trusted
  system/extension routines, or all possible execution paths.
- Verify the exact schema, constraint and trigger definitions separately,
  including enabled state and immutable terminal/send-record behavior. The
  canonical guard functions use invoker security and a fixed catalog search path;
  observing table privileges does not establish that these guards exist or work.
- Other databases, unrelated schemas/relations, sequences, extensions, foreign
  servers, RLS policies, default privileges and future grant changes remain
  outside a two-table privilege matrix unless expressly included in the query.
  No readiness result may claim financial-database isolation from these checks.
  Database TEMPORARY and its grant option are not checked; CONNECT and CREATE
  plus their grant options are covered, not the complete database ACL.
- Role ownership or an administrator can change safeguards after observation.
  Reconcile any drift before an approved publication attempt; the read-only check
  supplies no repair authority and no reservation/publication authorization.

## Primary references checked

- [PostgreSQL 16 information and privilege functions](https://www.postgresql.org/docs/16/functions-info.html)
- [PostgreSQL 16 ownership, grants and default PUBLIC privileges](https://www.postgresql.org/docs/16/ddl-priv.html)
- [PostgreSQL 16 function security](https://www.postgresql.org/docs/16/sql-createfunction.html)
- [PostgreSQL 16 timeout settings](https://www.postgresql.org/docs/16/runtime-config-client.html)
- [PostgreSQL SSL statistics](https://www.postgresql.org/docs/current/monitoring-stats.html#PG-STAT-SSL-VIEW)

Initial static review missed the legacy-versus-receipt INSERT distinction; the
corrected intended matrix above must be enforced by the revised readiness source
and tests before accepting that source's review. No real SQL
parsing/execution, credentials, or database probe formed part of that review.
Requirements and synthetic results are not evidence of deployment readiness.
