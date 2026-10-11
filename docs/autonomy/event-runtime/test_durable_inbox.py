import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest
ROOT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('inbox',ROOT/'durable_inbox.py');inbox=importlib.util.module_from_spec(spec);spec.loader.exec_module(inbox)

def binding(n=1):return {'repository':'Achi1984/meridian','eventIdentity':'workflow-run:Achi1984/meridian:456:1:completed','revisionDigest':hashlib.sha256(str(n).encode()).hexdigest(),'headSha':'a'*40,'baseSha':'b'*40,'payloadSha256':'c'*64}
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
  with self.assertRaisesRegex(inbox.InboxError,'INVALID_SETTLEMENT'):inbox.complete(self.db,c,'d'*64)
  started=inbox.start(self.db,c);summary=json.dumps({'decision':'WAITING_REVIEW','reason':'CI_ACCEPTED'})
  done=inbox.complete(self.db,started,'d'*64,summary);self.assertEqual(done['state'],'COMPLETE');self.assertEqual(done['resultJson'],summary);self.assertEqual(done['resultSha256'],'d'*64)
  self.assertEqual(inbox.inspect_event(self.db,e['eventId']),done)
  with self.assertRaisesRegex(inbox.InboxError,'ATTEMPT_CONSUMED'):inbox.claim(self.db,e['eventId'],'worker1')
  self.assertEqual(inbox.enqueue(self.db,binding())['state'],'COMPLETE')
 def test_unknown_retains_scope_and_never_retries(self):
  first=self.enqueue();other=self.enqueue(2);c=inbox.start(self.db,inbox.claim(self.db,first['eventId'],'worker1'));u=inbox.unknown(self.db,c,'d'*64)
  self.assertEqual(u['state'],'UNKNOWN')
  with self.assertRaisesRegex(inbox.InboxError,'ATTEMPT_CONSUMED'):inbox.claim(self.db,first['eventId'],'worker2')
  with self.assertRaisesRegex(inbox.InboxError,'INBOX_BUSY'):inbox.claim(self.db,other['eventId'],'worker2')
  with self.assertRaisesRegex(inbox.InboxError,'INVALID_SETTLEMENT'):inbox.complete(self.db,c,'d'*64)
 def test_claimed_unknown_also_holds_scope(self):
  e=self.enqueue();c=inbox.claim(self.db,e['eventId'],'worker1');self.assertEqual(inbox.unknown(self.db,c,'d'*64)['state'],'UNKNOWN')
 def test_fences_monotonic_and_old_claim_rejected(self):
  e=self.enqueue();c=inbox.start(self.db,inbox.claim(self.db,e['eventId'],'worker1'));inbox.complete(self.db,c,'d'*64)
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
   with self.assertRaises(inbox.InboxError):inbox.complete(self.db,c,'d'*64,text)
  self.assertEqual(inbox.inspect_event(self.db,c['eventId'])['state'],'STARTED')
 def test_summary_unknown_cannot_release_scope_or_mislabel_unknown(self):
  c=inbox.start(self.db,inbox.claim(self.db,self.enqueue()['eventId'],'worker1'));other=self.enqueue(2)
  with self.assertRaisesRegex(inbox.InboxError,'OUTCOME_SUMMARY_CONFLICT'):inbox.complete(self.db,c,'d'*64,json.dumps({'decision':'UNKNOWN','reason':'LOST_PROCESS'}))
  with self.assertRaisesRegex(inbox.InboxError,'INBOX_BUSY'):inbox.claim(self.db,other['eventId'],'worker2')
  with self.assertRaisesRegex(inbox.InboxError,'OUTCOME_SUMMARY_CONFLICT'):inbox.unknown(self.db,c,'d'*64,json.dumps({'decision':'BLOCKED','reason':'LOST_PROCESS'}))
  self.assertEqual(inbox.unknown(self.db,c,'d'*64,json.dumps({'decision':'UNKNOWN','reason':'LOST_PROCESS'}))['state'],'UNKNOWN')
 def test_unexpected_fields_and_bad_bindings_rejected(self):
  for edit in [lambda b:b.update(repository='other/repo'),lambda b:b.update(headSha='bad'),lambda b:b.update(rawBody='secret'),lambda b:b.update(eventIdentity='x'*321),lambda b:b.update(revisionDigest=True)]:
   b=binding();edit(b)
   with self.assertRaises(inbox.InboxError):inbox.enqueue(self.db,b)
 def test_authority_always_false(self):
  r=self.enqueue()
  for key in ('authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','mayWrite','distributed'):self.assertIs(r[key],False)

if __name__=='__main__':unittest.main(verbosity=2)
