"""Owner-operated candidate; no action on import. Never log database errors."""
import argparse
import ctypes
import getpass
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import stat
import sys
import sysconfig
import termios
import threading
import time
import warnings

HOST = 'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech'
ROLES = ('meridian_test_reservation', 'meridian_test_sender', 'meridian_test_reader')
OWNER = 'publisher_owner'
STATUS_OK = 'PASSWORD_SETUP_CONFIRMED'
STATUS_FAIL = 'PASSWORD_SETUP_FAILED'
STATUS_UNKNOWN = 'PASSWORD_SETUP_INDETERMINATE'
INPUT_OK = 'INPUT_CHECKS_PASSED'
INPUT_FAIL = 'INPUT_CHECKS_FAILED'
MAX_CA_BYTES = 1024 * 1024
PHASE_BUDGETS = {'setup': 15, 'connect': 15, 'mutation': 30, 'cleanup': 3, 'exit': 3}


def _reap(child, seconds):
    until = time.monotonic() + seconds
    while True:
        if time.monotonic() >= until:
            return None
        try:
            pid, status = os.waitpid(child, os.WNOHANG)
        except ChildProcessError:
            # Never signal a possibly already-reaped/reused PID.
            return ('unavailable', None)
        if pid == child:
            return status if time.monotonic() < until else ('late', status)
        remaining = until - time.monotonic()
        if remaining <= 0:
            return None
        time.sleep(min(0.01, remaining))


def _protect_worker(parent):
    # Linux clears PDEATHSIG on fork. Set it in this child, then close the race
    # where the supervisor died before prctl. Never detach from the owner's TTY.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or os.getppid() != parent:
        os._exit(1)


def _child_transition(event_fd, ack_fd, token):
    if token not in (b'A', b'C', b'P', b'M', b'L', b'F', b'U', b'O'):
        raise ValueError('phase')
    if os.write(event_fd, token) != 1 or os.read(ack_fd, 1) != b'.':
        raise ValueError('phase acknowledgement')


def _run_child(worker, parent, event_read, event_write, ack_read, ack_write, tty_fd):
    # Every child path exits without inherited atexit handlers, traceback or
    # stream flushing, including interruption during protection/pipe setup.
    try:
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        os.close(event_read)
        os.close(ack_write)
        if tty_fd is not None:
            os.close(tty_fd)
        _protect_worker(parent)
        last = [b'S']
        def phase(token):
            _child_transition(event_write, ack_read, token)
            last[0] = token
        try:
            outcome = worker(phase)
        except BaseException:
            outcome = STATUS_UNKNOWN if last[0] in (b'M', b'L') else STATUS_FAIL
        result = {STATUS_OK: b'O', STATUS_FAIL: b'F', STATUS_UNKNOWN: b'U'}.get(outcome, b'U')
        _child_transition(event_write, ack_read, result)
        os.close(event_write)
        os.close(ack_read)
        os._exit(0)
    except BaseException:
        os._exit(1)


def supervise(worker, budgets=None):
    """Run a credential-owning child; parent receives only fixed phase bytes.

    `worker(phase)` returns one STATUS_* value. Budget injection is for local
    fault-injection tests only; the CLI always uses immutable production values.
    """
    limits = dict(PHASE_BUDGETS if budgets is None else budgets)
    if (sys.platform != 'linux' or threading.active_count() != 1
            or threading.current_thread() is not threading.main_thread()
            or signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL
            or set(limits) != set(PHASE_BUDGETS)
            or any(type(v) not in (int, float) or not 0 < v <= 30 for v in limits.values())):
        return STATUS_FAIL
    event_read, event_write = os.pipe()
    ack_read, ack_write = os.pipe()
    parent = os.getpid()
    tty_fd = None
    tty_state = None
    child = None
    reaped = False
    state = b'S'
    mutated = False
    pending = None
    until = time.monotonic() + limits['setup']
    prior_term = signal.getsignal(signal.SIGTERM)
    def interrupted(signum, frame):
        raise KeyboardInterrupt()
    try:
        signal.signal(signal.SIGTERM, interrupted)
        # No TTY reads. Snapshot solely to recover from killed hidden-input code.
        try:
            tty_fd = os.open('/dev/tty', os.O_RDWR | os.O_CLOEXEC)
            tty_state = termios.tcgetattr(tty_fd)
        except OSError:
            if tty_fd is not None:
                os.close(tty_fd)
                tty_fd = None
        child = os.fork()  # Before any driver import, password or DB connection.
        if child == 0:
            _run_child(worker, parent, event_read, event_write, ack_read, ack_write, tty_fd)
        os.close(event_write)
        event_write = None
        os.close(ack_read)
        ack_read = None
        allowed = {b'S': {b'A', b'F'}, b'A': {b'C', b'F'},
                   b'C': {b'P', b'L', b'F'}, b'P': {b'M', b'L'},
                   b'M': {b'L'}, b'L': {b'F', b'U', b'O'}}
        while True:
            remaining = None if until is None else max(0, until - time.monotonic())
            ready, _, _ = select.select([event_read], [], [], remaining)
            if not ready or (until is not None and time.monotonic() >= until):
                raise TimeoutError('phase')
            token = os.read(event_read, 1)
            if token not in allowed.get(state, set()):
                raise ValueError('phase sequence')
            if token == b'O' and not mutated:
                raise ValueError('unearned success')
            state = token
            if token == b'M':
                mutated = True  # Record uncertainty before ACK permits mutation.
            if token in (b'F', b'U', b'O'):
                pending = {b'F': STATUS_FAIL, b'U': STATUS_UNKNOWN, b'O': STATUS_OK}[token]
                until = time.monotonic() + limits['exit']
            elif token in (b'A', b'P'):
                until = None  # Owner input deliberately has no deadline.
            else:
                key = {b'C': 'connect', b'M': 'mutation', b'L': 'cleanup'}[token]
                until = time.monotonic() + limits[key]
            if os.write(ack_write, b'.') != 1:
                raise ValueError('ack')
            if pending is not None:
                status = _reap(child, max(0, until - time.monotonic()))
                reaped = status is not None
                if status != 0:
                    raise ValueError('child exit')
                return pending
    except BaseException:
        return STATUS_UNKNOWN if mutated or state == b'L' else STATUS_FAIL
    finally:
        signal.signal(signal.SIGTERM, prior_term)
        if child is not None and child > 0 and not reaped:
            try:
                os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                _reap(child, limits['exit'])
            except BaseException:
                pass
        for fd in (event_read, event_write, ack_read, ack_write):
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass
        if tty_fd is not None:
            try:
                termios.tcflush(tty_fd, termios.TCIFLUSH)
                termios.tcsetattr(tty_fd, termios.TCSANOW, tty_state)
            except BaseException:
                pass
            os.close(tty_fd)


def emit_status(outcome):
    """One nonblocking write; restore flags shared with the invoking shell."""
    original_blocking = None
    delivered = False
    try:
        original_blocking = os.get_blocking(1)
        os.set_blocking(1, False)
        payload = (outcome + '\n').encode('ascii')
        delivered = os.write(1, payload) == len(payload)
    except BaseException:
        delivered = False
    finally:
        if original_blocking is not None:
            try:
                os.set_blocking(1, original_blocking)
            except BaseException:
                delivered = False
    return delivered

IDENTITY_SQL = """
SELECT current_database(), current_user, session_user,
 current_setting('server_version_num')::integer,
 current_setting('search_path'), current_setting('createrole_self_grant'),
 r.oid, r.rolcreaterole, r.rolsuper,
 (SELECT count(*) FROM pg_catalog.pg_database
   WHERE datname='publisher_ledger' AND datdba=r.oid),
 (SELECT count(*) FROM pg_catalog.pg_namespace
   WHERE nspname='meridian_publisher' AND nspowner=r.oid),
 (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
   ON n.oid=c.relnamespace WHERE n.nspname='meridian_publisher'
   AND c.relname IN ('reservations','send_records')
   AND c.relkind='r' AND c.relowner=r.oid),
 (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid())
FROM pg_catalog.pg_roles r WHERE r.rolname='publisher_owner'
"""
ROLE_SQL = """
SELECT r.rolname, r.oid, r.rolcanlogin, r.rolsuper, r.rolcreatedb,
 r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit,
 EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d
   WHERE d.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass
   AND d.refobjid=r.oid AND d.deptype='o')
FROM pg_catalog.pg_roles r WHERE r.rolname IN
 ('meridian_test_reservation','meridian_test_sender','meridian_test_reader')
"""
MEMBERSHIP_SQL = """
SELECT m.roleid, m.member, m.grantor, m.admin_option, m.inherit_option, m.set_option
FROM pg_catalog.pg_auth_members m WHERE m.roleid IN
 (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN
 ('meridian_test_reservation','meridian_test_sender','meridian_test_reader'))
 OR m.member IN
 (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN
 ('meridian_test_reservation','meridian_test_sender','meridian_test_reader'))
"""


def validate_baseline(value):
    if type(value) is not dict or set(value) != {'owner_oid', 'roles'}:
        raise ValueError('baseline')
    def oid(v):
        return type(v) is int and 0 < v < 2**32
    if not oid(value['owner_oid']) or type(value['roles']) is not dict:
        raise ValueError('baseline')
    if set(value['roles']) != set(ROLES):
        raise ValueError('baseline')
    ids = [value['owner_oid']]
    for record in value['roles'].values():
        if type(record) is not dict or set(record) != {'oid', 'grantor_oid'}:
            raise ValueError('baseline')
        if not oid(record['oid']) or not oid(record['grantor_oid']):
            raise ValueError('baseline')
        ids.append(record['oid'])
    if len(set(ids)) != 4:
        raise ValueError('baseline')
    return value


def read_baseline(path):
    if not path.is_absolute() or not path.is_file() or path.stat().st_size > 4096:
        raise ValueError('baseline')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate')
            result[key] = value
        return result
    return validate_baseline(json.loads(path.read_text(), object_pairs_hook=unique))


def load_ca(path):
    """Offline PEM trust-store load only; not CA provenance or endpoint proof."""
    if not path.is_absolute():
        raise ValueError('ca')
    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_CA_BYTES:
            raise ValueError('ca')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            content = stream.read(MAX_CA_BYTES + 1)
    finally:
        os.close(fd)
    if not 0 < len(content) <= MAX_CA_BYTES:
        raise ValueError('ca')
    import ssl  # Password-mode invocation occurs only in supervised child SETUP.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(cadata=content.decode('ascii'))
    if context.cert_store_stats()['x509_ca'] < 1:
        raise ValueError('ca')
    return content


def verify(cursor, baseline):
    cursor.execute(IDENTITY_SQL)
    rows = cursor.fetchall()
    if len(rows) != 1:
        raise ValueError('identity')
    row = rows[0]
    if (len(row) != 13 or row[:3] != ('publisher_ledger', OWNER, OWNER)
            or type(row[3]) is not int or row[3] // 10000 != 16
            or row[4:7] != ('pg_catalog', '', baseline['owner_oid'])
            or row[7] is not True or row[8] is not False
            or row[9:12] != (1, 1, 2) or row[12] is not True):
        raise ValueError('identity')
    cursor.execute(ROLE_SQL)
    rows = cursor.fetchall()
    if len(rows) != 3 or {r[0] for r in rows} != set(ROLES):
        raise ValueError('roles')
    for row in rows:
        if (len(row) != 10 or row[1] != baseline['roles'][row[0]]['oid']
                or any(v is not False for v in row[2:])):
            raise ValueError('roles')
    cursor.execute(MEMBERSHIP_SQL)
    rows = cursor.fetchall()
    expected = {
        (v['oid'], baseline['owner_oid'], v['grantor_oid'], True, False, False)
        for v in baseline['roles'].values()
    }
    if len(rows) != 3 or set(rows) != expected:
        raise ValueError('membership')


def hidden(prompt, reader):
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        value = reader(prompt)
    if type(value) is not str or not value or '\x00' in value:
        raise ValueError('input')
    return value


def perform(baseline, ca_path, adapter, reader, phase=lambda token: None):
    """Injected adapters allow offline tests; caller enforces TTY/config gates."""
    connection = None
    committing = False
    committed = False
    outcome = STATUS_FAIL
    try:
        phase(b'A')
        admin = hidden('Administrator password (hidden): ', reader)
        phase(b'C')
        connection = adapter.connect(
            host=HOST, port=5432, dbname='publisher_ledger', user=OWNER,
            password=admin, sslmode='verify-full', sslrootcert=str(ca_path),
            connect_timeout=10, autocommit=False,
            options='-c search_path=pg_catalog -c statement_timeout=10000 -c lock_timeout=2000')
        # A notice is a failure; retain no message or SQL detail.
        noticed = [False]
        connection.add_notice_handler(lambda unused: noticed.__setitem__(0, True))
        cursor = connection.cursor()
        verify(cursor, baseline)
        passwords = []
        phase(b'P')
        for role in ROLES:
            value = hidden(role + ' new password (hidden): ', reader)
            confirmation = hidden(role + ' confirm password (hidden): ', reader)
            if (value != confirmation or len(value) < 32 or len(value) > 256
                    or not all(33 <= ord(c) <= 126 for c in value)
                    or value == admin or value in passwords):
                raise ValueError('password')
            passwords.append(value)
        phase(b'M')
        # Input may take time. Check again before the first mutation.
        verify(cursor, baseline)
        if noticed[0]:
            raise ValueError('notice')
        cursor.execute("SET LOCAL password_encryption = 'scram-sha-256'")
        cursor.execute('SHOW password_encryption')
        if cursor.fetchall() != [('scram-sha-256',)]:
            raise ValueError('encoding')
        for role, value in zip(ROLES, passwords):
            statement = adapter.sql.SQL('ALTER ROLE {} PASSWORD {}').format(
                adapter.sql.Identifier(role), adapter.sql.Literal(value))
            cursor.execute(statement)
        verify(cursor, baseline)
        if noticed[0]:
            raise ValueError('notice')
        committing = True
        connection.commit()
        committed = True
        if noticed[0]:
            outcome = STATUS_UNKNOWN
        else:
            outcome = STATUS_OK
    except BaseException:
        if committing and not committed:
            outcome = STATUS_UNKNOWN
        else:
            outcome = STATUS_FAIL
    finally:
        if connection is not None:
            phase(b'L')
            cleanup_failed = False
            if not committing:
                try:
                    connection.rollback()
                except BaseException:
                    cleanup_failed = True
            try:
                connection.close()
            except BaseException:
                cleanup_failed = True
            if cleanup_failed:
                outcome = STATUS_UNKNOWN
    return outcome


class QuietParser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError('arguments')


def verify_dependency_origin(module_path):
    """Reject workspace/user-site substitution; installed packages remain trusted."""
    if type(module_path) is not str:
        raise ValueError('dependency origin')
    origin = Path(module_path).resolve(strict=True)
    paths = sysconfig.get_paths()
    roots = {Path(paths[key]).resolve(strict=True) for key in ('purelib', 'platlib')}
    if (not origin.is_file() or origin.name != '__init__.py'
            or origin.parent.name != 'psycopg'
            or not any(origin.is_relative_to(root) for root in roots)):
        raise ValueError('dependency origin')


def verify_installed_dependency():
    """Metadata/origin only; never import the database driver in the parent."""
    spec = importlib.util.find_spec('psycopg')
    if spec is None:
        raise ValueError('dependency')
    verify_dependency_origin(spec.origin)
    if importlib.metadata.version('psycopg') != '3.3.6':
        raise ValueError('dependency')


def main(argv=None):
    arguments = list(sys.argv[1:] if argv is None else argv)
    checking = '--check-inputs' in arguments
    outcome = INPUT_FAIL if checking else STATUS_FAIL
    try:
        parser = QuietParser(add_help=False, allow_abbrev=False)
        modes = parser.add_mutually_exclusive_group(required=True)
        modes.add_argument('--set-test-passwords', action='store_true')
        modes.add_argument('--check-inputs', action='store_true')
        parser.add_argument('--acknowledge-provider-logging', action='store_true')
        parser.add_argument('--baseline', type=Path, required=True)
        parser.add_argument('--ca', type=Path, required=True)
        args = parser.parse_args(arguments)
        if args.set_test_passwords and not args.acknowledge_provider_logging:
            raise ValueError('acknowledgement')
        if (sys.platform != 'linux' or sys.flags.isolated != 1
                or (args.set_test_passwords and (not sys.stdin.isatty() or not sys.stderr.isatty()))
                or sys.gettrace() is not None or sys.getprofile() is not None
                or any(k.startswith(('PG', 'PSYCOPG', 'OTEL_', 'PYTHON', 'SSL_CERT_'))
                       or k in {'LD_PRELOAD', 'LD_LIBRARY_PATH', 'OPENSSL_CONF', 'SSLKEYLOGFILE'}
                       for k in os.environ)):
            raise ValueError('environment')
        if not args.ca.is_absolute() or not args.ca.is_file() or args.ca.stat().st_size == 0:
            raise ValueError('ca')
        baseline = read_baseline(args.baseline)
        verify_installed_dependency()
        def worker(phase):
            load_ca(args.ca)
            import psycopg  # Child setup deadline; before any password prompt.
            verify_dependency_origin(psycopg.__file__)
            if psycopg.__version__ != '3.3.6':
                raise ValueError('dependency')
            from psycopg import sql
            psycopg.sql = sql
            return perform(baseline, args.ca, psycopg, getpass.getpass, phase)
        if args.check_inputs:
            load_ca(args.ca)
            outcome = INPUT_OK
        else:
            outcome = supervise(worker)
    except BaseException:
        pass
    if not emit_status(outcome):
        return 2
    return 0 if outcome in (STATUS_OK, INPUT_OK) else 2 if outcome == STATUS_UNKNOWN else 1


if __name__ == '__main__':
    sys.exit(main())
