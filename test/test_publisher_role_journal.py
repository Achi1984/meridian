import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
for name in ('publisher_role_cycle','publisher_role_transition','publisher_role_journal'):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/(name+'.py'))
    module=importlib.util.module_from_spec(spec); sys.modules[name]=module; spec.loader.exec_module(module)
m=sys.modules['publisher_role_journal']


def binding(direction='activation',operation='1'*32):
    t=m.transition
    return {'operation_id':operation,'cycle_id':'2'*32,'direction':direction,'source_sha':'3'*40,
            'baseline_sha256':'4'*64,'manifest_sha256':t.MANIFEST,'workflow_sha':'5'*40,
            'approval_ref':'12345','target':dict(t.TARGET)}


def finish(journal,b,status='CONFIRMED'):
    if status=='CONFIRMED':
        journal.record(b,'mutation_started','PENDING'); journal.record(b,'commit_started','PENDING')
    journal.record(b,'finished',status)


CHILD = r'''
import importlib.util,json,sys
from pathlib import Path
base=Path(sys.argv[1])
for name in ('publisher_role_cycle','publisher_role_transition','publisher_role_journal'):
 spec=importlib.util.spec_from_file_location(name,base/'scripts'/(name+'.py'))
 module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
m=sys.modules['publisher_role_journal']; b=json.loads(sys.argv[3])
if sys.argv[4]=='race': sys.stdin.read(1)
j=m.LocalRoleJournal(Path(sys.argv[2]))
try:
 try: print('WON' if j.claim(b) else 'BLOCKED',flush=True)
 except (ValueError,OSError): print('BLOCKED',flush=True)
 if sys.argv[4]=='hold': sys.stdin.read(1)
finally: j.close()
'''


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='role-journal-test-')
        self.parent=Path(self.temp.name); self.parent.chmod(0o700)
        self.root=self.parent/'journal'; self.root.mkdir(mode=0o700)
        self.b=binding(); self.cycle=self.root/self.b['cycle_id']
    def tearDown(self): self.temp.cleanup()
    def open(self): return m.LocalRoleJournal(self.root)
    def child(self,b,mode):
        return subprocess.Popen([sys.executable,'-I','-B','-c',CHILD,str(ROOT),str(self.root),json.dumps(b),mode],
                                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)

    def test_claim_and_stages_are_private_and_survive_restart(self):
        with self.open() as j:
            self.assertTrue(j.claim(self.b)); finish(j,self.b)
            self.assertEqual(j.phase,'finished')
        self.assertEqual(self.cycle.stat().st_mode&0o777,0o700)
        for file in self.cycle.iterdir(): self.assertEqual(file.stat().st_mode&0o777,0o600)
        with self.open() as j: self.assertFalse(j.claim(binding(operation='9'*32)))
        with self.open() as j:
            closure=binding('closure','6'*32); self.assertTrue(j.claim(closure)); finish(j,closure)
        with self.open() as j: self.assertFalse(j.claim(binding('closure','7'*32)))

    def test_lost_claim_ack_is_consumed_after_restart(self):
        with self.open() as j:
            self.assertTrue(j.claim(self.b))
            # Caller lost the successful acknowledgement; no resume is available.
        with self.open() as j: self.assertFalse(j.claim(self.b))
        with self.open() as j:
            with self.assertRaises(ValueError): j.claim(binding('closure'))

    def test_unfinished_failed_and_indeterminate_activation_block_closure(self):
        for status in (None,'FAILED','INDETERMINATE'):
            with self.subTest(status=status):
                root=self.parent/('case-'+str(status)); root.mkdir(mode=0o700)
                with m.LocalRoleJournal(root) as j:
                    j.claim(self.b)
                    if status: finish(j,self.b,status)
                with m.LocalRoleJournal(root) as j:
                    with self.assertRaises(ValueError): j.claim(binding('closure'))

    def test_full_common_binding_required_for_other_direction(self):
        with self.open() as j: j.claim(self.b); finish(j,self.b)
        for key in ('source_sha','baseline_sha256','workflow_sha','approval_ref'):
            # Separate immutable copy: a rejected request poisons that cycle.
            import shutil
            root=self.parent/key; shutil.copytree(self.root,root)
            b=binding('closure'); b[key]='9'*len(b[key])
            with m.LocalRoleJournal(root) as j:
                with self.assertRaises(ValueError): j.claim(b)
        with self.open() as j:
            b=binding('closure'); b['target']['host']='other'
            with self.assertRaises(ValueError): j.claim(b)

    def test_fresh_handle_cannot_record_even_with_exact_binding(self):
        with self.open() as j: j.claim(self.b)
        with self.open() as j:
            self.assertFalse(j.claim(self.b))
            with self.assertRaises(ValueError): j.record(self.b,'finished','FAILED')

    def test_lifetime_lock_extends_through_finished_until_close(self):
        j=self.open(); j.claim(self.b); finish(j,self.b)
        try:
            with self.open() as other:
                with self.assertRaises(ValueError): other.claim(binding('closure'))
        finally: j.close()
        with self.open() as other: self.assertTrue(other.claim(binding('closure')))

    def test_subprocess_race_only_one_distinct_operation_wins(self):
        children=[self.child(binding(operation=str(n)*32),'race') for n in (1,2,3)]
        try:
            for child in children: child.stdin.write('x'); child.stdin.flush()
            outputs=[child.communicate(timeout=10)[0].strip() for child in children]
            self.assertEqual(outputs.count('WON'),1); self.assertEqual(outputs.count('BLOCKED'),2)
            self.assertTrue(all(child.returncode==0 for child in children))
        finally:
            for child in children:
                if child.poll() is None: child.kill()
                child.wait(timeout=3)

    def test_partial_initialization_is_excluded_from_contenders(self):
        original=m.LocalRoleJournal._write
        checked=[]
        def delayed(journal,name,value):
            if name=='cycle.json':
                child=self.child(binding(operation='9'*32),'race')
                output,error=child.communicate('x',timeout=10)
                self.assertEqual(child.returncode,0,error)
                self.assertEqual(output.strip(),'BLOCKED')
                checked.append(True)
            return original(journal,name,value)
        with self.open() as j:
            with mock.patch.object(m.LocalRoleJournal,'_write',new=delayed):
                self.assertTrue(j.claim(self.b))
            self.assertFalse((self.cycle/'blocked.json').exists())
            finish(j,self.b)
            # Root publication lock is released while the cycle lock stays held.
            other=dict(self.b,cycle_id='8'*32)
            with self.open() as second: self.assertTrue(second.claim(other))
        self.assertEqual(checked,[True])

    def test_crashed_subprocess_claim_cannot_resume_or_allow_closure(self):
        child=self.child(self.b,'hold')
        try:
            self.assertEqual(child.stdout.readline().strip(),'WON')
            child.kill(); child.wait(timeout=3)
            with self.open() as j: self.assertFalse(j.claim(self.b))
            with self.open() as j:
                with self.assertRaises(ValueError): j.claim(binding('closure'))
        finally:
            if child.poll() is None: child.kill(); child.wait(timeout=3)
            child.stdin.close(); child.stdout.close(); child.stderr.close()

    def test_invalid_stage_order_poison_is_persistent(self):
        with self.open() as j:
            j.claim(self.b)
            with self.assertRaises(ValueError): j.record(self.b,'finished','CONFIRMED')
            self.assertTrue(j.poisoned)
            with self.assertRaises(ValueError): j.record(self.b,'finished','FAILED')
        self.assertTrue((self.cycle/'blocked.json').exists())
        with self.open() as j:
            with self.assertRaises(ValueError): j.claim(self.b)

    def test_record_binding_change_never_writes_clean_final(self):
        with self.open() as j:
            j.claim(self.b); changed=binding(operation='9'*32)
            with self.assertRaises(ValueError): j.record(changed,'finished','FAILED')
        self.assertFalse((self.cycle/'activation.03-finished.json').exists())

    def test_corrupt_duplicate_or_out_of_order_evidence_blocks(self):
        for label,data,name in (
            ('truncated',b'{','activation.claim.json'),
            ('duplicate',b'{"schema":1,"schema":1}\n','activation.claim.json'),
            ('nonfinite',b'{"schema":NaN}\n','activation.claim.json'),
            ('unexpected',b'{}\n','unrelated.json'),
            ('order',m._encode({'schema':1,'binding_sha256':m.hashlib.sha256(m._encode(self.b)).hexdigest(),'stage':'commit_started','status':'PENDING'}),'activation.02-commit.json')):
            root=self.parent/label; root.mkdir(mode=0o700)
            with m.LocalRoleJournal(root) as j: j.claim(self.b)
            file=root/self.b['cycle_id']/name; file.write_bytes(data); file.chmod(0o600)
            with m.LocalRoleJournal(root) as j:
                with self.assertRaises(ValueError): j.claim(self.b)

    def test_short_write_consumes_and_blocks_restart(self):
        original=m.os.write
        def short(fd,data): return original(fd,data[:max(1,len(data)//2)])
        with self.open() as j:
            with mock.patch.object(m.os,'write',side_effect=short):
                with self.assertRaises(ValueError): j.claim(self.b)
            self.assertTrue(j.poisoned)
        with self.open() as j:
            with self.assertRaises(ValueError): j.claim(self.b)

    def test_fsync_failure_at_each_claim_boundary_fails_closed(self):
        original=m.os.fsync
        for boundary in range(1,6):
            root=self.parent/('fsync-'+str(boundary)); root.mkdir(mode=0o700)
            calls=[0]
            def fail(fd):
                calls[0]+=1
                if calls[0]==boundary: raise OSError('synthetic fsync')
                return original(fd)
            with m.LocalRoleJournal(root) as j:
                with mock.patch.object(m.os,'fsync',side_effect=fail):
                    with self.assertRaises(ValueError): j.claim(self.b)
                self.assertTrue(j.poisoned)
            with m.LocalRoleJournal(root) as j:
                with self.assertRaises(ValueError): j.claim(self.b)

    def test_finished_fsync_failure_cannot_be_reported_clean(self):
        with self.open() as j:
            j.claim(self.b); j.record(self.b,'mutation_started','PENDING'); j.record(self.b,'commit_started','PENDING')
            with mock.patch.object(m.os,'fsync',side_effect=OSError('synthetic failure')):
                with self.assertRaises(ValueError): j.record(self.b,'finished','CONFIRMED')
            self.assertTrue(j.poisoned)
            with self.assertRaises(ValueError): j.record(self.b,'finished','CONFIRMED')
        with self.open() as j:
            with self.assertRaises(ValueError): j.claim(binding('closure'))

    def test_symlinks_hardlinks_modes_and_parent_are_rejected(self):
        alias=self.parent/'alias'; alias.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(OSError): m.LocalRoleJournal(alias)
        with self.open() as j: j.claim(self.b)
        file=self.cycle/'activation.claim.json'; original=file.read_bytes(); file.unlink()
        other=self.parent/'other'; other.write_bytes(original); other.chmod(0o600); file.symlink_to(other)
        with self.open() as j:
            with self.assertRaises(ValueError): j.claim(self.b)
        hard_root=self.parent/'hard'; hard_root.mkdir(mode=0o700)
        with m.LocalRoleJournal(hard_root) as j: j.claim(self.b)
        source=hard_root/self.b['cycle_id']/'activation.claim.json'
        os.link(source,self.parent/'hardlink')
        with m.LocalRoleJournal(hard_root) as j:
            with self.assertRaises(ValueError): j.claim(self.b)
        fifo_root=self.parent/'fifo'; fifo_root.mkdir(mode=0o700)
        with m.LocalRoleJournal(fifo_root) as j: j.claim(self.b)
        fifo=fifo_root/self.b['cycle_id']/'activation.claim.json'; fifo.unlink(); os.mkfifo(fifo,0o600)
        with m.LocalRoleJournal(fifo_root) as j:
            with self.assertRaises(ValueError): j.claim(self.b)
        self.root.chmod(0o755)
        with self.assertRaises(ValueError): self.open()
        self.root.chmod(0o700); self.parent.chmod(0o755)
        with self.assertRaises(ValueError): self.open()
        self.parent.chmod(0o700)

    def test_live_root_swap_never_redirects_record(self):
        with self.open() as j:
            j.claim(self.b)
            old=self.parent/'old'; self.root.rename(old); self.root.mkdir(mode=0o700)
            with self.assertRaises(ValueError): j.record(self.b,'finished','FAILED')
            self.assertEqual(list(self.root.iterdir()),[])
            self.assertTrue((old/self.b['cycle_id']/'blocked.json').exists())

    def test_second_claim_on_same_handle_and_records_after_close_rejected(self):
        j=self.open(); self.assertTrue(j.claim(self.b))
        with self.assertRaises(ValueError): j.claim(self.b)
        j.close(); j.close()
        with self.assertRaises(ValueError): j.record(self.b,'finished','FAILED')

    def test_real_journal_composes_with_driver_early_failure_and_ambiguity(self):
        baseline={'owner_oid':10,'roles':{n:{'oid':100+i,'grantor_oid':10} for i,n in enumerate(m.transition.cycle.ROLES)}}
        for connect_fails in (False,True):
            root=self.parent/('driver-'+str(connect_fails)); root.mkdir(mode=0o700)
            calls=[]
            class Connection:
                def cursor(self): return None
                def begin(self): calls.append('begin')
                def rollback(self): calls.append('rollback')
                def close(self): calls.append('close')
            with m.LocalRoleJournal(root) as journal:
                class Services:
                    def expected_binding(inner): return binding()
                    def claim(inner,b): return journal.claim(b)
                    def record(inner,b,stage,status): return journal.record(b,stage,status)
                    def connect(inner):
                        if connect_fails: raise RuntimeError('synthetic acquisition ambiguity')
                        return Connection()
                    def prewrite(inner,connection,b): raise ValueError('synthetic rejected prewrite')
                    def phase(inner,token): pass
                result=m.transition.drive_transition(binding(),baseline,[],Services())
                expected='INDETERMINATE' if connect_fails else 'FAILED'
                self.assertEqual(result['outcome'],expected)
                self.assertEqual(journal.phase,'finished')
                if not connect_fails: self.assertEqual(calls,['begin','rollback','close'])
            with m.LocalRoleJournal(root) as restart: self.assertFalse(restart.claim(binding()))
            with m.LocalRoleJournal(root) as restart:
                with self.assertRaises(ValueError): restart.claim(binding('closure'))

    def test_stage_failure_keeps_claim_and_blocks_fresh_writer(self):
        with self.open() as j:
            j.claim(self.b)
            with mock.patch.object(m.os,'write',side_effect=OSError('synthetic write')):
                with self.assertRaises(ValueError): j.record(self.b,'mutation_started','PENDING')
        self.assertTrue((self.cycle/'activation.claim.json').exists())
        with self.open() as j:
            with self.assertRaises(ValueError): j.claim(self.b)

if __name__=='__main__': unittest.main()
