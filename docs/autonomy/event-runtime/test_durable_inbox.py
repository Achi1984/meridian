import hashlib
import importlib.util
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest
ROOT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('inbox',ROOT/'durable_inbox.py');inbox=importlib.util.module_from_spec(spec);spec.loader.exec_module(inbox)

def binding(n=1):return {'repository':'Achi1984/meridian','eventIdentity':'workflow-run:Achi1984/meridian:456:1:completed','revisionDigest':hashlib.sha256(str(n).encode()).hexdigest(),'headSha':'a'*40,'baseSha':'b'*40,'payloadSha256':'c'*64}
def projection(receipt,summary=None):
    summary=json.loads(summary) if summary is not None else {'decision':'READY_FOR_OWNER_DECISION','reason':'OFFLINE_CONSISTENT_ONLY'}
    state='REVIEW_WAIT' if summary['decision']=='WAITING_REVIEW' else 'COMPLETE_DRAFT'
    b=receipt['binding']
    ledger={'kind':'OFFLINE_CLAIMS_ONLY','manifestDigest':'d'*64,'revision':5,'revoked':False,'dispatchAllowed':False,'mergeAllowed':False,'authenticated':False,'durable':False,
            'packets':[{'id':'first','state':state,'baseSha':b['baseSha'],'headSha':b['headSha'],'ciHeadSha':b['headSha'],'reviewHeadSha':None if state=='REVIEW_WAIT' else b['headSha'],'mergeSha':None}]}
    return json.dumps({'kind':'OFFLINE_CONTINUATION_DECISION',**summary,'eventIdentity':b['eventIdentity'],'revisionDigest':b['revisionDigest'],'packetId':'first','ledger':ledger,
                      'authenticated':False,'provenanceVerified':False,'authorized':False,'dispatchAllowed':False,'mergeAllowed':False,'durable':False},sort_keys=True,separators=(',',':'))
def complete(db,receipt,digest,result_json=None):
    # Existing lifecycle tests now supply the mandatory schema2 recovery record.
    return inbox.complete(db,receipt,digest,result_json,continuation_json=projection(receipt,result_json))

CHILD="""import importlib.util,json,sys,os
s=importlib.util.spec_from_file_location('inbox',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
try:
 r=m.claim(sys.argv[2],sys.argv[3],sys.argv[4])
 if sys.argv[5]=='start':r=m.start(sys.argv[2],r)
 print(json.dumps({'ok':r}),flush=True)
except m.InboxError as e:print(json.dumps({'error':e.code}),flush=True)
os._exit(0)
"""

class InboxTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.db=str(pathlib.Path(self.temp.name)/'inbox.sqlite');inbox.initialize(self.db)
 def tearDown(self):self.temp.cleanup()
 def enqueue(self,n=1):return inbox.enqueue(self.db,binding(n))
 def test_explicit_init_missing_and_existing_store_fail_closed(self):
  with self.assertRaisesRegex(inbox.InboxError,'DATABASE_EXISTS'):inbox.initialize(self.db)
  with self.assertRaisesRegex(inbox.InboxError,'DATABASE_UNAVAILABLE'):inbox.enqueue(self.db+'missing',binding())
  pathlib.Path(self.db+'bad').touch()
  with self.assertRaisesRegex(inbox.InboxError,'DATABASE_SCHEMA'):inbox.enqueue(self.db+'bad',binding())
 def test_enqueue_deduplicates_and_conflicting_identity_never_rebinds(self):
  first=self.enqueue();self.assertEqual(self.enqueue(),first)
  for field,value in [('headSha','d'*40),('baseSha','e'*40),('payloadSha256','f'*64)]:
   b=binding();b[field]=value
   with self.assertRaisesRegex(inbox.InboxError,'EVENT_REVISION_CONFLICT'):inbox.enqueue(self.db,b)
  self.assertNotEqual(self.enqueue(2)['eventId'],first['eventId'])
 def test_claim_start_complete_and_durable_summary(self):
  e=self.enqueue();c=inbox.claim(self.db,e['eventId'],'worker1');self.assertEqual(c['attempts'],1)
  with self.assertRaisesRegex(inbox.InboxError,'INVALID_SETTLEMENT'):complete(self.db,c,'d'*64)
  started=inbox.start(self.db,c);summary=json.dumps({'decision':'WAITING_REVIEW','reason':'CI_ACCEPTED'})
  done=complete(self.db,started,'d'*64,summary);self.assertEqual(done['state'],'COMPLETE');self.assertEqual(done['resultJson'],summary);self.assertEqual(done['resultSha256'],'d'*64)
  self.assertEqual(inbox.inspect_event(self.db,e['eventId']),done)
  with self.assertRaisesRegex(inbox.InboxError,'ATTEMPT_CONSUMED'):inbox.claim(self.db,e['eventId'],'worker1')
  self.assertEqual(inbox.enqueue(self.db,binding())['state'],'COMPLETE')
 def test_unknown_retains_scope_and_never_retries(self):
  first=self.enqueue();other=self.enqueue(2);c=inbox.start(self.db,inbox.claim(self.db,first['eventId'],'worker1'));u=inbox.unknown(self.db,c,'d'*64)
  self.assertEqual(u['state'],'UNKNOWN')
  with self.assertRaisesRegex(inbox.InboxError,'ATTEMPT_CONSUMED'):inbox.claim(self.db,first['eventId'],'worker2')
  with self.assertRaisesRegex(inbox.InboxError,'INBOX_BUSY'):inbox.claim(self.db,other['eventId'],'worker2')
  with self.assertRaisesRegex(inbox.InboxError,'INVALID_SETTLEMENT'):complete(self.db,c,'d'*64)
 def test_claimed_unknown_also_holds_scope(self):
  e=self.enqueue();c=inbox.claim(self.db,e['eventId'],'worker1');self.assertEqual(inbox.unknown(self.db,c,'d'*64)['state'],'UNKNOWN')
 def test_fences_monotonic_and_old_claim_rejected(self):
  e=self.enqueue();c=inbox.start(self.db,inbox.claim(self.db,e['eventId'],'worker1'));complete(self.db,c,'d'*64)
  second=self.enqueue(2);d=inbox.claim(self.db,second['eventId'],'worker2');self.assertGreater(d['fence'],c['fence'])
  with self.assertRaisesRegex(inbox.InboxError,'STALE_FENCE'):inbox.start(self.db,c)
  wrong=dict(d,owner='worker3')
  with self.assertRaisesRegex(inbox.InboxError,'STALE_CLAIM'):inbox.start(self.db,wrong)
  wrong=dict(d,fence=d['fence']+1)
  with self.assertRaisesRegex(inbox.InboxError,'STALE_CLAIM'):inbox.start(self.db,wrong)
 def test_repeat_start_and_changed_payload_receipt_rejected(self):
  c=inbox.claim(self.db,self.enqueue()['eventId'],'worker1');changed={**c,'binding':{**c['binding'],'payloadSha256':'d'*64}}
  with self.assertRaisesRegex(inbox.InboxError,'STALE_CLAIM'):inbox.start(self.db,changed)
  inbox.start(self.db,c)
  with self.assertRaisesRegex(inbox.InboxError,'ALREADY_STARTED_OR_TERMINAL'):inbox.start(self.db,c)
 def test_competing_real_processes_only_one_claim(self):
  e=self.enqueue();processes=[subprocess.Popen([sys.executable,'-I','-c',CHILD,str(ROOT/'durable_inbox.py'),self.db,e['eventId'],'worker'+str(i),'claim'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for i in range(6)]
  rows=[]
  for p in processes:
   out,err=p.communicate(timeout=10);self.assertEqual(p.returncode,0,err);rows.append(json.loads(out))
  self.assertEqual(sum('ok' in r for r in rows),1);self.assertEqual(inbox.inspect_event(self.db,e['eventId'])['attempts'],1)
 def test_different_events_compete_for_single_scope(self):
  events=[self.enqueue(n) for n in (1,2)];processes=[subprocess.Popen([sys.executable,'-I','-c',CHILD,str(ROOT/'durable_inbox.py'),self.db,e['eventId'],'worker'+str(i),'claim'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for i,e in enumerate(events)]
  rows=[json.loads(p.communicate(timeout=10)[0]) for p in processes];self.assertEqual(sum('ok' in r for r in rows),1);self.assertIn('INBOX_BUSY',[r.get('error') for r in rows])
 def test_process_exit_after_start_never_reclaims(self):
  e=self.enqueue();p=subprocess.run([sys.executable,'-I','-c',CHILD,str(ROOT/'durable_inbox.py'),self.db,e['eventId'],'worker1','start'],capture_output=True,text=True,timeout=10);self.assertIn('ok',json.loads(p.stdout));self.assertEqual(inbox.inspect_event(self.db,e['eventId'])['state'],'STARTED')
  with self.assertRaisesRegex(inbox.InboxError,'ATTEMPT_CONSUMED'):inbox.claim(self.db,e['eventId'],'worker2')
 def test_row_and_byte_capacity_fail_closed_without_pruning(self):
  old=inbox.MAX_EVENTS;inbox.MAX_EVENTS=1
  try:
   self.enqueue()
   with self.assertRaisesRegex(inbox.InboxError,'INBOX_CAPACITY'):self.enqueue(2)
   self.assertEqual(self.enqueue()['state'],'QUEUED')
  finally:inbox.MAX_EVENTS=old
  old=inbox.MAX_STORED_BYTES;inbox.MAX_STORED_BYTES=1
  try:
   with self.assertRaisesRegex(inbox.InboxError,'INBOX_CAPACITY'):self.enqueue(2)
  finally:inbox.MAX_STORED_BYTES=old
 def test_only_bounded_summary_metadata_may_be_persisted(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'))
  for text in ['{"body":"private comment"}','{"decision":"BLOCKED","reason":"free form secret"}',json.dumps({'decision':'BLOCKED','reason':'X'*1000}),'not-json']:
   with self.assertRaises(inbox.InboxError):inbox.complete(self.db,c,'d'*64,text,continuation_json=projection(c))
  self.assertEqual(inbox.inspect_event(self.db,c['eventId'])['state'],'STARTED')
 def test_summary_unknown_cannot_release_scope_or_mislabel_unknown(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'));other=self.enqueue(2)
  with self.assertRaisesRegex(inbox.InboxError,'OUTCOME_SUMMARY_CONFLICT'):complete(self.db,c,'d'*64,json.dumps({'decision':'UNKNOWN','reason':'LOST_PROCESS'}))
  with self.assertRaisesRegex(inbox.InboxError,'INBOX_BUSY'):inbox.claim(self.db,other['eventId'],'worker2')
  with self.assertRaisesRegex(inbox.InboxError,'OUTCOME_SUMMARY_CONFLICT'):inbox.unknown(self.db,c,'d'*64,json.dumps({'decision':'BLOCKED','reason':'LOST_PROCESS'}))
  self.assertEqual(inbox.unknown(self.db,c,'d'*64,json.dumps({'decision':'UNKNOWN','reason':'LOST_PROCESS'}))['state'],'UNKNOWN')
 def test_unexpected_fields_and_bad_bindings_rejected(self):
  for edit in [lambda b:b.update(repository='other/repo'),lambda b:b.update(headSha='bad'),lambda b:b.update(rawBody='secret'),lambda b:b.update(eventIdentity='x'*321),lambda b:b.update(revisionDigest=True)]:
   b=binding();edit(b)
   with self.assertRaises(inbox.InboxError):inbox.enqueue(self.db,b)
 def test_schema1_fails_closed_without_auto_migration(self):
  with sqlite3.connect(self.db) as c:c.execute('PRAGMA user_version=1')
  with self.assertRaisesRegex(inbox.InboxError,'DATABASE_SCHEMA'):self.enqueue()
  with sqlite3.connect(self.db) as c:self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0],1)
 def test_complete_requires_projection_and_recovery_digest_is_binding_bound(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'))
  with self.assertRaisesRegex(inbox.InboxError,'CONTINUATION_REQUIRED'):inbox.complete(self.db,c,'d'*64)
  done=complete(self.db,c,'d'*64);raw=done['continuationJson'];canonical=json.dumps(done['binding'],sort_keys=True,separators=(',',':'))
  self.assertEqual(done['continuationSha256'],hashlib.sha256((canonical+'\n'+raw).encode()).hexdigest())
  self.assertEqual(json.loads(raw)['ledger']['packets'][0]['state'],'COMPLETE_DRAFT')
 def test_projection_corruption_and_wrong_metadata_fail_closed(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'))
  for edit in (lambda p:p.update(planner={'body':'private'}),lambda p:p.update(authenticated=True),lambda p:p.update(revisionDigest='e'*64),lambda p:p['ledger']['packets'][0].update(headSha='e'*40),lambda p:p['ledger']['packets'].append(dict(p['ledger']['packets'][0]))):
   p=json.loads(projection(c));edit(p)
   with self.assertRaises(inbox.InboxError):inbox.complete(self.db,c,'d'*64,continuation_json=json.dumps(p))
  done=complete(self.db,c,'d'*64)
  with sqlite3.connect(self.db) as db:db.execute('UPDATE events SET continuation_sha=? WHERE event_id=?',('0'*64,c['eventId']))
  with self.assertRaisesRegex(inbox.InboxError,'STORED_CONTINUATION_DIGEST'):inbox.inspect_event(self.db,c['eventId'])
 def test_corrupt_summary_or_full_result_digest_blocks_read(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'));complete(self.db,c,'d'*64)
  with sqlite3.connect(self.db) as db:db.execute('UPDATE events SET result_json=? WHERE event_id=?',(json.dumps({'decision':'UNKNOWN','reason':'CORRUPTED'}),c['eventId']))
  with self.assertRaisesRegex(inbox.InboxError,'STORED_SUMMARY_MISMATCH'):inbox.inspect_event(self.db,c['eventId'])
  with sqlite3.connect(self.db) as db:db.execute('UPDATE events SET result_json=NULL,result_sha=? WHERE event_id=?',('bad',c['eventId']))
  with self.assertRaisesRegex(inbox.InboxError,'STORED_RESULT_DIGEST'):inbox.inspect_event(self.db,c['eventId'])
 def test_projection_rejects_active_completion_after_failed_predecessor(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'));p=json.loads(projection(c))
  p['ledger']['packets'].insert(0,{'id':'previous','state':'FAILED','baseSha':c['binding']['baseSha'],'headSha':None,'ciHeadSha':None,'reviewHeadSha':None,'mergeSha':None})
  with self.assertRaisesRegex(inbox.InboxError,'CONTINUATION_PACKET_ORDER'):inbox.complete(self.db,c,'d'*64,continuation_json=json.dumps(p))
 def test_transaction_failure_rolls_back_complete_record_and_unlock_together(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'));other=self.enqueue(2)
  with sqlite3.connect(self.db) as db:db.execute("CREATE TRIGGER fail_unlock BEFORE UPDATE OF active ON meta WHEN NEW.active IS NULL BEGIN SELECT RAISE(ABORT,'injected'); END")
  with self.assertRaisesRegex(inbox.InboxError,'INBOX_STORAGE_ERROR'):complete(self.db,c,'d'*64)
  saved=inbox.inspect_event(self.db,c['eventId']);self.assertEqual(saved['state'],'STARTED');self.assertIsNone(saved['continuationJson'])
  with self.assertRaisesRegex(inbox.InboxError,'INBOX_BUSY'):inbox.claim(self.db,other['eventId'],'worker2')
 def assert_store_rejected_without_changes(self,event,code):
  def snapshot():
   with sqlite3.connect(self.db) as db:return list(db.iterdump())
  before=snapshot()
  for op in (lambda:inbox.inspect_event(self.db,event['eventId']),lambda:inbox.claim(self.db,event['eventId'],'worker2'),lambda:self.enqueue(3)):
   with self.assertRaisesRegex(inbox.InboxError,code):op()
   self.assertEqual(snapshot(),before)
 def test_cleared_or_wrong_active_lock_blocks_recovery_and_new_claim(self):
  first=self.enqueue();other=self.enqueue(2);c=inbox.start(self.db,inbox.claim(self.db,first['eventId'],'worker1'))
  for state in ('STARTED','UNKNOWN'):
   if state=='UNKNOWN':inbox.unknown(self.db,c,'d'*64)
   for active in (None,other['eventId']):
    with self.subTest(state=state,active=active):
     with sqlite3.connect(self.db) as db:db.execute('UPDATE meta SET active=?',(active,))
     self.assert_store_rejected_without_changes(other,'STORED_ACTIVE')
     with sqlite3.connect(self.db) as db:db.execute('UPDATE meta SET active=?',(first['eventId'],))
 def test_corrupt_binding_reports_stable_error_without_mutation_or_content(self):
  corrupt=self.enqueue();other=self.enqueue(2)
  invalid_values=['private-unparseable-content', '{"private":"secret"', 'null', '[]', '42', '"private-secret"', '{}', b'private-blob', '['*1100]
  for field,value in (('repository','wrong'),('headSha',42),('eventIdentity',None)):
   bad=binding();bad[field]=value;invalid_values.append(json.dumps(bad))
  for raw in invalid_values:
   with self.subTest(raw_type=type(raw).__name__):
    with sqlite3.connect(self.db) as db:db.execute('UPDATE events SET binding=? WHERE event_id=?',(raw,corrupt['eventId']))
    def snapshot():
     with sqlite3.connect(self.db) as db:return list(db.iterdump())
    before=snapshot()
    operations=(lambda:inbox.inspect_event(self.db,corrupt['eventId']),lambda:inbox.inspect_event(self.db,other['eventId']),lambda:self.enqueue(),lambda:self.enqueue(3),lambda:inbox.claim(self.db,corrupt['eventId'],'worker1'),lambda:inbox.claim(self.db,other['eventId'],'worker1'))
    for operation in operations:
     with self.assertRaises(inbox.InboxError) as caught:operation()
     self.assertEqual(caught.exception.code,'STORED_BINDING_CORRUPT')
     self.assertEqual(str(caught.exception),'STORED_BINDING_CORRUPT')
     self.assertTrue(caught.exception.__suppress_context__)
     self.assertEqual(snapshot(),before)
 def test_orphan_active_lock_is_rejected(self):
  e=self.enqueue()
  with sqlite3.connect(self.db) as db:db.execute('UPDATE meta SET active=?',(e['eventId'],))
  self.assert_store_rejected_without_changes(e,'STORED_ACTIVE')
 def test_meta_fence_mismatch_is_rejected(self):
  e=self.enqueue();inbox.claim(self.db,e['eventId'],'worker1')
  for fence in (0,2):
   with self.subTest(fence=fence):
    with sqlite3.connect(self.db) as db:db.execute('UPDATE meta SET fence=?',(fence,))
    self.assert_store_rejected_without_changes(e,'STORED_FENCE')
 def test_multiple_unresolved_and_duplicate_fences_are_rejected(self):
  first=self.enqueue();other=self.enqueue(2);inbox.claim(self.db,first['eventId'],'worker1')
  for fence,code in ((2,'STORED_ACTIVE'),(1,'STORED_FENCE')):
   with self.subTest(fence=fence):
    with sqlite3.connect(self.db) as db:
     db.execute("UPDATE events SET state='CLAIMED',owner='worker2',fence=?,attempts=1 WHERE event_id=?",(fence,other['eventId']))
     db.execute('UPDATE meta SET fence=?,active=?',(fence,other['eventId']))
    self.assert_store_rejected_without_changes(other,code)
 def test_inconsistent_queued_and_consumed_fields_are_rejected(self):
  e=self.enqueue()
  for sql in ("UPDATE events SET owner='worker1'","UPDATE events SET fence=1","UPDATE events SET attempts=1"):
   with self.subTest(sql=sql):
    with sqlite3.connect(self.db) as db:db.execute(sql)
    self.assert_store_rejected_without_changes(e,'STORED_STATE')
    with sqlite3.connect(self.db) as db:db.execute('UPDATE events SET owner=NULL,fence=0,attempts=0')
  inbox.claim(self.db,e['eventId'],'worker1')
  with sqlite3.connect(self.db) as db:db.execute('UPDATE events SET attempts=0')
  self.assert_store_rejected_without_changes(e,'STORED_STATE')
 def test_post_operation_invariant_failure_rolls_back_claim(self):
  e=self.enqueue()
  with sqlite3.connect(self.db) as db:
   db.execute("CREATE TRIGGER corrupt_lock AFTER UPDATE OF active ON meta WHEN NEW.active IS NOT NULL BEGIN UPDATE meta SET active=NULL WHERE id=1; END")
  with self.assertRaisesRegex(inbox.InboxError,'STORED_ACTIVE'):inbox.claim(self.db,e['eventId'],'worker1')
  saved=inbox.inspect_event(self.db,e['eventId']);self.assertEqual(saved['state'],'QUEUED');self.assertEqual(saved['attempts'],0);self.assertEqual(saved['fence'],0)
  with sqlite3.connect(self.db) as db:
   self.assertEqual(db.execute('SELECT fence,active FROM meta').fetchone(),(0,None));db.execute('DROP TRIGGER corrupt_lock')
  self.assertEqual(inbox.claim(self.db,e['eventId'],'worker1')['fence'],1)
 def test_process_exit_after_complete_commit_preserves_recoverable_ledger(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'))
  code="import importlib.util,json,os,sys;s=importlib.util.spec_from_file_location('inbox',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.complete(sys.argv[2],json.loads(sys.argv[3]),'d'*64,continuation_json=sys.argv[4]);os._exit(0)"
  child=subprocess.run([sys.executable,'-I','-c',code,str(ROOT/'durable_inbox.py'),self.db,json.dumps(c),projection(c)],capture_output=True,text=True,timeout=10);self.assertEqual(child.returncode,0,child.stderr)
  saved=inbox.inspect_event(self.db,c['eventId']);self.assertEqual(saved['state'],'COMPLETE');self.assertEqual(json.loads(saved['continuationJson'])['ledger']['revision'],5)
  with self.assertRaisesRegex(inbox.InboxError,'ATTEMPT_CONSUMED'):inbox.claim(self.db,c['eventId'],'worker2')
 def test_impossible_decision_state_rejected_on_commit_and_recovery(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'))
  for decision in ('WAITING_CI','WAITING_AGENT','WAITING_REVIEW','WAITING_DRAFT','BLOCKED','RECONCILE_EVENT','RECONCILE_NEW_MANIFEST'):
   with self.subTest(decision=decision):
    p=json.loads(projection(c));p['decision']=decision
    with self.assertRaisesRegex(inbox.InboxError,'CONTINUATION_DECISION_STATE'):inbox.complete(self.db,c,'d'*64,continuation_json=json.dumps(p))
  self.assertEqual(inbox.inspect_event(self.db,c['eventId'])['state'],'STARTED')
  done=complete(self.db,c,'d'*64)
  p=json.loads(done['continuationJson']);p['decision']='BLOCKED';raw=inbox._canonical(p)
  digest=inbox._projection_digest(inbox._canonical(c['binding']),raw)
  with sqlite3.connect(self.db) as db:db.execute('UPDATE events SET continuation_json=?,continuation_sha=? WHERE event_id=?',(raw,digest,c['eventId']))
  with self.assertRaisesRegex(inbox.InboxError,'CONTINUATION_DECISION_STATE'):inbox.inspect_event(self.db,c['eventId'])
 def test_impossible_blocked_merge_reason_rejected_even_after_rehash(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'))
  for state in ('MERGE_WAIT','COMPLETE_MERGED'):
   p=json.loads(projection(c));p.update(decision='BLOCKED',reason='PR_CLOSED');p['ledger']['packets'][0].update(state=state,mergeSha='c'*40)
   with self.assertRaisesRegex(inbox.InboxError,'CONTINUATION_DECISION_STATE'):inbox.complete(self.db,c,'d'*64,continuation_json=json.dumps(p))
  complete(self.db,c,'d'*64)
  raw=inbox._canonical(p);digest=inbox._projection_digest(inbox._canonical(c['binding']),raw)
  with sqlite3.connect(self.db) as db:db.execute('UPDATE events SET continuation_json=?,continuation_sha=?',(raw,digest))
  with self.assertRaisesRegex(inbox.InboxError,'CONTINUATION_DECISION_STATE'):inbox.inspect_event(self.db,c['eventId'])
 def test_actual_adapter_return_branches_survive_projection(self):
  default=ROOT.parent/'event-adapter/scripts/event-continuation-adapter.mjs'
  if not default.is_file():default=ROOT.parent/'event_bridge/scripts/event-continuation-adapter.mjs'
  adapter=pathlib.Path(os.environ.get('MERIDIAN_TEST_ADAPTER',str(default))).resolve()
  spec=importlib.util.spec_from_file_location('actual_adapter_fixtures',adapter.parent.parent/'review-binding/test/test_review_binding.py')
  f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
  script="import {readFileSync} from 'node:fs'; const {reconcileContinuation}=await import(process.argv[1]); console.log(JSON.stringify(reconcileContinuation(JSON.parse(readFileSync(0,'utf8')))));"
  cases=[('ready','READY_FOR_OWNER_DECISION'),('review','WAITING_REVIEW'),('ci','WAITING_CI'),('agent','WAITING_AGENT'),('closed','BLOCKED'),('event','RECONCILE_EVENT'),('main','RECONCILE_NEW_MANIFEST'),('draft','WAITING_DRAFT'),('review-chain','WAITING_REVIEW'),('merge','RECONCILE_NEW_MANIFEST'),('unknown','BLOCKED'),('unknown-merge','BLOCKED'),('unknown-merged','BLOCKED')]
  for mode,decision in cases:
   with self.subTest(mode=mode):
    o,e=f.fixture();x=f.adapter_input(o,e);bound=f.bind(o,e);x['snapshot']['work']['responses']=[bound['plannerResponse']];x['snapshot']['reviewBinding']=bound['reviewBinding']
    packet=x['ledger']['packets'][0];packet.update(state='COMPLETE_DRAFT',reviewHeadSha=f.B)
    if mode in ('review','review-chain'):x['snapshot']['work']['responses'][0].update(requestId='REQ002',opId='OP002',headSha='c'*40)
    if mode=='ci':x['snapshot']['work']['ci']=None
    if mode=='agent':x['snapshot']['work']['execution']='RUNNING'
    if mode=='closed':x['snapshot']['pr']['state']='closed'
    if mode=='event':x['snapshot']['eventBinding']['revisionDigest']='e'*64
    if mode=='main':x['snapshot']['mainSha']='c'*40
    if mode in ('unknown','unknown-merge','unknown-merged'):x['snapshot']['work']['execution']='UNKNOWN'
    if mode in ('merge','unknown-merge','unknown-merged'):packet.update(state='COMPLETE_MERGED' if mode=='unknown-merged' else 'MERGE_WAIT',mergeSha='c'*40)
    if mode=='draft':packet.update(state='CLAIMED',headSha=None,ciHeadSha=None,reviewHeadSha=None)
    if mode=='review-chain':
     x['manifest']['maxInvocations']=2
     second={**x['manifest']['packets'][0],'id':'second','paths':['docs/v11/second.md','test/v11-second.test.js']};x['manifest']['packets'].append(second)
     x['ledger']['manifestDigest']=hashlib.sha256(json.dumps(x['manifest'],separators=(',',':')).encode()).hexdigest()
     x['ledger']['packets'].append({'id':'second','state':'CLAIMED','baseSha':f.A,'headSha':None,'ciHeadSha':None,'reviewHeadSha':None,'mergeSha':None})
    run=subprocess.run(['node','--input-type=module','-e',script,adapter.as_uri()],input=json.dumps(x),capture_output=True,text=True,timeout=30)
    self.assertEqual(run.returncode,0,run.stderr);result=json.loads(run.stdout);self.assertEqual(result['decision'],decision)
    result.pop('planner');result['packetId']='first'
    b={'repository':e['scope']['repository'],'eventIdentity':result['eventIdentity'],'revisionDigest':result['revisionDigest'],'headSha':f.B,'baseSha':f.A,'payloadSha256':hashlib.sha256(json.dumps(x).encode()).hexdigest()}
    db=str(pathlib.Path(self.temp.name)/(mode+'.sqlite'));inbox.initialize(db);queued=inbox.enqueue(db,b);c=inbox.start(db,inbox.claim(db,queued['eventId'],'worker1'))
    done=inbox.complete(db,c,'d'*64,continuation_json=json.dumps(result));self.assertEqual(inbox.inspect_event(db,c['eventId']),done)
    if mode=='review-chain':self.assertTrue(result['ledger']['revoked']);self.assertEqual(result['ledger']['packets'][0]['state'],'UNKNOWN_OUTCOME')
 def test_authority_always_false(self):
  r=self.enqueue()
  for key in ('authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','mayWrite','distributed'):self.assertIs(r[key],False)

if __name__=='__main__':unittest.main(verbosity=2)
