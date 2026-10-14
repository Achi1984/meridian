"""Offline fault-injection tests; never import psycopg or contact a database."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
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


if __name__ == '__main__':
    unittest.main()
