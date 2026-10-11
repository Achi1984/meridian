import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import check_executor as executor
import check_journal as journal
import durable_check as durable
import test_check_executor as executor_tests

HERE=Path(__file__).resolve().parent
class DurableCheckTests(unittest.TestCase):
    git=executor_tests.CheckExecutorTests.git
    commit=executor_tests.CheckExecutorTests.commit
    update=executor_tests.CheckExecutorTests.update
    def setUp(self):
        executor_tests.CheckExecutorTests.setUp(self)
        self.storage=tempfile.TemporaryDirectory();self.addCleanup(self.storage.cleanup)
        self.db=Path(self.storage.name)/'checks.sqlite';journal.initialize(self.db)
    def run_check(self):return durable.run_check_once(self.db,self.root,self.scope)
    def test_real_execution_and_exact_recovery(self):
        actual=self.run_check();self.assertEqual(actual['state'],'COMPLETE')
        self.assertEqual(actual['receipt']['check']['status'],'passed')
        recovered=durable.recover_completed_check(self.db,self.scope)
        self.assertEqual(actual,recovered)
        for flag in executor.FLAGS:self.assertIs(actual[flag],False)
        with self.assertRaises(ValueError):self.run_check()
    def test_failed_process_receipt_preserved(self):
        self.update("process.exit(9)")
        actual=self.run_check();self.assertEqual(actual['state'],'COMPLETE')
        self.assertEqual(actual['receipt']['check']['status'],'failed')
        self.assertEqual(actual,durable.recover_completed_check(self.db,self.scope))
    def crash_child(self,hook):
        code="""
import json,os,sys
sys.path.insert(0,sys.argv[1])
import durable_check as durable
x=json.load(sys.stdin)
fn=getattr(durable.journal,x['hook'])
def crash(*args,**kwargs):
    fn(*args,**kwargs)
    os._exit(17)
setattr(durable.journal,x['hook'],crash)
durable.run_check_once(x['db'],x['root'],x['scope'])
"""
        return subprocess.run([sys.executable,'-B','-c',code,str(HERE)],input=json.dumps({'db':str(self.db),'root':str(self.root),'scope':self.scope,'hook':hook}),text=True,capture_output=True,timeout=15)
    def test_actual_child_after_commit_recovers_in_new_process_without_execution(self):
        self.assertEqual(self.crash_child('complete').returncode,17)
        stored=journal.recover(self.db,self.scope,executor.CHECK_ID,executor.COMMAND_SHA256)
        self.assertEqual(stored['state'],'COMPLETE')
        # Remove checkout entirely: read-only recovery cannot run the fixed command.
        import shutil
        shutil.rmtree(self.root)
        code="""
import json,sys
sys.path.insert(0,sys.argv[1])
import durable_check
x=json.load(sys.stdin)
print(json.dumps(durable_check.recover_completed_check(x['db'],x['scope'])))
"""
        child=subprocess.run([sys.executable,'-B','-c',code,str(HERE)],input=json.dumps({'db':str(self.db),'scope':self.scope}),text=True,capture_output=True,timeout=10,check=True)
        recovered=json.loads(child.stdout)
        self.assertEqual(recovered['receipt'],stored['receipt'])
        self.assertEqual(recovered['receipt']['check']['status'],'passed')
        with self.assertRaises(ValueError):self.run_check()
    def test_actual_child_after_started_stays_locked_without_execution(self):
        self.assertEqual(self.crash_child('mark_started').returncode,17)
        record=journal.recover(self.db,self.scope,executor.CHECK_ID,executor.COMMAND_SHA256)
        self.assertEqual(record['state'],'STARTED');self.assertIsNone(record['receipt'])
        with self.assertRaises(ValueError):self.run_check()
        with self.assertRaises(ValueError):durable.recover_completed_check(self.db,self.scope)
    def test_dirty_is_unknown_not_retryable(self):
        self.script.write_text('//dirty')
        result=self.run_check();self.assertEqual(result['state'],'UNKNOWN');self.assertIsNone(result['receipt'])
        with self.assertRaises(ValueError):self.run_check()
    def test_timeout_is_unknown_not_retryable(self):
        self.update('setInterval(()=>{},1000)')
        result=durable.run_check_once(self.db,self.root,self.scope,.1)
        self.assertEqual(result['state'],'UNKNOWN');self.assertIsNone(result['receipt'])
        with self.assertRaises(ValueError):self.run_check()
    def test_missing_storage_after_started_is_unsettled(self):
        start=journal.mark_started
        def remove(*args):
            record=start(*args);self.db.unlink();return record
        with patch.object(journal,'mark_started',side_effect=remove):result=self.run_check()
        self.assertEqual(result['state'],'UNSETTLED');self.assertFalse(result['persistConfirmed']);self.assertFalse(self.db.exists())
    def test_mismatched_scope_and_journal_inside_checkout(self):
        self.run_check();wrong=copy.deepcopy(self.scope);wrong['opId']='OTHER'
        with self.assertRaises(ValueError):durable.recover_completed_check(self.db,wrong)
        with self.assertRaisesRegex(ValueError,'JOURNAL_INSIDE_CHECKOUT'):durable.run_check_once(self.root/'checks.sqlite',self.root,self.scope)

if __name__=='__main__':unittest.main()
