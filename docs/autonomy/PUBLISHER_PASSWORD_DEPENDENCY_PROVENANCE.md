# Publisher password helper dependency evidence

Source-only dependency proposal, observed 2026-10-14. This document does not approve credentials, role changes, a Codespace, or a live database connection. The existing un-hashed requirements file is not changed by this packet.

## Deployment lock and provenance

`scripts/publisher-test-password-setup-cp314-linux-x86_64.lock` targets ordinary CPython 3.14 on Linux x86_64 with glibc >= 2.17. It does not cover free-threaded CPython, ARM64, musl, Windows, or the local Python 3.12 test environment. Both packages must be installed with `--require-hashes --only-binary=:all:`; reject a platform mismatch rather than selecting another wheel or building source.

Official metadata was fetched over HTTPS from `https://pypi.org/pypi/psycopg/3.3.6/json` and `https://pypi.org/pypi/psycopg-binary/3.3.6/json`. The exact wheel bytes were downloaded from the official `files.pythonhosted.org` URLs returned by that metadata, their SHA256 digests matched, and their embedded `.dist-info/METADATA` files were inspected. This establishes consistency with the official distribution channel; it is not an independent package audit or reproducible-build attestation.

| Exact deployment file | SHA256 |
| --- | --- |
| `psycopg-3.3.6-py3-none-any.whl` | `a1db9f7148b06a28606767efaca51fa6f9398c5c0a3810519be69d7000bdb631` |
| `psycopg_binary-3.3.6-cp314-cp314-manylinux2014_x86_64.manylinux_2_17_x86_64.whl` | `31cd942c23f613276b81a6e6598cefa12960058b0f46e1e874b540c793f6aca5` |

Official wheel URLs:

- https://files.pythonhosted.org/packages/4e/de/748bd7609c71cae5d737f0ba9192f19329f70180ecda8fff3cac02c5abe3/psycopg-3.3.6-py3-none-any.whl
- https://files.pythonhosted.org/packages/49/6d/7692d0d4e656b6cc9868d8acc2e3b42f17a0db4a625400a6d093cb0533a1/psycopg_binary-3.3.6-cp314-cp314-manylinux2014_x86_64.manylinux_2_17_x86_64.whl

Both distributions declare `Requires-Python: >=3.10`. For the selected `binary` extra on CPython 3.14/Linux, the full active dependency closure is these two packages. Psycopg's metadata declares:

```text
typing-extensions>=4.6; python_version < "3.13"
tzdata; sys_platform == "win32"
psycopg-binary==3.3.6; implementation_name != "pypy" and extra == "binary"
```

The first two conditions are false on this deployment target. Other dependencies are gated by unselected extras (`c`, `pool`, `test`, `dev`, `docs`). The binary wheel declares no `Requires-Dist` entries. No extra should be silently enabled.

For a future verified CPython 3.14 environment, first download with hash enforcement into an empty wheel directory, then install offline with the same lock and hash enforcement. Check that the two exact files above are selected. Use an isolated virtual environment and retain the actual interpreter version, platform, lock/source commit, and package verification output. The target interpreter and its provenance still require verification; the wheel filenames alone do not establish a working deployment environment.

## Executed local evidence

An isolated scratch virtual environment using CPython **3.12.14** installed the verified official wheels offline with no dependency resolution. Its additional local-only files were:

| Exact local-only file | SHA256 |
| --- | --- |
| `psycopg_binary-3.3.6-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl` | `1679a1cb93fbe5a6d1fd58d82cbddcc6fcb8c61446ba7cae6eb2a7b19bc585de` |
| `typing_extensions-4.15.0-py3-none-any.whl` | `f0fa19c6845758ab08074a0cfa8b7aecb71c999ca73d62883bc25cc018c4e548` |

The latter was downloaded from official PyPI version metadata and SHA256-verified. It satisfies the Python <3.13 dependency only and is not part of the deployment lock.

An isolated `python -I` execution imported Psycopg **3.3.6**, reported the **binary** implementation and bundled libpq **180006**, and passed five composition assertions: ordinary literals, apostrophe escaping, backslash escaping, quoted identifiers, and composing the helper's `ALTER ROLE ... PASSWORD ...` statement shape. Inputs were synthetic. No connection was opened. This is real driver/composition evidence, not PostgreSQL parsing, SCRAM-storage, transaction, or Python 3.14 execution evidence. Bundled libpq version is a client-library fact, not evidence of server version.

## Disposable PostgreSQL feasibility and remaining gate

The official PostgreSQL **16.10** source archive was downloaded from `https://ftp.postgresql.org/pub/source/v16.10/postgresql-16.10.tar.bz2`. Its bytes matched SHA256 **de8485f4ce9c32e3ddfeef0b7c261eed1cecb54c9bcd170e437ff454cb292b42**, fetched from the adjacent official `.sha256` file. No source build or server startup was performed: this runtime has UID 0, no installed PostgreSQL or container engine, and the legitimate `runuser -u nobody -- id` check failed with `cannot set groups: Operation not permitted`. No identity restriction or PostgreSQL root guard was bypassed.

Real integration remains a separate gate in a disposable environment with an ordinary unprivileged account, PostgreSQL 16, and the reviewed driver. Exercise the actual helper SQL and transaction behavior with synthetic roles/passwords. The helper checks its own backend TLS, so a local Unix socket alone is insufficient: use local TCP, a synthetic CA/server certificate, and verified TLS. A test adapter may assert the fixed production connection arguments and substitute only explicit disposable transport coordinates; do not relax production host or identity checks. Verify successful SCRAM storage and preserved role state, catalog drift rejection before writes, rollback on intermediate failure, and ambiguous commit handling. A synthetic TLS fixture does not verify Neon.

The local dependency investigation above made no Neon connection or production credential access. The later Codespace execution below supersedes its Python 3.14 and local PostgreSQL execution gaps; provider behavior remains unverified.

## Executed Codespace evidence — 2026-10-14

The existing owner-authorized blank Codespace provided ordinary CPython **3.14.2** and UID **1000**. PostgreSQL **16.10** was built from the SHA256-verified official archive above, without system installation, into `/tmp/meridian-pg16`. Build options were `--without-readline --without-zlib --without-icu --with-ssl=openssl`. No production database was contacted.

The exact repository commit `2ba6cade419e91dbc4c3e54e2244d0803629398f` was checked in the test checkout. A fresh virtual environment installed the deployment lock using `pip install --require-hashes --only-binary=:all:`. The selected packages were Psycopg 3.3.6 and Psycopg Binary 3.3.6, including the locked CPython 3.14 wheel.

The combined isolated unittest discovery command passed **20/20 tests** on Python 3.14.2: 18 helper tests and 2 real-driver composition tests. An earlier run on parent `f676015dcd339d72a8cdec65a456959e57e0e91f` failed three outcome subcases because its mock replaced all `sys.flags` with an incomplete object. The test-only correction preserves other interpreter flags; the production helper was unchanged.

The opt-in harness `test/publisher_test_password_setup_pg16.py --run-local-pg16 --pg-bin /tmp/meridian-pg16/bin`, executed with the isolated virtual-environment Python, passed **four real PostgreSQL cases**:

1. Actual SQL composition/parsing and SCRAM verifier storage for three distinct synthetic passwords containing quote/backslash syntax.
2. Wrong approved role OID rejected before password changes.
3. Injected second-ALTER failure rolls the transaction back, preserving prior verifiers.
4. Commit applied but acknowledgement lost returns INDETERMINATE; no automatic retry.

The harness used its own UTF8 temporary cluster, loopback-only TCP, a synthetic localhost certificate with verify-full TLS, synthetic owner/roles and canonical empty-table fixtures. It verified final OIDs/memberships, NOLOGIN and zero application rows, and stopped the temporary cluster before removal. No user secrets were requested. Roles remain NOLOGIN, so this does **not** prove successful password authentication.

Remaining operational gates: independent source review, native network/cleanup deadline implementation and fault evidence, actual deployment CA provenance, independently approved real-role baseline/provisioning, owner acceptance of provider logging, and provider-specific behavior. The local TLS certificate and PostgreSQL server do not certify Neon or authorize live credentials.
