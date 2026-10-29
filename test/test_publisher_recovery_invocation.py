"""Synthetic invocation bootstrap tests. No real wrapper/provider code executes."""
from contextlib import ExitStack
import base64
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
import zlib
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
HISTORICAL_AUTO_SETUP_SNAPSHOT = (
    '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'
)


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
        self.capture_windows = False
        self.window_checks = []
        self.window_clock = None
        self.result = 0
        self.real_fstat = os.fstat

    def stage_historical_auto_setup(self):
        data = zlib.decompress(base64.b64decode(HISTORICAL_AUTO_SETUP_SNAPSHOT))
        self.assertEqual(hashlib.sha256(data).hexdigest(), HISTORICAL_AUTO_SETUP_PIN)
        self.assertEqual(
            self.proposal['sourceManifest']['publisher_test_auto_setup.py'],
            HISTORICAL_AUTO_SETUP_PIN,
        )
        path = self.root / 'publisher_test_auto_setup.py'
        path.write_bytes(data)
        path.chmod(0o600)
        return data

    def fake_exec(self, code, namespace):
        # This replaces the exact exec seam. Never execute the verified wrapper.
        self.assertEqual(code.co_filename, str(self.root / 'publisher_recovery_wrapper.py'))
        def fake_wrapper(manifest, failed, scope, argv, window_check):
            self.calls.append((manifest, failed, scope, argv, window_check))
            if self.capture_windows:
                self.window_checks = [
                    window_check(scope['window_id']),
                    window_check('nonmatching-window'),
                ]
                self.window_clock[0] = 340.0
                self.window_checks.append(window_check(scope['window_id']))
            return self.result
        namespace['run_approved_recovery'] = fake_wrapper

    def fake_fstat(self, fd):
        info = self.real_fstat(fd)
        return types.SimpleNamespace(st_mode=info.st_mode, st_size=info.st_size, st_uid=1000)

    def invoke(self, isolated=1, tty=True, token_hex_values=None, wall_time=None,
               monotonic_clock=None):
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
            if token_hex_values is not None:
                stack.enter_context(patch('secrets.token_hex', side_effect=token_hex_values))
            if wall_time is not None:
                stack.enter_context(patch('time.time', return_value=wall_time))
            if monotonic_clock is not None:
                stack.enter_context(patch(
                    'time.monotonic', side_effect=lambda: monotonic_clock[0]
                ))
            # eval executes the outer code object; its inner exec is the stub above.
            eval(compile(BODY, '<reviewed-invocation>', 'exec'), {'exec': self.fake_exec})

    @staticmethod
    def digest(value):
        return hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
        ).hexdigest()

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
            'cd7ccf8d3410cdd955a91532bec9bbc88d737b9642d179ef7ffd51d810cfcda3',
        )
        with self.assertRaises(ValueError):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_historical_manifest_positive_path_binds_scope_argv_and_window_once(self):
        self.stage_historical_auto_setup()
        self.capture_windows = True
        self.window_clock = [100.0]
        with self.assertRaises(SystemExit) as raised:
            self.invoke(
                token_hex_values=['b' * 32, 'a' * 32],
                wall_time=1000,
                monotonic_clock=self.window_clock,
            )
        self.assertEqual(raised.exception.code, 0)
        self.assertEqual(len(self.calls), 1)

        manifest, failed, scope, argv, unused_window_check = self.calls[0]
        self.assertEqual(manifest, self.proposal['sourceManifest'])
        self.assertEqual(failed, self.proposal['failedSourceManifest'])
        expected_argv = [
            '--check', '--owner-approved-cli-sessions',
            '--acknowledge-provider-logging', '--exclusive-owner-window',
            '--baseline', str(self.root.parent / 'approved-role-baseline.json'),
            '--ca', str(self.root.parent / 'verified-ca-bundle.pem'),
            '--ca-sha256', self.proposal['caSha256'],
            '--gh', '/usr/bin/gh', '--gh-sha256', self.proposal['ghSha256'],
            '--neon', str(self.root.parent / 'neon-8.4.5'),
            '--neon-sha256', self.proposal['neonSha256'],
        ]
        self.assertEqual(argv, expected_argv)
        self.assertEqual(scope, {
            'action': self.proposal['action'],
            'owner_id': self.proposal['ownerId'],
            'operation_id': 'a' * 32,
            'window_id': 'b' * 32,
            'expires_at': 1240,
            'source_manifest_sha256': self.digest(manifest),
            'failed_manifest_sha256': self.digest(failed),
            'argv_sha256': self.digest(expected_argv),
            'marker': self.proposal['marker'],
            'approval_comment_id': 6230643903,
            'reconciliation_comment_id': 6230532439,
            'baseline_sha256': self.proposal['baselineSha256'],
        })
        self.assertEqual(self.window_checks, [True, False, False])

    def test_historical_manifest_propagates_nonzero_wrapper_exit(self):
        self.stage_historical_auto_setup()
        self.result = 2
        with self.assertRaises(SystemExit) as raised:
            self.invoke()
        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(len(self.calls), 1)

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
