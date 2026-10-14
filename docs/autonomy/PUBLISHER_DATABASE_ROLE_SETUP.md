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

**Operator: Christoph, on his trusted PC using PostgreSQL 16 `psql`.** This is
an owner-operated prerequisite, not an automated connector step. It requires the
separate provisioning approval and an existing authorized administrator identity
for the exact TEST branch. Do not create these roles through Neon Console, CLI,
or role-creation API: Neon documents that those paths add `neon_superuser`
membership. Use SQL role creation below instead.

Keep new roles NOLOGIN until passwords, grants and the six protected-environment
secrets have been installed and checked. No existing role is altered or reused.
For all three require NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION,
NOBYPASSRLS and NOINHERIT, **zero membership in other roles**, no object ownership,
and no grant/admin options. NOINHERIT does not replace the membership check.

### 1. Verify the administrator connection on the PC

In Neon, independently confirm the fixed project/branch/database/endpoint above.
Use the existing administrator's username and locally trusted CA bundle; neither
is guessed here. Confirm `psql --version` is PostgreSQL 16. Start interactive
psql with the following template, replacing only the administrator username and
absolute CA bundle path with the locally verified values:

```text
psql -X -n -W -v ON_ERROR_STOP=1 "host=ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech port=5432 dbname=publisher_ledger user=VERIFIED_ADMIN_USERNAME sslmode=verify-full sslrootcert=ABSOLUTE_TRUSTED_CA_BUNDLE_PATH connect_timeout=10 options='-c search_path=pg_catalog'"
```

Enter the administrator password only at the terminal password prompt. Do not
paste a password-bearing connection URI, set `PGPASSWORD`, enable query echo or
terminal recording, use a SQL web editor for passwords, or share screenshots of
password-manager/secret-entry screens. `-X` disables psql startup files; `-n`
disables command history. If certificate verification or target verification
fails, stop; do not weaken TLS. `\conninfo` must show the fixed host, database and
TLS connection. Check these non-secret session facts:

```sql
SELECT current_database(), current_user, session_user,
       current_setting('search_path'), current_setting('server_version_num');
```

Expected database `publisher_ledger`, the verified administrator for both user
fields, search path `pg_catalog`, and PostgreSQL 16. SQL alone does not establish
the Neon branch ID: the independent Console endpoint binding remains mandatory.

### 2. Create three fresh disabled ordinary roles atomically

Run this block only after the target check and provisioning approval. Any
existing proposed name aborts the transaction; never add IF NOT EXISTS or alter
an existing identity to force completion. PostgreSQL role creation is scoped to
the connected cluster/branch rather than one database, which is why the branch
binding matters.

```sql
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'publisher_ledger' OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN
      ('meridian_test_reservation','meridian_test_sender','meridian_test_reader')
  ) THEN
    RAISE EXCEPTION 'Wrong database or proposed role already exists; stop';
  END IF;
END;
$guard$;
CREATE ROLE meridian_test_reservation NOLOGIN NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE meridian_test_sender NOLOGIN NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
CREATE ROLE meridian_test_reader NOLOGIN NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
COMMIT;
```

On an error, stop and `ROLLBACK;` if the transaction remains open. Do not resume
at a later line or delete/recreate roles automatically. Confirm all three roles
remain disabled and have no other-role memberships; retain only this non-secret
evidence and role OIDs:

```sql
SELECT r.oid, r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb,
       r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit,
       EXISTS (SELECT 1 FROM pg_catalog.pg_roles parent
               WHERE parent.oid <> r.oid
                 AND pg_catalog.pg_has_role(r.oid, parent.oid, 'MEMBER')) AS other_membership
FROM pg_catalog.pg_roles r
WHERE r.rolname IN ('meridian_test_reservation','meridian_test_sender','meridian_test_reader')
ORDER BY r.rolname;
```

Exactly three rows are required, with every boolean false. Independently inspect
ownership and existing effective grants before the grant proposal below. If
there is any unexpected membership or privilege, leave the new roles NOLOGIN
and stop for review; do not revoke provider roles or modify other principals.

### 3. Set SCRAM passwords interactively and hand them to GitHub

Christoph generates and retains three distinct high-entropy passwords in his
password manager (at least 32 random characters), then uses the same verified
psql session. Set and verify the password encoding before prompting:

```sql
SET password_encryption = 'scram-sha-256';
SHOW password_encryption;
```

The result must be `scram-sha-256`. Enter these psql meta-commands individually:

```text
\password meridian_test_reservation
\password meridian_test_sender
\password meridian_test_reader
```

Enter each password only at its hidden confirmation prompts. PostgreSQL's psql
documentation states that `\password` encrypts the password before sending the
ALTER ROLE command, avoiding cleartext password text in SQL history/server logs.
No plaintext PASSWORD SQL statement, environment variable, pipe, script, command
argument or chat handoff is part of this procedure. Treat password-manager and
clipboard access as local owner responsibilities; this procedure does not
automatically transfer or verify GitHub secrets.

Keep all three roles NOLOGIN. After applying and inspecting the separately
approved grant block below, Christoph installs the six exact secrets through
GitHub's repository Settings → Environments → `meridian-publisher-test` UI.
Required reviewers and main-only deployment protection must already be verified.
The password values come directly from his password manager; only secret names
and completion status are recorded. Do not use repository-wide fallback secrets.

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

### 4. Enable only these newly created identities after handoff

First complete the grant proposal and effective-privilege review below. In the
same owner-controlled setup session, recheck the recorded role OIDs and all role
attributes/memberships, confirm the three passwords were set successfully and
the six protected-environment secret entries were installed. If the session was
lost, state changed, a name/OID differs, or any step is uncertain, stop for owner
reconciliation; do not run an ALTER against an unverified pre-existing identity.

Only then, within the separately approved provisioning scope, enable login:

```sql
BEGIN;
ALTER ROLE meridian_test_reservation LOGIN;
ALTER ROLE meridian_test_sender LOGIN;
ALTER ROLE meridian_test_reader LOGIN;
COMMIT;
```

Re-run the non-secret role query: only `rolcanlogin` becomes true, every other
boolean remains false, and OIDs remain unchanged. This LOGIN step creates usable
credentials and is part of provisioning authorization, not source-merge approval.
Do not dispatch a workflow here. A separately approved readiness run will test
the installed credentials; absence of that run means their handoff is not yet
operationally verified. On a handoff/setup failure leave roles NOLOGIN and stop;
do not reset passwords, broaden grants or replace existing GitHub secrets by
guessing. Close the administrator session with `\q` when finished.

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
- [PostgreSQL 16 psql password command](https://www.postgresql.org/docs/16/app-psql.html)
- [PostgreSQL 16 password encryption](https://www.postgresql.org/docs/16/runtime-config-connection.html#GUC-PASSWORD-ENCRYPTION)
- [Neon SQL-created roles versus Console/API roles](https://neon.com/docs/manage/roles#manage-roles-with-sql)
- [Readiness scope and exclusions](PUBLISHER_DATABASE_READINESS.md)
- [Execution proposal](PUBLISHER_DATABASE_EXECUTION_PROPOSAL.md)
