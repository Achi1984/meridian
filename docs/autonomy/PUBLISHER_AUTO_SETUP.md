# Publisher test secret preparation candidate

This is a source-review candidate, **not an execution approval or production-ready
bootstrap**. It removes password selection/copying, not authentication or owner
review. No credentials were created while developing it. The existing manual
helper remains unchanged. The implementation is Linux-only and owner-operated.

## Exact scope

Only `Achi1984/meridian` (repository ID `1342084551`, personal owner ID
`319562141`), environment `meridian-publisher-test`, and Neon project
`wandering-queen-12324132`, branch `br-delicate-field-b9uijh3y` are in scope.
Database `publisher_ledger`, administrator `publisher_owner`, and endpoint
`ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech` are fixed. The parent branch,
production credentials, workflow dispatch, role LOGIN, deployments, trading and
privilege expansion are outside this helper.

The owner must first have independently approved, existing Neon and GitHub CLI
sessions. The helper never runs login/logout/revoke commands. `neon me` is checked
before credential retrieval. CLI stdin is closed except for the bounded secret
value supplied to `gh secret set`; `BROWSER=/bin/false`, `CI=true`, and
`GH_PROMPT_DISABLED=1` prohibit the normal interactive paths. Expired sessions
fail closed. A login required by the provider must be completed separately by the
owner, never by supplying account credentials to this program or a chat.

## Prerequisites and bounded trust

Use an owner-reviewed checkout containing this file and the unchanged
`scripts/publisher_test_password_setup.py`. Review/pin that checkout before use;
this helper trusts that sibling source. Follow the existing
`PUBLISHER_PASSWORD_DEPENDENCY_PROVENANCE.md` process for psycopg **3.3.6** and the
CA provenance process already required by the manual helper. No packages are
installed here. Supply absolute CA and baseline paths and a separately verified
SHA-256 of the CA. Baseline is the previously reviewed owner/role/grantor OID
record; it is not discovered or guessed by this program.

Supply absolute Neon and GitHub CLI executable paths with SHA-256 hashes verified
against owner-approved distributions. Files and every ancestor directory must
not be group/world writable. This checks a selected binary, not its entire
transitive runtime: scripts, interpreters, shared libraries and owner CLI session
files remain trusted local dependencies. Prefer reviewed self-contained binaries;
do not use a workspace wrapper or derive a hash from an untrusted download and
call it provenance. An owner-controlled workstation/Codespace and exclusive
single-writer window remain necessary. This is not a defense against another
process controlled by the same OS user.

Run Python with `-I`. The CLI rejects debugger/profiler and inherited PostgreSQL,
Python, instrumentation, SSL override and dynamic loader variables. Child CLI
processes receive only the selected OS account's HOME, a fixed system PATH and
fixed noninteractive settings. Ambient `GH_TOKEN`, `GITHUB_TOKEN`, proxies,
CLI configuration overrides and debugging variables are never forwarded. Stored
CLI sessions under that HOME are used only with the explicit
`--owner-approved-cli-sessions` acknowledgement.

Before any secret write the helper requires:

- Exact repository/user identity, personal owner and affirmative administrator
  permission; missing permission fields fail.
- Required owner reviewer `319562141`, no administrator bypass, custom deployment
  branch policy containing only the exact `main` branch (no tags/wildcards).
  Self-review must be allowed because the existing owner-operated protocol uses
  that same owner as actor and reviewer. This does not bypass the environment.
- Exact environment variable `MERIDIAN_PUBLISHER_TEST_DATABASE=publisher_ledger`.
- Complete bounded repository/environment secret listings with **none** of the
  six target names already present. Existing names are conflicts, never overwritten.
- Independently supervised read-only TLS connection and the manual helper's
  exact baseline checks: identity, PostgreSQL 16, owner relations, three NOLOGIN
  roles and approved memberships. No admin connection is made by `--check`.

The CA is checked against its supplied hash before preflight and DB connections;
`verify-full` is always used by the driver. Neon output accepts only the exact
URI authority/database plus `sslmode=verify-full` and optional
`channel_binding=require`; extra, duplicate, malformed or weaker URI options
fail. No generic DATABASE_URL, host, user or certificate fallback is supported.

## Owner invocation template — only after independent source approval

Replace the paths and hashes with values from the approved installation. The
placeholders below are not credentials and are not executable as written.

```sh
python3 -I /absolute/reviewed/scripts/publisher_test_auto_setup.py \
  --check --owner-approved-cli-sessions \
  --baseline /absolute/reviewed/baseline.json \
  --ca /absolute/verified/ca.pem --ca-sha256 VERIFIED_CA_SHA256 \
  --gh /absolute/trusted/gh --gh-sha256 VERIFIED_GH_SHA256 \
  --neon /absolute/trusted/neon --neon-sha256 VERIFIED_NEON_SHA256
```

`--check` performs local validation and read-only provider identity/protection
checks. It does not fetch the administrator connection string, generate or
install credentials, create the attempt marker, or connect to the database.
Success is `AUTO_SETUP_CHECKS_PASSED`, not proof of DB connectivity/readiness.

For the separately approved preparation invocation, replace `--check` with
`--prepare-test-secrets --acknowledge-provider-logging --exclusive-owner-window`.
An interactive owner terminal is required. Provider-side logging may retain
sensitive SQL/API activity; this acknowledgement is explicit, not an assertion
that provider logging is disabled. Do not use terminal tracing/debugging tools.

## Effect ordering and fixed outputs

The helper creates an exclusive persistent local attempt marker at
`~/.meridian-owner-setup/publisher-test-attempt` before fetching the administrator
URI. It never deletes this marker. It then fetches the fixed-target URI privately,
performs the independent read-only DB precheck, generates three distinct CSPRNG
64-character hex passwords, and repeats the read-only provider gates. It writes
these exact six environment secrets, in the following order, via stdin only:

| Name | Value |
| --- | --- |
| `MERIDIAN_PUBLISHER_TEST_RESERVATION_USER` | `meridian_test_reservation` |
| `MERIDIAN_PUBLISHER_TEST_RESERVATION_PASSWORD` | Generated reservation password |
| `MERIDIAN_PUBLISHER_TEST_SENDER_USER` | `meridian_test_sender` |
| `MERIDIAN_PUBLISHER_TEST_SENDER_PASSWORD` | Generated sender password |
| `MERIDIAN_PUBLISHER_TEST_READER_USER` | `meridian_test_reader` |
| `MERIDIAN_PUBLISHER_TEST_READER_PASSWORD` | Generated reader password |

Only after all six command acknowledgements does the original supervised
`perform()` change the three passwords transactionally, preserving NOLOGIN and
rechecking the baseline before and after the changes. The original driver-origin,
notice handling, SQL quoting, commit uncertainty and phase deadlines apply.
Passwords exist in private process memory/pipes, not command arguments,
environment variables, output, temporary files or repository files. Raw provider
stdout/stderr, URI, exceptions and SQL are never printed. CLI commands each have
a 15-second deadline, a 1 MiB capture bound and process-group cleanup; DB phases
use the original independent supervisor. Owner-input phases in that supervisor
are supplied immediately from memory, not interactive prompts.

| Output | Meaning |
| --- | --- |
| `AUTO_SETUP_CHECKS_PASSED` | Read-only prerequisite checks passed |
| `AUTO_SETUP_PREPARED_NOLOGIN` | Six secret commands acknowledged and DB commit/cleanup confirmed; roles still NOLOGIN |
| `AUTO_SETUP_FAILED_NO_REMOTE_WRITES` | No target secret/DB mutation attempted; local marker may exist |
| `AUTO_SETUP_RECONCILIATION_REQUIRED` | A secret write or DB mutation failed or may have an unknown outcome |

GitHub secret writes have no create-only/CAS operation. The read-before-write
check cannot prevent another administrator racing it; **the owner must exclude
all other writers during this window**. If that cannot be guaranteed, do not run
this candidate. This limitation is explicit, not hidden behind the local marker.

There is no automatic retry, overwrite, deletion, password rotation, rollback
of remote secrets, or cleanup of the owner's existing CLI sessions. If a secret
write fails, even the first one, DB password mutation does not start and partial
remote state is preserved. If DB mutation fails or commit acknowledgement is
unknown, all installed secrets remain for owner reconciliation and roles remain
NOLOGIN under the reviewed baseline. Never remove the marker and rerun blindly:
an owner must reconcile actual remote state first under a separately reviewed
recovery plan. GitHub cannot reveal installed secret values, and successful
write acknowledgement does not independently prove an eventual runtime read.

This is preparation evidence only. LOGIN activation, Neon runtime integration,
protected workflow execution and production/live authorization remain separate.
