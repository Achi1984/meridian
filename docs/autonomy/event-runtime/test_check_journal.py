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
sys.path.insert(0,str(ROOT))
import check_journal as j
import check_executor as e

def scope(n=1):return {'repository':'Achi1984/meridian','requestId':'REQ'+str(n),'opId':'OP'+str(n),'headSha':'a'*40,'baseSha':'b'*40,'prNumber':703,'ci':{'runId':123,'runAttempt':1,'workflowId':456,'headSha':'a'*40}}
def receipt(s,code=0):
 r={'kind':'LOCAL_CHECK_EXECUTION','scope':s,'commandSha256':e.COMMAND_SHA256,'exitCode':code,'stdoutSha256':e.digest(b'out'),'stderrSha256':e.digest(b''),'startedAt':'2026-10-11T20:00:00.000000Z','finishedAt':'2026-10-11T20:00:01.000000Z',**e.FLAGS}
 r['evidenceSha256']=e.digest(e.canonical(r).encode());r['check']={'id':e.CHECK_ID,'commandSha256':e.COMMAND_SHA256,'executed':True,'status':'passed' if code==0 else 'failed','exitCode':code,'evidenceSha256':r['evidenceSha256'],**{k:s[k] for k in ('headSha','baseSha','requestId','ci')}};return r
class Tests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.db=str(pathlib.Path(self.tmp.name)/'checks.sqlite');j.initialize(self.db)
 def tearDown(self):self.tmp.cleanup()
 def reserve(self,n=1):return j.reserve(self.db,scope(n),e.CHECK_ID,e.COMMAND_SHA256)
 def recover(self,n=1):return j.recover(self.db,scope(n),e.CHECK_ID,e.COMMAND_SHA256)
 def test_explicit_init_missing_corrupt_schema(self):
  with self.assertRaises(j.JournalError):j.initialize(self.db)
  with self.assertRaises(j.JournalError):j.reserve(self.db+'missing',scope(),e.CHECK_ID,e.COMMAND_SHA256)
  with sqlite3.connect(self.db) as c:c.execute('PRAGMA user_version=2')
  with self.assertRaises(j.JournalError):self.reserve()
 def test_receipt_success_and_failure_roundtrip_preserve_status(self):
  for n,code in ((1,0),(2,3)):
   r=self.reserve(n)
   with self.assertRaises(j.JournalError):j.complete(self.db,r,receipt(scope(n),code))
   r=j.mark_started(self.db,r);done=j.complete(self.db,r,receipt(scope(n),code));self.assertEqual(self.recover(n),done);self.assertEqual(done['receipt']['exitCode'],code)
   with self.assertRaisesRegex(j.JournalError,'ATTEMPT_CONSUMED'):self.reserve(n)
 def test_unknown_and_started_never_replay(self):
  r=j.mark_started(self.db,self.reserve());j.mark_unknown(self.db,r)
  with self.assertRaisesRegex(j.JournalError,'ATTEMPT_CONSUMED'):self.reserve()
  with self.assertRaisesRegex(j.JournalError,'JOURNAL_BUSY'):self.reserve(2)
  self.assertEqual(self.recover()['state'],'UNKNOWN')
 def test_catalog_scope_and_fence_rejected(self):
  with self.assertRaises(j.JournalError):j.reserve(self.db,scope(),'arbitrary','a'*64)
  r=self.reserve();bad={**r,'fence':r['fence']+1}
  with self.assertRaises(j.JournalError):j.mark_started(self.db,bad)
  self.assertEqual(self.recover()['state'],'RESERVED')
 def test_receipt_tamper_and_self_hash_cannot_rebind(self):
  r=j.mark_started(self.db,self.reserve())
  for edit in (lambda x:x.update(stdoutSha256='bad'),lambda x:x.update(exitCode=True),lambda x:x.update(authenticated=True),lambda x:x.update(rawOutput='secret'),lambda x:x['scope'].update(prNumber=True),lambda x:x['check'].update(status='failed'),lambda x:x.update(finishedAt='2026-10-10T20:00:00.000000Z')):
   x=receipt(scope());edit(x)
   with self.assertRaises(j.JournalError):j.complete(self.db,r,x)
  with self.assertRaises(j.JournalError):j.complete(self.db,r,receipt(scope(2)))
  self.assertEqual(self.recover()['state'],'STARTED')
 def test_corrupt_saved_receipt_rejected(self):
  r=j.mark_started(self.db,self.reserve());j.complete(self.db,r,receipt(scope()))
  with sqlite3.connect(self.db) as c:c.execute("UPDATE checks SET digest=?",('f'*64,))
  with self.assertRaises(j.JournalError):self.recover()
 def test_atomic_failure_keeps_started_and_scope_lock(self):
  r=j.mark_started(self.db,self.reserve())
  with sqlite3.connect(self.db) as c:c.execute("CREATE TRIGGER abort_unlock BEFORE UPDATE OF active ON meta WHEN NEW.active IS NULL BEGIN SELECT RAISE(ABORT,'injected'); END")
  with self.assertRaises(j.JournalError):j.complete(self.db,r,receipt(scope()))
  self.assertEqual(self.recover()['state'],'STARTED');self.assertIsNone(self.recover()['receipt'])
  with self.assertRaises(j.JournalError):self.reserve(2)
 def test_corrupt_global_lock_and_fence_never_unlock_unresolved(self):
  r=j.mark_started(self.db,self.reserve());j.mark_unknown(self.db,r)
  with sqlite3.connect(self.db) as c:c.execute('UPDATE meta SET active=NULL')
  with self.assertRaisesRegex(j.JournalError,'STORED_ACTIVE'):self.reserve(2)
  with self.assertRaisesRegex(j.JournalError,'STORED_ACTIVE'):self.recover()
  with sqlite3.connect(self.db) as c:c.execute('UPDATE meta SET active=?,fence=9',(r['key'],))
  with self.assertRaisesRegex(j.JournalError,'STORED_FENCE'):self.recover()
 def test_rehashed_boolean_scope_cannot_equal_integer_pin(self):
  s=scope();s['prNumber']=1;r=j.reserve(self.db,s,e.CHECK_ID,e.COMMAND_SHA256);r=j.mark_started(self.db,r)
  x=receipt(s);x['scope']=dict(s,prNumber=True)
  record={k:v for k,v in x.items() if k not in ('check','evidenceSha256')};x['evidenceSha256']=e.digest(e.canonical(record).encode());x['check']['evidenceSha256']=x['evidenceSha256']
  with self.assertRaisesRegex(j.JournalError,'RECEIPT_BINDING'):j.complete(self.db,r,x)
 def test_capacity_no_pruning(self):
  old=j.MAX_ROWS;j.MAX_ROWS=0
  try:
   with self.assertRaisesRegex(j.JournalError,'JOURNAL_CAPACITY'):self.reserve()
  finally:j.MAX_ROWS=old
 def test_process_race_and_crash_after_start(self):
  script="import sys,json,os;sys.path.insert(0,sys.argv[1]);import check_journal as j,check_executor as e\ntry:\n r=j.reserve(sys.argv[2],json.loads(sys.argv[3]),e.CHECK_ID,e.COMMAND_SHA256);j.mark_started(sys.argv[2],r);print('ok',flush=True)\nexcept j.JournalError:print('blocked',flush=True)\nos._exit(0)"
  ps=[subprocess.Popen([sys.executable,'-I','-c',script,str(ROOT),self.db,json.dumps(scope())],stdout=subprocess.PIPE,text=True) for _ in range(4)]
  outputs=[p.communicate(timeout=15)[0].strip() for p in ps];self.assertEqual(outputs.count('ok'),1);self.assertEqual(self.recover()['state'],'STARTED')
  with self.assertRaises(j.JournalError):self.reserve()
 def test_process_crash_after_commit_recovers(self):
  r=j.mark_started(self.db,self.reserve())
  script="import sys,json,os;sys.path.insert(0,sys.argv[1]);import check_journal as j;j.complete(sys.argv[2],json.loads(sys.argv[3]),json.loads(sys.argv[4]));os._exit(0)"
  p=subprocess.run([sys.executable,'-I','-c',script,str(ROOT),self.db,json.dumps(r),json.dumps(receipt(scope()))],timeout=15);self.assertEqual(p.returncode,0);self.assertEqual(self.recover()['state'],'COMPLETE')
if __name__=='__main__':unittest.main(verbosity=2)
