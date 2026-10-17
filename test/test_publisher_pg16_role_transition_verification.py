import contextlib
import enum
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'scripts/publisher_pg16_role_transition_verification.py'
spec=importlib.util.spec_from_file_location('role_fixture',path)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Status(enum.IntEnum):
    IDLE=0; ACTIVE=1; INTRANS=2; INERROR=3; UNKNOWN=4
PQ=types.SimpleNamespace(TransactionStatus=Status)


class Raw:
    def __init__(self):
        self.info=types.SimpleNamespace(transaction_status=Status.IDLE)
        self.pgconn=types.SimpleNamespace(ssl_in_use=True)
        self.closed=False; self.sql=[]
    def execute(self,sql):
        self.sql.append(sql)
        if sql=='BEGIN;': self.info.transaction_status=Status.INTRANS
        elif sql in ('COMMIT;','ROLLBACK;'): self.info.transaction_status=Status.IDLE
        return self
    def cursor(self): return self
    def fetchmany(self,limit): return [('row',)][:limit]
    def close(self): self.closed=True


class FixtureTests(unittest.TestCase):
    def test_import_is_inert(self):
        with mock.patch.object(m.subprocess,'Popen',side_effect=AssertionError('process on import')), mock.patch.object(m.socket,'socket',side_effect=AssertionError('socket on import')):
            module=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        self.assertEqual(module.CASES,('activation_closure','mid_alter_rollback','commit_ack_loss','claim_direction'))

    def test_source_pins_match_existing_modules(self):
        modules=m.load_sources()
        self.assertEqual(set(modules),{'publisher_role_cycle','publisher_role_transition','publisher_role_journal','publisher_pg16_fixture_verification'})
        self.assertEqual(modules['publisher_role_transition'].MANIFEST,'611ce25904b59473149f5cb8bc69613309b0b8b147df6296defdfecc0ee11274')

    def test_source_mismatch_fails_before_import(self):
        with mock.patch.dict(m.PINS,{'publisher_role_cycle.py':'0'*64}):
            with self.assertRaisesRegex(ValueError,'source pin'): m.load_sources()

    def test_options_are_loopback_verifyfull_no_credentials(self):
        opts=m.connection_options(Path('/tmp/private-fixture'),12345,'publisher_owner','publisher_ledger')
        self.assertEqual(opts['host'],'127.0.0.1'); self.assertEqual(opts['hostaddr'],'127.0.0.1')
        self.assertEqual(opts['sslmode'],'verify-full'); self.assertEqual(opts['password'],'')
        self.assertTrue(opts['autocommit'])
        self.assertEqual(opts['sslrootcert'],'/tmp/private-fixture/server.crt')
        self.assertEqual(opts['passfile'],'/tmp/private-fixture/absent-passfile')
        for port in (True,0,1023,65536,'5432'):
            with self.assertRaises(ValueError): m.connection_options(Path('/tmp/private-fixture'),port,'publisher_owner','publisher_ledger')
        with self.assertRaises(ValueError): m.connection_options(Path('/tmp/private-fixture'),5432,'other','publisher_ledger')
        with self.assertRaises(ValueError): m.connection_options(Path('/tmp/private-fixture'),5432,'publisher_owner','other')

    def test_explicit_real_adapter_transaction_contract(self):
        raw=Raw(); conn=m.TransactionConnection(raw,PQ)
        conn.begin(); conn.cursor().execute('SELECT 1'); conn.commit(); conn.rollback(); conn.close()
        self.assertEqual(raw.sql,['BEGIN;','SELECT 1','COMMIT;'])
        self.assertEqual(conn.log,['BEGIN_INTRANS','COMMIT_IDLE','ROLLBACK_OR_IDLE','CLOSED'])
        self.assertTrue(conn.closed); self.assertIs(conn.pgconn,raw.pgconn)

    def test_mid_alter_fault_occurs_after_first_real_execute(self):
        raw=Raw(); conn=m.TransactionConnection(raw,PQ,'mid_alter_rollback'); conn.begin()
        cursor=conn.cursor(); cursor.execute('ALTER ROLE first LOGIN;')
        with self.assertRaises(RuntimeError): cursor.execute('ALTER ROLE second LOGIN;')
        conn.rollback(); conn.close()
        self.assertEqual(raw.sql,['BEGIN;','ALTER ROLE first LOGIN;','ROLLBACK;'])
        self.assertEqual(conn.rollbacks,1); self.assertEqual(conn.commits,0)

    def test_commit_ack_fault_occurs_after_commit_and_idle(self):
        raw=Raw(); conn=m.TransactionConnection(raw,PQ,'commit_ack_loss'); conn.begin()
        with self.assertRaises(RuntimeError): conn.commit()
        self.assertEqual(raw.sql,['BEGIN;','COMMIT;']); self.assertEqual(conn.commits,1)
        self.assertEqual(raw.info.transaction_status,Status.IDLE)

    def test_transaction_state_mismatch_rejected(self):
        raw=Raw(); conn=m.TransactionConnection(raw,PQ)
        with self.assertRaises(ValueError): conn.commit()
        raw.info.transaction_status=Status.INTRANS
        with self.assertRaises(ValueError): conn.begin()
        raw.info.transaction_status=Status.UNKNOWN
        with self.assertRaises(ValueError): conn.rollback()

    def test_claim_and_record_delegate_to_real_journal_across_reopen(self):
        modules=m.load_sources(); driver=modules['publisher_role_transition']; journals=modules['publisher_role_journal']
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'journal'; root.mkdir(mode=0o700)
            activation=m.test_binding(driver,'activation','1'*32,'2'*32)
            with journals.LocalRoleJournal(root) as journal:
                services=m.TestServices(driver,None,None,activation,None,journal)
                self.assertTrue(services.claim(activation))
                services.record(activation,'mutation_started','PENDING')
                services.record(activation,'commit_started','PENDING')
                services.record(activation,'finished','CONFIRMED')
                with journals.LocalRoleJournal(root) as blocked:
                    with self.assertRaises(ValueError): blocked.claim(dict(activation,direction='closure'))
            with journals.LocalRoleJournal(root) as journal:
                services=m.TestServices(driver,None,None,activation,None,journal)
                self.assertFalse(services.claim(dict(activation,operation_id='3'*32)))
            closure=dict(activation,direction='closure',operation_id='4'*32)
            with journals.LocalRoleJournal(root) as journal:
                services=m.TestServices(driver,None,None,closure,None,journal)
                self.assertTrue(services.claim(closure))

    def test_driver_exception_releases_journal_but_never_reclaims_slot(self):
        modules=m.load_sources(); driver=modules['publisher_role_transition']; journals=modules['publisher_role_journal']
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'journal'; root.mkdir(mode=0o700)
            binding=m.test_binding(driver,'activation','1'*32,'2'*32)
            journal=journals.LocalRoleJournal(root)
            services=m.TestServices(driver,None,None,binding,None,journal)
            close_order=[]
            class OpenRaw:
                closed=False
                def close(inner):
                    self.assertFalse(journal.closed)
                    close_order.append('connection-before-journal')
                    inner.closed=True
            def fail(binding,baseline,events,services):
                services.claim(binding)
                services.connections.append(types.SimpleNamespace(raw=OpenRaw()))
                raise RuntimeError('synthetic driver escape')
            with self.assertRaises(RuntimeError):
                m.invoke_driver(types.SimpleNamespace(drive_transition=fail),services,None,[])
            self.assertTrue(journal.closed)
            self.assertEqual(close_order,['connection-before-journal'])
            with journals.LocalRoleJournal(root) as restarted:
                self.assertFalse(restarted.claim(binding))

    def test_uncertain_activation_journal_blocks_model_ready_closure(self):
        modules=m.load_sources(); driver=modules['publisher_role_transition']; journals=modules['publisher_role_journal']
        baseline={'owner_oid':10,'roles':{n:{'oid':100+i,'grantor_oid':10} for i,n in enumerate(driver.cycle.ROLES)}}
        def snapshot(login):
            return {'roles':{n:{'oid':100+i,'login':login,**dict.fromkeys(driver.cycle.FLAGS,False)} for i,n in enumerate(driver.cycle.ROLES)},
                    'memberships':[dict(zip(('role_oid','member_oid','grantor_oid','admin','inherit','set'),(100+i,10,10,True,False,False))) for i in range(3)]}
        events=[{'type':'precheck','snapshot':snapshot(False)},{'type':'activation_started'},
                {'type':'activation_committed'},{'type':'activation_verified','snapshot':snapshot(True)},
                {'type':'activation_cleanup','clean':True},{'type':'cancel_dispatch'}]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'journal'; root.mkdir(mode=0o700)
            activation=m.test_binding(driver,'activation','1'*32,'2'*32)
            with journals.LocalRoleJournal(root) as journal:
                journal.claim(activation); journal.record(activation,'finished','INDETERMINATE')
            closure=dict(activation,direction='closure',operation_id='3'*32)
            services=m.TestServices(driver,None,None,closure,baseline,journals.LocalRoleJournal(root))
            with mock.patch.object(services,'connect',side_effect=AssertionError('must not connect')) as connect:
                result=m.invoke_driver(driver,services,baseline,events)
                connect.assert_not_called()
            self.assertEqual(result['outcome'],'INDETERMINATE')
            self.assertTrue(services.journal.closed)

    def test_actual_identity_must_include_private_data_directory_tls_and_port(self):
        class Admin:
            pgconn=types.SimpleNamespace(ssl_in_use=True)
            def execute(self,sql):
                # inet::text retains /32; the SQL must request the host address.
                if 'pg_catalog.host(pg_catalog.inet_server_addr())' not in sql:
                    raise AssertionError('noncanonical inet comparison')
                return self
            def fetchone(self): return self.row
        admin=Admin(); admin.row=(160015,'fixture_admin','postgres','127.0.0.1',12345,'/tmp/private/data','127.0.0.1')
        m.assert_local_identity(admin,Path('/tmp/private/data'),12345)
        for index,value in ((0,160016),(1,'publisher_owner'),(3,'other'),(4,5432),(5,'/actual/data'),(6,'*')):
            original=admin.row; row=list(original); row[index]=value; admin.row=tuple(row)
            with self.assertRaises(ValueError): m.assert_local_identity(admin,Path('/tmp/private/data'),12345)
            admin.row=original
        admin.pgconn.ssl_in_use=1
        with self.assertRaises(ValueError): m.assert_local_identity(admin,Path('/tmp/private/data'),12345)

    def test_libpq_environment_rejected_before_dependency_or_server(self):
        with mock.patch.object(m.os,'getuid',return_value=1000), mock.patch.dict(m.os.environ,{'PGHOST':'synthetic-value'}), mock.patch.object(m,'load_sources',side_effect=AssertionError('must not load')):
            with self.assertRaisesRegex(ValueError,'libpq environment'): m.verify(Path('/unused'))

    def test_connection_close_failures_cannot_skip_other_closes_or_server_wait(self):
        calls=[]
        class BadClose:
            def __init__(self,name): self.name=name
            def close(self):
                calls.append(self.name)
                raise RuntimeError('synthetic close failure')
        class Server:
            def poll(self): calls.append('poll'); return 0
            def wait(self,timeout): calls.append('wait'); return 0
        services=[types.SimpleNamespace(journal=BadClose('journal'),connections=[types.SimpleNamespace(raw=BadClose('first')),types.SimpleNamespace(raw=BadClose('second'))])]
        with self.assertRaisesRegex(ValueError,'connection cleanup'):
            m.cleanup_cluster(Server(),services,BadClose('admin'))
        self.assertEqual(calls,['first','second','journal','admin','poll','wait'])

    def test_cli_failure_is_sanitized_and_has_no_arbitrary_host_argument(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            result=m.main(['--pg-bin','/unused','--host','remote'])
        self.assertEqual(result,1); self.assertEqual(output.getvalue(),m.FAILURE+'\n')

if __name__=='__main__': unittest.main()
