"""Offline adversarial tests for automatic test credential bootstrap.

All credential strings are synthetic canaries. No network, CLI login, database,
secret installation, or real credential retrieval is performed.
"""
from contextlib import redirect_stdout, redirect_stderr
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
from types import SimpleNamespace
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/publisher_test_auto_setup.py'


def load():
    spec = importlib.util.spec_from_file_location('auto_setup_candidate', SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeServices:
    """A recording external boundary, deliberately unable to delete or retry."""
    def __init__(self, fault=None, mutate_result='PASSWORD_SETUP_CONFIRMED'):
        self.calls = []
        self.fault = fault
        self.mutate_result = mutate_result
        self.marked = False
        self.secrets = {}
        self.passwords = ('a' * 64, 'b' * 64, 'c' * 64)

    def action(self, name, *values):
        self.calls.append((name, *values))
        if self.fault == name:
            raise RuntimeError('SYNTHETIC_PRIVATE_CANARY')

    def preflight(self):
        self.action('preflight')
        return True

    def acquire_marker(self):
        self.action('marker')
        if self.marked:
            raise ValueError('already attempted')
        self.marked = True
        return True

    def admin_password(self):
        self.action('admin')
        return 'SYNTHETIC_ADMIN_CANARY'

    def db_precheck(self, admin):
        self.action('db_precheck', admin)
        return True

    def generate_passwords(self):
        self.action('generate')
        return self.passwords

    def set_secret(self, name, value):
        self.action('secret:' + name, value)
        if name in self.secrets:
            raise AssertionError('No overwrite permitted')
        self.secrets[name] = value
        return True

    def mutate(self, admin, passwords):
        self.action('mutate', admin, passwords)
        return self.mutate_result


class BootstrapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = load()

    def invoke(self, services, prepare=True):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err), \
                patch.object(socket, 'socket', side_effect=AssertionError('network forbidden')), \
                patch.object(subprocess, 'run', side_effect=AssertionError('real subprocess forbidden')):
            result = self.m.run_setup(services, prepare=prepare)
        self.assertEqual(out.getvalue(), '')
        self.assertEqual(err.getvalue(), '')
        self.assertNotIn('CANARY', result)
        return result

    def test_default_mode_is_preflight_only(self):
        fake = FakeServices()
        self.assertEqual(self.invoke(fake, prepare=False), self.m.CHECK_OK)
        self.assertEqual(fake.calls, [('preflight',)])
        self.assertFalse(fake.marked)

    def test_success_orders_precheck_before_secret_writes_and_database_last(self):
        fake = FakeServices()
        self.assertEqual(self.invoke(fake), self.m.SETUP_OK)
        names = [call[0] for call in fake.calls]
        self.assertEqual(names[:5], ['preflight', 'marker', 'admin', 'db_precheck', 'generate'])
        self.assertEqual(names[6:-1], ['secret:' + name for name in self.m.SECRET_NAMES])
        self.assertEqual(names[5], 'preflight')
        self.assertEqual(names[-1], 'mutate')
        self.assertEqual(fake.calls[-1][1:], ('SYNTHETIC_ADMIN_CANARY', fake.passwords))
        self.assertEqual(len(fake.secrets), 6)
        self.assertNotIn('SYNTHETIC_ADMIN_CANARY', fake.secrets.values())

    def test_every_early_failure_prevents_all_secret_and_database_writes(self):
        for fault in ('preflight', 'marker', 'admin', 'db_precheck', 'generate'):
            with self.subTest(fault=fault):
                fake = FakeServices(fault)
                self.assertNotEqual(self.invoke(fake), self.m.SETUP_OK)
                self.assertFalse(fake.secrets)
                self.assertNotIn('mutate', [call[0] for call in fake.calls])
                self.assertEqual(fake.calls[-1][0], fault)

    def test_each_failed_secret_write_stops_without_db_mutation_or_retry(self):
        for index, name in enumerate(self.m.SECRET_NAMES):
            with self.subTest(secret=name):
                fake = FakeServices('secret:' + name)
                self.assertEqual(self.invoke(fake), self.m.RECONCILE)
                self.assertEqual(len(fake.secrets), index)
                self.assertEqual(fake.calls[-1][0], 'secret:' + name)
                self.assertEqual(len([c for c in fake.calls if c[0] == 'secret:' + name]), 1)
                self.assertNotIn('mutate', [c[0] for c in fake.calls])

    def test_database_failure_and_unknown_retain_all_secrets_and_stop(self):
        for status in ('PASSWORD_SETUP_FAILED', 'PASSWORD_SETUP_INDETERMINATE', None, 'unexpected'):
            with self.subTest(status=status):
                fake = FakeServices(mutate_result=status)
                self.assertEqual(self.invoke(fake), self.m.RECONCILE)
                self.assertEqual(len(fake.secrets), 6)
                self.assertEqual(fake.calls[-1][0], 'mutate')
                self.assertEqual(sum(c[0] == 'mutate' for c in fake.calls), 1)

    def test_database_exception_retains_secrets_without_retry(self):
        fake = FakeServices('mutate')
        self.assertEqual(self.invoke(fake), self.m.RECONCILE)
        self.assertEqual(len(fake.secrets), 6)
        self.assertEqual(fake.calls[-1][0], 'mutate')

    def test_attempt_marker_denies_second_credential_acquisition(self):
        fake = FakeServices('db_precheck')
        self.invoke(fake)
        start = len(fake.calls)
        fake.fault = None
        self.assertNotEqual(self.invoke(fake), self.m.SETUP_OK)
        self.assertEqual(fake.calls[start:], [('preflight',), ('marker',)])
        self.assertFalse(fake.secrets)

    def test_unknown_secret_receipts_stop_even_if_provider_applied_write(self):
        for target in self.m.SECRET_NAMES:
            for receipt in (False, None, 'true', 1):
                with self.subTest(target=target, receipt=receipt):
                    fake = FakeServices()
                    original = fake.set_secret
                    def write(name, value):
                        original(name, value)
                        return receipt if name == target else True
                    fake.set_secret = write
                    self.assertEqual(self.invoke(fake), self.m.RECONCILE)
                    self.assertEqual(fake.calls[-1][0], 'secret:' + target)
                    self.assertNotIn('mutate', [c[0] for c in fake.calls])

    def test_password_role_mapping_is_exact(self):
        fake = FakeServices()
        self.assertEqual(self.invoke(fake), self.m.SETUP_OK)
        self.assertEqual(fake.secrets, {
            'MERIDIAN_PUBLISHER_TEST_RESERVATION_USER': 'meridian_test_reservation',
            'MERIDIAN_PUBLISHER_TEST_RESERVATION_PASSWORD': 'a' * 64,
            'MERIDIAN_PUBLISHER_TEST_SENDER_USER': 'meridian_test_sender',
            'MERIDIAN_PUBLISHER_TEST_SENDER_PASSWORD': 'b' * 64,
            'MERIDIAN_PUBLISHER_TEST_READER_USER': 'meridian_test_reader',
            'MERIDIAN_PUBLISHER_TEST_READER_PASSWORD': 'c' * 64,
        })

    def test_bad_generated_credentials_never_reach_github_or_database(self):
        for values in ((), ('a' * 64,) * 3, ('short', 'b' * 64, 'c' * 64),
                       ('a' * 64, None, 'c' * 64), ('a' * 64, 'b' * 64, 'x\n' * 32),
                       ('a' * 64, 'b' * 64, 'SYNTHETIC_ADMIN_CANARY')):
            with self.subTest(values=values):
                fake = FakeServices(); fake.passwords = values
                self.assertEqual(self.invoke(fake), self.m.SETUP_FAILED)
                self.assertFalse(fake.secrets)
                self.assertNotIn('mutate', [c[0] for c in fake.calls])

    def test_changed_preflight_after_db_precheck_prevents_writes(self):
        fake = FakeServices()
        def preflight():
            fake.action('preflight')
            return sum(c[0] == 'preflight' for c in fake.calls) == 1
        fake.preflight = preflight
        self.assertEqual(self.invoke(fake), self.m.SETUP_FAILED)
        self.assertEqual(fake.calls[-1][0], 'preflight')
        self.assertFalse(fake.secrets)

    def test_import_is_side_effect_free(self):
        with patch.object(subprocess, 'run', side_effect=AssertionError('subprocess on import')), \
                patch.object(socket, 'socket', side_effect=AssertionError('network on import')):
            load()


class ProviderGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = load()

    def gates(self):
        m = self.m
        return [
            {'id': m.REPO_ID, 'full_name': m.REPO, 'owner': {'id': m.OWNER_ID, 'type': 'User'},
             'permissions': {'admin': True}},
            {'id': m.OWNER_ID, 'login': 'Achi1984'},
            {'name': m.ENVIRONMENT, 'can_admins_bypass': False,
             'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True},
             'protection_rules': [{'type': 'required_reviewers', 'prevent_self_review': False,
                                  'reviewers': [{'type': 'User', 'reviewer': {'id': m.OWNER_ID}}]}]},
            {'total_count': 1, 'branch_policies': [{'name': 'main', 'type': 'branch'}]},
            {'total_count': 0, 'secrets': []}, {'total_count': 0, 'secrets': []},
        ]

    def test_exact_github_identity_and_protections_pass(self):
        self.m.validate_github(*self.gates())

    def test_identity_protection_and_branch_drift_reject(self):
        changes = [(0, 'id', 1), (0, 'full_name', 'attacker/meridian'),
                   (0, 'permissions', {'admin': False}), (1, 'id', 1),
                   (1, 'login', 'someone'), (2, 'can_admins_bypass', True),
                   (2, 'protection_rules', []), (2, 'deployment_branch_policy', None),
                   (3, 'branch_policies', [{'name': '*', 'type': 'branch'}]),
                   (3, 'branch_policies', [{'name': 'main', 'type': 'tag'}]),
                   (3, 'total_count', 2)]
        for index, name, value in changes:
            with self.subTest(field=name, value=value):
                gates = self.gates(); gates[index][name] = value
                with self.assertRaises(Exception): self.m.validate_github(*gates)

    def test_every_secret_conflict_at_repo_or_environment_is_rejected(self):
        for scope in (4, 5):
            for name in self.m.SECRET_NAMES:
                with self.subTest(scope=scope, name=name):
                    gates = self.gates()
                    gates[scope] = {'total_count': 1, 'secrets': [{'name': name}]}
                    with self.assertRaises(Exception): self.m.validate_github(*gates)

    def test_truncated_secret_listing_is_rejected(self):
        for scope in (4, 5):
            gates = self.gates(); gates[scope]['total_count'] = 101
            with self.assertRaises(Exception): self.m.validate_github(*gates)


class RealAdapterOfflineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = load()

    def service(self):
        instance = object.__new__(self.m.Services)
        instance.gh = '/trusted/gh'; instance.neon = '/trusted/neon'
        return instance

    def test_secret_uses_stdin_and_exact_environment_only(self):
        service = self.service()
        calls = []
        service.command = SimpleNamespace(run=lambda argv, *args: calls.append((argv, args)))
        for name in self.m.SECRET_NAMES:
            self.assertTrue(service.set_secret(name, 'SYNTHETIC_SECRET_CANARY'))
        for argv, args in calls:
            self.assertNotIn('SYNTHETIC_SECRET_CANARY', ' '.join(argv))
            self.assertEqual(args, ('SYNTHETIC_SECRET_CANARY',))
            self.assertEqual(argv[-4:], ['--repo', 'Achi1984/meridian', '--env', 'meridian-publisher-test'])
        before = len(calls)
        with self.assertRaises(Exception): service.set_secret('UNAUTHORIZED', 'canary')
        self.assertEqual(len(calls), before)

    def test_owner_uri_is_captured_and_command_is_exact(self):
        service = self.service(); calls = []
        uri = ('postgresql://publisher_owner:ADMIN_CANARY@' + self.m.HOST +
               '/publisher_ledger?sslmode=verify-full')
        def command(argv):
            calls.append(argv)
            return uri + '\n'
        service.command = SimpleNamespace(run=command)
        with redirect_stdout(io.StringIO()) as out:
            self.assertEqual(service.admin_password(), 'ADMIN_CANARY')
        self.assertEqual(out.getvalue(), '')
        self.assertEqual(calls, [['/trusted/neon', 'connection-string', 'br-delicate-field-b9uijh3y',
            '--project-id', 'wandering-queen-12324132', '--database-name', 'publisher_ledger',
            '--role-name', 'publisher_owner', '--ssl', 'verify-full']])

    def test_database_precheck_is_read_only_and_closes_connection(self):
        service = self.service(); calls = []
        service.args = SimpleNamespace(ca=SimpleNamespace(read_bytes=lambda: b'synthetic_ca'),
                                       ca_sha256=hashlib.sha256(b'synthetic_ca').hexdigest())
        service.baseline = {'synthetic': True}
        connection = SimpleNamespace(
            add_notice_handler=lambda handler: calls.append(('notice',)),
            cursor=lambda: 'synthetic_cursor',
            rollback=lambda: calls.append(('rollback',)),
            close=lambda: calls.append(('close',)))
        def connect(**options):
            calls.append(('connect', options))
            return connection
        driver = SimpleNamespace(__file__='/synthetic/psycopg.py', __version__='3.3.6', connect=connect)
        service.original = SimpleNamespace(
            STATUS_OK='PASSWORD_SETUP_CONFIRMED', STATUS_FAIL='PASSWORD_SETUP_FAILED',
            verify_dependency_origin=lambda path: None, load_ca=lambda path: b'synthetic_ca',
            verify=lambda cursor, baseline: calls.append(('verify', cursor, baseline)),
            supervise=lambda worker: worker(lambda phase: None))
        with patch.dict(sys.modules, {'psycopg': driver}):
            self.assertTrue(service.db_precheck('SYNTHETIC_ADMIN_CANARY'))
        options = calls[0][1]
        self.assertEqual(options['password'], 'SYNTHETIC_ADMIN_CANARY')
        self.assertEqual(options['sslmode'], 'verify-full')
        self.assertFalse(options['autocommit'])
        self.assertIn('default_transaction_read_only=on', options['options'])
        self.assertEqual(calls[-2:], [('rollback',), ('close',)])
        self.assertIn(('verify', 'synthetic_cursor', service.baseline), calls)

    def test_attempt_marker_persists_across_service_instances(self):
        import pwd
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(pwd, 'getpwuid', return_value=SimpleNamespace(pw_dir=directory)):
                self.assertTrue(self.service().acquire_marker())
                marker = Path(directory) / '.meridian-owner-setup/publisher-test-attempt'
                self.assertEqual(marker.stat().st_mode & 0o777, 0o600)
                with self.assertRaises(Exception): self.service().acquire_marker()
                self.assertTrue(marker.exists())

    def test_marker_directory_symlink_is_rejected(self):
        import pwd
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'target').mkdir(mode=0o700)
            (root / '.meridian-owner-setup').symlink_to(root / 'target')
            with patch.object(pwd, 'getpwuid', return_value=SimpleNamespace(pw_dir=directory)):
                with self.assertRaises(Exception): self.service().acquire_marker()
            self.assertEqual(list((root / 'target').iterdir()), [])


class PrivateCommandTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = load()

    def test_command_captures_stdout_and_discards_sensitive_stderr(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        source = ('import sys; value=sys.stdin.read(); '
                  'sys.stderr.write("SYNTHETIC_ERROR_CANARY"); sys.stdout.write(value)')
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            result = command.run([sys.executable, '-I', '-c', source], 'SYNTHETIC_STDIN_CANARY')
        self.assertEqual(result, 'SYNTHETIC_STDIN_CANARY')
        self.assertEqual(out.getvalue() + err.getvalue(), '')

    def test_failing_command_exposes_only_fixed_error(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        source = 'import sys; print("SYNTHETIC_SECRET_CANARY"); sys.exit(1)'
        with self.assertRaises(ValueError) as raised:
            command.run([sys.executable, '-I', '-c', source])
        self.assertEqual(str(raised.exception), 'command failed')
        self.assertTrue(raised.exception.cleanup_complete)

    def test_hung_command_has_bounded_timeout(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ready_fifo = root / 'ready'
            continue_fifo = root / 'continue'
            os.mkfifo(ready_fifo, 0o600)
            os.mkfifo(continue_fifo, 0o600)
            ready_fd = os.open(ready_fifo, os.O_RDWR | os.O_NONBLOCK)
            continue_fd = os.open(continue_fifo, os.O_RDWR | os.O_NONBLOCK)
            ready_seen = threading.Event()
            source = ("import os,time\n"
                      "ready=os.open(" + repr(str(ready_fifo)) + ", os.O_WRONLY); os.write(ready,b'R'); os.close(ready)\n"
                      "gate=os.open(" + repr(str(continue_fifo)) + ", os.O_RDONLY); os.read(gate,1); os.close(gate)\n"
                      "time.sleep(30)\n")
            def release_after_ready():
                readable, _, _ = __import__('select').select([ready_fd], [], [], 3)
                if readable and os.read(ready_fd, 1) == b'R':
                    ready_seen.set()
                    os.write(continue_fd, b'G')
            synchronizer = threading.Thread(target=release_after_ready, daemon=True)
            started = time.monotonic()
            synchronizer.start()
            try:
                with self.assertRaises(ValueError) as raised:
                    command.run([sys.executable, '-I', '-c', source], timeout=0.1)
                synchronizer.join(3)
                self.assertFalse(synchronizer.is_alive())
                self.assertTrue(ready_seen.is_set())
                self.assertLess(time.monotonic() - started, 3)
            finally:
                os.close(ready_fd)
                os.close(continue_fd)
        self.assertEqual(str(raised.exception), 'command failed')
        self.assertTrue(raised.exception.cleanup_complete)

    def test_startup_timeout_is_bounded_and_cleanup_remains_unconfirmed(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        delayed_start = 'import time; time.sleep(30)'
        started = time.monotonic()
        with patch.object(self.m, '_COMMAND_SUPERVISOR', delayed_start):
            with self.assertRaises(ValueError) as raised:
                command.run([sys.executable, '-I', '-c', 'pass'], timeout=0.1)
        self.assertEqual(str(raised.exception), 'command failed')
        self.assertFalse(raised.exception.cleanup_complete)
        self.assertLess(time.monotonic() - started, 3)

    def test_cleanup_receipt_is_drained_when_supervisor_exits_before_initial_read(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        delayed_receipt = """
import os, struct, sys
def send(kind, status=0, payload=b''):
    message = kind + bytes((status,)) + struct.pack('!I', len(payload)) + payload
    while message:
        message = message[os.write(1, message):]
send(b'P', payload=struct.pack('!I', os.getpid()))
send(b'R', 1, b'')
sys.exit(0)
"""
        original_selector = self.m.selectors.DefaultSelector
        class DelayedReadSelector:
            def __init__(self):
                self.inner = original_selector()
                self.block_until = time.monotonic() + 0.2
            def register(self, *args, **kwargs): return self.inner.register(*args, **kwargs)
            def unregister(self, *args, **kwargs): return self.inner.unregister(*args, **kwargs)
            def get_map(self): return self.inner.get_map()
            def close(self): return self.inner.close()
            def select(self, timeout=None):
                if time.monotonic() < self.block_until:
                    if timeout and timeout > 0:
                        time.sleep(min(timeout, 0.005))
                    return []
                return self.inner.select(timeout)
        with patch.object(self.m, '_COMMAND_SUPERVISOR', delayed_receipt), \
                patch.object(self.m.selectors, 'DefaultSelector', DelayedReadSelector):
            with self.assertRaises(ValueError) as raised:
                command.run([sys.executable, '-I', '-c', 'pass'], timeout=0.1)
        self.assertEqual(str(raised.exception), 'command failed')
        self.assertTrue(raised.exception.cleanup_complete)

    def test_invalid_receipt_matrix_remains_unconfirmed(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        scenarios = {
            'missing_receipt': """
import os, struct, sys
def send(kind, status=0, payload=b''):
    message = kind + bytes((status,)) + struct.pack('!I', len(payload)) + payload
    while message:
        message = message[os.write(1, message):]
send(b'P', payload=struct.pack('!I', os.getpid()))
sys.exit(0)
""",
            'truncated_receipt': """
import os, struct, sys
def send(kind, status=0, payload=b''):
    message = kind + bytes((status,)) + struct.pack('!I', len(payload)) + payload
    while message:
        message = message[os.write(1, message):]
send(b'P', payload=struct.pack('!I', os.getpid()))
os.write(1, b'R\\x01' + struct.pack('!I', 4) + b'ab')
sys.exit(0)
""",
            'malformed_receipt_kind': """
import os, struct, sys
def send(kind, status=0, payload=b''):
    message = kind + bytes((status,)) + struct.pack('!I', len(payload)) + payload
    while message:
        message = message[os.write(1, message):]
send(b'P', payload=struct.pack('!I', os.getpid()))
send(b'X', 0, b'')
sys.exit(0)
""",
            'duplicate_receipt': """
import os, struct, sys
def send(kind, status=0, payload=b''):
    message = kind + bytes((status,)) + struct.pack('!I', len(payload)) + payload
    while message:
        message = message[os.write(1, message):]
send(b'P', payload=struct.pack('!I', os.getpid()))
send(b'R', 1, b'')
send(b'R', 1, b'')
sys.exit(0)
""",
            'trailing_bytes_after_receipt': """
import os, struct, sys
def send(kind, status=0, payload=b''):
    message = kind + bytes((status,)) + struct.pack('!I', len(payload)) + payload
    while message:
        message = message[os.write(1, message):]
send(b'P', payload=struct.pack('!I', os.getpid()))
send(b'R', 1, b'')
os.write(1, b'JUNK')
sys.exit(0)
""",
        }
        for name, script in scenarios.items():
            with self.subTest(name=name), patch.object(self.m, '_COMMAND_SUPERVISOR', script):
                with self.assertRaises(ValueError) as raised:
                    command.run([sys.executable, '-I', '-c', 'pass'], timeout=0.1)
                self.assertEqual(str(raised.exception), 'command failed')
                self.assertFalse(raised.exception.cleanup_complete)

    def test_late_trailing_data_after_success_receipt_is_rejected(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        trailing_after_success = """
import os, struct, sys, time
def send(kind, status=0, payload=b''):
    message = kind + bytes((status,)) + struct.pack('!I', len(payload)) + payload
    while message:
        message = message[os.write(1, message):]
send(b'P', payload=struct.pack('!I', os.getpid()))
send(b'R', 0, b'ok\\n')
child = os.fork()
if child == 0:
    time.sleep(0.05)
    os.write(1, b'JUNK')
    os._exit(0)
os._exit(0)
"""
        with patch.object(self.m, '_COMMAND_SUPERVISOR', trailing_after_success):
            with self.assertRaises(ValueError) as raised:
                command.run([sys.executable, '-I', '-c', 'pass'], timeout=0.1)
        self.assertEqual(str(raised.exception), 'command failed')
        self.assertFalse(raised.exception.cleanup_complete)

    def test_sensitive_stdin_is_not_in_supervisor_arguments_or_environment(self):
        secret = 'SYNTHETIC_PRIVATE_INPUT_CANARY'
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        original_popen = self.m.subprocess.Popen
        observed = []
        def inspect_supervisor(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            command_line = Path('/proc/{}/cmdline'.format(process.pid)).read_bytes()
            observed.append(command_line)
            self.assertNotIn(secret.encode(), command_line)
            self.assertNotIn(secret, json.dumps(kwargs.get('env', {})))
            return process
        source = 'import sys; print("accepted" if sys.stdin.read() else "empty")'
        with patch.object(self.m.subprocess, 'Popen', side_effect=inspect_supervisor):
            self.assertEqual(command.run([sys.executable, '-I', '-c', source], secret), 'accepted\n')
        self.assertEqual(len(observed), 1)

    def test_supervisor_failure_reports_cleanup_as_unconfirmed(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        with patch.object(self.m, '_COMMAND_SUPERVISOR', 'raise RuntimeError()'):
            with self.assertRaises(ValueError) as raised:
                command.run([sys.executable, '-I', '-c', 'pass'])
        self.assertEqual(str(raised.exception), 'command failed')
        self.assertFalse(raised.exception.cleanup_complete)

    def test_stalled_supervisor_is_bounded_and_cleanup_remains_unconfirmed(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        stalled = 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)'
        started = time.monotonic()
        with patch.object(self.m, '_COMMAND_SUPERVISOR', stalled):
            with self.assertRaises(ValueError) as raised:
                command.run([sys.executable, '-I', '-c', 'pass'], timeout=0.1)
        self.assertEqual(str(raised.exception), 'command failed')
        self.assertFalse(raised.exception.cleanup_complete)
        self.assertLess(time.monotonic() - started, 3)

    def test_caller_interrupt_cleans_target_and_session_escaped_descendant(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            heartbeat, child_pid, ready_fifo = root / 'heartbeat', root / 'child.pid', root / 'ready'
            os.mkfifo(ready_fifo, 0o600)
            program = ("import os,time; from pathlib import Path\n"
                       "child=os.fork()\n"
                       "if child: time.sleep(20)\n"
                       "else:\n"
                       " os.setsid()\n"
                       " Path(" + repr(str(child_pid)) + ").write_text(str(os.getpid()))\n"
                       " with open(" + repr(str(heartbeat)) + ", 'ab') as beat: beat.write(b'ready\\n')\n"
                       " ready=os.open(" + repr(str(ready_fifo)) + ", os.O_WRONLY); os.write(ready,b'R'); os.close(ready)\n"
                       " while True:\n"
                       "  with open(" + repr(str(heartbeat)) + ", 'ab') as beat: beat.write(b'x')\n"
                       "  time.sleep(0.01)\n")
            ready_fd = os.open(ready_fifo, os.O_RDWR | os.O_NONBLOCK)
            interrupter = None
            try:
                def interrupt_when_ready():
                    readable, _, _ = __import__('select').select([ready_fd], [], [], 3)
                    if readable and os.read(ready_fd, 1) == b'R':
                        os.kill(os.getpid(), signal.SIGINT)
                interrupter = threading.Thread(target=interrupt_when_ready, daemon=True)
                interrupter.start()
                with self.assertRaises(ValueError) as raised:
                    self.m.Command({'PATH': '/usr/bin:/bin'}).run(
                        [sys.executable, '-I', '-c', program], timeout=10)
                interrupter.join(3)
                self.assertFalse(interrupter.is_alive())
                self.assertEqual(str(raised.exception), 'command failed')
                self.assertTrue(raised.exception.cleanup_complete)
                self.assertTrue(child_pid.exists())
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(child_pid.read_text()), 0)
                stopped = heartbeat.read_bytes()
                self.assertTrue(stopped)
                time.sleep(0.15)
                self.assertEqual(heartbeat.read_bytes(), stopped)
            finally:
                os.close(ready_fd)
                if interrupter is not None:
                    interrupter.join(3)

    def test_command_supervision_does_not_change_callers_subreaper_state(self):
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        before, after = ctypes.c_int(), ctypes.c_int()
        self.assertEqual(libc.prctl(37, ctypes.byref(before), 0, 0, 0), 0)
        result = self.m.Command({'PATH': '/usr/bin:/bin'}).run(
            [sys.executable, '-I', '-c', 'print("bounded")'])
        self.assertEqual(result, 'bounded\n')
        self.assertEqual(libc.prctl(37, ctypes.byref(after), 0, 0, 0), 0)
        self.assertEqual(after.value, before.value)

    def test_excess_output_is_rejected_without_raw_output(self):
        command = self.m.Command({'PATH': '/usr/bin:/bin'})
        with self.assertRaises(ValueError) as raised:
            command.run([sys.executable, '-I', '-c', 'print("x" * (1024 * 1024 + 1))'])
        self.assertEqual(str(raised.exception), 'command failed')

    def test_missing_mode_never_constructs_services_or_contacts_network(self):
        original = self.m.load_original()
        emitted = []
        with patch.object(self.m, 'load_original', return_value=original), \
                patch.object(original, 'emit_status', side_effect=lambda status: emitted.append(status) or True), \
                patch.object(self.m, 'Services', side_effect=AssertionError('services forbidden')) as services, \
                patch.object(socket, 'socket', side_effect=AssertionError('network forbidden')):
            self.assertEqual(self.m.main([]), 1)
        services.assert_not_called()
        self.assertEqual(emitted, [self.m.SETUP_FAILED])


class StrictURIValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = load()

    def valid(self):
        return ('postgresql://publisher_owner:SYNTHETIC_URI_CANARY@'
                'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech/'
                'publisher_ledger?sslmode=verify-full')

    def test_extracts_only_password_from_exact_destination(self):
        self.assertEqual(self.m.validate_uri(self.valid()), 'SYNTHETIC_URI_CANARY')

    def test_rejects_destination_confusion_and_downgrade(self):
        uri = self.valid()
        invalid = [
            uri.replace('publisher_owner:', 'neondb_owner:'),
            uri.replace('publisher_ledger?', 'neondb?'),
            uri.replace('.aws.neon.tech/', '.aws.neon.tech.attacker.invalid/'),
            uri.replace('.aws.neon.tech/', '.aws.neon.tech:5444/'),
            uri.replace('ep-purple-dew-', 'ep-purple-dew-pooler-'),
            uri.replace('sslmode=verify-full', 'sslmode=disable'),
            uri + '&sslmode=disable',
            uri + '&host=attacker.invalid',
            uri + '#fragment',
            uri.replace('SYNTHETIC_URI_CANARY', ''),
            uri.replace('SYNTHETIC_URI_CANARY', '%00bad'),
            uri.replace('SYNTHETIC_URI_CANARY', '%0Abad'),
            uri.replace('postgresql://', 'https://'),
            uri + '\nANOTHER_URI',
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(Exception):
                self.m.validate_uri(value)


if __name__ == '__main__':
    unittest.main()
