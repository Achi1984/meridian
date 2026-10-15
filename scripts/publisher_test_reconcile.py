"""Read-only owner evidence collection; never clears an attempt or retries setup.

A passing result is a point-in-time observation, not recovery authorization.
The existing attempt marker is deliberately neither read nor changed.
"""
import importlib.util
import os
from pathlib import Path
import sys

OK = 'RECONCILE_READ_ONLY_CHECKS_PASSED'
INVOCATION_FAILED = 'RECONCILE_INVOCATION_FAILED'
PREFLIGHT_FAILED = 'RECONCILE_PROVIDER_CHECK_FAILED'
CREDENTIAL_FAILED = 'RECONCILE_CONNECTION_RETRIEVAL_FAILED'
DATABASE_FAILED = 'RECONCILE_DATABASE_CHECK_FAILED'


def load_auto():
    path = Path(__file__).resolve().with_name('publisher_test_auto_setup.py')
    spec = importlib.util.spec_from_file_location('meridian_auto_setup', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_reconcile(services):
    """Use only provider reads and the existing supervised read-only DB check."""
    failure = PREFLIGHT_FAILED
    try:
        if services.preflight() is not True:
            return failure
        failure = CREDENTIAL_FAILED
        admin = services.admin_password()
        if type(admin) is not str or not admin:
            return failure
        failure = DATABASE_FAILED
        if services.db_precheck(admin) is not True:
            return failure
        # Detect provider drift during the DB check without attempting recovery.
        failure = PREFLIGHT_FAILED
        if services.preflight() is not True:
            return failure
        return OK
    except BaseException:
        return failure


def main(argv=None):
    outcome = INVOCATION_FAILED
    original = None
    try:
        auto = load_auto()
        original = auto.load_original()
        parser = original.QuietParser(add_help=False, allow_abbrev=False)
        parser.add_argument('--check', action='store_true', required=True)
        for flag in ('owner-approved-cli-sessions', 'acknowledge-provider-logging',
                     'exclusive-owner-window'):
            parser.add_argument('--' + flag, action='store_true', required=True)
        for name in ('baseline', 'ca', 'gh', 'neon'):
            parser.add_argument('--' + name, type=Path, required=True)
        for name in ('ca', 'gh', 'neon'):
            parser.add_argument('--' + name + '-sha256', required=True)
        args = parser.parse_args(argv)
        # Same isolation and environment contract as the credential bootstrap.
        if (sys.platform != 'linux' or sys.flags.isolated != 1 or sys.gettrace() or sys.getprofile()
                or any(k.startswith(('PG', 'PSYCOPG', 'OTEL_', 'PYTHON', 'SSL_CERT_'))
                       or k in {'LD_PRELOAD', 'LD_LIBRARY_PATH', 'OPENSSL_CONF', 'SSLKEYLOGFILE'}
                       for k in os.environ)
                or not sys.stdin.isatty() or not sys.stderr.isatty()):
            raise ValueError('invocation')
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        outcome = run_reconcile(auto.Services(args, original))
    except BaseException:
        pass
    try:
        # emit_status is bounded and contains no provider diagnostics.
        delivered = original.emit_status(outcome) if original is not None else False
    except BaseException:
        delivered = False
    return 0 if delivered and outcome == OK else 1


if __name__ == '__main__':
    sys.exit(main())
