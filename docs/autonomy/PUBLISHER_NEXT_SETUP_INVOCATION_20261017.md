# One TEST preparation attempt after verified recovery

Status: source-only proposal, not approved or executed. This document introduces
no executable script, workflow, scheduler or change to the reviewed helpers.
Operation: PUBLISHER-NEXT-SETUP-20261017-01.

Issue829/comment6230893412 records completed recovery and independent archive
verification. Recovery approval6230643903 excludes this later setup. The lead
must authenticate a separate approval in the actual owner conversation for this
exact TEST preparation, including provider logging and the partial-state risk
below. A comment ID, this document, its merge, and command flags are not approval.
The companion scope JSON is an immutable proposal; its null approval field and
false authorization are intentional. Record any later actual approval separately.

## Fixed scope and effects

Use only GitHub `Achi1984/meridian` (ID1342084551, owner319562141), environment
`meridian-publisher-test`; Neon project `wandering-queen-12324132`, branch
`br-delicate-field-b9uijh3y`, host
`ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech`, database
`publisher_ledger`, existing administrator `publisher_owner`.

The reviewed helper first performs local/provider checks, then creates the
exclusive persistent marker at
`/home/codespace/.meridian-owner-setup/publisher-test-attempt`. It privately reads
the existing administrator URI through the approved Neon CLI, verifies the
database against the approved OID/grant baseline, generates three distinct
64-character random hex passwords, and repeats provider gates before writes.
It writes these exact environment secrets in order:

| Name | Value |
| --- | --- |
| MERIDIAN_PUBLISHER_TEST_RESERVATION_USER | meridian_test_reservation |
| MERIDIAN_PUBLISHER_TEST_RESERVATION_PASSWORD | New random reservation password |
| MERIDIAN_PUBLISHER_TEST_SENDER_USER | meridian_test_sender |
| MERIDIAN_PUBLISHER_TEST_SENDER_PASSWORD | New random sender password |
| MERIDIAN_PUBLISHER_TEST_READER_USER | meridian_test_reader |
| MERIDIAN_PUBLISHER_TEST_READER_PASSWORD | New random reader password |

Only after all six CLI acknowledgements does the supervised database helper set
the three existing roles' passwords in one transaction, verifying the baseline
before and after. Roles remain **NOLOGIN**. No role creation, LOGIN activation,
workflow dispatch, live trading, credential display or archive removal is in scope.

GitHub writes and the database transaction are not atomic together. A failed or
ambiguous operation can leave partial GitHub secrets or an uncertain database
outcome. GitHub cannot reveal installed secret values. Provider logging may
retain sensitive SQL/API activity; acknowledgement does not disable that logging.
No automatic retry, secret deletion, overwrite, rotation or marker cleanup is
authorized. Existing target names at either repository or environment scope cause
preflight rejection. GitHub has no create-only secret write: all other writers
must be excluded throughout the operation.

## Preconditions before the exact launch

Source preparation baseline is now main
`61b2f00461ecb6b560fc454decce0ca83f62b06c`: PR836 is merged and the lead reports
all required postchecks successful (FINAL_MERGE_STATUS6231062545). All four
helper/lock hashes below were independently compared with that commit and match.
This closes the predecessor source gate only; it grants no setup authority.
Review this entire scope and
literal shell launch independently at its exact source head, with required
exact-head CI and relevant CPython3.14.2 evidence, before requesting execution.
Confirm the separate owner approval and logging acknowledgement only after this
candidate is reviewable. Do not infer setup approval from recovery or a generic
earlier Go.

Use the existing owner-controlled Codespace and ordinary isolated CPython3.14.2
environment. Revalidate the platform/session trust basis, pinned installed driver,
CA/CLI provenance, canonical paths, owner-only commissioning/source directories,
source and baseline bytes, and actual exclusive writer window. Python/stdlib/OS
and same-UID processes remain external trusted dependencies; hash matching is not
runtime attestation or authentication. Do not change permissions to pass checks.

The existing `recovery-830-reviewed` directory already contains the four source
files below. They are unchanged between the previously pinned d8a12f8 source and
main `61b2f00461ecb6b560fc454decce0ca83f62b06c`. Inspect the existing directory;
do not blindly restage, overwrite or install anything. Preserve the verified
recovery archive. Confirm the active marker remains absent, including dangling
symlinks, immediately before launching. A mismatch means stop and investigate.

The helper's optional `--check` mode is local/provider-only: it neither obtains
the administrator URI nor connects to the DB. It cannot substitute for the
fresh DB precheck inside the preparation invocation. The invocation below must
not be run during document validation, review or ordinary CI.

## Exact proposed shell launch — one attempt only after approval

Run in the existing interactive terminal with terminal stdin/stderr. Do not use
shell tracing, a pipeline around Python, stdin redirection or a debugger. Hash
verification before file execution depends on the maintained external source
window; it does not defeat same-UID file swapping. The helper reloads its sibling
source, so the window must last through final status and outer exit observation.
The new attempt marker survives both success and failure.

Exact shell block SHA256 (including its final newline):
`d87fa27882cabc3d2fb8d60b176d651097cff404f3049cd5435dd60cb32d661b`.

```bash
(
  set +x
  ulimit -c 0 || exit 1
  umask 077
  cd /home/codespace/meridian-commissioning-20261014/recovery-830-reviewed || exit 1
  test ! -e /home/codespace/.meridian-owner-setup/publisher-test-attempt || exit 1
  test ! -L /home/codespace/.meridian-owner-setup/publisher-test-attempt || exit 1
  printf '%s\n' \
    'c859d4413eb2b50f7aae04e1d28eb23961989eb64beb29cb751eb65f06a8bfc0  publisher_test_auto_setup.py' \
    '3f3e4cab7fa64b5890fda1483bc73ac277636f001ec933bf514c926267ef68fb  publisher_test_password_setup.py' \
    '7cef1a29f54c1657bb1174a5ab9b923c0a55d43e44cbfb2181c284346a7860a9  publisher-test-password-setup-requirements.txt' \
    '00b8671deb2339aea88940f3b4235a5145898a619a5ac62a8e407de82b166fa5  publisher-test-password-setup-cp314-linux-x86_64.lock' \
    'cb60f0aab88dd3f23560ad14e2d4849a8ed7abc8dab0e437ba263fa217356e6c  /home/codespace/meridian-commissioning-20261014/approved-role-baseline.json' \
    '9481fcd95f41b221f02f14d896535fe500bec539bc563c4cdca1acee483a8bdd  /home/codespace/meridian-commissioning-20261014/verified-ca-bundle.pem' \
    '553949e2efa12842771efe6012aa4de21f1d591530ec17fc435f610f10e017ee  /usr/bin/gh' \
    'e90831b13bfcf75df8d7322617965022508d28b0b8116530992c2a5db776371a  /home/codespace/meridian-commissioning-20261014/neon-8.4.5' \
    | sha256sum --check --status || exit 1
  env -u PYTHONIOENCODING -u PYTHON_PATH -u PYTHON_ROOT \
    /home/codespace/meridian-commissioning-20261014/venv/bin/python -I -B \
    /home/codespace/meridian-commissioning-20261014/recovery-830-reviewed/publisher_test_auto_setup.py \
    --prepare-test-secrets --owner-approved-cli-sessions \
    --acknowledge-provider-logging --exclusive-owner-window \
    --baseline /home/codespace/meridian-commissioning-20261014/approved-role-baseline.json \
    --ca /home/codespace/meridian-commissioning-20261014/verified-ca-bundle.pem \
    --ca-sha256 9481fcd95f41b221f02f14d896535fe500bec539bc563c4cdca1acee483a8bdd \
    --gh /usr/bin/gh --gh-sha256 553949e2efa12842771efe6012aa4de21f1d591530ec17fc435f610f10e017ee \
    --neon /home/codespace/meridian-commissioning-20261014/neon-8.4.5 \
    --neon-sha256 e90831b13bfcf75df8d7322617965022508d28b0b8116530992c2a5db776371a
  meridian_setup_exit=$?
  printf 'SETUP_EXIT=%s\n' "$meridian_setup_exit"
  exit "$meridian_setup_exit"
)
```

## Observe, preserve and stop

Require final `AUTO_SETUP_PREPARED_NOLOGIN` and observed outer `SETUP_EXIT=0`.
This is acknowledged secret writes plus confirmed DB commit/cleanup, not proof
of downstream secret consumption, working password login or live readiness.
The preparation helper is bounded internally but has no automatic recovery.

Any other status, nonzero exit, missing output, interrupted session or unexpected
input request means stop and preserve all state. Do not rerun this command, remove
the marker, delete secrets, repair permissions or activate LOGIN. Even
`AUTO_SETUP_FAILED_NO_REMOTE_WRITES` can leave a local attempt marker; it is not
automatic retry permission. Record only bounded status/exit and non-secret
operation evidence. A post-write verification/reconciliation plan must account
for the six now-existing secrets: the earlier recovery reconciler rejects those
names and is not a ready-made success verifier for this new state.

## Bounded read-only post-verification plan

Primary preparation evidence remains the reviewed helper's final
`AUTO_SETUP_PREPARED_NOLOGIN` plus outer exit0: it already verifies the database
baseline before and after its three password statements and confirms transaction
commit and cleanup. An extra DB read is corroboration of current role state, not
a replacement for that execution evidence or a password-value check. Keep the
same exclusive owner window for the following independent observations:

1. **GitHub metadata only.** Through the pinned existing GitHub CLI session, read
   the exact repository/user/environment identity, required-reviewer/main-branch
   protections and database variable again. Read environment secret metadata at
   `repos/Achi1984/meridian/environments/meridian-publisher-test/secrets?per_page=100`
   and repository secret metadata at
   `repos/Achi1984/meridian/actions/secrets?per_page=100`. Bound pagination as the
   reviewed helper does: reject a truncated/inconsistent response rather than
   guessing. Require each of the six target names exactly once in environment
   metadata and none at repository scope; preserve unrelated pre-existing names.
   Record only identity/protection PASS and the six target names with their
   creation/update timestamps. Compare timestamps with the recorded attempt
   interval where provider clock precision allows; ambiguous timing is not proof
   of this writer. Never request secret values, a workflow run or a test login.
   The existing `validate_github`/`preflight` deliberately reject these names and
   must not be used unchanged as a successful-post-setup validator.
2. **Local marker/evidence only.** Open canonical owner directories and the new
   active marker with no symlink traversal. Require owner UID1000, owner directory
   mode0700, marker regular mode0600/nlink1, exact53-byte fixed marker content,
   and matching descriptor/path identity. Record the NEW marker identity after
   this attempt; do not compare it with the retired old inode. Verify the prior
   recovery archive/evidence remain unchanged against6230893412. Do not remove,
   rename, repair or reuse either marker. An unexpected file/directory, changed
   archive or absent new marker requires read-only investigation.
3. **Optional independent DB corroboration, separately reviewed launch only.**
   Before any such credential access, review the exact read-only invocation
   against the already pinned helper source and the changed expected secret
   metadata state. Reuse existing `Services.admin_password()` privately and
   `Services.db_precheck(admin)`; do not call `run_setup`, `mutate`, `set_secret`
   or the old conflicting `preflight`. The former validates the fixed Neon URI
   and keeps its password in memory; the latter uses the existing supervised
   child, fixed TLS-verified endpoint/database/administrator, pinned CA and
   driver, `default_transaction_read_only=on`, bounded queries, original
   baseline verifier, rollback and close. It checks the three exact role OIDs,
   NOLOGIN and unchanged baseline attributes/grants, without changing roles or
   querying password material. Retain only bounded PASS/FAIL and observed outer
   exit; never print the URI, admin password, raw exceptions or query output.
   No new backend or verifier is introduced by this plan. The additional launch
   is not prepared/executed here and is not a prerequisite for recognizing the
   helper's narrowly defined confirmed preparation result.

These checks cannot establish the stored GitHub secret values, their agreement
with PostgreSQL passwords, later workflow consumption or successful login.
NOLOGIN is deliberately preserved. Do not activate roles to test this. A failed,
missing or ambiguous independent check must be reported alongside the original
helper outcome; stop progression and preserve all state for read-only
reconciliation. Never delete/replace secrets, roll back remotely, retry setup or
clear a marker to make the observations pass.

No command in this document was executed during preparation. Syntax validation
is not runtime or provider evidence. Separate owner approval, exact launch review,
fresh operational gates and the real result remain outstanding.
