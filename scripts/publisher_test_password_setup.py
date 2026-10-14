"""Owner-operated candidate; no action on import. Never log database errors."""
import argparse
import getpass
import importlib.util
import json
import os
from pathlib import Path
import sys
import sysconfig
import warnings

HOST = 'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech'
ROLES = ('meridian_test_reservation', 'meridian_test_sender', 'meridian_test_reader')
OWNER = 'publisher_owner'
STATUS_OK = 'PASSWORD_SETUP_CONFIRMED'
STATUS_FAIL = 'PASSWORD_SETUP_FAILED'
STATUS_UNKNOWN = 'PASSWORD_SETUP_INDETERMINATE'

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


def perform(baseline, ca_path, adapter, reader):
    """Injected adapters allow offline tests; caller enforces TTY/config gates."""
    connection = None
    committing = False
    committed = False
    try:
        admin = hidden('Administrator password (hidden): ', reader)
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
        for role in ROLES:
            value = hidden(role + ' new password (hidden): ', reader)
            confirmation = hidden(role + ' confirm password (hidden): ', reader)
            if (value != confirmation or len(value) < 32 or len(value) > 256
                    or not all(33 <= ord(c) <= 126 for c in value)
                    or value == admin or value in passwords):
                raise ValueError('password')
            passwords.append(value)
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
            return STATUS_UNKNOWN
        return STATUS_OK
    except BaseException:
        if committing and not committed:
            return STATUS_UNKNOWN
        return STATUS_FAIL
    finally:
        if connection is not None:
            if not committing:
                try:
                    connection.rollback()
                except BaseException:
                    pass
            try:
                connection.close()
            except BaseException:
                pass


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


def main(argv=None):
    outcome = STATUS_FAIL
    try:
        parser = QuietParser(add_help=False)
        parser.add_argument('--set-test-passwords', action='store_true', required=True)
        parser.add_argument('--acknowledge-provider-logging', action='store_true', required=True)
        parser.add_argument('--baseline', type=Path, required=True)
        parser.add_argument('--ca', type=Path, required=True)
        args = parser.parse_args(argv)
        if (sys.flags.isolated != 1
                or not sys.stdin.isatty() or not sys.stderr.isatty()
                or sys.gettrace() is not None or sys.getprofile() is not None
                or any(k.startswith(('PG', 'PSYCOPG', 'OTEL_', 'PYTHON', 'SSL_CERT_'))
                       or k in {'LD_PRELOAD', 'LD_LIBRARY_PATH', 'OPENSSL_CONF', 'SSLKEYLOGFILE'}
                       for k in os.environ)):
            raise ValueError('environment')
        if not args.ca.is_absolute() or not args.ca.is_file() or args.ca.stat().st_size == 0:
            raise ValueError('ca')
        baseline = read_baseline(args.baseline)
        spec = importlib.util.find_spec('psycopg')
        if spec is None:
            raise ValueError('dependency')
        verify_dependency_origin(spec.origin)
        import psycopg  # Late import; dependencies installed/reviewed before entry.
        verify_dependency_origin(psycopg.__file__)
        if psycopg.__version__ != '3.3.6':
            raise ValueError('dependency')
        from psycopg import sql
        psycopg.sql = sql
        outcome = perform(baseline, args.ca, psycopg, getpass.getpass)
    except BaseException:
        pass
    print(outcome, flush=True)
    return 0 if outcome == STATUS_OK else 2 if outcome == STATUS_UNKNOWN else 1


if __name__ == '__main__':
    sys.exit(main())
