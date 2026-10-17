# One private read-only Gate A inspection — source proposal

Operation: `PUBLISHER-GATEA-LAUNCH-20261017-01`. This packet is source-only:
not approved for operational execution, not executed, and not a workflow.
The literal companion is `PUBLISHER_GATEA_READONLY_LAUNCH_20261017.sh`, SHA256
`19b91760ade3940a04ad61a6e970551c337ea77a7d848cd65ff49d8042fc1b3e`.
Its command flags do not authenticate or grant approval. Do not execute it during
review, CI, import or a scheduled task. Merge alone grants no runtime authority.

## Source and preparation boundary

Pin runtime source to PR848 head
`c4e860ebd5aae2282e48e7899ed4cdbaaf9c5b47`, not a moving branch. Receipt
[848/6233415079](https://github.com/Achi1984/meridian/pull/848#issuecomment-6233415079)
records 64 actual CPython3.14 tests, private PostgreSQL16.15 comparison including
seven independently rejected production-comparator mutations, and identical
manifest regeneration. This is local fixture evidence, not deployed inspection.
The manifest's 37 entries have SHA256
`611ce25904b59473149f5cb8bc69613309b0b8b147df6296defdfecc0ee11274`.

Before any operational launch, require completed exact-head CI, independent full
review and merge/postchecks for the runtime source, and independent review of
this whole packet and its literal launcher. Record the approved packet SHA and
launcher digest. Existing merge delegation covers source decisions only.

Preparation will create one fresh owner-only directory, without overwriting an
existing one:
`/home/codespace/meridian-commissioning-20261014/gatea-readonly-c4e860eb-reviewed`.
Stage the six runtime files and two dependency-evidence files listed in the
launcher's `sources` mapping from that immutable source, preserving exact bytes;
all eight files must be owner-owned regular0600 files, with a canonical0700
owner-owned directory. The launcher creates, downloads and installs nothing.
This packet itself does not stage operational files. Do not change existing
resource permissions merely to make a check pass.

Reuse the existing owner-controlled Codespace and isolated CPython3.14.2
interpreter, with installed Psycopg3.3.6 and its reviewed package-origin/provenance
basis. Revalidate that trust basis before execution; requirements/lock hashes
alone do not attest installed bytes. No dependency installation is permitted in
the credential-bearing window. Python/stdlib/OS, CLI session caches and same-UID
processes remain trusted runtime inputs, not fully attested by source hashes.

The launcher requires a TTY and preserves the caller environment. A local-only
preflight on CPython3.14.2 stopped at its existing environment guard before file
checks. A first reading incorrectly reported only `PYTHONIOENCODING`; full-view
reinspection of the same names-only output confirmed three names:
`PYTHONIOENCODING`, `PYTHON_PATH`, `PYTHON_ROOT`. Their values were not read.
R2 removed only the initially reported name and its local-only preflight still
stopped at the unchanged guard. Neither local failure ran provider/database
inspection; both observations remain recorded rather than being called passes.

The corrected, explicitly assessed invocation uses
`/usr/bin/env -u PYTHONIOENCODING -u PYTHON_PATH -u PYTHON_ROOT` for both Python
children. Only those three names are removed from their child environments;
the parent shell and every other binding are unchanged. The reviewed recovery
and setup launch documents already use this exact trio. The latter two names
are distinct from the standard `PYTHONPATH` and `PYTHONHOME`: neither is used
by the fixed absolute interpreter invocation or the inspected helpers. Isolated
Python (`-I`) ignores its Python configuration environment, including the output
encoding override. Existing explicit `PYTHON*` and other environment guards are
unchanged and still reject every prohibited remaining name, including
`PYTHONPATH` and `PYTHONHOME`.

The reused provider CLI command environment is separately constructed from its
existing fixed allowlist (including HOME obtained from the operating-system
account); it does not derive session caches or authentication from these three
names. This correction does not change that allowlist, credentials or cache
paths. It is explicit launch-environment preparation, not a production-policy
exception or permission to remove arbitrary variables or credentials. No values
are printed, copied or replaced. `/usr/bin/env` uses the existing trusted platform
runtime; no tool is installed.

This source change requires exact-head review and the new literal digest before
use; it does not authorize an operational retry. If a required check fails,
stop. Further environmental correction needs its own assessment; no retry loop
or relaxed guard is permitted. Exclusive ownership must hold between hash
verification and script execution; ordinary pathname execution is not immutable
against a concurrent same-UID writer.

## One concrete owner decision

Authenticate a fresh owner decision in the actual conversation **after** the
packet is reviewable. Record its timestamp, approved immutable source/packet and
literal digest, one-attempt scope and exclusive owner window. Approval covers:

- One use of existing owner-controlled GitHub/Neon CLI sessions for fixed provider
  identity/protection checks and private retrieval of the existing administrator
  connection information; no credential printing, export or file persistence.
- One supervised fixed-target, TLS-verified read-only database inspection,
  acknowledging that provider audit/logging may retain access/query activity.
- Bounded cleanup and postflight; any failure, timeout or indeterminate result
  stops and consumes this operational attempt. No automatic retry or repair.

Target remains repository `Achi1984/meridian` ID1342084551, owner319562141,
protected environment `meridian-publisher-test`; Neon project
`wandering-queen-12324132`, branch `br-delicate-field-b9uijh3y`, host
`ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech`, database
`publisher_ledger`, administrator `publisher_owner`.

Setup approval6231898914 is consumed. Neither it, generic continuation messages,
CLI flags nor local fixture results authorize this new credential-bearing step.
Do not replay setup or recovery. Preserve the active marker and its archive;
the launcher neither checks for their absence nor writes, removes or repairs them.
One-attempt accounting is an external owner/lead receipt, not a new local marker.

No LOGIN, role/password/secret changes, grants/revokes, migrations, workflow
installation/dispatch, publishing, trading or Gates B–D closure are included.
The three application roles remain NOLOGIN. An administrator inspection does not
substitute for later role-authenticated protected-secret readiness checks.

## Read-only result and stop contract

The helper uses fixed SQL on the fixed TLS target, verifies baseline OIDs/NOLOGIN/
memberships, requires zero effective-grant mismatches across the existing186-check
matrix, and records three TEMP/grant-option observations separately. It compares
all observed publisher catalog identities/definition hashes to the pinned fixture
manifest. It performs transaction rollback/connection cleanup, then repeats its
provider preflight before reporting final completion.

The deployed server version is **unknown**. The current reference supports actual
`server_version_num=160015` only. Any other value fails closed. Do not infer a
version from local client binaries, replace the manifest automatically or broaden
version support during execution. An unsupported-version result requires a new
reviewed reference/source decision before another operational attempt.

Accept only the conjunction of:

1. Local pin checks pass, then a bounded `READONLY_SCHEMA_INVENTORY` report with
   `fixtureCatalogMatch=true`, exact manifest digest and actual version160015.
2. `schemaEquivalenceEstablished=false` and `activationAuthorized=false` remain.
3. Final `READONLY_INSPECTION_COMPLETE_SCHEMA_EQUIVALENCE_NOT_ESTABLISHED`, followed
   by `GATEA_INSPECTOR_EXIT=0` and the independently observed outer launcher exit0.
4. Cleanup and provider postflight complete. Missing/contradictory output, a
   success line followed by failure, or unexplained remaining worker/connection
   state is not success and must not trigger an automatic retry/termination.

The final status is emitted only after the helper's cleanup/postflight sequence.
A separate read-only local process check may corroborate no helper descendants;
this is not a claim that no unrelated database sessions exist. Do not improvise
administrative session queries or terminate sessions outside the reviewed scope.
Record sanitized timestamps, exact source/launcher/runtime pins, approval binding,
report, final status, outer exit and relevant failure details. Never record the
private administrator URI/password or secret values.

A successful deployed run would support the narrow point-in-time claim: pinned
publisher fixture catalog and reviewed grant/baseline contract match. It does
not prove complete trigger semantics, universal database isolation/schema
identity, three-role password authentication, publication or live autonomy.
Gate A remains incomplete until an approved deployed run meets this contract.
Gates B–D require their distinct prepared procedures and owner authority.
