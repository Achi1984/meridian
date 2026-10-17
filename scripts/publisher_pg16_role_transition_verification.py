"""Private PG16.15 role-transaction integration fixture; no provider fallback.

Explicit CLI --pg-bin accepts reviewed local PostgreSQL tools only. No install,
external host/URL/password arguments, or action on import. A fresh 0700 cluster
listens only on 127.0.0.1 with ephemeral TLS certificate/key; actual libpq
verify-full TLS and real SQL transactions exercise the unchanged role driver.
The identical-looking owner/database/role names exist ONLY inside that cluster.

Binding/approval/prewrite/journal/phase services are TEST DOUBLES. In particular
the driver's production-named TARGET dict is syntactic test data, never the
connection target. This fixture does not authenticate authority, validate a
provider target, implement full Gate A or prove durable replay protection.
Actual transaction/TLS evidence is separate from those missing integrations.
Only already-installed psycopg3.3.6 and /usr/bin/openssl are accepted.
"""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import sysconfig
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'publisher_role_cycle.py': 'fb46bfbd8ba52546bec25a7bab3864ac96abbd34d1e10cf0e8ab1939dc39c230',
    'publisher_role_transition.py': '93bd773e584072227a659b836bbb7aa079eb9a86736ab6e5ef3e97e7cb98785a',
    'publisher_pg16_fixture_verification.py': 'e6907d86a45f766d288f41bba238b100767516247e5a56991df9f410d98a0871',
}
FAILURE = 'LOCAL_ROLE_TRANSITION_FIXTURE_FAILED_NO_PROVIDER_CLAIM'
CASES = ('activation_closure', 'mid_alter_rollback', 'commit_ack_loss', 'claim_direction')


def load_sources():
    modules = {}
    for filename, digest in PINS.items():
        path = ROOT / 'scripts' / filename
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0,os.getuid())
                    or info.st_mode & 0o022 or not 0 < info.st_size <= 262144):
                raise ValueError('source boundary')
            data = os.read(fd,262145)
        finally:
            os.close(fd)
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('source pin')
        name = filename[:-3]
        module = importlib.util.module_from_spec(importlib.util.spec_from_file_location(name,path))
        sys.modules[name] = module
        exec(compile(data,str(path),'exec'),module.__dict__)
        modules[name] = module
    return modules


def installed_driver():
    if importlib.metadata.version('psycopg') != '3.3.6':
        raise ValueError('psycopg version')
    spec = importlib.util.find_spec('psycopg')
    if spec is None or not spec.origin:
        raise ValueError('psycopg origin')
    origin = Path(spec.origin).resolve(strict=True)
    roots = [Path(sysconfig.get_paths()[k]).resolve(strict=True) for k in ('purelib','platlib')]
    if origin.name != '__init__.py' or origin.parent.name != 'psycopg' or not any(origin.is_relative_to(p) for p in roots):
        raise ValueError('psycopg origin')
    import psycopg
    return psycopg


def openssl_tool(helper):
    path = Path('/usr/bin/openssl')
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError('openssl boundary')
    version = helper.run([str(path),'version']).strip()
    if not version.startswith('OpenSSL ') or len(version) > 256:
        raise ValueError('openssl version')
    return str(path), version, hashlib.sha256(path.read_bytes()).hexdigest()


def reserve_port_number():
    # Release before postgres bind. A collision is fatal, never a reason to kill
    # an unrelated listener or retry on another port.
    with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1',0))
        return sock.getsockname()[1]


def connection_options(root, port, owner, database):
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError('local port')
    if owner not in ('fixture_admin','publisher_owner') or database not in ('postgres','publisher_ledger'):
        raise ValueError('local identity')
    return dict(host='127.0.0.1',hostaddr='127.0.0.1',port=port,user=owner,dbname=database,
                password='',passfile=str(root/'absent-passfile'),sslmode='verify-full',
                sslrootcert=str(root/'server.crt'),sslcert=str(root/'absent-client.crt'),
                sslkey=str(root/'absent-client.key'),sslcrl=str(root/'absent-crl'),
                connect_timeout=3,application_name='meridian-local-role-fixture',autocommit=True,
                options='-c search_path=pg_catalog -c createrole_self_grant= -c statement_timeout=5000 -c lock_timeout=1000')


class TransactionConnection:
    """Real psycopg autocommit connection; explicit SQL transaction boundaries."""
    def __init__(self, raw, pq, fault=None):
        self.raw, self.pq, self.fault = raw,pq,fault
        self.alters = 0
        self.commits = 0
        self.rollbacks = 0
        self.closed = False
        self.log = []
    @property
    def pgconn(self): return self.raw.pgconn
    def require_status(self, status):
        if self.raw.info.transaction_status != status:
            raise ValueError('transaction state')
    def cursor(self): return FixtureCursor(self,self.raw.cursor())
    def begin(self):
        self.require_status(self.pq.TransactionStatus.IDLE)
        self.raw.execute('BEGIN;')
        self.require_status(self.pq.TransactionStatus.INTRANS)
        self.log.append('BEGIN_INTRANS')
    def commit(self):
        self.require_status(self.pq.TransactionStatus.INTRANS)
        self.raw.execute('COMMIT;')
        self.commits += 1
        self.require_status(self.pq.TransactionStatus.IDLE)
        self.log.append('COMMIT_IDLE')
        if self.fault == 'commit_ack_loss':
            raise RuntimeError('synthetic lost commit acknowledgement')
    def rollback(self):
        state = self.raw.info.transaction_status
        if state in (self.pq.TransactionStatus.INTRANS,self.pq.TransactionStatus.INERROR):
            self.raw.execute('ROLLBACK;')
            self.rollbacks += 1
        elif state != self.pq.TransactionStatus.IDLE:
            raise ValueError('rollback state')
        self.require_status(self.pq.TransactionStatus.IDLE)
        self.log.append('ROLLBACK_OR_IDLE')
    def close(self):
        self.raw.close()
        if not self.raw.closed:
            raise ValueError('close state')
        self.closed = True
        self.log.append('CLOSED')


class FixtureCursor:
    def __init__(self, connection, cursor): self.connection,self.raw = connection,cursor
    def execute(self, sql):
        if sql.startswith('ALTER ROLE '):
            self.connection.alters += 1
            if self.connection.fault == 'mid_alter_rollback' and self.connection.alters == 2:
                # First ALTER really executed; the second fails before transmission.
                raise RuntimeError('synthetic second ALTER failure')
        return self.raw.execute(sql)
    def fetchmany(self, limit): return self.raw.fetchmany(limit)


def test_binding(driver, direction, cycle_id, operation_id):
    return {'operation_id':operation_id,'cycle_id':cycle_id,'direction':direction,
            'source_sha':'1'*40,'baseline_sha256':'2'*64,'manifest_sha256':driver.MANIFEST,
            'workflow_sha':'3'*40,'approval_ref':'1','target':dict(driver.TARGET)}


class TestServices:
    """In-memory claims and fabricated authority fields: never operational services."""
    def __init__(self, driver, psycopg, options, binding, baseline, claims, fault=None):
        self.driver,self.psycopg,self.options = driver,psycopg,options
        self.binding,self.baseline,self.claims,self.fault = binding,baseline,claims,fault
        self.connections = []
        self.phase_log = []
    def expected_binding(self): return self.binding
    def claim(self, binding):
        key = (binding['cycle_id'],binding['direction'])
        if key in self.claims: return False
        self.claims.add(key)
        return True
    def connect(self):
        raw = self.psycopg.connect(**self.options)
        connection = TransactionConnection(raw,self.psycopg.pq,self.fault)
        self.connections.append(connection)
        return connection
    def prewrite(self, connection, binding):
        # Only local identity + role observations, NOT full Gate A/authority.
        connection.require_status(self.psycopg.pq.TransactionStatus.INTRANS)
        self.driver.observe_roles(connection,self.baseline,binding['direction']=='closure')
    def phase(self, token): self.phase_log.append(token.decode())
    def record(self, binding, stage, status): pass


def assert_local_identity(admin, data, port):
    row = admin.execute("SELECT current_setting('server_version_num')::integer, current_user, current_database(), pg_catalog.host(pg_catalog.inet_server_addr()), inet_server_port(), current_setting('data_directory'), current_setting('listen_addresses')").fetchone()
    if row != (160015,'fixture_admin','postgres','127.0.0.1',port,str(data),'127.0.0.1') or admin.pgconn.ssl_in_use is not True:
        raise ValueError('private server identity')


def build_roles(admin, driver):
    admin.execute('CREATE ROLE publisher_owner LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;')
    admin.execute('CREATE DATABASE publisher_ledger OWNER publisher_owner;')
    for role in driver.cycle.ROLES:
        admin.execute('CREATE ROLE '+role+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;')
        admin.execute('GRANT '+role+' TO publisher_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;')
    owner = admin.execute("SELECT oid::bigint FROM pg_roles WHERE rolname='publisher_owner'").fetchone()[0]
    rows = admin.execute("SELECT r.rolname,r.oid::bigint,m.grantor::bigint FROM pg_roles r JOIN pg_auth_members m ON m.roleid=r.oid WHERE m.member=%s",(owner,)).fetchall()
    baseline = {'owner_oid':owner,'roles':{name:{'oid':oid,'grantor_oid':grantor} for name,oid,grantor in rows}}
    driver.cycle.validate_baseline(baseline)
    return baseline


def cleanup_cluster(server, all_services, admin):
    close_failed = False
    for services in all_services:
        for connection in services.connections:
            try: connection.raw.close()
            except BaseException: close_failed = True
    if admin is not None:
        try: admin.close()
        except BaseException: close_failed = True
    try:
        if server.poll() is None: os.killpg(server.pid,signal.SIGQUIT)
        server.wait(timeout=5)
    except BaseException:
        try: os.killpg(server.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        server.wait(timeout=3)
        raise ValueError('private server cleanup indeterminate') from None
    if close_failed: raise ValueError('private connection cleanup indeterminate')


def verify(directory):
    if sys.platform != 'linux' or os.getuid() == 0:
        raise ValueError('unprivileged Linux required')
    if any(name.startswith('PG') or name == 'DATABASE_URL' for name in os.environ):
        raise ValueError('libpq environment forbidden')
    modules = load_sources()
    helper = modules['publisher_pg16_fixture_verification']
    driver = modules['publisher_role_transition']
    psycopg = installed_driver()
    tools,versions,digests = helper.binaries(directory)
    openssl,openssl_version,openssl_sha = openssl_tool(helper)
    report = None
    with tempfile.TemporaryDirectory(prefix='meridian-role-pg16-',dir='/tmp') as temporary:
        root = Path(temporary); root.chmod(0o700)
        data,sock = root/'data',root/'socket'; sock.mkdir(mode=0o700)
        helper.run([tools['initdb'],'-D',str(data),'--username=fixture_admin','--auth=trust','--no-locale','--encoding=UTF8'],timeout=20)
        helper.run([openssl,'req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1',
                    '-subj','/CN=meridian-local-role-fixture','-addext','subjectAltName=IP:127.0.0.1',
                    '-keyout',str(root/'server.key'),'-out',str(root/'server.crt')],timeout=20)
        (root/'server.key').chmod(0o600); (root/'server.crt').chmod(0o600)
        (data/'pg_hba.conf').write_text('local all all reject\nhostssl all all 127.0.0.1/32 trust\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n')
        (data/'pg_hba.conf').chmod(0o600)
        port = reserve_port_number()
        server = subprocess.Popen([tools['postgres'],'-D',str(data),'-h','127.0.0.1','-p',str(port),'-k',str(sock),
                    '-c','unix_socket_permissions=0700','-c','max_connections=10','-c','ssl=on',
                    '-c','ssl_cert_file='+str(root/'server.crt'),'-c','ssl_key_file='+str(root/'server.key')],
                    stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                    env=helper.ENV,start_new_session=True,close_fds=True)
        admin = None
        all_services = []
        try:
            admin_options = connection_options(root,port,'fixture_admin','postgres')
            deadline = time.monotonic()+10
            while True:
                if server.poll() is not None: raise ValueError('private postgres exited')
                try:
                    admin = psycopg.connect(**admin_options)
                    break
                except psycopg.OperationalError:
                    if time.monotonic() >= deadline: raise ValueError('private postgres startup timeout') from None
                    time.sleep(0.05)
            assert_local_identity(admin,data,port)
            baseline = build_roles(admin,driver)
            options = connection_options(root,port,'publisher_owner','publisher_ledger')
            claims = set()
            def observe(login):
                with psycopg.connect(**options) as raw:
                    return driver.observe_roles(TransactionConnection(raw,psycopg.pq),baseline,login)
            def invoke(direction,cycle_number,events,fault=None,operation_number=None):
                binding = test_binding(driver,direction,format(cycle_number,'032x'),format(operation_number or (cycle_number*2+(direction=='closure')),'032x'))
                services = TestServices(driver,psycopg,options,binding,baseline,claims,fault)
                all_services.append(services)
                result = driver.drive_transition(binding,baseline,events,services)
                if any(not c.closed for c in services.connections): raise ValueError('driver did not close')
                return result,services
            successes = []
            first,services = invoke('activation',1,[])
            if first['outcome'] != 'CONFIRMED' or first['state']['phase'] != 'READY': raise ValueError('activation result')
            observe(True)
            if services.connections[0].log != ['BEGIN_INTRANS','COMMIT_IDLE','ROLLBACK_OR_IDLE','CLOSED']:
                raise ValueError('real transaction sequence')
            duplicate,again = invoke('activation',1,[],operation_number=99)
            if duplicate['outcome'] != 'BLOCKED' or again.connections: raise ValueError('same-direction claim reused')
            closing_events = first['transcript']+[{'type':'cancel_dispatch'}]
            closed,services = invoke('closure',1,closing_events)
            if closed['outcome'] != 'CONFIRMED' or closed['state']['phase'] != 'AWAITING_SESSIONS': raise ValueError('closure result')
            observe(False)
            successes.extend(['activation_closure','claim_direction'])
            rolled,services = invoke('activation',2,[],fault='mid_alter_rollback')
            if (rolled['outcome'] != 'INDETERMINATE' or services.connections[0].alters != 2
                    or services.connections[0].commits != 0 or services.connections[0].rollbacks != 1):
                raise ValueError('partial ALTER rollback result')
            observe(False)
            successes.append('mid_alter_rollback')
            lost,services = invoke('activation',3,[],fault='commit_ack_loss')
            if (lost['outcome'] != 'INDETERMINATE' or not lost['state']['reconciliationRequired']
                    or services.connections[0].commits != 1 or services.connections[0].rollbacks != 0):
                raise ValueError('lost commit result')
            actual_enabled = observe(True)
            blocked,again = invoke('activation',3,[],operation_number=100)
            if blocked['outcome'] != 'BLOCKED' or again.connections: raise ValueError('lost commit replay')
            # Explicit LOCAL fixture reconciliation, never automatic driver retry.
            reconciled = lost['transcript']+[{'type':'reconciled','snapshot':actual_enabled,'login':True,'cleanup_confirmed':True}]
            closed,_ = invoke('closure',3,reconciled)
            if closed['outcome'] != 'CONFIRMED': raise ValueError('reconciled local closure')
            observe(False)
            successes.append('commit_ack_loss')
            sessions = admin.execute("SELECT count(*) FROM pg_stat_activity WHERE usename='publisher_owner'").fetchone()[0]
            if sessions != 0: raise ValueError('fixture sessions remain')
            report = {'kind':'LOCAL_PG16_ROLE_TRANSITION_INTEGRATION','serverVersionNum':160015,
                      'psycopgVersion':psycopg.__version__,'toolVersions':versions,'toolSha256':digests,
                      'opensslVersion':openssl_version,'opensslSha256':openssl_sha,'sourceSha256':PINS,
                      'casesPassed':sorted(successes),'realLibpqTlsVerified':True,'realSqlTransactionsVerified':True,
                      'localRoleSessionsRemaining':sessions,'bindingApprovalJournalPrewriteMocked':True,
                      'productionTargetValidated':False,'fullGateAEstablished':False,
                      'durableReplayProtectionProven':False,'activationAuthorized':False}
        finally:
            cleanup_cluster(server,all_services,admin)
    report['privateClusterStoppedAndRemoved'] = True
    return report


def main(argv=None):
    def interrupted(unused_signum,unused_frame): raise KeyboardInterrupt()
    prior = signal.signal(signal.SIGTERM,interrupted)
    try:
        class QuietParser(argparse.ArgumentParser):
            def error(self,unused_message): raise ValueError('arguments')
        parser = QuietParser(allow_abbrev=False)
        parser.add_argument('--pg-bin',type=Path,required=True)
        args = parser.parse_args(argv)
        print(json.dumps(verify(args.pg_bin),sort_keys=True,separators=(',',':')))
        return 0
    except BaseException:
        print(FAILURE)
        return 1
    finally:
        signal.signal(signal.SIGTERM,prior)


if __name__ == '__main__': sys.exit(main())
