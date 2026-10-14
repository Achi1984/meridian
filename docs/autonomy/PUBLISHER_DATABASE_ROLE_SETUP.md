# Publisher TEST role setup proposal

> **Execution hold (2026-10-14):** Do not execute the password step below.
> Neon's current role documentation requires plaintext password input and says
> pre-hashed passwords are unsupported; the proposed client-hashing `psql
> \password` path has not been validated against Neon. The browser replacement
> is specified in [PUBLISHER_DATABASE_BROWSER_SETUP.md](PUBLISHER_DATABASE_BROWSER_SETUP.md)
> and requires its own implementation review and operational approval. Prior
> source review and CI were not proof of real password initialization.

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
Use the approved `publisher_owner` administrator identity and a locally verified
CA bundle. This procedure requires that identity to own the database, publisher
schema and both tables directly; if catalog evidence differs, stop for a revised
grantor plan, with no SET ROLE or alternate-administrator fallback.
Confirm `psql --version` is PostgreSQL 16. Start interactive
psql with the following template, replacing only the absolute CA bundle path
with the locally verified value:

```text
psql -X -n -W -v ON_ERROR_STOP=1 "host=ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech port=5432 dbname=publisher_ledger user=publisher_owner sslmode=verify-full sslrootcert=ABSOLUTE_TRUSTED_CA_BUNDLE_PATH connect_timeout=10 options='-c search_path=pg_catalog'"
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

Before creation and again before GRANT, run this fail-closed prerequisite block.
An error, missing row or unexpected owner means STOP, not permission to continue:

```sql
SHOW createrole_self_grant;
DO $precheck$
DECLARE owner_oid oid;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles
    WHERE rolname='publisher_owner' AND rolcreaterole AND NOT rolsuper;
  IF current_user <> 'publisher_owner' OR session_user <> 'publisher_owner'
     OR owner_oid IS NULL OR current_database() <> 'publisher_ledger'
     OR current_setting('server_version_num')::integer / 10000 <> 16
     OR current_setting('search_path') <> 'pg_catalog'
     OR current_setting('createrole_self_grant') <> ''
     OR (SELECT count(*) FROM pg_catalog.pg_database
         WHERE datname='publisher_ledger' AND datdba=owner_oid) <> 1
     OR (SELECT count(*) FROM pg_catalog.pg_namespace
         WHERE nspname='meridian_publisher' AND nspowner=owner_oid) <> 1
     OR (SELECT count(*) FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='meridian_publisher'
           AND c.relname IN ('reservations','send_records')
           AND c.relkind='r' AND c.relowner=owner_oid) <> 2 THEN
    RAISE EXCEPTION 'Grantor, ownership, version or self-grant prerequisite failed';
  END IF;
END;
$precheck$;
```

PostgreSQL 16 defaults `createrole_self_grant` to the empty string. This disables
automatic SET/INHERIT privileges, but does **not** suppress the creator's implicit
ADMIN OPTION on its newly created roles. Do not change this setting to force a
pass; investigate unexpected configuration first.

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

Also inspect both directions of every membership touching the new roles:

```sql
SELECT parent.rolname AS granted_role, member.rolname AS member_role,
       grantor.rolname AS grantor, m.admin_option, m.inherit_option, m.set_option
FROM pg_catalog.pg_auth_members m
JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid
JOIN pg_catalog.pg_roles member ON member.oid=m.member
JOIN pg_catalog.pg_roles grantor ON grantor.oid=m.grantor
WHERE parent.rolname IN ('meridian_test_reservation','meridian_test_sender','meridian_test_reader')
   OR member.rolname IN ('meridian_test_reservation','meridian_test_sender','meridian_test_reader')
ORDER BY granted_role, member_role, grantor;
```

Expected: exactly three rows, one for each new `granted_role`, with
`member_role=publisher_owner`, ADMIN true, INHERIT false, SET false. Record the
actual grantor as non-secret evidence; PostgreSQL's implicit creator grant may
be recorded as granted by its bootstrap superuser rather than the creator.
There must be **zero** rows in which a new role is `member_role`. Missing or extra
rows, a different member, or different option flags mean STOP. This incoming
administrator authority lets `publisher_owner` maintain passwords; it does not
give the new roles membership in `publisher_owner`. Retaining precisely that
creator ADMIN authority is part of the proposed owner-approved provisioning
scope. It is not automatically revoked, expanded or granted to other operators.
The creator can use its ADMIN authority to grant itself SET/INHERIT later;
their current false values prevent accidental use, not administrator compromise.
This procedure does not claim isolation from the administrator.

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
outbound memberships; only the verified incoming creator ADMIN grants described
above are retained. Canonical tables and enabled guards exist under an independent
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

**Any GRANT warning is STOP**, including a warning about a privilege not granted.
`ON_ERROR_STOP` does not turn server warnings into errors and does not establish
that every requested grant was applied. Record the non-secret warning, keep roles
NOLOGIN and reconcile; do not continue merely because COMMIT succeeded.

### Mandatory post-GRANT matrix verification

Run the following as the same verified `publisher_owner`, before LOGIN. Expected
output is **zero mismatch rows**; any SQL error also means STOP. It checks effective
permissions, not only explicit ACL text. The cardinality and column-name checks
make absent roles, missing objects and unexpected columns failures rather than
an empty-result success. It does not replace the separate ownership and
membership queries above.

```sql
WITH
wanted_roles(role_name,lane) AS (VALUES
 ('meridian_test_reservation','reservation'),('meridian_test_sender','sender'),
 ('meridian_test_reader','reader')),
roles AS (SELECT w.*,r.oid FROM wanted_roles w
 LEFT JOIN pg_catalog.pg_roles r ON r.rolname=w.role_name),
wanted_tables(table_name) AS (VALUES ('reservations'),('send_records')),
tables AS (SELECT w.table_name,c.oid,c.relkind FROM wanted_tables w
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='meridian_publisher'
 LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=w.table_name),
wanted_columns(table_name,column_name) AS (VALUES
 ('reservations','operation_key'),('reservations','intent_sha256'),
 ('reservations','body_sha256'),('reservations','run_id'),
 ('reservations','run_attempt'),('reservations','status'),
 ('reservations','comment_id'),('reservations','created_at'),
 ('send_records','operation_key'),('send_records','comment_id'),('send_records','created_at')),
columns AS (SELECT t.table_name,t.oid,a.attnum,a.attname AS column_name
 FROM tables t JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid
 WHERE a.attnum>0 AND NOT a.attisdropped),
column_matrix AS (
 SELECT r.role_name,r.lane,r.oid AS role_oid,w.table_name,w.column_name,c.oid AS table_oid,c.attnum,p.privilege,
  CASE WHEN p.privilege='SELECT' THEN w.table_name='reservations' OR r.lane<>'reservation'
       WHEN p.privilege='INSERT' THEN
         (r.lane='sender' AND w.table_name='send_records') OR
         (r.lane='reservation' AND w.table_name='reservations'
          AND w.column_name IN ('operation_key','intent_sha256','body_sha256','run_id','run_attempt','status'))
       WHEN p.privilege='UPDATE' THEN w.table_name='reservations' AND
         ((r.lane='reservation' AND w.column_name IN ('status','comment_id')) OR
          (r.lane='sender' AND w.column_name='created_at'))
       ELSE false END AS expected
 FROM roles r CROSS JOIN wanted_columns w
 LEFT JOIN columns c ON c.table_name=w.table_name AND c.column_name=w.column_name
 CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)),
checks(role_name,target,privilege,expected,actual,grant_option) AS (
 SELECT r.role_name,'database publisher_ledger',p.privilege,p.privilege='CONNECT',
  CASE WHEN r.oid IS NOT NULL THEN pg_catalog.has_database_privilege(r.oid,'publisher_ledger',p.privilege) END,
  CASE WHEN r.oid IS NOT NULL THEN pg_catalog.has_database_privilege(r.oid,'publisher_ledger',p.privilege||' WITH GRANT OPTION') END
 FROM roles r CROSS JOIN (VALUES ('CONNECT'),('CREATE')) p(privilege)
 UNION ALL
 SELECT r.role_name,'schema meridian_publisher',p.privilege,p.privilege='USAGE',
  CASE WHEN r.oid IS NOT NULL THEN pg_catalog.has_schema_privilege(r.oid,'meridian_publisher',p.privilege) END,
  CASE WHEN r.oid IS NOT NULL THEN pg_catalog.has_schema_privilege(r.oid,'meridian_publisher',p.privilege||' WITH GRANT OPTION') END
 FROM roles r CROSS JOIN (VALUES ('USAGE'),('CREATE')) p(privilege)
 UNION ALL
 SELECT r.role_name,'table '||t.table_name,p.privilege,
  CASE WHEN p.privilege='SELECT' THEN t.table_name='reservations' OR r.lane<>'reservation'
       WHEN p.privilege='INSERT' THEN r.lane='sender' AND t.table_name='send_records' ELSE false END,
  CASE WHEN r.oid IS NOT NULL AND t.oid IS NOT NULL THEN pg_catalog.has_table_privilege(r.oid,t.oid,p.privilege) END,
  CASE WHEN r.oid IS NOT NULL AND t.oid IS NOT NULL THEN pg_catalog.has_table_privilege(r.oid,t.oid,p.privilege||' WITH GRANT OPTION') END
 FROM roles r CROSS JOIN tables t
 CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
 UNION ALL
 SELECT role_name,'column '||table_name||'.'||column_name,privilege,expected,
  CASE WHEN role_oid IS NOT NULL AND table_oid IS NOT NULL AND attnum IS NOT NULL THEN pg_catalog.has_column_privilege(role_oid,table_oid,attnum,privilege) END,
  CASE WHEN role_oid IS NOT NULL AND table_oid IS NOT NULL AND attnum IS NOT NULL THEN pg_catalog.has_column_privilege(role_oid,table_oid,attnum,privilege||' WITH GRANT OPTION') END
 FROM column_matrix),
mismatches AS (
 SELECT role_name,target,privilege FROM checks
 WHERE actual IS DISTINCT FROM expected OR grant_option IS DISTINCT FROM false
 UNION ALL SELECT '*','cardinality','roles/tables/columns/checks'
 WHERE (SELECT count(oid) FROM roles)<>3
    OR (SELECT count(*) FROM tables WHERE oid IS NOT NULL AND relkind='r')<>2
    OR (SELECT count(*) FROM columns)<>11 OR (SELECT count(*) FROM checks)<>186
 UNION ALL SELECT '*','column inventory','unexpected/missing'
 WHERE EXISTS (SELECT table_name,column_name FROM columns
               EXCEPT SELECT table_name,column_name FROM wanted_columns)
    OR EXISTS (SELECT table_name,column_name FROM wanted_columns
               EXCEPT SELECT table_name,column_name FROM columns))
SELECT * FROM mismatches ORDER BY role_name,target,privilege;
```

Observe TEMPORARY separately, without treating its common PUBLIC default as an
automatic denial or permission to revoke PUBLIC. This query must produce exactly
three non-NULL observations; include them in the owner review:

```sql
SELECT r.rolname,
 pg_catalog.has_database_privilege(r.oid,'publisher_ledger','TEMPORARY') AS temporary,
 pg_catalog.has_database_privilege(r.oid,'publisher_ledger','TEMPORARY WITH GRANT OPTION') AS temporary_grant
FROM pg_catalog.pg_roles r
WHERE r.rolname IN ('meridian_test_reservation','meridian_test_sender','meridian_test_reader')
ORDER BY r.rolname;
```

TEMPORARY values are explicitly outside the zero-mismatch matrix. They require
owner review before activation, not automatic broad revocation or a universal
least-privilege claim.

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
- [PostgreSQL 16 creator self-grant defaults](https://www.postgresql.org/docs/16/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT)
- [PostgreSQL 16 membership catalog](https://www.postgresql.org/docs/16/catalog-pg-auth-members.html)
- [PostgreSQL 16 psql password command](https://www.postgresql.org/docs/16/app-psql.html)
- [PostgreSQL 16 password encryption](https://www.postgresql.org/docs/16/runtime-config-connection.html#GUC-PASSWORD-ENCRYPTION)
- [Neon SQL-created roles versus Console/API roles](https://neon.com/docs/manage/roles#manage-roles-with-sql)
- [Readiness scope and exclusions](PUBLISHER_DATABASE_READINESS.md)
- [Execution proposal](PUBLISHER_DATABASE_EXECUTION_PROPOSAL.md)
