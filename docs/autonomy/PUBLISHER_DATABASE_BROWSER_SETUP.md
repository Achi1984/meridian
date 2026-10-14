# Publisher TEST browser setup — candidate procedure

Status: **source draft, not an approved or executed provisioning procedure**.
This document replaces the PC prerequisite with an owner-operated browser
terminal. It does not authorize database changes, credential retrieval,
environment changes, workflow installation or dispatch. Source review and the
operational authorization below remain outstanding.

## Scope and correction

The existing `PUBLISHER_DATABASE_ROLE_SETUP.md` step 3 proposes psql `\password`.
That command hashes the password client-side. Neon's role documentation says
passwords must be supplied as plaintext and pre-hashed passwords are unsupported.
**Do not execute that step or merely move it into Codespaces.** The ordinary
NOLOGIN role creation, grant matrix and catalog verification remain separate
prerequisites; no broader privileges are proposed here.

Christoph has personally trusted the existing Codespace
`ideal-umbrella-g5qx5p796rxfvjx`, created from `github/codespaces-blank` using a
two-core Europe West machine. This is a hosted workspace, not his local PC.
Trusting/opening it is not evidence that dependencies, certificates, code or
database operations have been approved. This draft does not create another
Codespace or change billing limits. Verify available allowance before use; do
not purchase capacity or enable paid overages implicitly. Stop the Codespace
after the session; deleting it is a separate owner action.

## Fixed target

| Binding | Required value |
| --- | --- |
| Project | `wandering-queen-12324132` |
| Branch | `br-delicate-field-b9uijh3y` |
| Direct host | `ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech` |
| Port / database | `5432` / `publisher_ledger` |
| Administrator | `publisher_owner` |
| New roles | `meridian_test_reservation`, `meridian_test_sender`, `meridian_test_reader` |

Confirm the endpoint-to-branch mapping independently in Neon. SQL does not
establish that mapping. Never select an administrator connection string as a
runtime credential or create application roles through Neon's role-creation
Console/API, which grants `neon_superuser` membership.

## Owner handoff and execution order

1. Review and pin a small Python 3 / Psycopg 3 helper and its dependencies before
   any credential entry. A candidate implementation now exists at
   `scripts/publisher_test_password_setup.py`, with nine offline fault-injection
   tests in `test/test_publisher_test_password_setup.py`. It has not been run
   against PostgreSQL or Neon and is not operationally approved. Psycopg 3.3.6 is
   pinned in `scripts/publisher-test-password-setup-requirements.txt` and checked
   before prompts; dependency hash/provenance review, real SQL composition and independent
   review remain outstanding. Install dependencies before providing credentials;
   do not run package installation hooks while credentials are present.
2. Establish the ordinary roles and their non-secret OID baseline only under
   the separately approved role-creation procedure. Verify all role attributes,
   incoming/outgoing membership, ownership and grants using that procedure.
   Never reuse an existing same-named role or manufacture a baseline by trusting
   whatever the helper first discovers. Retain OIDs and administrator OID as
   non-secret review evidence, alongside the fixed project/branch binding.
3. Give Christoph sole control of the Codespaces terminal for secret entry.
   Pause browser automation, screenshots, terminal observation and agent access
   to process state. Disable terminal recording, debugging, Python tracing and
   command echo. The operator must independently trust this workspace and its
   extensions/processes; hidden input does not protect against a compromised
   Codespace. Never request passwords or password screenshots in chat.
4. Run the reviewed helper using a command containing only its path and
   non-secret baseline/CA paths. Enter the administrator password and three
   distinct new passwords at hidden prompts. Generate and retain the new values
   in the owner's password manager; require at least 32 random ASCII characters.
   The helper must confirm each new value with a second hidden prompt, reject
   equal role passwords and reject reuse of the administrator password.
5. On confirmed success leave every role NOLOGIN. Christoph copies the three
   new passwords directly from his password manager into the exact six
   `meridian-publisher-test` environment secrets listed in the role setup
   document. Configure and verify the owner review and main-only environment
   protection before installing secrets. Browser secret entry is supported by
   GitHub; the particular iPhone layout still needs owner confirmation.
6. Record only role names/OIDs, fixed target, approved code version and coarse
   completion status. The helper does not automatically transfer or validate
   GitHub secret values. Fresh full grant/membership/ownership checks, explicit
   LOGIN enablement, workflow installation and one diagnostic dispatch are
   later separately scoped actions. Do not silently combine them with password
   initialization.

## Required minimal helper contract

Use Python `getpass.getpass`, treating `getpass.GetPassWarning` as an error and
requiring a real interactive TTY. Abort before reading any password if echo-free
input is unavailable. No command-line, environment-variable, pipe, file, URL,
browser storage or clipboard-reading fallback is allowed. Do not write secrets
to source files, shell history, logs, transcripts, artifacts or exception text.

Connect with Psycopg using explicit keyword values for every target field,
`sslmode='verify-full'`, an independently verified absolute CA bundle path,
`connect_timeout=10`, and fixed startup options for `search_path=pg_catalog`,
bounded statement/lock timeouts. Do not use a connection URI, service file,
passfile, ambient `PG*` configuration, alternate endpoint or TLS fallback.
Psycopg/libpq must receive the password directly from the hidden prompt in
memory. Require PostgreSQL 16, matching `current_user` and `session_user`, exact
database, expected search path, and a TLS connection with verified hostname.

Before **any password mutation**, run the existing grantor/ownership precheck
and compare the administrator and all three role OIDs to the approved baseline.
Require exactly the three named roles, with all seven role booleans false:
LOGIN, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS and INHERIT.
Require zero outgoing role memberships and exactly the documented creator
incoming ADMIN grants (INHERIT/SET false), including the approved grantor
identity. Reject missing/extra roles or changed membership/ownership. Fail
closed on an unrecognized result, warning or SQL error.

Use one explicit database transaction for the three password changes, with
`password_encryption='scram-sha-256'` checked before mutation. For the fixed
allowlisted role names, compose each statement with Psycopg's SQL composition:

```python
# Composition used by the candidate; not a standalone runnable command.
# Never print, log, stringify or persist the composed statement.
statement = sql.SQL("ALTER ROLE {} PASSWORD {}").format(
    sql.Identifier(approved_role_name), sql.Literal(hidden_password)
)
cursor.execute(statement)
```

SQL utility statements such as ALTER ROLE are not a reason to interpolate raw
strings or use unsafe f-strings. Psycopg SQL Identifier/Literal composition is
required here; ordinary server-side bind placeholders must not be assumed to
work in this statement. Confirm the exact reviewed Psycopg version's behavior
in a disposable local PostgreSQL test before operational use.

Repeat identity, OID, attributes and membership checks inside the same
transaction before commit. The helper must issue **no** CREATE ROLE, GRANT,
REVOKE, LOGIN, role rename, ownership change or application-table writes.
Independent administrators remain trusted: these checks do not establish
isolation from concurrent privileged changes. Do not automatically revoke or
repair differences to obtain a pass.

Suppress database notices and exception details. Print only fixed statuses
such as `PASSWORD_SETUP_CONFIRMED`, `PASSWORD_SETUP_FAILED` or
`PASSWORD_SETUP_INDETERMINATE`. Never print query text, connection parameters
containing passwords, SQL exceptions, tracebacks, password length or hashes.
On a failure before commit, attempt rollback and close. A connection loss or
exception during commit is **indeterminate**, not proof of rollback: stop and
reconcile; do not retry automatically. Keep roles disabled. Bound connection,
queries and cleanup; do not impose a short timer on the owner's password entry.
Close the connection and exit; Python object deletion is not a guarantee of
memory zeroization.

## Plaintext boundary and unresolved provider logging

The actual password is plaintext **inside** the TLS-protected protocol payload
because Neon requires that input. The helper keeps it out of local commands,
files and output; it cannot guarantee exclusion from provider-managed database
logs, privileged tracing, crash dumps, hosted-machine inspection or compromised
extensions. Neon's cited documentation does not establish comprehensive
redaction of password-bearing SQL across provider logs. Do not claim otherwise.

The owner must accept this specific hosted trust and provider logging boundary
in the concrete operational approval, or choose a provider-confirmed alternative
before execution. A source merge or the general permission to perform merges
does not resolve this boundary. Console reset of a newly SQL-created passwordless
NOLOGIN role is not a verified fallback; do not promise it works or assume that
reset preserves attributes. Do not create an elevated Console role as a shortcut.

## Remaining gates

- Pin and independently review the candidate helper and dependency provenance.
- The nine current offline tests exercise a fake adapter: they are not evidence
  of real Psycopg escaping, PostgreSQL parsing, Neon behavior or enforced
  end-to-end network/cleanup deadlines. Resolve those limits before execution.
- Verify hidden-input failures, strict connection settings, wrong OID/identity,
  unexpected membership/flags, escaping, rollback and indeterminate commit
  behavior without real credentials. No real Neon mutation for implementation
  testing is authorized by this draft.
- Confirm the actual Codespace terminal/CA/dependencies and owner-only secret
  handoff; review the exact non-secret baseline and existing role/grant state.
- Obtain concrete authorization for named role creation/grants/password setup
  and environment changes, with the logging/trust boundary understood. Honor
  already granted scope; do not require duplicate authorization for it.
- Perform post-setup checks before separately authorized LOGIN and dispatch.

## Primary references

- Neon role creation/password requirements:
  https://neon.com/docs/manage/roles
- GitHub browser environment secret setup:
  https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- Psycopg SQL composition (must be checked against the pinned release during
  implementation): https://www.psycopg.org/psycopg3/docs/api/sql.html
- Python hidden input: https://docs.python.org/3/library/getpass.html

These references describe capabilities, not evidence that this setup has run.

## Candidate invocation and baseline format

The candidate requires explicit flags and rejects ambient `PG*`, `PSYCOPG*`,
`OTEL_*` and `PYTHON*` variables rather than silently inheriting client or tracing
configuration. Launching it still requires operational approval; the acknowledgement
flag documents the operator's choice and is not a replacement for that approval.
The following command contains no credential values:

```text
python scripts/publisher_test_password_setup.py --set-test-passwords --acknowledge-provider-logging --baseline /ABSOLUTE/approved-role-baseline.json --ca /ABSOLUTE/verified-ca-bundle.pem
```

The baseline contains only `owner_oid` and `roles`. `roles` contains exactly the
three fixed role names, each mapping to an object with integer `oid` and
`grantor_oid`. Supply independently approved observed catalog values; there are
no default or example OIDs that may be accepted as actual evidence. The reader
rejects duplicate JSON keys, unknown keys, malformed OIDs and duplicate role
identities. Existing roles are never automatically adopted.
