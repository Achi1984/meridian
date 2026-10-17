"""Offline inspector tests; all provider, credential and DB boundaries are fake."""
from contextlib import redirect_stdout, redirect_stderr
import copy
import hashlib
import importlib.util
import io
import json
import os
import tempfile
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inspection', ROOT / 'scripts/publisher_test_readonly_inspection.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
AUTO, ORIGINAL, QUERIES = m.load_dependencies()
CANARY = 'SYNTHETIC_PASSWORD_URI_FUNCTION_CANARY'


def internal_rows():
    return [('internal_fk_trigger', json.dumps([table, 'send_records_operation_key_fkey',
             'pg_catalog', function, event]), 42,
             json.dumps({'enabled': 'O', 'deferrable': False, 'initiallyDeferred': False}))
            for table, function, event in (
                ('reservations', 'RI_FKey_noaction_del', 9),
                ('reservations', 'RI_FKey_noaction_upd', 17),
                ('send_records', 'RI_FKey_check_ins', 5),
                ('send_records', 'RI_FKey_check_upd', 17))]


def inventory():
    return [('schema', 'meridian_publisher', 42, 'schema')] + [
        ('relation', n, 42, 'r') for n in ('reservations', 'send_records')] + [
        ('function', n, 42, CANARY) for n in ('guard_reservation()', 'guard_send_record()')] + [
        ('trigger', n, 42, CANARY) for n in (
            'reservations.guard_reservation_row', 'reservations.guard_reservation_truncate',
            'send_records.guard_send_record_row', 'send_records.guard_send_record_truncate')] + internal_rows()


class Cursor:
    def __init__(self, rows=None, grants=None, temporary=None):
        self.results = [grants or [], temporary if temporary is not None else
                        [(n, True, False) for n in ORIGINAL.ROLES], rows if rows is not None else inventory()]
        self.sql = []
    def execute(self, sql):
        self.sql.append(sql)
    def fetchmany(self, n):
        return self.results.pop(0)[:n]


class Tests(unittest.TestCase):
    def collect(self, cursor):
        return m.collect(cursor, SimpleNamespace(verify=Mock(), ROLES=ORIGINAL.ROLES), {'owner_oid': 42}, QUERIES)

    def test_pins_and_authoritative_sql(self):
        for path, digest in QUERIES['sourceSha256'].items():
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest)
        source = (ROOT / 'docs/autonomy/PUBLISHER_DATABASE_ROLE_SETUP.md').read_text().split('### Mandatory post-GRANT matrix verification', 1)[1]
        sql = re.findall(r'```sql\n(.*?)```', source, re.S)
        self.assertEqual(QUERIES['grantMatrixSql'], sql[0].strip())
        self.assertEqual(QUERIES['temporarySql'], sql[1].strip())
        self.assertIn('count(*) FROM checks)<>186', sql[0])

    def test_no_import_effects(self):
        with patch.object(socket, 'socket', side_effect=AssertionError), patch.object(subprocess, 'Popen', side_effect=AssertionError):
            spec.loader.exec_module(m)

    def test_only_fixed_queries_and_hashed_observation(self):
        cursor = Cursor()
        result = self.collect(cursor)
        self.assertEqual(cursor.sql, [QUERIES['grantMatrixSql'], QUERIES['temporarySql'], m.INVENTORY_SQL])
        self.assertNotIn(CANARY, json.dumps(result))
        self.assertIs(result['schemaEquivalenceEstablished'], False)
        self.assertIs(result['activationAuthorized'], False)

    def test_changed_definition_never_becomes_equivalence(self):
        rows = inventory()
        first = self.collect(Cursor(rows=rows))
        rows[3] = (*rows[3][:3], 'DIFFERENT DEFINITION')
        second = self.collect(Cursor(rows=rows))
        self.assertNotEqual(first['definitions'], second['definitions'])
        self.assertFalse(second['schemaEquivalenceEstablished'])

    def test_union_identity_is_text_before_catalog_name_branches(self):
        self.assertIn("SELECT 'schema'::text,'meridian_publisher'::text,nspowner,'schema'::text", m.INVENTORY_SQL)
        self.assertIn("SELECT 'relation',c.relname::text,c.relowner", m.INVENTORY_SQL)
        names = [r[1] for r in internal_rows()]
        self.assertTrue(all(len(n) > 63 for n in names))
        self.assertEqual(len(set(names)), 4)
        # PostgreSQL name-width truncation destroys these stable identities.
        self.assertEqual(len(set(n[:63] for n in names)), 2)

    def test_internal_fk_inventory_is_stable_and_output_is_hashed(self):
        section = m.INVENTORY_SQL.split("'internal_fk_trigger',", 1)[1].split(" UNION ALL SELECT 'function'", 1)[0]
        self.assertNotIn('tgname', section)
        for fact in ('t.tgtype', 't.tgenabled', 't.tgdeferrable', 't.tginitdeferred', "k.contype='f'"):
            self.assertIn(fact, section)
        result = self.collect(Cursor())
        self.assertEqual(sum(r['kind'] == 'internal_fk_trigger' for r in result['definitions']), 4)
        rendered = json.dumps(result)
        self.assertNotIn('RI_FKey', rendered)
        self.assertNotIn('send_records_operation_key_fkey', rendered)
        self.assertFalse(result['schemaEquivalenceEstablished'])

    def test_internal_fk_missing_duplicate_or_wrong_identity_stops(self):
        base = inventory()
        variants = [base[:-1], base + [base[-1]]]
        # Equivalent JSON with different whitespace must still be duplicate.
        row = base[-1]
        variants.append(base + [(row[0], json.dumps(json.loads(row[1]), separators=(',', ':')), row[2], row[3])])
        for index, replacement in ((0, 'other'), (1, 'other'), (2, 'public'), (3, 'other'), (4, 99), (4, True)):
            identity = json.loads(row[1]); identity[index] = replacement
            variants.append(base[:-1] + [(row[0], json.dumps(identity), row[2], row[3])])
        variants.append(base[:-1] + [(row[0], row[1], 99, row[3])])
        for rows in variants:
            with self.assertRaises(ValueError):
                self.collect(Cursor(rows=rows))

    def test_internal_fk_state_and_malformed_definition_stops(self):
        base = inventory(); row = base[-1]
        values = ['not json', 'null', '[]', '{}']
        for key, value in (('enabled', 'D'), ('enabled', 'R'), ('enabled', 'A'),
                           ('deferrable', True), ('deferrable', 0),
                           ('initiallyDeferred', True), ('initiallyDeferred', 0), ('extra', False)):
            facts = json.loads(row[3]); facts[key] = value; values.append(json.dumps(facts))
        for definition in values:
            with self.assertRaises(ValueError):
                self.collect(Cursor(rows=base[:-1] + [(row[0], row[1], row[2], definition)]))

    def test_grant_mismatch_stops(self):
        with self.assertRaises(ValueError):
            self.collect(Cursor(grants=[('unexpected grant',)]))

    def test_invalid_catalogs_stop(self):
        variants = [[], inventory()[:-1], inventory() + [inventory()[0]],
                    inventory() + [('relation', 'extra', 42, 'r')],
                    [('schema', 'meridian_publisher', 99, 'schema')] + inventory()[1:],
                    inventory() + [('column', 'x', 42, 'x' * 16385)],
                    inventory() + [('column', 'x' * 257, 42, 'x')]]
        for rows in variants:
            with self.subTest(rows=len(rows)), self.assertRaises(ValueError):
                self.collect(Cursor(rows=rows))

    def test_temporary_metadata_is_observation_not_denial_claim(self):
        self.assertTrue(self.collect(Cursor())['temporary'][0][1])
        for rows in ([], [(n, 'true', False) for n in ORIGINAL.ROLES], [(ORIGINAL.ROLES[0], False, False)] * 3):
            with self.assertRaises(ValueError):
                self.collect(Cursor(temporary=rows))

    def test_post_setup_metadata_independently_checked(self):
        auto = SimpleNamespace(_secret_names=AUTO._secret_names, SECRET_NAMES=AUTO.SECRET_NAMES, validate_github=Mock())
        empty = {'secrets': [], 'total_count': 0}
        present = {'secrets': [{'name': n} for n in AUTO.SECRET_NAMES], 'total_count': 6}
        m.validate_post_setup(auto, {}, {}, {}, {}, empty, present)
        self.assertEqual(auto.validate_github.call_args.args[-2:], (empty, empty))
        for repo, env in ((present, present), (empty, empty), (empty, {**present, 'total_count': 7}),
                          (empty, {'secrets': present['secrets'] + [{'name': 'EXTRA'}], 'total_count': 7})):
            with self.assertRaises(ValueError):
                m.validate_post_setup(auto, {}, {}, {}, {}, repo, env)
        auto.validate_github.side_effect = ValueError(CANARY)
        with self.assertRaises(ValueError):
            m.validate_post_setup(auto, {}, {}, {}, {}, empty, present)

    def test_failstop_no_retry_or_exception_output(self):
        for failure in range(3):
            calls = []
            def action():
                calls.append('read')
                if len(calls) == failure + 1:
                    raise RuntimeError(CANARY)
                return True
            output = io.StringIO()
            with redirect_stdout(output), redirect_stderr(output):
                self.assertEqual(m.run_inspection(SimpleNamespace(preflight=action, inspect=action)), m.FAILED)
            self.assertEqual(len(calls), failure + 1)
            self.assertEqual(output.getvalue(), '')

    def test_completion_requires_postflight(self):
        calls = []
        def preflight():
            calls.append('preflight')
            return True
        def inspect():
            calls.append('inspect')
            return True
        self.assertEqual(m.run_inspection(SimpleNamespace(preflight=preflight, inspect=inspect)), m.OBSERVED)
        self.assertEqual(calls, ['preflight', 'inspect', 'preflight'])

    def worker_fixture(self, cleanup_fault=False, close_fault=False, notice=False, delivery=True):
        service = object.__new__(m.InspectionServices)
        events = []
        connection = Mock()
        connection.rollback.side_effect = RuntimeError(CANARY) if cleanup_fault else lambda: events.append('rollback')
        def close():
            events.append('close')
            if close_fault:
                raise RuntimeError(CANARY)
        connection.close.side_effect = close
        if notice:
            connection.add_notice_handler.side_effect = lambda handler: handler(None)
        driver = SimpleNamespace(__file__='fake', __version__='3.3.6', connect=Mock(return_value=connection))
        original = SimpleNamespace(load_ca=Mock(), verify_dependency_origin=Mock(), STATUS_OK='OK', STATUS_FAIL='FAIL',
                                   emit_status=lambda text: events.append('report') or delivery)
        def supervise(worker):
            try:
                return worker(lambda phase: events.append(phase))
            except BaseException:
                return 'FAIL'
        original.supervise = supervise
        ca = SimpleNamespace(read_bytes=lambda: b'fake')
        service.base = SimpleNamespace(args=SimpleNamespace(ca=ca, ca_sha256=hashlib.sha256(b'fake').hexdigest()),
                                       baseline={}, admin_password=lambda: CANARY)
        service.auto, service.original, service.queries = AUTO, original, QUERIES
        with patch.dict(sys.modules, {'psycopg': driver}), patch.object(m, 'collect', return_value={'schemaEquivalenceEstablished': False}):
            result = service.inspect()
        self.assertFalse(connection.commit.called)
        self.assertEqual(driver.connect.call_args.kwargs['options'].split()[-1], 'default_transaction_read_only=on')
        self.assertEqual(driver.connect.call_args.kwargs['host'], AUTO.HOST)
        return result, events

    def test_worker_readonly_and_cleanup_before_report(self):
        result, events = self.worker_fixture()
        self.assertTrue(result)
        self.assertEqual(events, [b'A', b'C', b'P', b'M', b'L', 'rollback', 'close', 'report'])

    def test_cleanup_notice_or_delivery_faults_stop(self):
        for args in ({'cleanup_fault': True}, {'close_fault': True}, {'notice': True}, {'delivery': False}):
            result, events = self.worker_fixture(**args)
            self.assertFalse(result)
            self.assertIn('close', events)
            if 'delivery' not in args:
                self.assertNotIn('report', events)

    def test_supervisor_timeout_cannot_complete(self):
        def worker(phase):
            phase(b'A'); phase(b'C'); phase(b'P'); phase(b'M')
            time.sleep(1)
            return ORIGINAL.STATUS_OK
        limits = dict.fromkeys(ORIGINAL.PHASE_BUDGETS, 0.1)
        self.assertNotEqual(ORIGINAL.supervise(worker, limits), ORIGINAL.STATUS_OK)

    def test_public_cli_rejects_activation_and_arbitrary_sql(self):
        for argv in (['--activate'], ['--sql', 'ALTER ROLE x LOGIN'], []):
            m._USED = False
            original = SimpleNamespace(QuietParser=ORIGINAL.QuietParser, emit_status=Mock(return_value=True))
            with patch.object(m, 'load_dependencies', return_value=(AUTO, original, QUERIES)), patch.object(m, 'InspectionServices') as services:
                self.assertEqual(m.main(argv), 1)
                services.assert_not_called()
                original.emit_status.assert_called_once_with(m.FAILED)

    def test_resource_hash_override_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            baseline = Path(directory) / 'baseline.json'
            # Exercise the digest override, independently of the host umask/ACL.
            fd = os.open(baseline, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as output:
                output.write(b'known synthetic baseline')
            args = SimpleNamespace(baseline=baseline, ca_sha256='wrong')
            pins = dict(m.RESOURCE_PINS, baseline=hashlib.sha256(baseline.read_bytes()).hexdigest())
            with patch.object(m, 'RESOURCE_PINS', pins):
                with self.assertRaisesRegex(ValueError, 'resource pin argument'):
                    m.verify_resources(args)

    def test_private_cli_timeout_reaps_group_before_any_db_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            heartbeat = Path(directory) / 'synthetic-descendant-heartbeat'
            program = ("import os,time; from pathlib import Path\n"
                       "child=os.fork()\n"
                       "if child: time.sleep(20)\n"
                       "else:\n"
                       " for count in range(2000):\n"
                       "  Path(" + repr(str(heartbeat)) + ").write_text(str(count))\n"
                       "  time.sleep(0.01)\n")
            service = object.__new__(m.InspectionServices)
            original = SimpleNamespace(supervise=Mock(side_effect=AssertionError('DB worker must not start')))
            command = AUTO.Command({'PATH': '/usr/bin:/bin'})
            service.base = SimpleNamespace(admin_password=lambda: command.run(
                [sys.executable, '-I', '-c', program], timeout=0.3))
            service.auto, service.original = AUTO, original
            output = io.StringIO()
            with redirect_stdout(output), redirect_stderr(output):
                with self.assertRaisesRegex(ValueError, '^command failed$'):
                    service.inspect()
            original.supervise.assert_not_called()
            self.assertEqual(output.getvalue(), '')
            # Child PID namespaces differ from this host's /proc view. Use an
            # active descendant heartbeat instead of inspecting unrelated PIDs.
            self.assertTrue(heartbeat.exists())
            stopped = heartbeat.read_bytes()
            time.sleep(0.15)
            self.assertEqual(heartbeat.read_bytes(), stopped)


if __name__ == '__main__':
    unittest.main()
