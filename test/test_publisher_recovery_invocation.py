"""Synthetic invocation bootstrap tests. No real wrapper/provider code executes."""
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path, PosixPath
import secrets
import stat
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
DOCUMENT = REPO / 'docs/autonomy/PUBLISHER_RECOVERY_INVOCATION_20261017.md'
BODY = DOCUMENT.read_bytes().split(b'```python\n', 1)[1].split(b'```', 1)[0]
PIN = '3f5e0758a0138ed2df334847422d2b27d7fa6123cd019432647581755e1aae76'
EXPECTED_ROOT = '/home/codespace/meridian-commissioning-20261014/recovery-830-reviewed'


class InvocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='meridian-invocation-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'stage'
        self.root.mkdir(mode=0o700)
        source = REPO / 'docs/autonomy/PUBLISHER_RECOVERY_SCOPE_20261017.json'
        self.proposal = json.loads(source.read_bytes())
        (self.root / 'scope.json').write_bytes(source.read_bytes())
        for name, pin in self.proposal['sourceManifest'].items():
            data = (REPO / 'scripts' / name).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), pin)
            (self.root / name).write_bytes(data)
        for file in self.root.iterdir():
            file.chmod(0o600)
        self.calls = []
        self.result = 0
        self.real_fstat = os.fstat

    def fake_exec(self, code, namespace):
        # This replaces the exact exec seam. Never execute the verified wrapper.
        self.assertEqual(code.co_filename, str(self.root / 'publisher_recovery_wrapper.py'))
        def fake_wrapper(manifest, failed, scope, argv, window_check):
            self.calls.append((manifest, failed, scope, argv, window_check))
            return self.result
        namespace['run_approved_recovery'] = fake_wrapper

    def fake_fstat(self, fd):
        info = self.real_fstat(fd)
        return types.SimpleNamespace(st_mode=info.st_mode, st_size=info.st_size, st_uid=1000)

    def invoke(self, isolated=1, tty=True):
        def fixture_path(value):
            return self.root if str(value) == EXPECTED_ROOT else PosixPath(value)
        with ExitStack() as stack:
            stack.enter_context(patch('pathlib.Path', fixture_path))
            stack.enter_context(patch('os.getuid', return_value=1000))
            stack.enter_context(patch('os.fstat', self.fake_fstat))
            stack.enter_context(patch.object(sys, 'version_info', (3, 14, 2)))
            stack.enter_context(patch.object(sys, 'flags', types.SimpleNamespace(isolated=isolated)))
            stack.enter_context(patch.object(sys.stdin, 'isatty', return_value=tty))
            stack.enter_context(patch.object(sys.stderr, 'isatty', return_value=tty))
            # eval executes the outer code object; its inner exec is the stub above.
            eval(compile(BODY, '<reviewed-invocation>', 'exec'), {'exec': self.fake_exec})

    def test_exact_reviewed_body(self):
        self.assertEqual(len(BODY), 2918)
        self.assertEqual(hashlib.sha256(BODY).hexdigest(), PIN)

    def test_binds_scope_argv_and_exits_once(self):
        before = time.time()
        with self.assertRaises(SystemExit) as outcome:
            self.invoke()
        self.assertEqual(outcome.exception.code, 0)
        self.assertEqual(len(self.calls), 1)
        manifest, failed, scope, argv, window = self.calls[0]
        self.assertEqual(manifest, self.proposal['sourceManifest'])
        self.assertEqual(failed, self.proposal['failedSourceManifest'])
        digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(scope['argv_sha256'], digest(argv))
        self.assertEqual(scope['source_manifest_sha256'], digest(manifest))
        self.assertEqual(scope['failed_manifest_sha256'], digest(failed))
        self.assertEqual(scope['approval_comment_id'], 6230643903)
        self.assertEqual(scope['marker'], self.proposal['marker'])
        self.assertEqual(scope['action'], 'ARCHIVE_PUBLISHER_ATTEMPT_ONCE')
        self.assertEqual(scope['owner_id'], 319562141)
        self.assertEqual(argv.count('--baseline'), 1)
        self.assertEqual(argv[argv.index('--baseline') + 1], str(self.root.parent / 'approved-role-baseline.json'))
        self.assertEqual(argv[argv.index('--ca-sha256') + 1], self.proposal['caSha256'])
        self.assertEqual(argv[argv.index('--gh-sha256') + 1], self.proposal['ghSha256'])
        self.assertEqual(argv[argv.index('--neon-sha256') + 1], self.proposal['neonSha256'])
        self.assertGreater(scope['expires_at'], before + 238)
        self.assertLessEqual(scope['expires_at'], time.time() + 240)
        self.assertTrue(window(scope['window_id']))
        self.assertFalse(window('not-the-window'))
        with patch('time.monotonic', return_value=time.monotonic() + 300):
            self.assertFalse(window(scope['window_id']))

    def test_nonzero_wrapper_exit_propagates(self):
        self.result = 1
        with self.assertRaises(SystemExit) as outcome:
            self.invoke()
        self.assertEqual(outcome.exception.code, 1)
        self.assertEqual(len(self.calls), 1)

    def test_modified_scope_rejected_before_wrapper(self):
        path = self.root / 'scope.json'
        path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaises(ValueError):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_modified_source_rejected_before_wrapper(self):
        path = self.root / 'publisher_recovery_wrapper.py'
        path.write_bytes(path.read_bytes() + b'\n')
        with self.assertRaises(ValueError):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_group_writable_input_rejected(self):
        (self.root / 'scope.json').chmod(0o660)
        with self.assertRaises(ValueError):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_symlink_input_rejected(self):
        source = self.root / 'scope.json'
        renamed = self.root / 'original.json'
        source.rename(renamed)
        source.symlink_to(renamed)
        with self.assertRaises(OSError):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_nonisolated_process_rejected(self):
        with self.assertRaises(AssertionError):
            self.invoke(isolated=0)
        self.assertEqual(self.calls, [])

    def test_missing_terminal_rejected(self):
        with self.assertRaises(AssertionError):
            self.invoke(tty=False)
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
