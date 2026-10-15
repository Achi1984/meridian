"""Owner-run candidate. Imports do not authenticate, connect, or mutate anything."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import secrets
import selectors
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit, parse_qsl, unquote

PROJECT = 'wandering-queen-12324132'
BRANCH = 'br-delicate-field-b9uijh3y'
HOST = 'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech'
REPO = 'Achi1984/meridian'
ENVIRONMENT = 'meridian-publisher-test'
OWNER_ID = 319562141
REPO_ID = 1342084551
ROLES = ('meridian_test_reservation', 'meridian_test_sender', 'meridian_test_reader')
SECRET_NAMES = tuple('MERIDIAN_PUBLISHER_TEST_' + role + suffix
                     for role in ('RESERVATION', 'SENDER', 'READER')
                     for suffix in ('_USER', '_PASSWORD'))
CHECK_OK = 'AUTO_SETUP_CHECKS_PASSED'
SETUP_OK = 'AUTO_SETUP_PREPARED_NOLOGIN'
SETUP_FAILED = 'AUTO_SETUP_FAILED_NO_REMOTE_WRITES'
RECONCILE = 'AUTO_SETUP_RECONCILIATION_REQUIRED'


def validate_uri(value):
    """Return only password; all other connection fields are fixed independently."""
    if type(value) is not str or not value or any(ord(c) <= 32 or ord(c) == 127 for c in value):
        raise ValueError('uri')
    if re.search(r'%(?![0-9a-fA-F]{2})', value):
        raise ValueError('uri escape')
    parsed = urlsplit(value)
    if (parsed.scheme not in ('postgres', 'postgresql') or parsed.fragment
            or parsed.hostname != HOST or parsed.port not in (None, 5432)
            or parsed.path != '/publisher_ledger' or parsed.username != 'publisher_owner'
            or not parsed.password or parsed.netloc.count('@') != 1):
        raise ValueError('uri')
    pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    if len(dict(pairs)) != len(pairs) or not pairs:
        raise ValueError('uri')
    query = dict(pairs)
    if (set(query) - {'sslmode', 'channel_binding'} or query.get('sslmode') != 'verify-full'
            or query.get('channel_binding', 'require') != 'require'):
        raise ValueError('uri')
    password = unquote(parsed.password, errors='strict')
    if not password or any(ord(c) < 33 or ord(c) > 126 for c in password):
        raise ValueError('uri')
    return password


def _secret_names(page):
    if (type(page) is not dict or type(page.get('secrets')) is not list
            or type(page.get('total_count')) is not int
            or page['total_count'] != len(page['secrets'])):
        raise ValueError('pagination')
    names = [item['name'] for item in page['secrets']]
    if len(set(names)) != len(names) or any(type(n) is not str for n in names):
        raise ValueError('secrets')
    return set(names)


def validate_github(repo, user, environment, policies, repo_secrets, env_secrets):
    if (repo.get('id') != REPO_ID or repo.get('full_name') != REPO
            or repo.get('owner', {}).get('id') != OWNER_ID
            or repo.get('owner', {}).get('type') != 'User'
            or repo.get('permissions', {}).get('admin') is not True
            or user.get('id') != OWNER_ID or user.get('login') != 'Achi1984'
            or environment.get('name') != ENVIRONMENT
            or environment.get('can_admins_bypass') is not False
            or environment.get('deployment_branch_policy') != {
                'protected_branches': False, 'custom_branch_policies': True}):
        raise ValueError('github identity or protection')
    rules = environment.get('protection_rules')
    if (type(rules) is not list or any(type(r) is not dict for r in rules)
            or any(r.get('type') not in ('required_reviewers', 'branch_policy') for r in rules)
            or sum(r.get('type') == 'required_reviewers' for r in rules) != 1
            or sum(r.get('type') == 'branch_policy' for r in rules) > 1):
        raise ValueError('protection rules')
    rule = next(r for r in rules if r.get('type') == 'required_reviewers')
    if (rule.get('type') != 'required_reviewers' or rule.get('prevent_self_review') is not False
            or type(rule.get('reviewers')) is not list or len(rule['reviewers']) != 1
            or rule['reviewers'][0].get('type') != 'User'
            or rule['reviewers'][0].get('reviewer', {}).get('id') != OWNER_ID):
        raise ValueError('reviewers')
    if (policies.get('total_count') != 1 or len(policies.get('branch_policies', [])) != 1
            or policies['branch_policies'][0].get('name') != 'main'
            or policies['branch_policies'][0].get('type') != 'branch'):
        raise ValueError('branch policies')
    if set(SECRET_NAMES) & (_secret_names(repo_secrets) | _secret_names(env_secrets)):
        raise ValueError('existing secret conflict')


def run_setup(services, prepare=False):
    """Dependency-injected state machine. Exceptions are intentionally never exposed.

    Each effect returns True, except admin_password (str), generate_passwords
    (three strings), and mutate (original helper's STATUS_OK). A failed/unknown
    secret write is never retried/deleted. The exclusive marker survives failure.
    """
    writing = False
    try:
        if services.preflight() is not True:
            raise ValueError('preflight')
        if not prepare:
            return CHECK_OK
        if services.acquire_marker() is not True:
            raise ValueError('attempt marker')
        admin = services.admin_password()
        if type(admin) is not str or not admin:
            raise ValueError('administrator')
        if services.db_precheck(admin) is not True:
            raise ValueError('database precheck')
        values = services.generate_passwords()
        if (type(values) not in (tuple, list) or len(values) != 3
                or any(type(v) is not str or not 32 <= len(v) <= 256
                       or not all(33 <= ord(c) <= 126 for c in v) for v in values)
                or len(set(values)) != 3 or admin in values):
            raise ValueError('generated passwords')
        # Repeat provider read-only gates immediately before the first write.
        if services.preflight() is not True:
            raise ValueError('pre-write preflight')
        for index, role in enumerate(ROLES):
            for name, value in zip(SECRET_NAMES[index * 2:index * 2 + 2], (role, values[index])):
                writing = True  # Unknown outcome starts before invoking the API.
                if services.set_secret(name, value) is not True:
                    raise ValueError('secret write')
        if services.mutate(admin, tuple(values)) != 'PASSWORD_SETUP_CONFIRMED':
            return RECONCILE
        return SETUP_OK
    except BaseException:
        return RECONCILE if writing else SETUP_FAILED


class Command:
    """Bounded private pipes; no raw diagnostic leaves this class."""
    def __init__(self, environment):
        self.environment = dict(environment)

    def run(self, argv, input_value=None, timeout=15):
        proc = None
        selector = selectors.DefaultSelector()
        output = bytearray()
        try:
            proc = subprocess.Popen(argv, stdin=subprocess.PIPE if input_value is not None else subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    env=self.environment, start_new_session=True, close_fds=True)
            if input_value is not None:
                # Input is at most 257 bytes, smaller than the minimum pipe capacity.
                proc.stdin.write(input_value.encode('ascii'))
                proc.stdin.close()
            os.set_blocking(proc.stdout.fileno(), False)
            selector.register(proc.stdout, selectors.EVENT_READ)
            deadline = time.monotonic() + timeout
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError('command deadline')
                for key, _ in selector.select(min(remaining, 0.1)):
                    part = os.read(key.fd, 65536)
                    if not part:
                        selector.unregister(key.fileobj)
                    else:
                        output.extend(part)
                        if len(output) > 1024 * 1024:
                            raise ValueError('command output bound')
            if proc.wait(timeout=max(0.001, deadline - time.monotonic())) != 0:
                raise ValueError('command')
            return bytes(output).decode('utf-8', errors='strict')
        except BaseException:
            raise ValueError('command failed') from None
        finally:
            selector.close()
            if proc is not None:
                # Kill any lingering process-group descendants, including after exit.
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except OSError:
                    pass
                try:
                    proc.wait(timeout=2)
                except BaseException:
                    pass
                for stream in (proc.stdin, proc.stdout):
                    if stream is not None:
                        try:
                            stream.close()
                        except BaseException:
                            pass


def trusted_executable(path, digest):
    if not path.is_absolute() or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise ValueError('executable')
    resolved = path.resolve(strict=True)
    info = resolved.stat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, os.getuid())
            or info.st_mode & 0o022 or not os.access(resolved, os.X_OK)
            or hashlib.sha256(resolved.read_bytes()).hexdigest() != digest):
        raise ValueError('executable')
    for parent in resolved.parents:
        if parent.stat().st_mode & 0o022:
            raise ValueError('executable parent')
    return str(resolved)


def load_original():
    path = Path(__file__).resolve().with_name('publisher_test_password_setup.py')
    spec = importlib.util.spec_from_file_location('meridian_password_setup', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Services:
    def __init__(self, args, original):
        self.args, self.original = args, original
        self.gh = trusted_executable(args.gh, args.gh_sha256)
        self.neon = trusted_executable(args.neon, args.neon_sha256)
        self.baseline = original.read_baseline(args.baseline)
        # No ambient token, proxy, CA, loader, CLI config, or debug variables.
        import pwd
        home = pwd.getpwuid(os.getuid()).pw_dir
        self.command = Command({'HOME': home, 'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8',
                                'GH_HOST': 'github.com', 'GH_PROMPT_DISABLED': '1', 'CI': 'true',
                                'BROWSER': '/bin/false'})

    def api(self, suffix):
        return json.loads(self.command.run([self.gh, 'api', '--hostname', 'github.com', '--method', 'GET', suffix]))

    def preflight(self):
        original = self.original
        original.verify_installed_dependency()
        original.load_ca(self.args.ca)
        if hashlib.sha256(self.args.ca.read_bytes()).hexdigest() != self.args.ca_sha256:
            raise ValueError('ca pin')
        # `me` does not start interactive authentication when signed out.
        identity = json.loads(self.command.run([self.neon, 'me', '--output', 'json']))
        if type(identity) is not dict or not identity.get('id'):
            raise ValueError('neon session')
        prefix = 'repos/' + REPO
        validate_github(self.api(prefix), self.api('user'),
                        self.api(prefix + '/environments/' + ENVIRONMENT),
                        self.api(prefix + '/environments/' + ENVIRONMENT + '/deployment-branch-policies?per_page=100'),
                        self.api(prefix + '/actions/secrets?per_page=100'),
                        self.api(prefix + '/environments/' + ENVIRONMENT + '/secrets?per_page=100'))
        variable = self.api(prefix + '/environments/' + ENVIRONMENT + '/variables/MERIDIAN_PUBLISHER_TEST_DATABASE')
        if variable.get('name') != 'MERIDIAN_PUBLISHER_TEST_DATABASE' or variable.get('value') != 'publisher_ledger':
            raise ValueError('database binding')
        return True

    def acquire_marker(self):
        import pwd
        home = Path(pwd.getpwuid(os.getuid()).pw_dir)
        directory = home / '.meridian-owner-setup'
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            pass
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError('marker directory')
        # Fixed name across invocations and source revisions. Never auto-remove.
        path = directory / 'publisher-test-attempt'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, b'OWNER_RECONCILIATION_REQUIRED_BEFORE_ANOTHER_ATTEMPT\n')
            os.fsync(fd)
        finally:
            os.close(fd)
        return True

    def admin_password(self):
        value = self.command.run([self.neon, 'connection-string', BRANCH, '--project-id', PROJECT,
                                  '--database-name', 'publisher_ledger', '--role-name', 'publisher_owner',
                                  '--ssl', 'verify-full'])
        return validate_uri(value.rstrip('\r\n'))

    def db_precheck(self, admin):
        original = self.original
        def worker(phase):
            original.load_ca(self.args.ca)
            if hashlib.sha256(self.args.ca.read_bytes()).hexdigest() != self.args.ca_sha256:
                raise ValueError('ca pin')
            import psycopg
            original.verify_dependency_origin(psycopg.__file__)
            if psycopg.__version__ != '3.3.6':
                raise ValueError('dependency')
            connection = None
            ok = False
            try:
                phase(b'A')
                phase(b'C')
                connection = psycopg.connect(host=HOST, port=5432, dbname='publisher_ledger',
                    user='publisher_owner', password=admin, sslmode='verify-full', sslrootcert=str(self.args.ca),
                    connect_timeout=10, autocommit=False,
                    options='-c search_path=pg_catalog -c statement_timeout=10000 -c lock_timeout=2000 -c default_transaction_read_only=on')
                noticed = [False]
                connection.add_notice_handler(lambda unused: noticed.__setitem__(0, True))
                original.verify(connection.cursor(), self.baseline)
                if noticed[0]:
                    raise ValueError('notice')
                # Supervisor's M means uncertainty boundary, not necessarily a write.
                phase(b'P')
                phase(b'M')
                ok = True
            finally:
                if connection is not None:
                    phase(b'L')
                    connection.rollback()
                    connection.close()
            return original.STATUS_OK if ok else original.STATUS_FAIL
        return original.supervise(worker) == original.STATUS_OK

    def generate_passwords(self):
        return tuple(secrets.token_hex(32) for _ in ROLES)

    def set_secret(self, name, value):
        if name not in SECRET_NAMES:
            raise ValueError('secret name')
        self.command.run([self.gh, 'secret', 'set', name, '--repo', REPO, '--env', ENVIRONMENT], value)
        return True

    def mutate(self, admin, passwords):
        original = self.original
        def worker(phase):
            original.load_ca(self.args.ca)
            if hashlib.sha256(self.args.ca.read_bytes()).hexdigest() != self.args.ca_sha256:
                raise ValueError('ca pin')
            import psycopg
            from psycopg import sql
            original.verify_dependency_origin(psycopg.__file__)
            if psycopg.__version__ != '3.3.6':
                raise ValueError('dependency')
            psycopg.sql = sql
            values = iter([admin] + [value for password in passwords for value in (password, password)])
            return original.perform(self.baseline, self.args.ca, psycopg, lambda prompt: next(values), phase)
        return original.supervise(worker)


def main(argv=None):
    outcome = SETUP_FAILED
    try:
        original = load_original()
        parser = original.QuietParser(add_help=False, allow_abbrev=False)
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument('--check', action='store_true')
        mode.add_argument('--prepare-test-secrets', action='store_true')
        parser.add_argument('--acknowledge-provider-logging', action='store_true')
        parser.add_argument('--owner-approved-cli-sessions', action='store_true', required=True)
        parser.add_argument('--exclusive-owner-window', action='store_true')
        for name in ('baseline', 'ca', 'gh', 'neon'):
            parser.add_argument('--' + name, type=Path, required=True)
        for name in ('ca', 'gh', 'neon'):
            parser.add_argument('--' + name + '-sha256', required=True)
        args = parser.parse_args(argv)
        if (sys.platform != 'linux' or sys.flags.isolated != 1 or sys.gettrace() or sys.getprofile()
                or any(k.startswith(('PG', 'PSYCOPG', 'OTEL_', 'PYTHON', 'SSL_CERT_'))
                       or k in {'LD_PRELOAD', 'LD_LIBRARY_PATH', 'OPENSSL_CONF', 'SSLKEYLOGFILE'}
                       for k in os.environ)
                or (args.prepare_test_secrets and (not args.acknowledge_provider_logging
                    or not args.exclusive_owner_window or not sys.stdin.isatty() or not sys.stderr.isatty()))):
            raise ValueError('invocation')
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        outcome = run_setup(Services(args, original), args.prepare_test_secrets)
    except BaseException:
        pass
    try:
        delivered = load_original().emit_status(outcome)
    except BaseException:
        delivered = False
    return 0 if delivered and outcome in (SETUP_OK, CHECK_OK) else 2 if outcome == RECONCILE else 1


if __name__ == '__main__':
    sys.exit(main())
