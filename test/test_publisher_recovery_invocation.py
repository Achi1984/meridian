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
HISTORICAL_SCOPE_PIN = '11e0c283e227698b415d371712d01d40d7e03ffb4c5cc975e909b7864f8aa5da'
HISTORICAL_SOURCE_COMMIT = 'd8a12f8dfeb25843d186111094e1cdc1fbb35b0d'
HISTORICAL_AUTO_SETUP_PIN = 'c859d4413eb2b50f7aae04e1d28eb23961989eb64beb29cb751eb65f06a8bfc0'
EXPECTED_ROOT = '/home/codespace/meridian-commissioning-20261014/recovery-830-reviewed'


class InvocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='meridian-invocation-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'stage'
        self.root.mkdir(mode=0o700)
        source = REPO / 'docs/autonomy/PUBLISHER_RECOVERY_SCOPE_20261017.json'
        scope_bytes = source.read_bytes()
        self.proposal = json.loads(scope_bytes)
        (self.root / 'scope.json').write_bytes(scope_bytes)
        self.current_sources = {}
        for name in self.proposal['sourceManifest']:
            data = (REPO / 'scripts' / name).read_bytes()
            self.current_sources[name] = hashlib.sha256(data).hexdigest()
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

    def test_historical_scope_is_byte_exact_and_current_source_divergence_fails_closed(self):
        scope_bytes = (REPO / 'docs/autonomy/PUBLISHER_RECOVERY_SCOPE_20261017.json').read_bytes()
        self.assertEqual(hashlib.sha256(scope_bytes).hexdigest(), HISTORICAL_SCOPE_PIN)
        self.assertEqual(self.proposal['sourceCommit'], HISTORICAL_SOURCE_COMMIT)
        self.assertEqual(
            self.proposal['sourceManifest']['publisher_test_auto_setup.py'],
            HISTORICAL_AUTO_SETUP_PIN,
        )
        self.assertEqual(
            self.proposal['failedSourceManifest']['publisher_test_auto_setup.py'],
            HISTORICAL_AUTO_SETUP_PIN,
        )
        self.assertEqual(
            {name for name, digest in self.current_sources.items()
             if digest != self.proposal['sourceManifest'][name]},
            {'publisher_test_auto_setup.py'},
        )
        self.assertEqual(
            self.current_sources['publisher_test_auto_setup.py'],
            'e416e768b699cf9a33eecaa15dde5f19944750de00598c74b77d2521ab5d0c85',
        )
        with self.assertRaises(ValueError):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_changed_historical_source_never_reaches_wrapper_even_if_result_is_nonzero(self):
        self.result = 1
        with self.assertRaises(ValueError):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_modified_scope_rejected_before_wrapper(self):
        path = self.root / 'scope.json'
        path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaises(ValueError):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_modified_earlier_source_rejected_before_wrapper(self):
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
