"""Opt-in disposable local PostgreSQL 16 integration. Never targets Neon.

python -I test/publisher_test_password_setup_pg16.py --run-local-pg16 --pg-bin /usr/lib/postgresql/16/bin
Requires nonroot, openssl and independently installed psycopg[binary]==3.3.6.
Creates/removes only a temporary cluster and synthetic credentials. No import I/O.
"""
import argparse
import getpass
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile

STAGE = 'runtime'


def run(pg_bin):
    global STAGE
    import psycopg
    from psycopg import sql
    if os.geteuid() == 0 or psycopg.__version__ != '3.3.6':
        raise RuntimeError('Unsupported test runtime')
    repo = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('local_password_helper', repo / 'scripts/publisher_test_password_setup.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    # No inherited libpq options, tracing or client TLS overrides.
    if any(key.startswith(('PG', 'PSYCOPG', 'SSL_CERT_', 'OTEL_')) or key in
           {'SSLKEYLOGFILE', 'OPENSSL_CONF', 'LD_PRELOAD', 'LD_LIBRARY_PATH'} for key in os.environ):
        raise RuntimeError('Ambient client configuration rejected')
    def command(args, timeout=30):
        return subprocess.run(args, check=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=timeout)
    version = command([str(pg_bin / 'postgres'), '--version']).stdout.decode()
    if not version.startswith('postgres (PostgreSQL) 16.'):
        raise RuntimeError('PostgreSQL 16 required')
    with tempfile.TemporaryDirectory(prefix='meridian-local-pg16-') as directory:
        root = Path(directory); data = root / 'data'; ca = root / 'server.crt'; key = root / 'server.key'
        STAGE = 'initdb'
        command([str(pg_bin / 'initdb'), '-D', str(data), '--auth-local=trust', '--auth-host=scram-sha-256', '--no-locale', '--encoding=UTF8'])
        STAGE = 'certificate'
        command(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                 '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
                 '-keyout', str(key), '-out', str(ca)])
        key.chmod(0o600)
        with socket.socket() as allocator:
            allocator.bind(('127.0.0.1', 0)); port = allocator.getsockname()[1]
        with (data / 'postgresql.conf').open('a') as config:
            config.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories='{root}'\n"
                         f"ssl=on\nssl_cert_file='{ca}'\nssl_key_file='{key}'\n"
                         "password_encryption='scram-sha-256'\nlog_statement='none'\n")
        started = False
        admin_password = secrets.token_urlsafe(36)
        try:
            STAGE = 'server-start'
            command([str(pg_bin / 'pg_ctl'), '-D', str(data), '-l', str(root / 'server.log'), '-w', '-t', '15', 'start'])
            started = True
            STAGE = 'synthetic-owner'
            local = dict(host=str(root), port=port, user=getpass.getuser(), dbname='postgres', connect_timeout=5)
            with psycopg.connect(**local, autocommit=True) as superuser:
                superuser.execute(sql.SQL('CREATE ROLE publisher_owner LOGIN CREATEROLE NOSUPERUSER PASSWORD {}').format(sql.Literal(admin_password)))
                superuser.execute('CREATE DATABASE publisher_ledger OWNER publisher_owner')
            owner = dict(host='localhost', hostaddr='127.0.0.1', port=port, user='publisher_owner',
                         dbname='publisher_ledger', password=admin_password, sslmode='verify-full',
                         sslrootcert=str(ca), connect_timeout=5, options='-c search_path=pg_catalog -c statement_timeout=10000 -c lock_timeout=2000')
            with psycopg.connect(**owner, autocommit=True) as connection:
                STAGE = 'fixtures-and-roles'
                fixtures = repo / 'docs/autonomy/event-adapter/review-binding/fixtures'
                for filename in ('publication-ledger.sql', 'publication-send-record.sql'):
                    connection.execute((fixtures / filename).read_text())
                for role in helper.ROLES:
                    connection.execute(sql.SQL('CREATE ROLE {} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT').format(sql.Identifier(role)))
                owner_oid = connection.execute("SELECT oid FROM pg_catalog.pg_roles WHERE rolname='publisher_owner'").fetchone()[0]
                observed = connection.execute('SELECT r.rolname,r.oid,m.grantor FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_auth_members m ON m.roleid=r.oid WHERE r.rolname=ANY(%s)', (list(helper.ROLES),)).fetchall()
                baseline = {'owner_oid': owner_oid, 'roles': {name: {'oid': oid, 'grantor_oid': grantor} for name, oid, grantor in observed}}
                helper.validate_baseline(baseline)

            def password_state():
                with psycopg.connect(**local, autocommit=True) as connection:
                    return connection.execute('SELECT rolname,rolpassword,rolcanlogin FROM pg_catalog.pg_authid WHERE rolname=ANY(%s) ORDER BY rolname', (list(helper.ROLES),)).fetchall()

            class Connection:
                def __init__(self, raw, fault): self.raw, self.fault, self.changes = raw, fault, 0
                def add_notice_handler(self, fn): self.raw.add_notice_handler(fn)
                def cursor(self): self.cur = self.raw.cursor(); return self
                def execute(self, query):
                    if isinstance(query, sql.Composed):
                        self.changes += 1
                        if self.fault == 'alter' and self.changes == 2:
                            raise RuntimeError('Synthetic second ALTER fault')
                    self.cur.execute(query)
                def fetchall(self): return self.cur.fetchall()
                def commit(self):
                    self.raw.commit()
                    if self.fault == 'commit': raise RuntimeError('Synthetic lost commit acknowledgement')
                def rollback(self): self.raw.rollback()
                def close(self): self.raw.close()

            class Adapter:
                def __init__(self, fault=None): self.fault = fault; self.sql = sql
                def connect(self, **kwargs):
                    # Verify production policy is still requested, then replace ONLY
                    # transport in this test adapter. Real helper has no host override.
                    assert kwargs['host'] == helper.HOST and kwargs['port'] == 5432
                    assert kwargs['user'] == 'publisher_owner' and kwargs['dbname'] == 'publisher_ledger'
                    assert kwargs['sslmode'] == 'verify-full' and kwargs['sslrootcert'] == str(ca)
                    assert kwargs['password'] == admin_password
                    local_kwargs = dict(kwargs, host='localhost', hostaddr='127.0.0.1', port=port)
                    self.connection = Connection(psycopg.connect(**local_kwargs), self.fault)
                    return self.connection

            def attempt(fault=None, approved=None):
                # Printable injection-shaped values remain data with actual Psycopg
                # composition and actual PostgreSQL parsing; never emit them.
                values = [secrets.token_urlsafe(32) + suffix for suffix in ("';SELECT/**/1;--", '\\backslash', '"quoted"')]
                answers = iter([admin_password, *[v for password in values for v in (password, password)]])
                adapter = Adapter(fault)
                outcome = helper.perform(approved or baseline, ca, adapter, lambda prompt: next(answers))
                return outcome, adapter.connection.changes

            STAGE = 'initial-state'
            initial = password_state()
            assert len(initial) == 3 and all(password is None and login is False for _, password, login in initial)
            STAGE = 'positive-composition'
            assert attempt() == (helper.STATUS_OK, 3)
            changed = password_state()
            assert all(password.startswith('SCRAM-SHA-256$') and login is False for _, password, login in changed)
            assert len({password for _, password, _ in changed}) == 3
            wrong = json.loads(json.dumps(baseline)); wrong['roles'][helper.ROLES[0]]['oid'] += 1000000
            STAGE = 'wrong-oid'
            assert attempt(approved=wrong) == (helper.STATUS_FAIL, 0)
            assert password_state() == changed
            STAGE = 'alter-rollback'
            assert attempt('alter') == (helper.STATUS_FAIL, 2)
            assert password_state() == changed
            STAGE = 'commit-ambiguity'
            assert attempt('commit') == (helper.STATUS_UNKNOWN, 3)
            after_unknown = password_state()
            assert after_unknown != changed and all(login is False for _, _, login in after_unknown)
            with psycopg.connect(**owner) as connection:
                STAGE = 'final-state'
                helper.verify(connection.cursor(), baseline)
                assert connection.execute('SELECT count(*) FROM meridian_publisher.reservations').fetchone() == (0,)
                assert connection.execute('SELECT count(*) FROM meridian_publisher.send_records').fetchone() == (0,)
            return version.strip()
        finally:
            # A failed start may still have left a postmaster; stop before deleting.
            if started or (data / 'postmaster.pid').exists():
                try:
                    command([str(pg_bin / 'pg_ctl'), '-D', str(data), '-w', '-t', '10', '-m', 'immediate', 'stop'], timeout=15)
                except BaseException:
                    STAGE = 'server-stop'
                    raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-local-pg16', action='store_true', required=True)
    parser.add_argument('--pg-bin', type=Path, required=True)
    args = parser.parse_args()
    try:
        version = run(args.pg_bin.resolve(strict=True))
    except BaseException:
        print(json.dumps({'outcome': 'LOCAL_PG16_INTEGRATION_FAILED', 'stage': STAGE}))
        return 1
    print(json.dumps({'outcome': 'LOCAL_PG16_INTEGRATION_PASSED', 'cases': 4,
                      'server': version, 'productionContacted': False, 'neonBehaviorVerified': False}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
