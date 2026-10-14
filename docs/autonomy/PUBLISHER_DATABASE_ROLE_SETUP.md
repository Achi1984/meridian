# Publisher TEST role setup proposal

Status: **proposal only; not executed**. This packet creates no roles, retrieves
no credentials and changes no grants. Provisioning, secret installation and the
readiness run require their own concrete owner authorization. A source merge is
not that authorization.

## Fixed target and proposed identities

| Binding | Exact proposed value |
| --- | --- |
| Neon project | `wandering-queen-12324132` |
| Isolated branch | `br-delicate-field-b9uijh3y` |
| Direct host | `ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech:5432` |
| Database | `publisher_ledger` |
| Schema | `meridian_publisher` |
| Reservation role | `meridian_test_reservation` |
| Sender-record role | `meridian_test_sender` |
| Confirmation-reader role | `meridian_test_reader` |

These three role identities are proposed, not observed provisioned accounts.
Before any change, independently confirm project, branch, database, object
ownership and current grants. Do not use the financial database, parent branch,
existing validation role, or an administrator credential as a runtime substitute.

## Secure creation and credential handoff

Use a separately approved provider/owner administration flow to create ordinary
login roles and deliver three distinct random passwords directly to the approved
secret store. Do not put passwords in SQL examples, repository files, chat,
workflow inputs, command-line arguments, logs or artifacts. This document does
not prescribe a password-bearing command or retrieve an existing password.

For all three roles require LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
NOREPLICATION and NOBYPASSRLS. Prefer NOINHERIT as additional defense, but it is
not a replacement for **zero membership in other roles**. Require no ownership
of database/schema/tables/functions, no grant/admin options, and no membership
in an administrator or provider-managed privileged role. Verify the actual
catalog state after creation; do not assume a provider UI/API creates ordinary
roles. If its creation path adds privileged membership, stop and obtain a
separately reviewed ordinary-role creation procedure. Do not repair that silently.

The exact six secret mappings proposed for the separately approved protected
environment are:

| Environment secret | Value source |
| --- | --- |
| `MERIDIAN_PUBLISHER_TEST_RESERVATION_USER` | `meridian_test_reservation` |
| `MERIDIAN_PUBLISHER_TEST_RESERVATION_PASSWORD` | Reservation role's securely provisioned password |
| `MERIDIAN_PUBLISHER_TEST_SENDER_USER` | `meridian_test_sender` |
| `MERIDIAN_PUBLISHER_TEST_SENDER_PASSWORD` | Sender role's securely provisioned password |
| `MERIDIAN_PUBLISHER_TEST_READER_USER` | `meridian_test_reader` |
| `MERIDIAN_PUBLISHER_TEST_READER_PASSWORD` | Reader role's securely provisioned password |

`MERIDIAN_PUBLISHER_TEST_DATABASE=publisher_ledger` is a non-secret exact
deployment binding. The runtime uses no generic `DATABASE_URL` or `PG*` fallback.

## Reviewable grant proposal

Prerequisites: the three new roles have no pre-existing object privileges or
memberships; canonical tables and enabled guards exist under an independent
owner; effective PUBLIC grants do not widen this matrix. The administrator must
connect to the exact branch/database above. These additive grants do not remove
old or inherited privileges and therefore are not a repair script.

```sql
-- PROPOSAL ONLY. No credentials and no role creation in this block.
-- Independently verify the fixed branch/host and current_database() first.
BEGIN;

GRANT CONNECT ON DATABASE publisher_ledger
  TO meridian_test_reservation, meridian_test_sender, meridian_test_reader;
GRANT USAGE ON SCHEMA meridian_publisher
  TO meridian_test_reservation, meridian_test_sender, meridian_test_reader;

GRANT SELECT ON TABLE meridian_publisher.reservations
  TO meridian_test_reservation;
GRANT INSERT (operation_key, intent_sha256, body_sha256, run_id, run_attempt, status)
  ON TABLE meridian_publisher.reservations TO meridian_test_reservation;
GRANT UPDATE (status, comment_id)
  ON TABLE meridian_publisher.reservations TO meridian_test_reservation;

GRANT SELECT ON TABLE meridian_publisher.reservations
  TO meridian_test_sender;
GRANT UPDATE (created_at)
  ON TABLE meridian_publisher.reservations TO meridian_test_sender;
GRANT SELECT, INSERT ON TABLE meridian_publisher.send_records
  TO meridian_test_sender;

GRANT SELECT ON TABLE meridian_publisher.reservations,
  meridian_publisher.send_records TO meridian_test_reader;

COMMIT;
```

Do not grant table-wide INSERT on reservations: its `created_at` timestamp must
come from the database default, and initial `comment_id` must remain absent.
The six INSERT columns match `RESERVE_RECEIPT_SQL`. Revoking individual column
rights cannot cancel an existing table-wide grant.

The sender's narrow UPDATE privilege on `created_at` enables its reviewed
`SELECT FOR UPDATE` locking path. It is not intended to permit timestamp changes:
the canonical `guard_reservation` trigger rejects changes to reservation identity
and timestamps, and enforces terminal transitions. Independently inspect the
enabled trigger and function definitions before granting this privilege. Preserve
the canonical invoker-security functions and their `search_path=pg_catalog`.
This block grants no function EXECUTE, schema CREATE, DELETE, TRUNCATE, REFERENCES,
TRIGGER, sequence permissions, role membership or ownership.

## Effective privilege and PUBLIC review

Inspect direct, inherited and PUBLIC permissions, database CONNECT/CREATE,
schema privileges, grant options, role attributes, both tables and every column.
Fresh names alone do not establish isolation. The canonical fixtures revoke
PUBLIC access to the publisher schema/tables/guard functions, but their presence
in source does not prove the deployed ACLs.

No PUBLIC revocation is included here. A PUBLIC change affects all users of its
target object, including existing workloads. If PUBLIC, default privileges,
memberships, ownership or pre-existing grants violate the profile, stop and
prepare an exact object-scoped remediation proposal with affected principals,
dependencies and rollback evidence for separate approval. Never perform blanket
database/schema revokes, broad default-privilege changes or automatic repair.

Database TEMPORARY and unrelated schemas/databases/routines require separate
review; the readiness matrix does not establish universal least privilege or
financial-database isolation. An executable SECURITY DEFINER routine may cause
the readiness check to reject an otherwise matching table matrix. Inspect it;
do not broaden the checker or revoke provider routines automatically.

## Session settings and acceptance

The pool adapter requests startup settings `statement_timeout=2000`,
`lock_timeout=1000`, and `search_path=pg_catalog`, verified TLS on the fixed host,
and bounded driver operations. The read-only checker requires effective server
settings, exact identities/database, and the narrow grant matrix; it does not
install these permissions or prove guard definitions. Never fix a failing check
by substituting an owner role or relaxing TLS/search-path checks.

After separately approved setup, retain sanitized evidence of role attributes,
membership/ownership absence, exact grants, verified target and secret names
without values. Any readiness run is separately authorized and uses the actual
three credentials. Passing readiness authorizes no publication, reservation,
strategy execution, merge or live trade.

## Sources

The checked local contracts are `fixtures/publication-ledger.sql`,
`fixtures/publication-send-record.sql`, `scripts/publication-reservation-receipt.mjs`
and `scripts/publication-actions-pools.mjs` under
`docs/autonomy/event-adapter/review-binding/`. The current narrow reservation
grant profile supersedes the older broad-grant fixture comment; schema semantics
and guards remain the canonical definitions.

- [PostgreSQL 16 GRANT](https://www.postgresql.org/docs/16/sql-grant.html)
- [PostgreSQL 16 CREATE ROLE](https://www.postgresql.org/docs/16/sql-createrole.html)
- [Readiness scope and exclusions](PUBLISHER_DATABASE_READINESS.md)
- [Execution proposal](PUBLISHER_DATABASE_EXECUTION_PROPOSAL.md)
