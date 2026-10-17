#!/bin/bash
# SOURCE-ONLY launch proposal. Separate exact-scope owner approval is required.
# Never called by CI, application code, an import, or a scheduled workflow.
set -u
case $- in *x*) printf '%s\n' 'GATEA_LAUNCH_STOP_TRACE_ENABLED'; exit 1;; esac
if ! test -t 0 || ! test -t 2; then
  printf '%s\n' 'GATEA_LAUNCH_STOP_TTY_REQUIRED'
  exit 1
fi
readonly meridian_gatea_python=/home/codespace/meridian-commissioning-20261014/venv/bin/python
# Read-only local checks. Preserve the caller environment; reject unsafe bindings.
"$meridian_gatea_python" -I -B - <<'PY'
import hashlib
import os
from pathlib import Path
import stat
import sys

try:
    if (sys.version_info[:3] != (3, 14, 2) or sys.flags.isolated != 1
            or sys.gettrace() or sys.getprofile()
            or any(k.startswith(('PG', 'PSYCOPG', 'OTEL_', 'PYTHON', 'SSL_CERT_'))
                   or k in {'LD_PRELOAD', 'LD_LIBRARY_PATH', 'OPENSSL_CONF', 'SSLKEYLOGFILE'}
                   for k in os.environ)):
        raise ValueError('runtime environment')
    base = Path('/home/codespace/meridian-commissioning-20261014')
    stage = base / 'gatea-readonly-c4e860eb-reviewed'
    for directory in (base, stage):
        info = directory.lstat()
        if (directory.resolve(strict=True) != directory or not stat.S_ISDIR(info.st_mode)
                or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError('source directory')
    sources = {
        'publisher_test_readonly_inspection.py': 'dfa65b4258e47d7ae7b4e68d06cdafe4520a3db3d53b9f28cb80bd099a30c951',
        'publisher_test_auto_setup.py': 'c859d4413eb2b50f7aae04e1d28eb23961989eb64beb29cb751eb65f06a8bfc0',
        'publisher_test_password_setup.py': '3f3e4cab7fa64b5890fda1483bc73ac277636f001ec933bf514c926267ef68fb',
        'publisher-test-readonly-queries.json': '99ac288ed3e1dd5681345aa828bed3e129e729a1430f9022ca456622b62e7789',
        'publisher_fixture_catalog.py': 'aecca8ba7ea9ae20c848ae8b240cb179389c13a93a5c1ba9d1a20a605e1495c5',
        'publisher-fixture-catalog-pg16.json': '611ce25904b59473149f5cb8bc69613309b0b8b147df6296defdfecc0ee11274',
        'publisher-test-password-setup-requirements.txt': '7cef1a29f54c1657bb1174a5ab9b923c0a55d43e44cbfb2181c284346a7860a9',
        'publisher-test-password-setup-cp314-linux-x86_64.lock': '00b8671deb2339aea88940f3b4235a5145898a619a5ac62a8e407de82b166fa5',
    }
    resources = {
        base / 'approved-role-baseline.json': 'cb60f0aab88dd3f23560ad14e2d4849a8ed7abc8dab0e437ba263fa217356e6c',
        base / 'verified-ca-bundle.pem': '9481fcd95f41b221f02f14d896535fe500bec539bc563c4cdca1acee483a8bdd',
        Path('/usr/bin/gh'): '553949e2efa12842771efe6012aa4de21f1d591530ec17fc435f610f10e017ee',
        base / 'neon-8.4.5': 'e90831b13bfcf75df8d7322617965022508d28b0b8116530992c2a5db776371a',
    }
    for path, expected, private, limit in [
            *((stage / name, digest, True, 262144) for name, digest in sources.items()),
            *((path, digest, False, 134217728) for path, digest in resources.items())]:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= limit
                    or info.st_uid not in (0, os.getuid()) or info.st_mode & 0o022
                    or (private and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600))):
                raise ValueError('file boundary')
            actual, size = hashlib.sha256(), 0
            while block := os.read(fd, 1048576):
                size += len(block)
                if size > limit:
                    raise ValueError('file length')
                actual.update(block)
            if size != info.st_size or actual.hexdigest() != expected:
                raise ValueError('file pin')
        finally:
            os.close(fd)
    print('GATEA_LOCAL_PIN_CHECKS_PASS_NOT_EXECUTION_APPROVAL')
except BaseException:
    print('GATEA_LOCAL_PIN_CHECKS_FAILED_STOP')
    sys.exit(1)
PY
meridian_gatea_preflight_exit=$?
if test "$meridian_gatea_preflight_exit" -ne 0; then
  printf '%s\n' 'GATEA_LAUNCH_STOP_LOCAL_CHECKS'
  exit 1
fi
# Flags acknowledge the externally authenticated approval; they do not grant it.
"$meridian_gatea_python" -I -B \
  /home/codespace/meridian-commissioning-20261014/gatea-readonly-c4e860eb-reviewed/publisher_test_readonly_inspection.py \
  --inspect-read-only --owner-approved-cli-sessions \
  --acknowledge-provider-logging --exclusive-owner-window \
  --baseline /home/codespace/meridian-commissioning-20261014/approved-role-baseline.json \
  --ca /home/codespace/meridian-commissioning-20261014/verified-ca-bundle.pem \
  --ca-sha256 9481fcd95f41b221f02f14d896535fe500bec539bc563c4cdca1acee483a8bdd \
  --gh /usr/bin/gh --gh-sha256 553949e2efa12842771efe6012aa4de21f1d591530ec17fc435f610f10e017ee \
  --neon /home/codespace/meridian-commissioning-20261014/neon-8.4.5 \
  --neon-sha256 e90831b13bfcf75df8d7322617965022508d28b0b8116530992c2a5db776371a
meridian_gatea_exit=$?
printf 'GATEA_INSPECTOR_EXIT=%s\n' "$meridian_gatea_exit"
exit "$meridian_gatea_exit"
