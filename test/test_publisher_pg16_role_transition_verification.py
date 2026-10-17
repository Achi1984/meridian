import contextlib
import enum
import importlib.util
import io
import json
import os
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
        self.assertEqual(module.CASES,('activation_closure','mid_alter_rollback','commit_ack_loss','claim_direction','prewrite_grant_drift','prewrite_catalog_drift','supervised_mutation_timeout','parent_completion_boundary'))

    def test_source_pins_match_existing_modules(self):
        modules=m.load_sources()
        self.assertEqual(set(modules),{'publisher_role_cycle','publisher_role_transition','publisher_role_journal','publisher_role_prewrite','publisher_role_supervision','publisher_parent_completion','publisher_pg16_fixture_verification'})
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

    def test_failed_prewrite_input_load_never_opens_journal_and_registration_failure_closes(self):
        prewrite=types.SimpleNamespace(CatalogPrewrite=mock.Mock(side_effect=ValueError('source pin')))
        journal=types.SimpleNamespace(LocalRoleJournal=mock.Mock())
        with self.assertRaises(ValueError):
            m.prepare_services(None,None,None,None,None,Path('/unused'),journal,prewrite,[])
        journal.LocalRoleJournal.assert_not_called()
        prewrite.CatalogPrewrite=mock.Mock(return_value=object())
        handle=mock.Mock(); journal.LocalRoleJournal.return_value=handle
        with mock.patch.object(m,'TestServices',side_effect=ValueError('construction')):
            with self.assertRaises(ValueError):
                m.prepare_services(None,None,None,None,None,Path('/unused'),journal,prewrite,[])
        handle.close.assert_called_once_with()

    def test_cli_failure_is_sanitized_and_has_no_arbitrary_host_argument(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            result=m.main(['--pg-bin','/unused','--host','remote'])
        self.assertEqual(result,1); self.assertEqual(output.getvalue(),m.FAILURE+'\n')

    def test_supervised_factory_refuses_open_parent_and_constructs_child_only(self):
        supervisor=mock.Mock()
        modules={'publisher_parent_completion':supervisor}
        with self.assertRaisesRegex(ValueError,'parent connection'):
            m.supervised_invoke(modules,None,None,None,None,[],None,None,[types.SimpleNamespace(closed=False)])
        supervisor.run_attempt.assert_not_called()
        def same_process(root,binding,baseline,events,factory,**kwargs):
            with factory(lambda token: None): pass
        supervisor.run_attempt=same_process
        with mock.patch.object(m,'prepare_services') as prepare:
            with self.assertRaisesRegex(ValueError,'child only'):
                m.supervised_invoke(modules,None,None,None,None,[],None,None,[])
            prepare.assert_not_called()

    def test_child_context_closes_all_connections_and_journal_before_diagnostic(self):
        calls=[]; parent=m.os.getpid()
        class Handle:
            closed=False
            def close(inner): calls.append('connection'); inner.closed=True
        handle=Handle()
        services=types.SimpleNamespace(connections=[types.SimpleNamespace(raw=handle)],
            journal=types.SimpleNamespace(close=lambda:calls.append('journal')))
        def supervisor(root,binding,baseline,events,factory,**kwargs):
            with mock.patch.object(m.os,'getpid',return_value=parent+1):
                with factory(lambda token: calls.append(token)) as actual:
                    self.assertIs(actual,services); actual.phase(b'M')
            return {'outcome':'INDETERMINATE'}
        modules={key:None for key in ('publisher_role_transition','publisher_role_journal','publisher_role_prewrite')}
        modules['publisher_parent_completion']=types.SimpleNamespace(run_attempt=supervisor)
        with mock.patch.object(m,'prepare_services',return_value=services), mock.patch.object(m,'write_diagnostic',side_effect=lambda *unused:calls.append('diagnostic')):
            result=m.supervised_invoke(modules,None,None,None,None,[],None,None,[])
        self.assertEqual(calls,[b'M','connection','journal','diagnostic'])
        self.assertEqual(result['outcome'],'INDETERMINATE')
        services.connections=[types.SimpleNamespace(raw=types.SimpleNamespace(closed=False,close=mock.Mock(side_effect=RuntimeError()))) ]
        calls.clear()
        with self.assertRaises(ValueError): m.close_services(services)
        self.assertEqual(calls,['journal'])

    def test_parent_observer_close_and_bounded_session_poll(self):
        raw=Raw(); raw.fetchone=lambda:(1,)
        driver=types.SimpleNamespace(connect=lambda **unused:raw)
        handles=[]
        with self.assertRaises(RuntimeError):
            with m.parent_connection(driver,{},handles): raise RuntimeError('observer failure')
        self.assertEqual(handles,[raw]); self.assertTrue(raw.closed)
        counts=iter((2,0)); raw.fetchone=lambda:(next(counts),)
        with mock.patch.object(m.time,'sleep'):
            self.assertEqual(m.wait_for_no_owner_sessions(driver,{},handles),0)
        self.assertTrue(raw.closed)
        raw.fetchone=lambda:(1,)
        with mock.patch.object(m.time,'monotonic',side_effect=(0,6)):
            with self.assertRaisesRegex(ValueError,'sessions remain'):
                m.wait_for_no_owner_sessions(driver,{},handles)

    def test_timeout_marker_after_real_alter_before_stop(self):
        raw=Raw(); conn=m.TransactionConnection(raw,PQ,'mutation_timeout'); conn.begin()
        events=[]
        conn.after_first_alter=lambda:events.append(list(raw.sql))
        with mock.patch.object(m.os,'kill',side_effect=lambda pid,sig:events.append(sig)):
            conn.cursor().execute('ALTER ROLE first LOGIN;')
        self.assertEqual(events,[['BEGIN;','ALTER ROLE first LOGIN;'],m.signal.SIGSTOP])
        self.assertEqual(conn.alters,1); self.assertEqual(conn.commits,0)
        self.assertEqual(raw.info.transaction_status,Status.INTRANS)

    def test_diagnostic_is_bounded_exclusive_private_and_not_authority(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'receipt.json'
            service=types.SimpleNamespace(catalog_prewrite=types.SimpleNamespace(last_report={}),connections=[])
            with mock.patch.object(m.os,'getpid',return_value=os.getpid()+100): m.write_diagnostic(path,service)
            value=m.read_diagnostic(path)
            self.assertEqual(set(value),{'kind','pid','prewriteVerified','connections'})
            with self.assertRaises(FileExistsError): m.write_diagnostic(path,service)
            path.chmod(0o644)
            with self.assertRaises(ValueError): m.read_diagnostic(path)
            path.chmod(0o600); path.write_text('x'*8193)
            with self.assertRaises(ValueError): m.read_diagnostic(path)
            path.write_text('{"kind":1,"kind":2}')
            with self.assertRaises(ValueError): m.read_diagnostic(path)
            path.unlink(); path.symlink_to(Path(tmp)/'missing')
            with self.assertRaises(OSError): m.read_diagnostic(path)

class PrewriteTests(unittest.TestCase):
    def setUp(self):
        modules=m.load_sources()
        self.prewrite=modules['publisher_role_prewrite']
        self.driver=modules['publisher_role_transition']
        self.baseline={'owner_oid':10,'roles':{n:{'oid':100+i,'grantor_oid':10} for i,n in enumerate(self.driver.cycle.ROLES)}}
        self.adapter=self.prewrite.CatalogPrewrite(self.baseline)
        self.login=False
        self.identity=('publisher_ledger','publisher_owner','publisher_owner',160015,'pg_catalog','',10,True,False,1,1,2,True)
        self.transaction=(42,False)
        self.extra_role=False
        test=self
        class Cursor:
            def execute(inner,sql):
                if sql==test.prewrite.TRANSACTION_SQL: inner.rows=[test.transaction]
                elif sql==test.adapter.original.IDENTITY_SQL: inner.rows=[test.identity]
                elif sql==test.adapter.original.ROLE_SQL:
                    inner.rows=[(name,100+i,test.login,False,False,False,False,False,False,False) for i,name in enumerate(test.driver.cycle.ROLES)]
                    if test.extra_role: inner.rows.append(inner.rows[0])
                elif sql==test.adapter.original.MEMBERSHIP_SQL:
                    inner.rows=[(100+i,10,10,True,False,False) for i in range(3)]
                else: raise AssertionError('unreviewed SQL in verifier')
            def fetchmany(inner,count): return inner.rows[:count]
        self.cursor=Cursor()
        class Connection:
            pgconn=types.SimpleNamespace(transaction_status=2,ssl_in_use=True,backend_pid=42)
            cursor_calls=0
            def cursor(inner): inner.cursor_calls+=1; return test.cursor
        self.connection=Connection()
        def collect(cursor,verifier,baseline,queries,catalog):
            self.assertIs(cursor,self.cursor)
            self.assertEqual(queries,self.adapter.queries)
            verifier.verify(cursor,baseline)
            return {'fixtureCatalogMatch':True,'schemaEquivalenceEstablished':False,'activationAuthorized':False}
        self.collect=collect

    def call(self,direction='activation',collector=None):
        binding=m.test_binding(self.driver,direction,'1'*32,'2'*32)
        with mock.patch.object(self.adapter.inspector,'collect',side_effect=collector or self.collect):
            return self.adapter(self.connection,binding)

    def test_direction_specific_roles_reuse_collector_with_one_cursor(self):
        for direction,login in (('activation',False),('closure',True)):
            self.login=login; self.connection.cursor_calls=0
            self.assertIsNone(self.call(direction))
            self.assertEqual(self.connection.cursor_calls,1)
            self.assertTrue(self.adapter.last_report['catalogGrantsRolesVerified'])
            self.assertFalse(self.adapter.last_report['fullGateAEstablished'])
            self.assertFalse(self.adapter.last_report['productionTargetValidated'])
            self.assertFalse(self.adapter.last_report['parentSupervisorCompletionEstablished'])
        self.login=True
        with self.assertRaises(ValueError): self.call('activation')
        self.assertIsNone(self.adapter.last_report)
        self.login=False
        with self.assertRaises(ValueError): self.call('closure')

    def test_transaction_readonly_tls_status_and_backend_identity_fail_closed(self):
        for name,value in (('transaction_status',0),('transaction_status',2.0),('ssl_in_use',False),('backend_pid',True),('backend_pid',43)):
            original=getattr(self.connection.pgconn,name); setattr(self.connection.pgconn,name,value)
            with self.assertRaises(ValueError): self.call()
            setattr(self.connection.pgconn,name,original)
        self.transaction=(42,True)
        with self.assertRaises(ValueError): self.call()
        self.transaction=(43,False)
        with self.assertRaises(ValueError): self.call()

    def test_owner_identity_attributes_and_owned_object_counts_are_strict(self):
        for index,value in ((0,'other'),(3,160016),(6,True),(7,False),(8,True),(9,True),(10,0),(11,1)):
            saved=self.identity; row=list(saved); row[index]=value; self.identity=tuple(row)
            with self.assertRaises(ValueError): self.call()
            self.identity=saved
        self.extra_role=True
        with self.assertRaises(ValueError): self.call()

    def test_changed_transaction_after_collector_has_no_success_report(self):
        def changed(*args):
            result=self.collect(*args)
            self.connection.pgconn.transaction_status=0
            return result
        with self.assertRaises(ValueError): self.call(collector=changed)
        self.assertIsNone(self.adapter.last_report)

    def test_pinned_collector_rejection_propagates_without_cached_success(self):
        self.call(); self.assertIsNotNone(self.adapter.last_report)
        def reject(*args): raise ValueError('synthetic grant/catalog mismatch')
        with self.assertRaises(ValueError): self.call(collector=reject)
        self.assertIsNone(self.adapter.last_report)

    def test_prewrite_input_pin_rejected_before_use(self):
        with mock.patch.dict(self.prewrite.PINS,{'publisher_test_readonly_inspection.py':'0'*64}):
            with self.assertRaisesRegex(ValueError,'source pin'): self.prewrite.load_inputs()

    def test_fixture_uses_pinned_original_sql_and_exact_grant_document(self):
        helper=m.load_sources()['publisher_pg16_fixture_verification']
        fixtures,grants=m.fixture_schema_and_grants(helper)
        self.assertEqual(len(fixtures),2)
        self.assertIn('GRANT INSERT (operation_key, intent_sha256, body_sha256, run_id, run_attempt, status)',grants)
        self.assertNotIn('CREATE ROLE',grants)
        self.assertNotIn('ALTER ROLE',grants)
        with mock.patch.object(m,'GRANT_DOCUMENT_SHA256','0'*64):
            with self.assertRaisesRegex(ValueError,'document pin'): m.fixture_schema_and_grants(helper)

if __name__=='__main__': unittest.main()
