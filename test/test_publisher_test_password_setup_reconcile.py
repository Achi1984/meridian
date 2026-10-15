"""Offline read-only reconciliation tests; synthetic credentials only."""
from contextlib import ExitStack, redirect_stdout, redirect_stderr
import importlib.util
import io
import resource
import sys
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/publisher_test_reconcile.py'


def load():
    spec = importlib.util.spec_from_file_location('reconcile_candidate', SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FlagsOverride:
    """Override one guard while preserving interpreter flags used by argparse."""
    def __init__(self, original, isolated):
        self.original = original
        self.isolated = isolated

    def __getattr__(self, name):
        return getattr(self.original, name)


class ReadOnlyServices:
    # Intentionally offers no mutation or marker methods.
    def __init__(self, fault=None, value=None):
        self.calls = []
        self.fault, self.value = fault, value

    def step(self, name, result):
        self.calls.append(name)
        if self.fault == name:
            if isinstance(self.value, BaseException):
                raise self.value
            return self.value
        return result

    def preflight(self):
        return self.step('preflight', True)

    def admin_password(self):
        return self.step('admin', 'SYNTHETIC_PRIVATE_CANARY')

    def db_precheck(self, value):
        assert value == 'SYNTHETIC_PRIVATE_CANARY'
        return self.step('database', True)


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.m = load()

    def invoke(self, services):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = self.m.run_reconcile(services)
        self.assertEqual(out.getvalue() + err.getvalue(), '')
        self.assertNotIn('CANARY', status)
        return status

    def test_success_needs_only_read_methods_and_rechecks_provider(self):
        services = ReadOnlyServices()
        self.assertEqual(self.invoke(services), self.m.OK)
        self.assertEqual(services.calls, ['preflight', 'admin', 'database', 'preflight'])

    def test_unknown_receipts_fail_closed_at_each_boundary(self):
        for step, status in [('preflight', self.m.PREFLIGHT_FAILED),
                             ('database', self.m.DATABASE_FAILED)]:
            for value in (False, None, 1, 'true', RuntimeError('SYNTHETIC_PRIVATE_CANARY'),
                          KeyboardInterrupt('SYNTHETIC_PRIVATE_CANARY')):
                with self.subTest(step=step, value=type(value)):
                    services = ReadOnlyServices(step, value)
                    self.assertEqual(self.invoke(services), status)
                    self.assertEqual(services.calls[-1], step)
                    self.assertEqual(services.calls.count(step), 1)

    def test_invalid_credential_never_reaches_database(self):
        for value in (None, '', b'private', 1, RuntimeError('SYNTHETIC_PRIVATE_CANARY')):
            services = ReadOnlyServices('admin', value)
            self.assertEqual(self.invoke(services), self.m.CREDENTIAL_FAILED)
            self.assertEqual(services.calls, ['preflight', 'admin'])

    def test_provider_drift_after_db_is_failure(self):
        services = ReadOnlyServices()
        services.preflight = Mock(side_effect=[True, False])
        self.assertEqual(self.invoke(services), self.m.PREFLIGHT_FAILED)
        self.assertEqual(services.preflight.call_count, 2)

    def arguments(self):
        return ['--check', '--owner-approved-cli-sessions', '--acknowledge-provider-logging',
                '--exclusive-owner-window', '--baseline', '/trusted/baseline', '--ca', '/trusted/ca',
                '--gh', '/trusted/gh', '--neon', '/trusted/neon', '--ca-sha256', 'a' * 64,
                '--gh-sha256', 'b' * 64, '--neon-sha256', 'c' * 64]

    def cli(self, args, *, isolated=1, environment=None, tty=True, delivered=True):
        auto = self.m.load_auto()
        original = auto.load_original()
        services = ReadOnlyServices()
        emitted = []
        with ExitStack() as stack:
            stack.enter_context(patch.object(self.m, 'load_auto', return_value=auto))
            stack.enter_context(patch.object(auto, 'load_original', return_value=original))
            factory = stack.enter_context(patch.object(auto, 'Services', return_value=services))
            stack.enter_context(patch.object(original, 'emit_status', side_effect=lambda s: emitted.append(s) or delivered))
            stack.enter_context(patch.object(self.m.sys, 'flags', FlagsOverride(self.m.sys.flags, isolated)))
            stack.enter_context(patch.object(self.m.sys, 'gettrace', return_value=None))
            stack.enter_context(patch.object(self.m.sys, 'getprofile', return_value=None))
            stack.enter_context(patch.object(self.m.sys.stdin, 'isatty', return_value=tty))
            stack.enter_context(patch.object(self.m.sys.stderr, 'isatty', return_value=tty))
            stack.enter_context(patch.dict(self.m.os.environ, environment or {}, clear=True))
            limits = stack.enter_context(patch.object(resource, 'setrlimit'))
            result = self.m.main(args)
        return result, emitted, factory, limits

    def test_flags_override_preserves_argparse_environment_flag(self):
        for isolated in (0, 1):
            flags = FlagsOverride(sys.flags, isolated)
            self.assertEqual(flags.isolated, isolated)
            self.assertEqual(flags.ignore_environment, sys.flags.ignore_environment)
            self.assertEqual(flags.verbose, sys.flags.verbose)

    def test_valid_cli_runs_read_only_services_and_disables_core_dumps(self):
        result, emitted, factory, limits = self.cli(self.arguments())
        self.assertEqual(result, 0)
        self.assertEqual(emitted, [self.m.OK])
        factory.assert_called_once()
        limits.assert_called_once()

    def test_missing_ack_and_mutation_flags_reject_before_services(self):
        candidates = [[], self.arguments() + ['--prepare-test-secrets'],
                      self.arguments() + ['--delete-marker']]
        for flag in ('--check', '--owner-approved-cli-sessions', '--acknowledge-provider-logging',
                     '--exclusive-owner-window'):
            candidates.append([a for a in self.arguments() if a != flag])
        for args in candidates:
            result, emitted, factory, _ = self.cli(args)
            self.assertEqual((result, emitted), (1, [self.m.INVOCATION_FAILED]))
            factory.assert_not_called()

    def test_invocation_guards_prevent_credentials(self):
        cases = [{'isolated': 0}, {'tty': False}]
        cases += [{'environment': {key: 'private'}} for key in
                  ('PGPASSWORD', 'PSYCOPG_IMPL', 'OTEL_TEST', 'PYTHONPATH', 'SSL_CERT_FILE',
                   'LD_PRELOAD', 'LD_LIBRARY_PATH', 'OPENSSL_CONF', 'SSLKEYLOGFILE')]
        for options in cases:
            result, emitted, factory, _ = self.cli(self.arguments(), **options)
            self.assertEqual((result, emitted), (1, [self.m.INVOCATION_FAILED]))
            factory.assert_not_called()

    def test_output_delivery_failure_is_nonzero(self):
        self.assertEqual(self.cli(self.arguments(), delivered=False)[0], 1)


if __name__ == '__main__':
    unittest.main()
