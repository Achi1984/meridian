"""Synthetic owner roots and fake provider services; never real credentials/DB."""
import hashlib
import os
from pathlib import Path
import resource
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import publisher_recovery_wrapper as w
import publisher_marker_recovery as r


class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='meridian-wrapper-fixture-')
        self.root = Path(self.temp.name)
        self.home = self.root / 'owner'
        self.directory = self.home / '.meridian-owner-setup'
        self.directory.mkdir(parents=True, mode=0o700)
        self.home.chmod(0o700)
        self.marker = self.directory / r.MARKER
        self.marker.write_bytes(r.CONTENT)
        self.marker.chmod(0o600)
        self.baseline = self.root / 'baseline.json'
        self.baseline.write_text('{}')
        # Fixture permissions must not depend on inherited creation defaults.
        self.baseline.chmod(0o600)
        self.manifest = {name: hashlib.sha256((SCRIPTS/name).read_bytes()).hexdigest() for name in w.FILES}
        self.failed = {name: 'a'*64 for name in w.FAILED_FILES}
        self.argv = ['--check', '--owner-approved-cli-sessions', '--acknowledge-provider-logging',
                     '--exclusive-owner-window', '--baseline', str(self.baseline),
                     '--ca', '/fixture-ca', '--ca-sha256', 'b'*64,
                     '--gh', '/fixture-gh', '--gh-sha256', 'c'*64,
                     '--neon', '/fixture-neon', '--neon-sha256', 'd'*64]
        self.scope = {'action': 'ARCHIVE_PUBLISHER_ATTEMPT_ONCE', 'owner_id':319562141,
                      'operation_id':'1'*32, 'window_id':'2'*32,
                      'expires_at':int(time.time())+240,
                      'source_manifest_sha256':w._digest(self.manifest),
                      'failed_manifest_sha256':w._digest(self.failed),
                      'argv_sha256':w._digest(self.argv),
                      'baseline_sha256':hashlib.sha256(b'{}').hexdigest(),
                      'marker':r._identity(self.marker.stat()),
                      'approval_comment_id':123, 'reconciliation_comment_id':456}
        self.events = []
        self.statuses = []
        self.modules = None
        self.behavior = None
        self.delivery = True
        self.post_reconcile = lambda: None
        self.post_retire = lambda: None
        actual_open = os.open
        def fixture_open(path, *args, **kwargs):
            return actual_open(self.root if path == '/' else path, *args, **kwargs)
        self.patches = [patch.object(w.os, 'open', side_effect=fixture_open),
                        patch('pwd.getpwuid', return_value=SimpleNamespace(pw_uid=os.getuid(), pw_dir='/owner')),
                        patch.dict(os.environ, {}, clear=True),
                        patch.object(sys.stdin, 'isatty', return_value=True),
                        patch.object(sys.stderr, 'isatty', return_value=True),
                        patch.object(resource, 'setrlimit'), patch.object(w, '_USED', False)]
        for p in self.patches:
            p.start()
        original_modules = w._modules
        def modules(source):
            result = original_modules(source)
            self.modules = result
            owner = self
            class Services:
                def __init__(self, args, original):
                    owner.events.append('services')
                def preflight(self):
                    owner.events.append('provider')
                    if owner.behavior == 'second-provider' and owner.events.count('provider') == 2:
                        return False
                    return owner.behavior != 'provider'
                def admin_password(self):
                    owner.events.append('credential')
                    return 'synthetic-test-only'
                def db_precheck(self, admin):
                    owner.events.append('db')
                    return owner.behavior != 'db'
                def __getattr__(self, name):
                    raise AssertionError('Forbidden setup operation: ' + name)
            result['publisher_test_auto_setup'].Services = Services
            original_main = result['publisher_test_reconcile'].main
            def reconcile(argv):
                value = original_main(argv)
                self.post_reconcile()
                return value
            result['publisher_test_reconcile'].main = reconcile
            def emit(value):
                self.statuses.append(value)
                return self.delivery
            result['publisher_test_password_setup'].emit_status = emit
            retire = result['publisher_marker_recovery'].retire_marker
            def retirement(*args):
                self.events.append('retire')
                value = retire(*args)
                self.post_retire()
                return value
            result['publisher_marker_recovery'].retire_marker = retirement
            return result
        self.patches.append(patch.object(w, '_modules', side_effect=modules))
        self.patches[-1].start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def run_wrapper(self, window=lambda unused: True):
        return w.run_approved_recovery(self.manifest, self.failed, self.scope, self.argv, window)

    def test_complete_uses_real_reconcile_order_retains_evidence_and_no_setup(self):
        self.assertEqual(self.run_wrapper(), 0)
        self.assertEqual(self.events, ['services','provider','credential','db','provider','retire'])
        self.assertEqual(self.statuses, ['RECONCILE_READ_ONLY_CHECKS_PASSED', w.COMPLETE])
        self.assertFalse(self.marker.exists())
        archive = self.directory / ('recovery-' + self.scope['operation_id'])
        self.assertEqual((archive/r.MARKER).stat().st_ino, self.scope['marker']['st_ino'])
        self.assertEqual((archive/'evidence.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.events.count('retire'), 1)

    def test_defaults_block(self):
        self.assertEqual(w.run_approved_recovery(), 1)
        self.assertEqual(self.events, [])

    def test_wrong_manifest_blocks_before_helper_loading(self):
        self.manifest['publisher_test_auto_setup.py'] = '0'*64
        self.scope['source_manifest_sha256'] = w._digest(self.manifest)
        self.assertEqual(self.run_wrapper(), 1)
        self.assertIsNone(self.modules)

    def test_wrong_scope_bindings(self):
        for key, value in (('action','SETUP'),('owner_id',1),('operation_id','bad'),
                           ('source_manifest_sha256','bad'),('argv_sha256','bad'),
                           ('expires_at',int(time.time())-1)):
            before = self.scope[key]
            self.scope[key] = value
            with patch.object(w, '_USED', False):
                self.assertEqual(self.run_wrapper(), 1)
            self.scope[key] = before
        self.assertEqual(self.events, [])

    def test_marker_binding(self):
        self.scope['marker']['st_ino'] += 1
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.events, [])

    def test_baseline_content_binding(self):
        self.baseline.write_text('{"changed":true}')
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.events, [])

    def test_baseline_equals_override_rejected(self):
        self.argv.append('--baseline=/unpinned-file')
        self.scope['argv_sha256'] = w._digest(self.argv)
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.events, [])

    def test_each_reconciliation_stage_failure_blocks_retirement(self):
        for behavior in ('provider', 'db', 'second-provider'):
            self.behavior = behavior
            self.events.clear()
            self.statuses.clear()
            with patch.object(w, '_USED', False):
                self.assertEqual(self.run_wrapper(), 1)
            self.assertNotIn('retire', self.events)
            self.assertTrue(self.marker.exists())

    def test_invocation_gate_retained(self):
        with patch.object(sys.stdin, 'isatty', return_value=False):
            self.assertEqual(self.run_wrapper(), 1)
        self.assertNotIn('services', self.events)
        self.assertNotIn('retire', self.events)

    def test_missing_status_delivery_blocks_retirement(self):
        self.delivery = False
        self.assertEqual(self.run_wrapper(), 1)
        self.assertNotIn('retire', self.events)

    def test_lost_exclusivity_blocks_retirement(self):
        calls = []
        def window(unused):
            calls.append(1)
            return len(calls) == 1
        self.assertEqual(self.run_wrapper(window), 1)
        self.assertNotIn('retire', self.events)

    def test_source_changed_after_reconcile_blocks_retirement(self):
        source = w._source_bytes
        calls = []
        def changed(manifest):
            calls.append(1)
            if len(calls) > 1:
                raise ValueError('source changed')
            return source(manifest)
        with patch.object(w, '_source_bytes', side_effect=changed):
            self.assertEqual(self.run_wrapper(), 1)
        self.assertNotIn('retire', self.events)

    def test_directory_detached_before_retire(self):
        self.post_reconcile = lambda: self.directory.rename(self.home/'detached')
        self.assertEqual(self.run_wrapper(), 1)
        self.assertNotIn('retire', self.events)

    def test_archive_detached_after_retire(self):
        self.post_retire = lambda: (self.directory/('recovery-'+self.scope['operation_id'])).rename(self.directory/'detached')
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.statuses[-1], w.UNCERTAIN)
        self.assertEqual(self.events.count('retire'), 1)

    def test_interrupt_after_retire_never_retries(self):
        def interrupt():
            raise KeyboardInterrupt
        self.post_retire = interrupt
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.events.count('retire'), 1)
        self.assertEqual(self.statuses[-1], w.UNCERTAIN)

    def test_restrictive_umask_controlled_and_restored(self):
        old = os.umask(0o777)
        try:
            self.assertEqual(self.run_wrapper(), 0)
            self.assertEqual(os.umask(0o777), 0o777)
        finally:
            os.umask(old)

    def test_fsync_failure_is_uncertain(self):
        with patch.object(os, 'fsync', side_effect=OSError('injected')):
            self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.statuses[-1], w.UNCERTAIN)
        self.assertEqual(self.events.count('retire'), 1)

    def test_final_status_delivery_failure_is_nonzero(self):
        self.post_retire = lambda: setattr(self, 'delivery', False)
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.events.count('retire'), 1)

    def test_tampered_archive_evidence_rejected(self):
        def tamper():
            (self.directory/('recovery-'+self.scope['operation_id'])/'evidence.json').write_text('{}')
        self.post_retire = tamper
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.statuses[-1], w.UNCERTAIN)

    def test_canonical_directory_detached_after_retire(self):
        self.post_retire = lambda: self.directory.rename(self.home/'detached')
        self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.statuses[-1], w.UNCERTAIN)

    def test_retained_directory_close_failure_after_retire(self):
        close = os.close
        inode = self.directory.stat().st_ino
        def failed(fd):
            match = os.fstat(fd).st_ino == inode
            close(fd)
            if match:
                raise OSError('close failed')
        with patch.object(os, 'close', side_effect=failed):
            self.assertEqual(self.run_wrapper(), 1)
        self.assertEqual(self.statuses[-1], w.UNCERTAIN)

    def test_nonzero_reconciliation_return_even_with_success_status(self):
        def alter():
            # main already delivered success; callback interruption prevents return.
            raise SystemExit(1)
        self.post_reconcile = alter
        self.assertEqual(self.run_wrapper(), 1)
        self.assertNotIn('retire', self.events)


if __name__ == '__main__':
    unittest.main()
