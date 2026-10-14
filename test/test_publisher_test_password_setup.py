"""Offline fault-injection tests; never import psycopg or contact a database."""
import importlib.util
import io
import json
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
import tempfile
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import patch, Mock
import warnings

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/publisher_test_password_setup.py'
spec = importlib.util.spec_from_file_location('setup_candidate', SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def baseline():
    return {'owner_oid': 100, 'roles': {
        role: {'oid': 200 + i, 'grantor_oid': 10} for i, role in enumerate(m.ROLES)}}


class SQL:
    @staticmethod
    def SQL(text):
        class Template:
            def format(self, identifier, literal):
                return ('composed', identifier, literal)
        return Template()

    @staticmethod
    def Identifier(value):
        return ('identifier', value)

    @staticmethod
    def Literal(value):
        return ('literal', value)


class Fake:
    sql = SQL

    def __init__(self, fault=None):
        self.fault = fault
        self.mutations = []
        self.rolled_back = False
        self.closed = False
        self.committed = False
        self.round = 0

    def connect(self, **kwargs):
        self.config = kwargs
        return self

    def add_notice_handler(self, handler):
        self.notice = handler

    def cursor(self):
        return self

    def execute(self, query):
        b = baseline()
        if query == m.IDENTITY_SQL:
            self.round += 1
            self.rows = [('publisher_ledger', m.OWNER, m.OWNER, 160015,
                          'pg_catalog', '', 100, True, False, 1, 1, 2, True)]
            if self.fault == 'identity':
                self.rows = []
        elif query == m.ROLE_SQL:
            self.rows = [(r, b['roles'][r]['oid'], *([False] * 8)) for r in m.ROLES]
            if (self.fault == 'oid' or (self.fault == 'late_oid' and self.round > 1)
                    or (self.fault == 'post_oid' and self.round > 2)):
                self.rows[0] = (m.ROLES[0], 999, *([False] * 8))
            if self.fault == 'login':
                self.rows[0] = (m.ROLES[0], 200, True, *([False] * 7))
        elif query == m.MEMBERSHIP_SQL:
            self.rows = [(v['oid'], 100, 10, True, False, False)
                         for v in b['roles'].values()]
            if self.fault == 'membership':
                self.rows.append((200, 100, 10, True, True, True))
        elif query == 'SHOW password_encryption':
            self.rows = [('scram-sha-256',)]
        elif isinstance(query, tuple):
            self.mutations.append(query)
            if self.fault == 'alter':
                raise RuntimeError('simulated secret-bearing server exception')
            if self.fault == 'notice':
                self.notice(object())
        elif query != "SET LOCAL password_encryption = 'scram-sha-256'":
            raise AssertionError('unexpected SQL')

    def fetchall(self):
        return self.rows

    def commit(self):
        if self.fault == 'commit_notice':
            self.notice(object())
        if self.fault == 'commit':
            raise RuntimeError('lost acknowledgement')
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def reader(values=None):
    entries = values or ['test-admin'] + [p for i in range(3) for p in [str(i) * 32] * 2]
    sequence = iter(entries)
    return lambda prompt: next(sequence)


class SetupTests(unittest.TestCase):
    def run_fake(self, fault=None, values=None):
        fake = Fake(fault)
        result = m.perform(baseline(), Path('/trusted/ca.pem'), fake, reader(values))
        return fake, result

    def test_success_fixed_connection_and_only_three_password_changes(self):
        fake, result = self.run_fake()
        self.assertEqual(result, m.STATUS_OK)
        self.assertEqual(fake.config['host'], m.HOST)
        self.assertEqual(fake.config['sslmode'], 'verify-full')
        self.assertEqual(fake.config['sslrootcert'], '/trusted/ca.pem')
        self.assertEqual(fake.config['user'], m.OWNER)
        self.assertEqual(fake.config['dbname'], 'publisher_ledger')
        self.assertEqual([q[1] for q in fake.mutations], [('identifier', r) for r in m.ROLES])
        self.assertEqual([q[2] for q in fake.mutations], [('literal', str(i) * 32) for i in range(3)])
        self.assertEqual(len(fake.mutations), 3)
        self.assertTrue(fake.committed and fake.closed)

    def test_wrong_identity_oid_membership_or_login_never_mutates(self):
        for fault in ('identity', 'oid', 'late_oid', 'login', 'membership'):
            with self.subTest(fault=fault):
                fake, result = self.run_fake(fault)
                self.assertEqual(result, m.STATUS_FAIL)
                self.assertEqual(fake.mutations, [])
                self.assertTrue(fake.rolled_back and fake.closed)

    def test_alter_error_and_notice_rollback(self):
        for fault in ('alter', 'notice'):
            fake, result = self.run_fake(fault)
            self.assertEqual(result, m.STATUS_FAIL)
            self.assertTrue(fake.rolled_back and fake.closed)
            self.assertFalse(fake.committed)

    def test_commit_ambiguity_has_no_retry_or_false_rollback_claim(self):
        fake, result = self.run_fake('commit')
        self.assertEqual(result, m.STATUS_UNKNOWN)
        self.assertFalse(fake.rolled_back)
        self.assertEqual(len(fake.mutations), 3)
        self.assertTrue(fake.closed)

    def test_duplicate_password_rejected_before_mutation(self):
        fake, result = self.run_fake(values=['admin', *(['x' * 32] * 6)])
        self.assertEqual(result, m.STATUS_FAIL)
        self.assertEqual(fake.mutations, [])

    def test_commit_notice_is_indeterminate_after_acknowledged_commit(self):
        fake, result = self.run_fake('commit_notice')
        self.assertEqual(result, m.STATUS_UNKNOWN)
        self.assertTrue(fake.committed and fake.closed)
        self.assertFalse(fake.rolled_back)
        self.assertEqual(len(fake.mutations), 3)

    def test_post_mutation_oid_change_rolls_back(self):
        fake, result = self.run_fake('post_oid')
        self.assertEqual(result, m.STATUS_FAIL)
        self.assertEqual(len(fake.mutations), 3)
        self.assertTrue(fake.rolled_back and fake.closed)
        self.assertFalse(fake.committed)

    def test_hidden_input_warning_aborts(self):
        def insecure(prompt):
            warnings.warn('fallback', m.getpass.GetPassWarning)
            return 'value'
        with self.assertRaises(m.getpass.GetPassWarning):
            m.hidden('hidden', insecure)

    def test_password_validation_rejects_before_any_mutation(self):
        cases = [('x' * 31, 'x' * 31), ('x' * 257, 'x' * 257),
                 ('é' * 32, 'é' * 32), ('x' * 31 + '\n', 'x' * 31 + '\n'),
                 ('x' * 31 + '\x00', 'x' * 31 + '\x00'),
                 ('x' * 32, 'y' * 32), ('a' * 32, 'a' * 32)]
        for password, confirmation in cases:
            with self.subTest(length=len(password), final=repr(password[-1])):
                fake, result = self.run_fake(values=['a' * 32, password, confirmation])
                self.assertEqual(result, m.STATUS_FAIL)
                self.assertEqual(fake.mutations, [])
                self.assertFalse(fake.committed)
                self.assertTrue(fake.closed)

    def test_reader_exception_is_sanitized_and_rolls_back(self):
        fake = Fake()
        values = iter(['admin'])
        def failing_reader(prompt):
            try:
                return next(values)
            except StopIteration:
                raise RuntimeError('secret-input-detail')
        out = io.StringIO()
        with redirect_stdout(out):
            result = m.perform(baseline(), Path('/trusted/ca.pem'), fake, failing_reader)
        self.assertEqual(result, m.STATUS_FAIL)
        self.assertEqual(out.getvalue(), '')
        self.assertEqual(fake.mutations, [])
        self.assertTrue(fake.rolled_back and fake.closed)

    def test_each_identity_field_rejects_independently(self):
        changes = ['wrongdb', 'wronguser', 'wrongsession', 170000, 'public',
                   'set', 999, False, True, 0, 0, 1, False]
        for index, value in enumerate(changes):
            with self.subTest(field=index):
                class WrongIdentity(Fake):
                    def execute(self, query):
                        super().execute(query)
                        if query == m.IDENTITY_SQL:
                            row = list(self.rows[0]); row[index] = value
                            self.rows = [tuple(row)]
                fake = WrongIdentity()
                result = m.perform(baseline(), Path('/trusted/ca.pem'), fake, reader())
                self.assertEqual(result, m.STATUS_FAIL)
                self.assertEqual(fake.mutations, [])
                self.assertTrue(fake.rolled_back and fake.closed)

    def test_grantor_missing_membership_and_each_role_flag_reject(self):
        for fault in ['grantor', 'missing', *range(2, 10)]:
            with self.subTest(fault=fault):
                class WrongCatalog(Fake):
                    def execute(self, query):
                        super().execute(query)
                        if query == m.MEMBERSHIP_SQL and fault == 'missing':
                            self.rows.pop()
                        elif query == m.MEMBERSHIP_SQL and fault == 'grantor':
                            row = list(self.rows[0]); row[2] = 999
                            self.rows[0] = tuple(row)
                        elif query == m.ROLE_SQL and type(fault) is int:
                            row = list(self.rows[0]); row[fault] = True
                            self.rows[0] = tuple(row)
                fake = WrongCatalog()
                result = m.perform(baseline(), Path('/trusted/ca.pem'), fake, reader())
                self.assertEqual(result, m.STATUS_FAIL)
                self.assertEqual(fake.mutations, [])

    def test_strict_baseline(self):
        m.validate_baseline(baseline())
        for value in ({}, {'owner_oid': True, 'roles': {}}, {'owner_oid': 100, 'roles': {}, 'secret': 'x'}):
            with self.assertRaises(ValueError):
                m.validate_baseline(value)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'baseline.json'
            path.write_text('{"owner_oid":100,"owner_oid":101,"roles":{}}')
            with self.assertRaises(ValueError):
                m.read_baseline(path)


class MainGateTests(unittest.TestCase):
    def invoke(self, fault=None, outcome=None):
        with tempfile.TemporaryDirectory() as temp, ExitStack() as stack:
            root = Path(temp)
            ca = root / 'ca.pem'; ca.write_text('synthetic-ca')
            approved = root / 'baseline.json'; approved.write_text(json.dumps(baseline()))
            argv = ['--set-test-passwords', '--acknowledge-provider-logging',
                    '--baseline', str(approved), '--ca', str(ca)]
            package = ModuleType('psycopg')
            package.__version__ = '3.3.6'
            package.__file__ = '/trusted/site-packages/psycopg/__init__.py'
            package.sql = SQL
            environment = {}
            stdin = Mock(); stdin.isatty.return_value = True
            stderr = Mock(); stderr.isatty.return_value = True
            trace, profile, isolated = None, None, 1
            if fault == 'stdin': stdin.isatty.return_value = False
            if fault == 'stderr': stderr.isatty.return_value = False
            if fault == 'trace': trace = object()
            if fault == 'profile': profile = object()
            if fault == 'isolation': isolated = 0
            if isinstance(fault, tuple) and fault[0] == 'env': environment[fault[1]] = 'secret-canary'
            if fault == 'flags': argv = []
            if fault == 'unknown_flag': argv += ['--password', 'secret-canary']
            if fault == 'ca': ca.unlink()
            if fault == 'empty_ca': ca.write_text('')
            if fault == 'baseline': approved.write_text('{}')
            if fault == 'version': package.__version__ = '0.0.0'
            stack.enter_context(patch.dict(m.os.environ, environment, clear=True))
            stack.enter_context(patch.object(m.sys, 'stdin', stdin))
            stack.enter_context(patch.object(m.sys, 'stderr', stderr))
            stack.enter_context(patch.object(m.sys, 'gettrace', return_value=trace))
            stack.enter_context(patch.object(m.sys, 'getprofile', return_value=profile))
            stack.enter_context(patch.object(m.sys, 'flags', SimpleNamespace(isolated=isolated)))
            stack.enter_context(patch.dict(m.sys.modules, {'psycopg': package}))
            spec_mock = stack.enter_context(patch('importlib.util.find_spec', return_value=SimpleNamespace(origin=package.__file__)))
            if fault == 'missing_dependency': spec_mock.return_value = None
            origin = stack.enter_context(patch.object(m, 'verify_dependency_origin'))
            if fault == 'provenance': origin.side_effect = ValueError('secret-canary')
            if fault == 'loaded_provenance': origin.side_effect = [None, ValueError('secret-canary')]
            prompt = stack.enter_context(patch.object(m.getpass, 'getpass', side_effect=AssertionError('unexpected prompt')))
            perform = stack.enter_context(patch.object(m, 'perform', return_value=outcome or m.STATUS_OK))
            output = io.StringIO()
            with redirect_stdout(output): code = m.main(argv)
            prompt.assert_not_called()
            if fault: perform.assert_not_called()
            else:
                perform.assert_called_once()
                self.assertEqual(origin.call_count, 2)
            if fault in ('stdin', 'stderr', 'trace', 'profile', 'isolation', 'flags', 'unknown_flag', 'ca', 'empty_ca', 'baseline') or isinstance(fault, tuple):
                spec_mock.assert_not_called()
            return code, output.getvalue()

    def test_main_gates_fail_before_prompt_and_dependency_lookup(self):
        for fault in ('stdin', 'stderr', 'trace', 'profile', 'isolation', 'flags',
                      'unknown_flag', 'ca', 'empty_ca', 'baseline'):
            with self.subTest(fault=fault):
                self.assertEqual(self.invoke(fault), (1, m.STATUS_FAIL + '\n'))

    def test_main_rejects_ambient_client_and_instrumentation_configuration(self):
        for name in ('PGHOST', 'PGPASSWORD', 'PSYCOPG_IMPL', 'OTEL_EXPORTER',
                     'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'OPENSSL_CONF',
                     'SSLKEYLOGFILE', 'SSL_CERT_FILE', 'SSL_CERT_DIR'):
            with self.subTest(variable=name):
                self.assertEqual(self.invoke(('env', name)), (1, m.STATUS_FAIL + '\n'))

    def test_main_version_and_origin_fail_before_prompt(self):
        for fault in ('version', 'provenance', 'loaded_provenance', 'missing_dependency'):
            with self.subTest(fault=fault):
                self.assertEqual(self.invoke(fault), (1, m.STATUS_FAIL + '\n'))

    def test_main_maps_only_coarse_outcomes_to_exit_codes(self):
        for outcome, code in ((m.STATUS_OK, 0), (m.STATUS_FAIL, 1), (m.STATUS_UNKNOWN, 2)):
            with self.subTest(outcome=outcome):
                self.assertEqual(self.invoke(outcome=outcome), (code, outcome + '\n'))

    def test_dependency_origin_rejects_shadow_paths_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            trusted = root / 'site-packages'; trusted.mkdir()
            package = trusted / 'psycopg'; package.mkdir()
            source = package / '__init__.py'; source.write_text('')
            outside = root / 'untrusted'; outside.mkdir()
            shadow = outside / '__init__.py'; shadow.write_text('')
            with patch.object(m.sysconfig, 'get_paths', return_value={'purelib': str(trusted), 'platlib': str(trusted)}):
                m.verify_dependency_origin(str(source))
                for candidate in (str(shadow), str(root / 'missing'), None):
                    with self.subTest(candidate=candidate), self.assertRaises(Exception):
                        m.verify_dependency_origin(candidate)
                source.unlink(); source.symlink_to(shadow)
                with self.assertRaises(Exception): m.verify_dependency_origin(str(source))


if __name__ == '__main__':
    unittest.main()
