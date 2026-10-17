"""Private PG16.15 role-transaction integration fixture; no provider fallback.

Explicit CLI --pg-bin accepts reviewed local PostgreSQL tools only. No install,
external host/URL/password arguments, or action on import. A fresh 0700 cluster
listens only on 127.0.0.1 with ephemeral TLS certificate/key; actual libpq
verify-full TLS and real SQL transactions exercise the unchanged role driver.
The identical-looking owner/database/role names exist ONLY inside that cluster.

Binding/approval and closure transcripts are TEST DOUBLES. Phase supervision
uses the pinned real parent/child adapter; all connection/journal/prewrite handles
are created in the child, after all parent database handles are verified closed.
The real fixed-root parent coordinator persists attempts/completion and serializes
parent launches. Distinct synthetic test cycles each have their own private anchor;
this is not global replay or externally acknowledged completion proof. Catalog/grant/role prewrite
uses the pinned real adapter on the same transaction. Claim and record use
the real local fsynced journal in this disposable root; no reconciliation override
is supplied. Uncertain activation blocks closure even with model-ready input. In particular
the driver's production-named TARGET dict is syntactic test data, never the
connection target. This fixture does not authenticate authority, validate a
provider target, establish full Gate A or prove durable replay protection.
Actual transaction/TLS evidence is separate from those missing integrations.
Only already-installed psycopg3.3.6 and /usr/bin/openssl are accepted.
"""
import argparse
import contextlib
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
    'publisher_role_journal.py': '3789410d4d67cc12db3404bd1cf58b4b6c0bb8633646b849e9c8106dec046425',
    'publisher_role_supervision.py': '80cfd10ab5c90feb93fab1bcde6963136074994eb54cdf2a2176acc8a52f90fe',
    'publisher_parent_completion.py': '724e99f08c9b3ad96c4ff426bc4318ed317897018fdc8851e794f6c394bce585',
    'publisher_role_prewrite.py': 'a5e62a0e1c22a16eec057b65b446873a0b9f96abfe78ce78210caabc46defc97',
    'publisher_pg16_fixture_verification.py': 'e6907d86a45f766d288f41bba238b100767516247e5a56991df9f410d98a0871',
}
FAILURE = 'LOCAL_ROLE_TRANSITION_FIXTURE_FAILED_NO_PROVIDER_CLAIM'
CASES = ('activation_closure', 'mid_alter_rollback', 'commit_ack_loss', 'claim_direction', 'prewrite_grant_drift', 'prewrite_catalog_drift', 'supervised_mutation_timeout', 'parent_completion_boundary')


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
        result=self.raw.execute(sql)
        if (sql.startswith('ALTER ROLE ') and self.connection.fault=='mutation_timeout'
                and self.connection.alters==1):
            # Actual first ALTER has returned INTRANS; parent must kill this child.
            self.connection.after_first_alter()
            os.kill(os.getpid(),signal.SIGSTOP)
        return result
    def fetchmany(self, limit): return self.raw.fetchmany(limit)


def test_binding(driver, direction, cycle_id, operation_id):
    return {'operation_id':operation_id,'cycle_id':cycle_id,'direction':direction,
            'source_sha':'1'*40,'baseline_sha256':'2'*64,'manifest_sha256':driver.MANIFEST,
            'workflow_sha':'3'*40,'approval_ref':'1','target':dict(driver.TARGET)}


class TestServices:
    """Real local journal/catalog prewrite; fabricated authority/phase, never operational."""
    def __init__(self, driver, psycopg, options, binding, baseline, journal, fault=None, prewrite=None):
        self.driver,self.psycopg,self.options = driver,psycopg,options
        self.binding,self.baseline,self.journal,self.fault = binding,baseline,journal,fault
        self.catalog_prewrite=prewrite
        self.connections = []
        self.phase_log = []
        self.after_first_alter = None
    def expected_binding(self): return self.binding
    def claim(self, binding): return self.journal.claim(binding)
    def connect(self):
        raw = self.psycopg.connect(**self.options)
        connection = TransactionConnection(raw,self.psycopg.pq,self.fault)
        connection.after_first_alter=self.after_first_alter
        self.connections.append(connection)
        return connection
    def prewrite(self, connection, binding):
        if self.catalog_prewrite is None: raise ValueError('catalog prewrite adapter missing')
        return self.catalog_prewrite(connection,binding)
    def phase(self, token): self.phase_log.append(token.decode())
    def record(self, binding, stage, status): return self.journal.record(binding,stage,status)


def prepare_services(driver,psycopg,options,binding,baseline,journal_root,journal_module,prewrite_module,all_services,fault=None):
    # Validate/load inert prewrite inputs before acquiring any journal descriptors.
    prewrite=prewrite_module.CatalogPrewrite(baseline)
    journal=journal_module.LocalRoleJournal(journal_root)
    try:
        services=TestServices(driver,psycopg,options,binding,baseline,journal,fault,prewrite)
        all_services.append(services)
        return services
    except BaseException:
        journal.close()
        raise


def invoke_driver(driver, services, baseline, events):
    """Release the lifetime journal lock even if driver/cleanup/reporting raises."""
    try:
        return driver.drive_transition(services.binding,baseline,events,services)
    finally:
        failed=False
        try:
            for connection in services.connections:
                try:
                    if not connection.raw.closed: connection.raw.close()
                except BaseException: failed=True
        finally:
            services.journal.close()
        if failed: raise ValueError('driver connection cleanup indeterminate')



def close_services(services):
    """Every connection close precedes journal release; one failure skips neither."""
    failed=False
    try:
        for connection in services.connections:
            try:
                if not connection.raw.closed: connection.raw.close()
                if connection.raw.closed is not True: failed=True
            except BaseException: failed=True
    finally:
        try: services.journal.close()
        except BaseException: failed=True
    if failed: raise ValueError('child resource cleanup')


def write_diagnostic(path,services):
    # Synthetic diagnostics only; never promote these to supervisor/authority proof.
    value={'kind':'LOCAL_CHILD_DIAGNOSTIC','pid':os.getpid(),
           'prewriteVerified':services.catalog_prewrite.last_report is not None,
           'connections':[{'alters':c.alters,'commits':c.commits,'rollbacks':c.rollbacks,
                           'closed':c.closed,'log':c.log} for c in services.connections]}
    data=json.dumps(value,sort_keys=True,separators=(',',':')).encode()
    if len(data)>8192: raise ValueError('diagnostic size')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        if os.write(fd,data)!=len(data): raise ValueError('diagnostic short write')
    finally: os.close(fd)


def read_diagnostic(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid()
                or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1
                or not 0<info.st_size<=8192): raise ValueError('diagnostic boundary')
        data=os.read(fd,8193)
    finally: os.close(fd)
    if len(data)!=info.st_size: raise ValueError('diagnostic read')
    def pairs(items):
        result={}
        for key,value in items:
            if key in result: raise ValueError('diagnostic duplicate')
            result[key]=value
        return result
    value=json.loads(data,object_pairs_hook=pairs)
    if (type(value) is not dict or set(value)!={'kind','pid','prewriteVerified','connections'}
            or value['kind']!='LOCAL_CHILD_DIAGNOSTIC' or type(value['pid']) is not int
            or value['pid']<=0 or value['pid']==os.getpid() or type(value['prewriteVerified']) is not bool
            or type(value['connections']) is not list or len(value['connections'])>1):
        raise ValueError('diagnostic schema')
    for row in value['connections']:
        if (type(row) is not dict or set(row)!={'alters','commits','rollbacks','closed','log'}
                or any(type(row[k]) is not int or not 0<=row[k]<=3 for k in ('alters','commits','rollbacks'))
                or type(row['closed']) is not bool or type(row['log']) is not list or len(row['log'])>5
                or any(type(item) is not str or item not in ('BEGIN_INTRANS','COMMIT_IDLE','ROLLBACK_OR_IDLE','CLOSED') for item in row['log'])):
            raise ValueError('diagnostic connection schema')
    return value


def supervised_invoke(modules,psycopg,options,binding,baseline,events,journal_root,receipt,parent_handles,fault=None,parent_root=None):
    if any(raw.closed is not True for raw in parent_handles):
        raise ValueError('parent connection still open before fork')
    parent_pid=os.getpid()
    @contextlib.contextmanager
    def factory(phase):
        if os.getpid()==parent_pid: raise ValueError('services must be child only')
        services=prepare_services(modules['publisher_role_transition'],psycopg,options,binding,baseline,
            journal_root,modules['publisher_role_journal'],modules['publisher_role_prewrite'],[],fault)
        services.phase=phase
        if fault=='mutation_timeout':
            services.after_first_alter=lambda: write_diagnostic(receipt.with_suffix('.timeout'),services)
        try: yield services
        finally:
            close_services(services)
            write_diagnostic(receipt,services)
            if fault=='parent_completion_boundary':
                # Local-only storage boundary fault AFTER real SQL/resource cleanup.
                parent_root.chmod(0o500)
    budgets=None
    if fault=='mutation_timeout':
        budgets={'setup':5,'connect':15,'mutation':0.3,'cleanup':3,'exit':3}
    return modules['publisher_parent_completion'].run_attempt(
        parent_root,binding,baseline,events,factory,_test_budgets=budgets)


@contextlib.contextmanager
def parent_connection(psycopg,options,handles):
    raw=psycopg.connect(**options)
    handles.append(raw)
    try: yield raw
    finally:
        raw.close()
        if raw.closed is not True: raise ValueError('parent close unconfirmed')


def wait_for_no_owner_sessions(psycopg,admin_options,handles):
    # Query as fixture_admin, so the observer itself cannot inflate owner count.
    deadline=time.monotonic()+5
    while True:
        with parent_connection(psycopg,admin_options,handles) as admin:
            count=admin.execute("SELECT count(*) FROM pg_stat_activity WHERE usename='publisher_owner'").fetchone()[0]
        if type(count) is not int or count<0: raise ValueError('session observation')
        if count==0: return 0
        if time.monotonic()>=deadline: raise ValueError('fixture sessions remain')
        time.sleep(0.05)

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


GRANT_DOCUMENT_SHA256='47095db6ce7d991bd46cbdd7143cc38e7fd82dfa2be5369872d348a687353957'


def fixture_schema_and_grants(helper):
    # Extract only the exact reviewed grant block, never any surrounding setup.
    unused_inspector,fixtures=helper.load_inspector()
    path=ROOT/'docs/autonomy/PUBLISHER_DATABASE_ROLE_SETUP.md'
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0,os.getuid())
                or info.st_mode & 0o022 or not 0<info.st_size<=262144):
            raise ValueError('fixture grant document boundary')
        data=os.read(fd,262145)
    finally: os.close(fd)
    if len(data)!=info.st_size or hashlib.sha256(data).hexdigest()!=GRANT_DOCUMENT_SHA256:
        raise ValueError('fixture grant document pin')
    grants=data.decode().split('## Reviewable grant proposal',1)[1].split('```sql\n',1)[1].split('```',1)[0]
    return fixtures,grants


def cleanup_cluster(server, all_services, admin):
    close_failed = False
    for services in all_services:
        for connection in services.connections:
            try: connection.raw.close()
            except BaseException: close_failed = True
        try: services.journal.close()
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
    journal_module = modules['publisher_role_journal']
    prewrite_module = modules['publisher_role_prewrite']
    fixtures,grants=fixture_schema_and_grants(helper)
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
        parent_handles = []
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
            parent_handles.append(admin)
            assert_local_identity(admin,data,port)
            baseline = build_roles(admin,driver)
            options = connection_options(root,port,'publisher_owner','publisher_ledger')
            with parent_connection(psycopg,options,parent_handles) as owner:
                noticed=[]
                owner.add_notice_handler(lambda unused: noticed.append(True))
                for fixture in fixtures: owner.execute(fixture)
                owner.execute(grants)
                if noticed: raise ValueError('fixture setup notice')
            admin.close()
            if admin.closed is not True: raise ValueError('setup admin close')
            journal_root=root/'journal'
            journal_root.mkdir(mode=0o700)
            parent_roots={n:root/('parent-'+str(n)) for n in range(1,8)}
            for anchor in parent_roots.values(): anchor.mkdir(mode=0o700)
            def observe(login):
                with parent_connection(psycopg,options,parent_handles) as raw:
                    return driver.observe_roles(TransactionConnection(raw,psycopg.pq),baseline,login)
            def invoke(direction,cycle_number,events,fault=None,operation_number=None):
                binding = test_binding(driver,direction,format(cycle_number,'032x'),format(operation_number or (cycle_number*2+(direction=='closure')),'032x'))
                receipt=root/('diagnostic-'+binding['operation_id']+'.json')
                result=supervised_invoke(modules,psycopg,options,binding,baseline,events,journal_root,receipt,parent_handles,fault,parent_roots[cycle_number])
                wait_for_no_owner_sessions(psycopg,admin_options,parent_handles)
                diagnostic=read_diagnostic(receipt) if receipt.exists() else None
                if diagnostic is not None:
                    with contextlib.suppress(ChildProcessError):
                        os.waitpid(diagnostic['pid'],os.WNOHANG)
                        raise ValueError('supervisor did not reap diagnostic child')
                if not result['supervisorInvoked'] and diagnostic is not None: raise ValueError('prefork rejection created diagnostic')
                if result['outcome']=='CONFIRMED' and (diagnostic is None or result['parentCompletionRecorded'] is not True
                        or result['parentObservedConfirmedChildExit'] is not True): raise ValueError('confirmed parent evidence missing')
                return result,diagnostic
            def require_uncertain_journal(cycle_number):
                path=journal_root/format(cycle_number,'032x')/'activation.03-finished.json'
                record=json.loads(path.read_text())
                if record['stage']!='finished' or record['status']!='INDETERMINATE':
                    raise ValueError('uncertainty journal missing')
            successes = []
            before=observe(False)
            first,diagnostic = invoke('activation',1,[])
            if first['outcome'] != 'CONFIRMED': raise ValueError('activation result')
            after=observe(True)
            if diagnostic['connections'][0]['log'] != ['BEGIN_INTRANS','COMMIT_IDLE','ROLLBACK_OR_IDLE','CLOSED']:
                raise ValueError('real transaction sequence')
            duplicate,again = invoke('activation',1,[],operation_number=99)
            if duplicate['supervisorInvoked'] is not False or again is not None: raise ValueError('same-direction claim reused')
            # Synthetic test transcript, never authenticated child evidence or authority.
            closing_events=[{'type':'precheck','snapshot':before},{'type':'activation_started'},
                {'type':'activation_committed'},{'type':'activation_verified','snapshot':after},
                {'type':'activation_cleanup','clean':True},{'type':'cancel_dispatch'}]
            closed,diagnostic = invoke('closure',1,closing_events)
            if closed['outcome'] != 'CONFIRMED': raise ValueError('closure result')
            observe(False)
            if not diagnostic['prewriteVerified']:
                raise ValueError('closure catalog prewrite missing')
            successes.extend(['activation_closure','claim_direction'])
            parent_active,diagnostic=invoke('activation',7,[])
            if parent_active['outcome']!='CONFIRMED': raise ValueError('parent fault activation')
            observe(True)
            try:
                parent_failed,diagnostic=invoke('closure',7,closing_events,fault='parent_completion_boundary')
                if (parent_failed['outcome']!='INDETERMINATE' or parent_failed['supervisorInvoked'] is not True
                        or parent_failed['parentObservedConfirmedChildExit'] is not True
                        or parent_failed['parentCompletionRecorded'] is not False or diagnostic is None):
                    raise ValueError('parent completion fault not detected')
            finally:
                # Restore only the deliberately changed test permission; NEVER
                # delete/overwrite attempt or terminal evidence, nor reset a slot.
                parent_roots[7].chmod(0o700)
            observe(False)
            if ((parent_roots[7]/'closure.terminal.json').exists()
                    or not (parent_roots[7]/'closure.start.json').exists()):
                raise ValueError('missing consumed parent closure')
            blocked,again=invoke('closure',7,closing_events,operation_number=102)
            if blocked['supervisorInvoked'] is not False or again is not None:
                raise ValueError('parent uncertainty replay')
            successes.append('parent_completion_boundary')
            drift_cases=(
                ('prewrite_grant_drift',4,
                 'GRANT DELETE ON meridian_publisher.reservations TO meridian_test_reader;',
                 'REVOKE DELETE ON meridian_publisher.reservations FROM meridian_test_reader;'),
                ('prewrite_catalog_drift',5,
                 'ALTER TABLE meridian_publisher.reservations DISABLE TRIGGER guard_reservation_row;',
                 'ALTER TABLE meridian_publisher.reservations ENABLE TRIGGER guard_reservation_row;'))
            for name,number,mutation,restore in drift_cases:
                with parent_connection(psycopg,options,parent_handles) as owner: owner.execute(mutation)
                try:
                    rejected,diagnostic=invoke('activation',number,[])
                    if (rejected['outcome']!='INDETERMINATE' or len(diagnostic['connections'])!=1
                            or diagnostic['connections'][0]['alters']!=0 or diagnostic['connections'][0]['commits']!=0
                            or diagnostic['prewriteVerified'] is not False):
                        raise ValueError('prewrite drift not rejected before ALTER')
                    observe(False)
                finally:
                    with parent_connection(psycopg,options,parent_handles) as owner: owner.execute(restore)
                successes.append(name)
            rolled,diagnostic = invoke('activation',2,[],fault='mid_alter_rollback')
            if (rolled['outcome'] != 'INDETERMINATE' or diagnostic['connections'][0]['alters'] != 2
                    or diagnostic['connections'][0]['commits'] != 0 or diagnostic['connections'][0]['rollbacks'] != 1):
                raise ValueError('partial ALTER rollback result')
            observe(False)
            require_uncertain_journal(2)
            # Synthetic model-ready input must not bypass actual journal history.
            blocked,again = invoke('closure',2,closing_events)
            if blocked['supervisorInvoked'] is not False or again is not None:
                raise ValueError('uncertain rollback closure accepted')
            successes.append('mid_alter_rollback')
            timed,diagnostic=invoke('activation',6,[],fault='mutation_timeout')
            if timed['outcome']!='INDETERMINATE' or diagnostic is not None:
                raise ValueError('mutation timeout not killed')
            observe(False)
            timeout_marker=read_diagnostic(root/('diagnostic-'+format(12,'032x')+'.timeout'))
            if timeout_marker['connections'] != [{'alters':1,'commits':0,'rollbacks':0,'closed':False,'log':['BEGIN_INTRANS']}]:
                raise ValueError('first real ALTER timeout evidence')
            try: os.waitpid(timeout_marker['pid'],os.WNOHANG)
            except ChildProcessError: pass
            else: raise ValueError('timeout child not reaped')
            pending=journal_root/format(6,'032x')
            mutation_record=json.loads((pending/'activation.01-mutation.json').read_text())
            if (mutation_record.get('stage')!='mutation_started' or mutation_record.get('status')!='PENDING'
                    or (pending/'activation.02-commit.json').exists() or (pending/'activation.03-finished.json').exists()):
                raise ValueError('timeout journal evidence')
            blocked,again=invoke('activation',6,[],operation_number=101)
            if blocked['supervisorInvoked'] is not False or again is not None: raise ValueError('timeout replay')
            blocked,again=invoke('closure',6,closing_events)
            if blocked['supervisorInvoked'] is not False or again is not None: raise ValueError('timeout closure')
            successes.append('supervised_mutation_timeout')
            lost,diagnostic = invoke('activation',3,[],fault='commit_ack_loss')
            if (lost['outcome'] != 'INDETERMINATE'
                    or diagnostic['connections'][0]['commits'] != 1 or diagnostic['connections'][0]['rollbacks'] != 0):
                raise ValueError('lost commit result')
            observe(True)
            require_uncertain_journal(3)
            blocked,again = invoke('activation',3,[],operation_number=100)
            if blocked['supervisorInvoked'] is not False or again is not None: raise ValueError('lost commit replay')
            # No reconciliation override: actual LOGIN remains observed until
            # this private cluster is stopped and removed. Never retry ALTER.
            blocked,again = invoke('closure',3,closing_events)
            if blocked['supervisorInvoked'] is not False or again is not None:
                raise ValueError('uncertain committed closure accepted')
            successes.append('commit_ack_loss')
            sessions = wait_for_no_owner_sessions(psycopg,admin_options,parent_handles)
            if sessions != 0: raise ValueError('fixture sessions remain')
            report = {'kind':'LOCAL_PG16_ROLE_TRANSITION_INTEGRATION','serverVersionNum':160015,
                      'psycopgVersion':psycopg.__version__,'toolVersions':versions,'toolSha256':digests,
                      'opensslVersion':openssl_version,'opensslSha256':openssl_sha,'sourceSha256':PINS,
                      'casesPassed':sorted(successes),'realLibpqTlsVerified':True,'realSqlTransactionsVerified':True,
                      'localRoleSessionsRemaining':sessions,'bindingApprovalMocked':True,'phaseSupervisionMocked':False,
                      'realParentChildSupervisionExercised':True,'childOnlyDatabaseAndJournalHandles':True,
                      'syntheticClosureTranscript':True,'diagnosticsAuthenticated':False,
                      'mutationTimeoutRollbackAndReplayBlockVerified':True,
                      'sameTransactionCatalogGrantsRolesPrewriteExercised':True,
                      'prewriteInputSha256':prewrite_module.PINS,
                      'grantDocumentSha256':GRANT_DOCUMENT_SHA256,
                      'localParentCompletionCoordinatorExercised':True,
                      'parentCompletionSourceSha256':modules['publisher_parent_completion'].PINS,
                      'perSyntheticCyclePrivateAnchor':True,'externalCallerAcknowledgementProven':False,
                      'parentFilesystemIoDeadlineProven':False,'localJournalExercised':True,'parentReplayAfterReopenRejected':True,
                      'parentUncertainClosureRejected':['mid_alter_rollback','commit_ack_loss','supervised_mutation_timeout'],
                      'lostCommitLoginObserved':True,
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
