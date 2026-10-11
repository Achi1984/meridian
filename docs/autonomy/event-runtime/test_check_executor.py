import copy
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import check_executor as executor

class CheckExecutorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.git('init','-q');self.git('config','user.name','Synthetic Test');self.git('config','user.email','synthetic@example.invalid')
        self.git('commit','--allow-empty','-qm','Synthetic base');base=self.git('rev-parse','HEAD').strip()
        self.script=self.root/executor.COMMAND[2];self.script.parent.mkdir(parents=True)
        self.script.write_text("import test from 'node:test';import assert from 'node:assert/strict';test('local synthetic',()=>assert.equal(2+2,4));")
        self.commit();head=self.git('rev-parse','HEAD').strip()
        self.scope={'repository':'Achi1984/meridian','requestId':'REQ001','opId':'OP001','headSha':head,'baseSha':base,'prNumber':704,'ci':{'runId':1,'runAttempt':1,'workflowId':2,'headSha':head}}
    def git(self,*args):return subprocess.check_output(['git',*args],cwd=self.root,stderr=subprocess.DEVNULL,text=True)
    def commit(self):self.git('add','.');self.git('commit','-qm','Synthetic local fixture')
    def update(self,source):
        self.script.write_text(source);self.commit();head=self.git('rev-parse','HEAD').strip();self.scope['headSha']=head;self.scope['ci']['headSha']=head
    def test_actual_fixed_sibling_adapter_suite(self):
        source=Path(__file__).resolve().parent.parent/'event-adapter'
        if not source.is_dir():source=Path(__file__).resolve().parent.parent/'event_bridge'
        target=self.root/'docs/autonomy/event-adapter'
        shutil.rmtree(target);shutil.copytree(source,target,ignore=shutil.ignore_patterns('__pycache__','.git'))
        self.commit();head=self.git('rev-parse','HEAD').strip();self.scope['headSha']=head;self.scope['ci']['headSha']=head
        r=executor.execute_check(self.root,self.scope)
        self.assertEqual(r['check']['status'],'passed');self.assertEqual(r['exitCode'],0)
        self.assertTrue(r['check']['executed']);self.assertEqual(r['check']['headSha'],head)
        self.assertEqual(len(r['stdoutSha256']),64)
        for flag in executor.FLAGS:self.assertIs(r[flag],False)
    def test_nonzero_is_failed_not_promoted(self):
        self.update("process.stderr.write('private-marker');process.exit(7)")
        r=executor.execute_check(self.root,self.scope);self.assertEqual(r['check']['status'],'failed');self.assertNotEqual(r['exitCode'],0)
        self.assertNotIn('private-marker',str(r))
    def test_dirty_untracked_ignored_rejected(self):
        self.script.write_text('//dirty')
        with self.assertRaisesRegex(ValueError,'CHECKOUT_NOT_CLEAN'):executor.execute_check(self.root,self.scope)
        self.git('checkout','--','.');(self.root/'untracked').write_text('x')
        with self.assertRaisesRegex(ValueError,'CHECKOUT_NOT_CLEAN'):executor.execute_check(self.root,self.scope)
        (self.root/'untracked').unlink();(self.root/'.gitignore').write_text('ignored\n');self.commit();head=self.git('rev-parse','HEAD').strip();self.scope['headSha']=head;self.scope['ci']['headSha']=head
        (self.root/'ignored').write_text('x')
        with self.assertRaisesRegex(ValueError,'CHECKOUT_NOT_CLEAN'):executor.execute_check(self.root,self.scope)
    def test_wrong_head_and_missing_base(self):
        wrong=copy.deepcopy(self.scope);wrong['headSha']='a'*40;wrong['ci']['headSha']='a'*40
        with self.assertRaisesRegex(ValueError,'HEAD_MOVED'):executor.execute_check(self.root,wrong)
        wrong=copy.deepcopy(self.scope);wrong['baseSha']='a'*40
        with self.assertRaisesRegex(ValueError,'GIT_READ_FAILED'):executor.execute_check(self.root,wrong)
    def test_changes_during_execution_rejected(self):
        self.update("import fs from 'node:fs';fs.writeFileSync('untracked','x')")
        with self.assertRaisesRegex(ValueError,'CHECKOUT_NOT_CLEAN'):executor.execute_check(self.root,self.scope)
    def test_timeout_and_stream_bounds(self):
        self.update('setInterval(()=>{},1000)')
        with self.assertRaisesRegex(ValueError,'PROCESS_TIMEOUT'):executor.execute_check(self.root,self.scope,.1)
        self.update("process.stdout.write('x'.repeat(1000000))")
        with self.assertRaisesRegex(ValueError,'PROCESS_OUTPUT_BOUND'):executor.execute_check(self.root,self.scope)
    def test_identical_head_base_rejected(self):
        scope=copy.deepcopy(self.scope);scope['baseSha']=scope['headSha']
        with self.assertRaisesRegex(ValueError,'HEAD_BASE_IDENTICAL'):executor.execute_check(self.root,scope)
    def test_local_clean_filter_never_executes(self):
        (self.root/'.gitattributes').write_text('*.mjs filter=hostile\n');self.commit()
        head=self.git('rev-parse','HEAD').strip();self.scope['headSha']=head;self.scope['ci']['headSha']=head
        marker=self.root/'filter-executed'
        self.git('config','filter.hostile.clean','touch '+str(marker))
        # Force status to inspect modified tracked content if it were reached.
        self.script.write_text(self.script.read_text()+'\n')
        with self.assertRaisesRegex(ValueError,'GIT_FILTER_UNSUPPORTED'):executor.execute_check(self.root,self.scope)
        self.assertFalse(marker.exists())
    def test_partial_clone_rejected_before_object_reads(self):
        from unittest.mock import patch
        actual=executor._run
        for key in ('extensions.partialClone','remote.origin.promisor','remote.origin.partialCloneFilter'):
            self.git('config',key,'true')
            calls=[]
            def run(argv,*args):
                calls.append(argv)
                self.assertEqual(args[-1]['GIT_NO_LAZY_FETCH'],'1')
                return actual(argv,*args)
            with patch.object(executor,'_run',side_effect=run):
                with self.assertRaisesRegex(ValueError,'GIT_PARTIAL_CLONE_UNSUPPORTED'):executor.execute_check(self.root,self.scope)
            self.assertFalse(any('cat-file' in argv or 'merge-base' in argv for argv in calls))
            self.git('config','--unset',key)
    def test_negative_process_return_rejected(self):
        from unittest.mock import patch
        actual=executor._run
        def run(argv,*args):
            if '--test' in argv:return -9,b'',b''
            return actual(argv,*args)
        with patch.object(executor,'_run',side_effect=run):
            with self.assertRaisesRegex(ValueError,'PROCESS_SIGNAL_EXIT'):executor.execute_check(self.root,self.scope)
    def test_environment_injection_removed(self):
        self.update("if(process.env.NODE_OPTIONS||process.env.GH_TOKEN)process.exit(2)")
        old={key:os.environ.get(key) for key in ('NODE_OPTIONS','GH_TOKEN')}
        try:
            os.environ['NODE_OPTIONS']='--invalid';os.environ['GH_TOKEN']='synthetic-marker'
            self.assertEqual(executor.execute_check(self.root,self.scope)['check']['status'],'passed')
        finally:
            for key,value in old.items():
                if value is None:os.environ.pop(key,None)
                else:os.environ[key]=value

if __name__=='__main__':unittest.main()
