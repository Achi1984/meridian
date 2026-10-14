"""Opt-in real-driver composition checks; no PostgreSQL connection or SQL execution.

Run with the independently provisioned Psycopg 3.3.6 interpreter:
  python -I -m unittest discover -s test -p test_publisher_test_password_setup_driver.py
Missing dependencies fail this explicit check; they are never installed here.
This proves client rendering only, not PostgreSQL parsing or Neon behavior.
"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

fixture_path = Path(__file__).with_name('test_publisher_test_password_setup.py')
spec = importlib.util.spec_from_file_location('password_setup_offline_fixtures', fixture_path)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
m = fixtures.m


class RealDriverCompositionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg import sql
        if psycopg.__version__ != '3.3.6':
            raise RuntimeError('Expected independently reviewed Psycopg 3.3.6')
        cls.driver, cls.sql = psycopg, sql

    def test_real_identifier_and_literal_render_quoted_inputs(self):
        cases = [
            ("x'; SELECT 1; --", "'x''; SELECT 1; --'"),
            ('abc\\def', " E'abc\\\\def'"),
            ('"double"', "'\"double\"'"),
        ]
        with patch.object(self.driver, 'connect', side_effect=AssertionError('Network forbidden')):
            for value, expected in cases:
                with self.subTest(case=expected):
                    composed = self.sql.SQL('ALTER ROLE {} PASSWORD {}').format(
                        self.sql.Identifier('meridian_test_reader'), self.sql.Literal(value))
                    self.assertEqual(composed.as_string(),
                                     'ALTER ROLE "meridian_test_reader" PASSWORD ' + expected)

    def test_actual_helper_composes_each_synthetic_password_with_real_driver(self):
        actual_sql = self.sql
        class RenderingAdapter(fixtures.Fake):
            sql = actual_sql

            def __init__(self):
                super().__init__()
                self.rendered = []

            def execute(self, query):
                if isinstance(query, actual_sql.Composed):
                    self.rendered.append(query.as_string())
                    self.mutations.append(query)
                else:
                    super().execute(query)

        passwords = ["a'" * 16, 'b\\' * 16, 'c"' * 16]
        values = ['synthetic-admin', *[v for password in passwords for v in (password, password)]]
        adapter = RenderingAdapter()
        with patch.object(self.driver, 'connect', side_effect=AssertionError('Network forbidden')):
            result = m.perform(fixtures.baseline(), Path('/synthetic/ca.pem'), adapter, fixtures.reader(values))
        self.assertEqual(result, m.STATUS_OK)
        expected_literals = ["'" + "a''" * 16 + "'", " E'" + 'b\\\\' * 16 + "'", "'" + 'c"' * 16 + "'"]
        self.assertEqual(adapter.rendered, [
            f'ALTER ROLE "{role}" PASSWORD {literal}'
            for role, literal in zip(m.ROLES, expected_literals)
        ])
        self.assertTrue(adapter.committed and adapter.closed)


if __name__ == '__main__':
    unittest.main()
