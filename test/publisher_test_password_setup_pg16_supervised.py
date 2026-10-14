"""Opt-in local PG16 + real-driver + supervisor composition; synthetic data only.

python -I test/publisher_test_password_setup_pg16_supervised.py --run-local-pg16 --pg-bin /path/to/pg16/bin
The stable unsupervised harness is intentionally unchanged. This companion owns
its temporary cluster. It never connects to Neon or accepts credentials in args.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[1]
STAGE = 'runtime'
BUDGETS = {'setup': 10, 'connect': 5, 'mutation': 5, 'cleanup': 2, 'exit': 2}


def helper_module():
    spec = importlib.util.spec_from_file_location('supervised_local_helper', REPO / 'scripts/publisher_test_password_setup.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def worker_entry(manifest_path, secret_fd):
    # This fresh interpreter has never loaded the driver or opened a DB session.
    if sys.flags.isolated != 1 or any(name.startswith('psycopg') for name in sys.modules):
        return 1
    helper = helper_module()
    manifest = json.loads(manifest_path.read_text())  # Non-secret fixture metadata only.
    if (set(manifest) != {'ca', 'port', 'baseline', 'case'}
            or type(manifest['port']) is not int or not 0 < manifest['port'] < 65536
            or manifest['case'] not in ('success', 'lost_ack')
            or not Path(manifest['ca']).is_absolute()):
        return 1

    def worker(phase):
        # Bounded SETUP includes pipe reads, CA parsing and native-driver import.
        # The supervisor inherits this FD but never reads/deserializes its data.
        try:
            payload = bytearray()
            while True:
                block = os.read(secret_fd, 4096)
                if not block: break
                payload.extend(block)
                if len(payload) > 4096: raise ValueError('fixture payload too large')
        finally:
            os.close(secret_fd)
        synthetic = json.loads(payload)
        ca = Path(manifest['ca'])
        helper.load_ca(ca)
        import psycopg
        from psycopg import sql
        if psycopg.__version__ != '3.3.6': raise ValueError('driver version')
        helper.validate_baseline(manifest['baseline'])
        class Connection:
            def __init__(self, raw): self.raw = raw
            def add_notice_handler(self, handler): self.raw.add_notice_handler(handler)
            def cursor(self): return self.raw.cursor()
            def rollback(self): self.raw.rollback()
            def close(self): self.raw.close()
            def commit(self):
                self.raw.commit()
                if manifest['case'] == 'lost_ack':
                    raise RuntimeError('synthetic acknowledgement loss after real commit')
        class Adapter:
            def __init__(self): self.sql = sql
            def connect(self, **kwargs):
                expected = dict(host=helper.HOST, port=5432, dbname='publisher_ledger', user='publisher_owner',
                                password=synthetic['admin'], sslmode='verify-full', sslrootcert=str(ca),
                                connect_timeout=10, autocommit=False,
                                options='-c search_path=pg_catalog -c statement_timeout=10000 -c lock_timeout=2000')
                if kwargs != expected: raise ValueError('production policy mismatch')
                # Only this test adapter changes transport. TLS and every other
                # requested policy remain those of the real production helper.
                local = dict(kwargs, host='localhost', hostaddr='127.0.0.1', port=manifest['port'])
                return Connection(psycopg.connect(**local))
        answers = iter([synthetic['admin'], *[value for password in synthetic['passwords'] for value in (password, password)]])
        return helper.perform(manifest['baseline'], ca, Adapter(), lambda prompt: next(answers), phase)

    try:
        if any(name.startswith('psycopg') for name in sys.modules):
            raise RuntimeError('driver loaded before supervisor')
        outcome = helper.supervise(worker, BUDGETS)
    finally:
        os.close(secret_fd)  # Parent copy; child has a distinct descriptor table.
    if not helper.emit_status(outcome): return 2
    return {helper.STATUS_OK: 0, helper.STATUS_FAIL: 1, helper.STATUS_UNKNOWN: 2}[outcome]


def run_local(pg_bin):
    global STAGE
    if os.geteuid() == 0 or sys.flags.isolated != 1: raise RuntimeError('nonroot isolated runtime required')
    if any(key.startswith(('PG', 'PSYCOPG', 'SSL_CERT_', 'OTEL_')) or key in
           {'SSLKEYLOGFILE', 'OPENSSL_CONF', 'LD_PRELOAD', 'LD_LIBRARY_PATH'} for key in os.environ):
        raise RuntimeError('ambient client configuration')
    import psycopg
    from psycopg import sql
    if psycopg.__version__ != '3.3.6': raise RuntimeError('driver version')
    helper = helper_module()
    def command(argv, timeout=30):
        return subprocess.run(argv, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    version = command([str(pg_bin / 'postgres'), '--version']).stdout.decode().strip()
    if not version.startswith('postgres (PostgreSQL) 16.'): raise RuntimeError('server version')
    with tempfile.TemporaryDirectory(prefix='meridian-supervised-pg16-') as directory:
        root = Path(directory); data = root / 'data'; ca = root / 'ca.pem'; key = root / 'key.pem'
        STAGE = 'initdb'
        command([str(pg_bin / 'initdb'), '-D', str(data), '--username=fixture_admin', '--auth-local=trust',
                 '--auth-host=scram-sha-256', '--no-locale', '--encoding=UTF8'])
        STAGE = 'certificate'
        command(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                 '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
                 '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', str(key), '-out', str(ca)])
        key.chmod(0o600)
        with socket.socket() as allocation:
            allocation.bind(('127.0.0.1', 0)); port = allocation.getsockname()[1]
        with (data / 'postgresql.conf').open('a') as config:
            config.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories='{root}'\n"
                         f"ssl=on\nssl_cert_file='{ca}'\nssl_key_file='{key}'\npassword_encryption='scram-sha-256'\nlog_statement='none'\n")
        started = False
        try:
            STAGE = 'server-start'
            command([str(pg_bin / 'pg_ctl'), '-D', str(data), '-l', str(root / 'server.log'), '-w', '-t', '15', 'start'])
            started = True
            local = dict(host=str(root), port=port, user='fixture_admin', dbname='postgres', connect_timeout=5)
            admin = secrets.token_urlsafe(36)
            STAGE = 'synthetic-fixture'
            with psycopg.connect(**local, autocommit=True) as connection:
                connection.execute(sql.SQL('CREATE ROLE publisher_owner LOGIN CREATEROLE NOSUPERUSER PASSWORD {}').format(sql.Literal(admin)))
                connection.execute('CREATE DATABASE publisher_ledger OWNER publisher_owner')
            owner = dict(host='localhost', hostaddr='127.0.0.1', port=port, dbname='publisher_ledger',
                         user='publisher_owner', password=admin, sslmode='verify-full', sslrootcert=str(ca),
                         connect_timeout=5, options='-c search_path=pg_catalog -c statement_timeout=10000')
            with psycopg.connect(**owner, autocommit=True) as connection:
                for filename in ('publication-ledger.sql', 'publication-send-record.sql'):
                    connection.execute((REPO / 'docs/autonomy/event-adapter/review-binding/fixtures' / filename).read_text())
                for role in helper.ROLES:
                    connection.execute(sql.SQL('CREATE ROLE {} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT').format(sql.Identifier(role)))
                owner_oid = connection.execute("SELECT oid FROM pg_catalog.pg_roles WHERE rolname='publisher_owner'").fetchone()[0]
                rows = connection.execute('SELECT r.rolname,r.oid,m.grantor FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_auth_members m ON m.roleid=r.oid WHERE r.rolname=ANY(%s)', (list(helper.ROLES),)).fetchall()
                baseline = {'owner_oid': owner_oid, 'roles': {name: {'oid': oid, 'grantor_oid': grantor} for name, oid, grantor in rows}}
                helper.validate_baseline(baseline)
            def state():
                with psycopg.connect(**local) as connection:
                    return connection.execute('SELECT rolname,rolpassword,rolcanlogin FROM pg_catalog.pg_authid WHERE rolname=ANY(%s) ORDER BY rolname', (list(helper.ROLES),)).fetchall()
            previous = state()
            assert len(previous) == 3 and all(password is None and login is False for _, password, login in previous)
            for case, expected_code, expected_status in [('success', 0, helper.STATUS_OK), ('lost_ack', 2, helper.STATUS_UNKNOWN)]:
                STAGE = 'supervised-' + case
                manifest = root / 'manifest.json'
                manifest.write_text(json.dumps({'port': port, 'ca': str(ca), 'baseline': baseline, 'case': case}))
                values = [secrets.token_urlsafe(32) + suffix for suffix in ("';SELECT/**/1;--", '\\quoted', '"quoted"')]
                payload = json.dumps({'admin': admin, 'passwords': values}).encode()
                if len(payload) > 4096: raise RuntimeError('fixture payload bound')
                read_fd, write_fd = os.pipe()
                try:
                    os.write(write_fd, payload); os.close(write_fd); write_fd = None
                    result = subprocess.run([sys.executable, '-I', str(Path(__file__).resolve()), '--local-worker',
                                             '--manifest', str(manifest), '--secret-fd', str(read_fd)],
                                            pass_fds=(read_fd,), capture_output=True, timeout=30)
                finally:
                    os.close(read_fd)
                    if write_fd is not None: os.close(write_fd)
                assert result.returncode == expected_code and result.stdout == (expected_status + '\n').encode() and result.stderr == b''
                current = state()
                assert len(current) == 3 and all(password.startswith('SCRAM-SHA-256$') and login is False for _, password, login in current)
                assert len({password for _, password, _ in current}) == 3
                assert all(before[1] != after[1] for before, after in zip(previous, current))
                with psycopg.connect(**owner) as connection:
                    helper.verify(connection.cursor(), baseline)
                    for table in ('reservations', 'send_records'):
                        assert connection.execute(sql.SQL('SELECT count(*) FROM meridian_publisher.{}').format(sql.Identifier(table))).fetchone() == (0,)
                previous = current
            return version
        finally:
            if started or (data / 'postmaster.pid').exists():
                try:
                    command([str(pg_bin / 'pg_ctl'), '-D', str(data), '-w', '-t', '10', '-m', 'immediate', 'stop'], 15)
                except BaseException:
                    STAGE = 'server-stop'
                    raise


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--run-local-pg16', action='store_true')
    mode.add_argument('--local-worker', action='store_true')
    parser.add_argument('--pg-bin', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--secret-fd', type=int)
    args = parser.parse_args()
    if args.local_worker:
        try:
            return worker_entry(args.manifest, args.secret_fd)
        except BaseException:
            return 1  # Never expose credential/SQL/connection errors.
    try:
        version = run_local(args.pg_bin.resolve(strict=True))
    except BaseException:
        print(json.dumps({'outcome': 'LOCAL_SUPERVISED_PG16_FAILED', 'stage': STAGE}))
        return 1
    print(json.dumps({'outcome': 'LOCAL_SUPERVISED_PG16_PASSED', 'cases': 2,
                      'server': version, 'productionContacted': False, 'neonBehaviorVerified': False}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
