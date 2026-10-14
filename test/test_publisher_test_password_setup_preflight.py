"""Credential-free input-check tests; generated CA and baseline are synthetic.

No database driver is imported and no network connection is attempted.
"""
import builtins
from contextlib import ExitStack, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/publisher_test_password_setup.py'
spec = importlib.util.spec_from_file_location('preflight_candidate', SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def baseline():
    return {'owner_oid': 100, 'roles': {
        role: {'oid': 200 + index, 'grantor_oid': 10}
        for index, role in enumerate(m.ROLES)}}


class PreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='meridian-offline-ca-')
        root = Path(cls.temp.name)
        cert = root / 'ca.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-days', '1', '-subj', '/CN=Synthetic Offline Test CA',
                        '-addext', 'basicConstraints=critical,CA:TRUE',
                        '-keyout', str(root / 'key.pem'), '-out', str(cert)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=15)
        cls.ca_bytes = cert.read_bytes()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def invoke(self, fault=None, password_mode=False):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary)
            ca = root / 'ca.pem'; ca.write_bytes(self.ca_bytes)
            approved = root / 'baseline.json'; approved.write_text(json.dumps(baseline()))
            args = ['--set-test-passwords' if password_mode else '--check-inputs',
                    '--baseline', str(approved), '--ca', str(ca)]
            if password_mode: args.append('--acknowledge-provider-logging')
            if fault == 'both_modes': args.append('--set-test-passwords')
            if fault == 'missing_mode': args = args[1:]
            if fault == 'missing_ca': args = args[:-2]
            if fault == 'unknown_flag': args += ['--password', 'SYNTHETIC_SECRET_CANARY']
            if fault == 'malformed_ca': ca.write_text('SYNTHETIC_SECRET_CANARY')
            if fault == 'empty_ca': ca.write_bytes(b'')
            if fault == 'malformed_baseline': approved.write_text('{SYNTHETIC_SECRET_CANARY')
            if fault == 'unknown_baseline':
                value = baseline(); value['password'] = 'SYNTHETIC_SECRET_CANARY'
                approved.write_text(json.dumps(value))
            if fault == 'duplicate_baseline': approved.write_text('{"owner_oid":100,"owner_oid":101,"roles":{}}')
            env = {} if not isinstance(fault, tuple) else {fault[1]: 'SYNTHETIC_SECRET_CANARY'}
            real_flags = m.sys.flags
            class Flags:
                def __getattr__(self, name):
                    return (0 if fault == 'isolation' else 1) if name == 'isolated' else getattr(real_flags, name)
            stack.enter_context(patch.object(m.sys, 'flags', Flags()))
            stack.enter_context(patch.dict(m.os.environ, env, clear=True))
            stack.enter_context(patch.object(m.sys, 'gettrace', return_value=object() if fault == 'trace' else None))
            stack.enter_context(patch.object(m.sys, 'getprofile', return_value=object() if fault == 'profile' else None))
            stdin = Mock(); stdin.isatty.return_value = password_mode
            stderr = Mock(); stderr.isatty.return_value = password_mode
            stack.enter_context(patch.object(m.sys, 'stdin', stdin))
            stack.enter_context(patch.object(m.sys, 'stderr', stderr))
            found = None if fault == 'missing_dependency' else SimpleNamespace(origin='/trusted/psycopg/__init__.py')
            stack.enter_context(patch('importlib.util.find_spec', return_value=found))
            origin = stack.enter_context(patch.object(m, 'verify_dependency_origin'))
            if fault == 'origin': origin.side_effect = ValueError('SYNTHETIC_SECRET_CANARY')
            version = stack.enter_context(patch('importlib.metadata.version', return_value='0.0.0' if fault == 'version' else '3.3.6'))
            if fault == 'metadata_error': version.side_effect = RuntimeError('SYNTHETIC_SECRET_CANARY')
            supervisor = stack.enter_context(patch.object(m, 'supervise', side_effect=(
                (lambda worker: worker(lambda token: None)) if password_mode
                else AssertionError('offline supervisor forbidden'))))
            effects = [stack.enter_context(patch.object(m, 'perform', side_effect=AssertionError('forbidden effect')))]
            effects.append(stack.enter_context(patch.object(m.getpass, 'getpass', side_effect=AssertionError('forbidden prompt'))))
            effects.append(stack.enter_context(patch.object(socket, 'socket', side_effect=AssertionError('forbidden socket'))))
            effects.append(stack.enter_context(patch.object(socket, 'create_connection', side_effect=AssertionError('forbidden connection'))))
            actual_import = builtins.__import__
            imported_drivers = []
            def guarded_import(name, *values, **kwargs):
                if name == 'psycopg' or name.startswith('psycopg.'):
                    imported_drivers.append(name)
                    raise AssertionError('offline driver import')
                return actual_import(name, *values, **kwargs)
            stack.enter_context(patch('builtins.__import__', side_effect=guarded_import))
            emitted = []
            stack.enter_context(patch.object(m, 'emit_status', side_effect=lambda status: emitted.append(status) is None and fault != 'output'))
            raw = io.StringIO()
            with redirect_stdout(raw):
                code = m.main(args)
            self.assertEqual(raw.getvalue(), '')
            stderr.write.assert_not_called()
            self.assertEqual(imported_drivers, [])
            for effect in effects: effect.assert_not_called()
            if password_mode: supervisor.assert_called_once()
            else: supervisor.assert_not_called()
            if not password_mode and not fault:
                stdin.isatty.assert_not_called()
                stderr.isatty.assert_not_called()
            self.assertNotIn('SYNTHETIC_SECRET_CANARY', '\n'.join(emitted))
            return code, emitted

    def test_valid_offline_inputs_need_no_tty_driver_import_or_credential(self):
        self.assertEqual(self.invoke(), (0, ['INPUT_CHECKS_PASSED']))

    def test_invalid_ca_and_baseline_fail_before_any_effect(self):
        for fault in ('malformed_ca', 'empty_ca', 'malformed_baseline', 'unknown_baseline', 'duplicate_baseline'):
            with self.subTest(fault=fault):
                self.assertEqual(self.invoke(fault), (1, ['INPUT_CHECKS_FAILED']))

    def test_invalid_dependency_metadata_origin_or_missing_package_is_sanitized(self):
        for fault in ('missing_dependency', 'origin', 'version', 'metadata_error'):
            with self.subTest(fault=fault):
                self.assertEqual(self.invoke(fault), (1, ['INPUT_CHECKS_FAILED']))

    def test_common_isolation_and_instrumentation_gates_apply_offline(self):
        for fault in ('isolation', 'trace', 'profile'):
            with self.subTest(fault=fault):
                self.assertEqual(self.invoke(fault), (1, ['INPUT_CHECKS_FAILED']))
        for name in ('PGHOST', 'PGPASSWORD', 'PSYCOPG_IMPL', 'OTEL_EXPORTER', 'PYTHONPATH',
                     'LD_PRELOAD', 'LD_LIBRARY_PATH', 'OPENSSL_CONF', 'SSLKEYLOGFILE', 'SSL_CERT_FILE'):
            with self.subTest(variable=name):
                self.assertEqual(self.invoke(('env', name)), (1, ['INPUT_CHECKS_FAILED']))

    def test_mutually_exclusive_modes_and_required_arguments_fail_closed(self):
        for fault in ('both_modes', 'missing_mode', 'missing_ca', 'unknown_flag'):
            with self.subTest(fault=fault):
                code, emitted = self.invoke(fault)
                self.assertEqual(code, 1)
                self.assertEqual(len(emitted), 1)
                self.assertIn(emitted[0], ('INPUT_CHECKS_FAILED', m.STATUS_FAIL))

    def test_output_failure_is_nonzero_even_after_valid_input_checks(self):
        self.assertEqual(self.invoke('output'), (2, ['INPUT_CHECKS_PASSED']))

    def test_password_mode_parses_ca_in_worker_before_driver_or_password_input(self):
        self.assertEqual(self.invoke('malformed_ca', password_mode=True), (1, [m.STATUS_FAIL]))

    def test_real_ssl_parser_accepts_ca_and_rejects_invalid_path_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); ca = root / 'ca.pem'; ca.write_bytes(self.ca_bytes)
            self.assertEqual(m.load_ca(ca), self.ca_bytes)
            link = root / 'link.pem'; link.symlink_to(ca)
            for path in (link, root, root / 'missing', Path('relative.pem')):
                with self.subTest(path=path.name), self.assertRaises(Exception): m.load_ca(path)
            for content in (b'', b'not a certificate', b'\xff', b'x' * (1024 * 1024 + 1)):
                ca.write_bytes(content)
                with self.subTest(length=len(content)), self.assertRaises(Exception): m.load_ca(ca)


if __name__ == '__main__':
    unittest.main()
