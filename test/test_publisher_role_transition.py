import copy
import importlib.util
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
for name in ('publisher_role_cycle','publisher_role_transition'):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/(name+'.py'))
    module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    spec.loader.exec_module(module)
m=sys.modules['publisher_role_transition']
c=m.cycle


def baseline():
    return {'owner_oid':10,'roles':{n:{'oid':100+i,'grantor_oid':10} for i,n in enumerate(c.ROLES)}}


def binding(direction='activation'):
    return {'operation_id':'1'*32,'cycle_id':'2'*32,'direction':direction,'source_sha':'3'*40,
            'baseline_sha256':'4'*64,'manifest_sha256':m.MANIFEST,'workflow_sha':'5'*40,
            'approval_ref':'12345','target':dict(m.TARGET)}


def snapshot(login):
    return {'roles':{n:{'oid':100+i,'login':login,**dict.fromkeys(c.FLAGS,False)} for i,n in enumerate(c.ROLES)},
            'memberships':[dict(zip(('role_oid','member_oid','grantor_oid','admin','inherit','set'),
                                   (100+i,10,10,True,False,False))) for i in range(3)]}


def closure_transcript(outcome='unknown'):
    return [{'type':'precheck','snapshot':snapshot(False)},{'type':'activation_started'},
            {'type':'activation_committed'},{'type':'activation_verified','snapshot':snapshot(True)},
            {'type':'activation_cleanup','clean':True},{'type':'dispatch_attempted'},
            {'type':'dispatch_finished','outcome':outcome}]


class FakeCursor:
    def __init__(self, conn): self.conn=conn; self.rows=[]
    def execute(self, sql):
        service=self.conn.service
        service.sql.append(sql)
        if sql == m.IDENTITY_SQL:
            service.hit('identity')
            self.rows=[('publisher_ledger','publisher_owner','publisher_owner',160015,10,'pg_catalog','',False)]
            if service.bad_identity is not None: self.rows=service.bad_identity
        elif sql == m.ROLE_SQL:
            service.hit('roles')
            self.rows=[(n,100+i,self.conn.login[i],False,False,False,False,False,False,False) for i,n in enumerate(c.ROLES)]
            if service.bad_roles is not None: self.rows=service.bad_roles
        elif sql == m.MEMBERSHIP_SQL:
            service.hit('memberships')
            self.rows=[(100+i,10,10,True,False,False) for i in range(3)]
            if service.bad_memberships is not None: self.rows=service.bad_memberships
        else:
            options={f'ALTER ROLE {n} {word};':(i,value) for i,n in enumerate(c.ROLES) for word,value in (('LOGIN',True),('NOLOGIN',False))}
            if sql not in options: raise AssertionError('unexpected SQL')
            service.hit('alter')
            i,value=options[sql]; self.conn.login[i]=value
    def fetchmany(self, limit):
        self.conn.service.bounds.append(limit)
        return self.rows[:limit]


class FakeConnection:
    def __init__(self, service):
        self.service=service; self.pgconn=types.SimpleNamespace(ssl_in_use=True)
        self.login=[service.direction=='closure']*3; self.saved=list(self.login)
    def cursor(self): self.service.hit('cursor'); return FakeCursor(self)
    def begin(self): self.service.hit('begin')
    def commit(self):
        self.service.hit('commit'); self.saved=list(self.login)
    def rollback(self): self.service.hit('rollback'); self.login=list(self.saved)
    def close(self): self.service.hit('close')


class Services:
    def __init__(self,direction='activation',fails=()):
        self.direction=direction; self.fail=set(fails); self.log=[]; self.counts={}; self.sql=[]; self.bounds=[]
        self.conn=FakeConnection(self); self.bad_identity=None; self.bad_roles=None; self.bad_memberships=None
        self.claim_result=True; self.prewrite_result=None; self.record_result=None; self.phase_result=None
    def hit(self,name):
        self.log.append(name); self.counts[name]=self.counts.get(name,0)+1
        if name in self.fail or f'{name}:{self.counts[name]}' in self.fail:
            raise RuntimeError('synthetic private exception MUST NOT escape')
    def expected_binding(self): self.hit('expected'); return binding(self.direction)
    def claim(self,value): self.hit('claim'); return self.claim_result
    def connect(self): self.hit('connect'); return self.conn
    def prewrite(self,conn,value):
        self.hit('prewrite')
        if conn is not self.conn: raise AssertionError('different connection')
        return self.prewrite_result
    def phase(self,token): self.hit('phase_'+token.decode()); return self.phase_result
    def record(self,value,stage,status): self.hit('record_'+stage); return self.record_result


class TransitionTests(unittest.TestCase):
    def drive(self,services=None,request=None,events=None):
        services=services or Services()
        return m.drive_transition(request or binding(services.direction),baseline(),
                                  ([] if services.direction=='activation' else closure_transcript()) if events is None else events,services)

    def test_activation_exact_effects_and_observation_only(self):
        s=Services(); result=self.drive(s)
        self.assertEqual(result['outcome'],'CONFIRMED'); self.assertEqual(result['state']['phase'],'READY')
        self.assertFalse(result['activationAuthorized']); self.assertFalse(result['evidenceAuthenticated'])
        self.assertFalse(result['dispatchAuthorized']); self.assertFalse(result['supervisorCompletionEstablished'])
        self.assertEqual([q for q in s.sql if q.startswith('ALTER')],[f'ALTER ROLE {n} LOGIN;' for n in c.ROLES])
        self.assertLess(s.log.index('claim'),s.log.index('connect'))
        self.assertLess(s.log.index('prewrite'),s.log.index('alter'))
        self.assertLess(s.log.index('record_mutation_started'),s.log.index('phase_M'))
        self.assertLess(s.log.index('phase_M'),s.log.index('alter'))
        self.assertLess(s.log.index('record_commit_started'),s.log.index('commit'))
        self.assertLess(s.log.index('close'),s.log.index('record_finished'))
        self.assertEqual(s.counts['commit'],1); self.assertEqual(s.counts['close'],1)
        self.assertEqual(set(s.bounds),{2,4})

    def test_closure_after_every_dispatch_outcome(self):
        for outcome in ('success','failure','unknown'):
            s=Services('closure'); result=self.drive(s,events=closure_transcript(outcome))
            self.assertEqual(result['outcome'],'CONFIRMED')
            self.assertEqual(result['state']['phase'],'AWAITING_SESSIONS')
            self.assertTrue(result['state']['attemptConsumed'])
            self.assertEqual(result['state']['dispatchOutcome'],outcome)
            self.assertEqual([q for q in s.sql if q.startswith('ALTER')],[f'ALTER ROLE {n} NOLOGIN;' for n in c.ROLES])

    def test_binding_mismatch_never_claims(self):
        for key in ('operation_id','cycle_id','source_sha','baseline_sha256','workflow_sha','approval_ref'):
            s=Services(); b=binding(); b[key]='9'*len(b[key])
            self.assertEqual(self.drive(s,b)['outcome'],'BLOCKED'); self.assertNotIn('claim',s.log)
        s=Services(); b=binding(); b['target']['host']='other'
        self.assertEqual(self.drive(s,b)['outcome'],'BLOCKED'); self.assertNotIn('connect',s.log)

    def test_strict_binding_fields_and_types(self):
        for key in binding():
            b=binding(); b[key]=True
            with self.assertRaises(ValueError): m.validate_binding(binding(),b)
        b=binding(); b['extra']=1
        with self.assertRaises(ValueError): m.validate_binding(binding(),b)

    def test_missing_prewrite_adapter_blocks_before_claim(self):
        s=Services(); s.prewrite=None
        self.assertEqual(self.drive(s)['outcome'],'BLOCKED'); self.assertNotIn('claim',s.log)

    def test_prewrite_is_not_boolean_attestation(self):
        s=Services(); s.prewrite_result=True
        self.assertEqual(self.drive(s)['outcome'],'FAILED'); self.assertNotIn('alter',s.log)
        self.assertIn('rollback',s.log); self.assertIn('close',s.log)

    def test_claim_ambiguous_false_and_malformed(self):
        for value,expected in ((False,'BLOCKED'),(1,'INDETERMINATE'),(None,'INDETERMINATE')):
            s=Services(); s.claim_result=value
            self.assertEqual(self.drive(s)['outcome'],expected); self.assertNotIn('connect',s.log)
        s=Services(fails=('claim',)); self.assertEqual(self.drive(s)['outcome'],'INDETERMINATE')
        self.assertEqual(s.counts['claim'],1); self.assertNotIn('connect',s.log)

    def test_connect_and_pre_effect_failures_never_alter(self):
        for point in ('connect','cursor:1','begin','prewrite','identity:1','roles:1','memberships:1'):
            s=Services(fails=(point,)); result=self.drive(s)
            self.assertNotIn('alter',s.log)
            self.assertNotEqual(result['outcome'],'CONFIRMED')
            if point!='connect': self.assertIn('rollback',s.log); self.assertIn('close',s.log)
            else: self.assertEqual(result['outcome'],'INDETERMINATE')

    def test_phase_and_journal_mutation_ack_fail_closed(self):
        for point in ('record_mutation_started','phase_M'):
            s=Services(fails=(point,)); result=self.drive(s)
            self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertNotIn('alter',s.log)
            self.assertTrue(result['state']['reconciliationRequired'])
            self.assertIn('rollback',s.log); self.assertIn('close',s.log)

        for field in ('record_result','phase_result'):
            s=Services(); setattr(s,field,True)
            self.assertEqual(self.drive(s)['outcome'],'INDETERMINATE')
            self.assertNotIn('alter',s.log); self.assertIn('close',s.log)

    def test_each_alter_failure_rolls_back_once_and_closes(self):
        for index in (1,2,3):
            s=Services(fails=(f'alter:{index}',)); result=self.drive(s)
            self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertNotIn('commit',s.log)
            self.assertEqual(s.counts['alter'],index); self.assertEqual(s.counts['rollback'],1)
            self.assertEqual(s.counts['close'],1); self.assertEqual(s.conn.login,[False]*3)

    def test_precommit_observation_failure_prevents_commit(self):
        for query in ('identity','roles','memberships'):
            s=Services(fails=(query+':2',)); result=self.drive(s)
            self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertNotIn('commit',s.log)
            self.assertIn('rollback',s.log); self.assertIn('close',s.log)

    def test_commit_ambiguity_never_retries_or_rolls_back(self):
        for point in ('record_commit_started','commit'):
            s=Services(fails=(point,)); result=self.drive(s)
            self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertNotIn('rollback',s.log)
            self.assertEqual(s.counts.get('commit',0),int(point=='commit')); self.assertEqual(s.counts['close'],1)

    def test_postcommit_observation_failure_requires_reconciliation(self):
        for query in ('identity','roles','memberships'):
            s=Services(fails=(query+':3',)); result=self.drive(s)
            self.assertEqual(result['outcome'],'INDETERMINATE')
            self.assertTrue(result['state']['reconciliationRequired']); self.assertIn('close',s.log)

    def test_cleanup_failures_override_success(self):
        for point in ('phase_L','rollback','close','record_finished'):
            s=Services(fails=(point,)); result=self.drive(s)
            self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertEqual(s.counts['close'],1)
            self.assertTrue(result['state']['reconciliationRequired']); self.assertFalse(result['state']['dispatchEligible'])

    def test_cleanup_runs_when_journal_and_phase_fail_together(self):
        s=Services(fails=('record_mutation_started','phase_L','rollback','record_finished'))
        result=self.drive(s)
        self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertEqual(s.counts['close'],1)
        self.assertNotIn('synthetic',str(result))

    def test_mixed_roles_stop_activation_and_closure(self):
        for direction in ('activation','closure'):
            s=Services(direction); s.conn.login=[True,False,False]
            result=self.drive(s)
            self.assertEqual(result['outcome'],'FAILED'); self.assertNotIn('alter',s.log)
            self.assertTrue(result['ownerReconciliationRequired'])
            self.assertNotIn('commit',s.log)

    def test_identity_tls_and_readonly_rejected(self):
        for index,value in ((3,True),(3,160016),(4,True),(7,True),(0,'other')):
            s=Services(); row=['publisher_ledger','publisher_owner','publisher_owner',160015,10,'pg_catalog','',False]
            row[index]=value; s.bad_identity=[tuple(row)]
            self.assertEqual(self.drive(s)['outcome'],'FAILED'); self.assertNotIn('alter',s.log)
        s=Services(); s.conn.pgconn.ssl_in_use=1
        self.assertEqual(self.drive(s)['outcome'],'FAILED')

    def test_duplicate_roles_and_memberships_rejected(self):
        for field in ('bad_roles','bad_memberships'):
            s=Services()
            row=(c.ROLES[0],100,False,False,False,False,False,False,False,False) if field=='bad_roles' else (100,10,10,True,False,False)
            setattr(s,field,[row]*3)
            self.assertEqual(self.drive(s)['outcome'],'FAILED'); self.assertNotIn('alter',s.log)

    def test_state_and_replay_boundaries(self):
        s=Services('closure')
        self.assertEqual(self.drive(s,events=[])['outcome'],'BLOCKED'); self.assertNotIn('claim',s.log)
        s=Services(); first=self.drive(s)
        second=Services(); result=self.drive(second,events=first['transcript'])
        self.assertEqual(result['outcome'],'BLOCKED'); self.assertNotIn('claim',second.log)

    def test_failed_closure_is_indeterminate_without_dispatch_or_repair(self):
        s=Services('closure',fails=('alter:2',)); result=self.drive(s)
        self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertTrue(result['state']['attemptConsumed'])
        self.assertTrue(result['state']['reconciliationRequired'])
        self.assertEqual(s.counts['alter'],2)

    def test_inputs_unchanged(self):
        b=baseline(); req=binding(); events=[]; original=copy.deepcopy((b,req,events))
        m.drive_transition(req,b,events,Services())
        self.assertEqual((b,req,events),original)

if __name__=='__main__': unittest.main()
