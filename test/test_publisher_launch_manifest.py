"""Synthetic immutable manifests composed with real fork/coordinator/journal."""
import contextlib
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
for name,path in (('helpers',ROOT/'test/test_publisher_role_transition.py'),('fixture',ROOT/'scripts/publisher_pg16_role_transition_verification.py')):
    spec=importlib.util.spec_from_file_location(name,path); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    globals()[name]=module
import publisher_launch_manifest as m


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='meridian-manifest-')
        self.base=Path(self.tmp.name); self.root=self.base/'launch'; self.root.mkdir(mode=0o700)
        (self.root/'attempts').mkdir(mode=0o700)
        self.jroot=self.base/'journal'; self.jroot.mkdir(mode=0o700)
        self.coordinator,self.transition,self.journal=m.dependencies()
        self.baseline=helpers.baseline(); self.now=1000
        self.packet=fixture.synthetic_manifest_packet(m,self.transition,self.baseline,self.root,1,self.now)
        self.parent=os.getpid()
    def tearDown(self): self.tmp.cleanup()
    @contextlib.contextmanager
    def factory(self,binding,phase):
        assert os.getpid()!=self.parent
        for entry in Path('/proc/self/fd').iterdir():
            try: target=os.readlink(entry)
            except FileNotFoundError: continue
            assert target not in (str(self.root),str(self.root/'attempts'))
        fd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY)
        try:
            try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError: pass
            else: raise AssertionError('manifest lock released by child')
        finally: os.close(fd)
        with self.journal.LocalRoleJournal(self.jroot) as journal:
            class Services(helpers.Services):
                def expected_binding(inner): return binding
                def phase(inner,token): phase(token)
                def claim(inner,value): return journal.claim(value)
                def record(inner,value,stage,status): return journal.record(value,stage,status)
            yield Services(binding['direction'])
    def run_attempt(self,direction='activation',packet=None,now=None,baseline=None):
        raw,expected,decision=packet or self.packet
        return m.run_synthetic_attempt(self.root,raw,expected,direction,self.baseline if baseline is None else baseline,
            helpers.closure_transcript() if direction=='closure' else [],self.factory,decision,self.now if now is None else now)
    def changed(self,change):
        value=json.loads(self.packet[0]); change(value)
        raw=m.encode(value); expected=m.digest(raw)
        return raw,expected,{'kind':'SYNTHETIC_DECISION_INPUT','manifest_sha256':expected,'reference':'1'}
    def reject(self,result):
        self.assertFalse(result['supervisorInvoked']); self.assertEqual(result['outcome'],'INDETERMINATE')
        self.assertFalse(result['activationAuthorized']); self.assertFalse(result['evidenceAuthenticated'])

    def test_actual_process_lifecycle_separate_deadlines_and_derived_binding(self):
        self.reject(self.run_attempt(now=1060))
        self.assertFalse((self.root/'manifest.json').exists())
        result=self.run_attempt(); self.assertEqual(result['outcome'],'CONFIRMED')
        self.assertTrue(result['syntheticExecutionOnly']); self.assertTrue(result['manifestIntegrityChecked'])
        self.assertFalse(result['activationAuthorized']); self.assertFalse(result['evidenceAuthenticated'])
        record=json.loads((self.root/'attempts'/'activation.start.json').read_text())['binding']
        self.assertEqual(record['operation_id'],m.digest((self.packet[1]+':activation').encode())[:32])
        self.assertEqual(record['baseline_sha256'],m.digest(m.encode(self.baseline)))
        self.assertEqual(record['workflow_sha'],'3'*40)
        self.assertEqual(self.run_attempt('closure',now=1061)['outcome'],'CONFIRMED')
        self.assertEqual((self.root/'manifest.json').read_bytes(),self.packet[0])

    def test_malformed_noncanonical_duplicate_bool_and_size_rejected_without_writes(self):
        raws=[self.packet[0]+b' ',b'{"schema":1,"schema":1}',b'{"x":NaN}',b'x'*16385]
        for raw in raws:
            self.reject(self.run_attempt(packet=(raw,m.digest(raw),self.packet[2])))
        for change in (lambda v:v.update(schema=True),lambda v:v['repository'].update(id=True),
                       lambda v:v['window'].update(not_before=True),lambda v:v['effects'].update(dispatch=0)):
            self.reject(self.run_attempt(packet=self.changed(change)))
        self.assertEqual(set(p.name for p in self.root.iterdir()),{'attempts'})

    def test_exact_scope_source_root_baseline_and_workflow(self):
        changes=(lambda v:v.update(baseline_sha256='0'*64),lambda v:v.update(catalog_sha256='0'*64),
                 lambda v:v['sources'].update({'publisher_parent_completion.py':'0'*64}),
                 lambda v:v.update(root=str(self.base/'other')),lambda v:v['target'].update(host='other'),
                 lambda v:v['effects'].update(activation=['ROLE_NOLOGIN']),lambda v:v.update(environment='other'),
                 lambda v:v['workflow']['installed'].update(kind='AUTHENTICATED'),
                 lambda v:v['workflow'].update(proposed_sha256='0'*64))
        for change in changes: self.reject(self.run_attempt(packet=self.changed(change)))
        for direction in (True,'dispatch'): self.reject(self.run_attempt(direction))
        for now in (True,998,1120): self.reject(self.run_attempt(now=now))

    def test_companion_drift_between_activation_and_closure_not_new_manifest(self):
        self.assertEqual(self.run_attempt()['outcome'],'CONFIRMED')
        for change in (lambda v:v['window'].update(closure_expires=1121),lambda v:v.update(source_commit='9'*40),
                       lambda v:v.update(cycle_id='9'*32),lambda v:v['workflow']['installed'].update(commit='9'*40)):
            self.reject(self.run_attempt('closure',packet=self.changed(change)))
        self.assertEqual(self.run_attempt('closure')['outcome'],'CONFIRMED')

    def test_synthetic_decision_is_exact_and_never_authenticated(self):
        for decision in ({'approved':True},dict(self.packet[2],reference='2'),dict(self.packet[2],kind='OWNER_APPROVED'),True):
            self.reject(self.run_attempt(packet=(self.packet[0],self.packet[1],decision)))
        self.assertFalse((self.root/'manifest.json').exists())

    def test_missing_companion_cannot_attach_to_existing_attempt_history(self):
        (self.root/'attempts'/'anchor.json').write_text('{}')
        self.reject(self.run_attempt()); self.assertFalse((self.root/'manifest.json').exists())

    def test_companion_file_permissions_symlink_and_unknown_entries(self):
        path=self.root/'manifest.json'; path.symlink_to(self.base/'missing')
        self.reject(self.run_attempt()); path.unlink()
        path.write_bytes(self.packet[0]); path.chmod(0o644)
        self.reject(self.run_attempt()); path.chmod(0o600)
        (self.root/'unexpected').write_text('x'); self.reject(self.run_attempt())

    def test_manifest_write_fsync_failure_retains_blocking_evidence(self):
        with mock.patch.object(m.os,'fsync',side_effect=OSError('synthetic storage failure')):
            self.reject(self.run_attempt())
        self.assertTrue((self.root/'blocked.json').exists())
        self.reject(self.run_attempt())

    def test_pinned_source_mutation_stops_before_manifest_write(self):
        with mock.patch.dict(m.SOURCES,{'publisher_parent_completion.py':'0'*64}): self.reject(self.run_attempt())
        self.assertFalse((self.root/'manifest.json').exists())
        with mock.patch.object(m,'WORKFLOW_SHA','0'*64): self.reject(self.run_attempt())
        self.assertFalse((self.root/'manifest.json').exists())

    def test_mutable_inputs_frozen_and_expiry_rechecked_after_preparation(self):
        baseline=copy.deepcopy(self.baseline); original=m.dependencies
        def change_input():
            baseline['owner_oid']=999
            return original()
        with mock.patch.object(m,'dependencies',side_effect=change_input):
            self.assertEqual(self.run_attempt(baseline=baseline)['outcome'],'CONFIRMED')
        self.assertEqual(self.run_attempt('closure')['outcome'],'CONFIRMED')
        other=self.base/'slow'; other.mkdir(mode=0o700); (other/'attempts').mkdir(mode=0o700)
        packet=fixture.synthetic_manifest_packet(m,self.transition,self.baseline,other,2,self.now)
        with mock.patch.object(m.time,'monotonic',side_effect=(0,61)):
            result=m.run_synthetic_attempt(other,*packet[:2],'activation',self.baseline,[],self.factory,packet[2],self.now)
        self.reject(result); self.assertEqual(list((other/'attempts').iterdir()),[])

if __name__=='__main__': unittest.main()
