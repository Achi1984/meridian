# TEST publisher commissioning: one bounded authentication/readiness cycle

Source proposal only. No activation, installation, dispatch or credential access
is authorized by this packet. Preparation baseline:
`f54f38317cfe95fd97671e4192aff307722fab08`. Owner setup approval6231898914 is
consumed; completion6232054311 records prepared credentials and postchecks, not
LOGIN or workflow authority. The next useful result is real protected-secret
delivery plus three role-authenticated catalog checks, not publication or trading.

## Exact source and target

Repository `Achi1984/meridian` ID1342084551, owner319562141; protected environment
`meridian-publisher-test`. Neon project `wandering-queen-12324132`, branch
`br-delicate-field-b9uijh3y`, host
`ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech:5432`, database
`publisher_ledger`. Existing roles: `meridian_test_reservation`,
`meridian_test_sender`, `meridian_test_reader`. Do not create replacements or
reset passwords/secrets. Approved baseline SHA256:
`cb60f0aab88dd3f23560ad14e2d4849a8ed7abc8dab0e437ba263fa217356e6c`.

The existing inactive fixture is
`event-adapter/review-binding/fixtures/meridian-database-readiness.yml` relative
to this directory. Proposed installed path:
`.github/workflows/meridian-database-readiness.yml`. Its bytes at the preparation
baseline have SHA256
`1d934231bb3439c3808f9501c7ee78854f657fe6734ec9ded8f0e14ef09d6968`.
Installation is not performed by this packet.

Keep its reviewed application checkout
`817e18d06c453bbd6a01fa44abe1de778dc94cc9`: the three runtime modules, two SQL
fixtures and npm lock below are byte-identical to the preparation baseline.
This is an immutable application pin, not the future workflow installation SHA.

| Path below `event-adapter/review-binding/` | SHA256 |
| --- | --- |
| scripts/publication-database-readiness-cli.mjs | 2030d48d4cd1b23a556a8ccd3a55c25924f4570677c9a3bdaf839a81dc0cf954 |
| scripts/publication-database-readiness.mjs | 0751a7604db630357adcdef747cdcfcd8b6c4aecd9847b38251b097908dd91aa |
| scripts/publication-actions-pools.mjs | ab8881d55e749f44c7772130a6e8aa05c2128816288d2fabc90766cb2db1e55b |
| fixtures/publication-ledger.sql | c7cab138a398936dd59845db9838947b4a308a3d387b2c4102060ac3ae646736 |
| fixtures/publication-send-record.sql | 84018bd5f335652592ad3bccc4574407e14b90d7751da55480e000da6cf37bce |

Root `package-lock.json` SHA256
`3dfb5a358caf0386c6dc68cc7cf7c0ecd7c91860beec090c22dffbeb059998a2`,
Git blob `55a78f3b27fd823008b77dde8d77219bd0fbef2d`, pg8.23.0.
Retain fixture Node22.23.3, checkout action
`11d5960a326750d5838078e36cf38b85af677262`, setup-node action
`49933ea5288caeca8642d1e84afbd3f7d6820020`, and secret-free
`npm ci --ignore-scripts --no-audit --no-fund`. Do not install dependencies during
credential-bearing steps. Exact-runtime tests and full independent review must
cover the proposed installed bytes, not merely the legacy application source.

## Gate A: private, read-only state inspection before activation

The password setup helper's baseline verifier does NOT verify complete effective
application grants or trigger definitions. Its success cannot close this gate.
Use the existing owner-controlled session, pinned CLI/CA/runtime, approved OID
baseline, and a reviewed private administrator acquisition path. Never substitute
an administrator for the three application roles in the later readiness CLI.

The precise existing effective-grant SELECT is the SQL block under
`Mandatory post-GRANT matrix verification` in `PUBLISHER_DATABASE_ROLE_SETUP.md`
at the preparation baseline, whose full-file SHA256 is
`47095db6ce7d991bd46cbdd7143cc38e7fd82dfa2be5369872d348a687353957`.
Run that SELECT only, NOT its preceding GRANT block: require186 checks, three
roles, two ordinary tables, eleven exact columns and zero mismatch rows. Execute
the following TEMPORARY-observation SELECT from the same pinned document and
retain exactly three boolean/grant-option observations for owner review; it is
explicitly outside the zero-mismatch contract, not permission for PUBLIC revokes.
Verify role OIDs, current NOLOGIN and memberships against the approved baseline.
Inspect actual constraints, enabled triggers, function ownership/security/search
path and definitions against the two pinned SQL fixtures; schema-file presence
is not deployed-schema evidence. No automatic migration, GRANT, REVOKE or repair.

**Read-only source implementation:** the inspector now combines the fixed
baseline/grant observations, private administrator acquisition and bounded
supervision with a pinned fixture catalog comparator. PR848 source head
`c4e860ebd5aae2282e48e7899ed4cdbaaf9c5b47` has actual private PG16 fixture evidence
(receipt848/6233415079), including seven independently rejected comparator
mutations. This is not a deployed Gate A result. Complete its source review/merge
and postchecks before operational use.

The separate source-only packet
`PUBLISHER_GATEA_READONLY_SCOPE_20261017.md` and companion
`PUBLISHER_GATEA_READONLY_LAUNCH_20261017.sh` define one reviewable read-only
invocation with immutable source/resource pins. They grant no execution authority.
The deployed PostgreSQL version remains unknown; only actual160015 matches the
current reference and all other versions stop. Fresh exact-scope owner approval
is required before private credential access. No setup/recovery approval carries
forward and no automatic retry, migration or repair is included.

This inspector intentionally has no activation mode. Gates B–D still need their
own separately reviewed activation/closure implementation and exact authority;
none of this packet implements or permits LOGIN or workflow effects.

## Gates B–D: distinguishable, sequential effects in one owner decision

Prepare the complete helper, tests, exact launch, workflow installation diff and
closure procedure before requesting one concrete owner decision covering each
effect below. The owner must explicitly accept usable write-capable credentials
during this window, provider logging, and uncertain-state handling. Source merge
alone authorizes none of these effects.

**B — workflow installation and three-role LOGIN.** Verify there is no previous
run history for the exact intended workflow path: the fixture requires run_number1
and attempt1. Do not rename/recreate a consumed workflow to evade that guard.
Install only the pinned inactive fixture after approval, record actual installed
workflow SHA, and recheck the protected environment/main-only owner-review policy.
In a separately supervised fixed-target transaction, recheck the exact role OIDs
and all Gate A conditions, then execute only:

```sql
BEGIN;
ALTER ROLE meridian_test_reservation LOGIN;
ALTER ROLE meridian_test_sender LOGIN;
ALTER ROLE meridian_test_reader LOGIN;
COMMIT;
```

The exact launcher must bound these statements and confirm that only rolcanlogin
changed; bare SQL above is NOT an execution procedure. Never run CREATE ROLE,
password changes, grants or unrelated schema mutations. An ambiguous commit or
cleanup stops dispatch; do not repeat ALTER blindly.

**C — one protected dispatch.** Dispatch the reviewed installed workflow once on
main, owner actor/triggering actor, first run/attempt. At the native owner approval
pause verify the exact run/job/workflow/source before releasing six environment
secrets to its sole check step. The existing exact process invocation is:

```sh
node docs/autonomy/event-adapter/review-binding/scripts/publication-database-readiness-cli.mjs --check-test-db
```

Use only the workflow's fixed seven named environment bindings. No secret can be
read back from GitHub or copied into a terminal to simulate the runtime handoff.
The fixed check opens three role pools and issues at most three catalog SELECTs;
no OIDC, publisher credential, comment, application row or trading action occurs.
Accept only `SCOPED_READ_ONLY_CHECKS_PASSED` and actual outer exit0 with bounded
cleanup, never a buffered success line followed by nonzero exit. Preserve actual
run/job/timestamps and sanitized result. Any outcome consumes the allowance.

**D — explicit closure included in the eventual approval.** For this initial
commissioning cycle, return exactly these three roles to NOLOGIN after the single
attempt, with unchanged OIDs/other attributes. The closure helper/transaction and
its ambiguity handling require the same source review and approval as activation.
NOLOGIN blocks new logins but does not terminate existing sessions: independently
observe connection cleanup; unexplained sessions require reconciliation, not an
unapproved pg_terminate_backend or blanket revoke. Preserve secrets and both local
attempt/recovery markers. Leaving roles enabled for sustained operation is a
different scope and needs an explicit decision.

## Acceptance and evidence limits

One successful cycle proves the actual protected secret delivery, role password
authentication and sampled session/catalog contract at that time. It does not
prove universal isolation, trigger semantics under mutation, durable publication,
future credential/grant state, autonomous development or trading profitability.
The next publisher publication cycle needs its separate exact-body, OIDC/publisher
identity, lazy credential, reservation/durability and one-attempt approval binding.

Existing setup tests are relevant to reused credential/supervisor components,
not tests of the missing new helper. Existing readiness/pool/CLI tests remain
relevant to the unchanged immutable runtime modules. This docs-only packet was
validated for pin consistency; no database, credential, workflow or LOGIN action
was performed. No execution approval is requested until the missing helper and
literal launch/closure are independently reviewed with actual toolchain evidence.
