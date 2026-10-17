"""Offline source/boundary tests; real PG16 fixture integration is separate."""
from contextlib import redirect_stdout, redirect_stderr
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fixture_harness', ROOT / 'scripts/publisher_pg16_fixture_verification.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def fixture():
    return {'inventory': [{'kind': 'schema', 'name': 'meridian_publisher', 'owner_oid': 42, 'left': 'schema'}] +
                [{'kind': 'internal_fk_trigger', 'name': str(i), 'owner_oid': 42,
                  'left': '{"enabled":"O"}'} for i in range(4)],
            'functions': [{'name': name, 'owner': 42, 'securityDefiner': False,
                           'configuration': ['search_path=pg_catalog'], 'language': 'plpgsql'}
                          for name in ('guard_reservation', 'guard_send_record')],
            'triggers': [{'name': str(i), 'enabled': 'O', 'internal': False} for i in range(4)],
            'internalFkTriggers': [{'table': 'send_records', 'constraint': 'send_records_operation_key_fkey',
                                    'functionSchema': 'pg_catalog', 'function': str(i),
                                    'eventMask': i, 'enabled': 'O', 'deferrable': False,
                                    'initiallyDeferred': False} for i in range(4)],
            'columns': [{'name': str(i), 'notNull': True} for i in range(11)],
            'constraints': [{'validated': True, 'definition': 'CHECK (run_attempt = 1)'}]}


class Tests(unittest.TestCase):
    def test_import_is_inert(self):
        with patch.object(subprocess, 'Popen', side_effect=AssertionError), patch.object(socket, 'socket', side_effect=AssertionError):
            SPEC.loader.exec_module(m)

    def test_sources_are_pinned_and_actual_inspector_query_is_embedded(self):
        inventory, fixtures = m.sources()
        self.assertIn(inventory, m.snapshot_sql(inventory))
        self.assertEqual(len(fixtures), 2)
        for path, digest in m.PINS.items():
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest)

    def test_application_trigger_inventory_excludes_internal_foreign_key_triggers(self):
        inventory, _ = m.sources()
        query = m.snapshot_sql(inventory)
        trigger_section = query.split("'triggers',", 1)[1].split("'columns',", 1)[0]
        self.assertIn('AND NOT t.tgisinternal', trigger_section)
        # The fixture foreign key has internal PostgreSQL triggers in addition
        # to the four application triggers asserted by require_fixture_facts.
        self.assertIn('REFERENCES meridian_publisher.reservations', m.sources()[1][1])

    def test_internal_fk_trigger_snapshot_has_stable_identity_without_generated_name(self):
        query = m.snapshot_sql(m.sources()[0])
        section = query.split("'internalFkTriggers',", 1)[1].split("'columns',", 1)[0]
        self.assertNotIn('tgname', section)
        self.assertNotIn("'oid'", section)
        for field in ('c.relname', 'k.conname', 'p.proname', 't.tgtype', 't.tgenabled'):
            self.assertIn(field, section)
        mutation = m.NEGATIVES['disabled_internal_fk_trigger']
        self.assertIn('INTO STRICT trigger_name', mutation)
        self.assertIn("c.relname='send_records'", mutation)
        self.assertIn("k.conname='send_records_operation_key_fkey'", mutation)
        self.assertIn("p.proname='RI_FKey_check_ins'", mutation)

    def test_internal_fk_trigger_disable_or_removal_rejected(self):
        expected = m.canonical(fixture(), 42)
        for mutate in (lambda v: v['internalFkTriggers'][0].update(enabled='D'),
                       lambda v: v['internalFkTriggers'].pop(),
                       lambda v: v['internalFkTriggers'][0].update(eventMask=99)):
            observed = copy.deepcopy(expected); mutate(observed)
            with self.assertRaises(ValueError):
                m.compare(expected, observed)

    def test_shipped_inspector_inventory_includes_internal_fk_state(self):
        inventory, _ = m.sources()
        section = inventory.split("'internal_fk_trigger',", 1)[1].split(" UNION ALL SELECT 'function'", 1)[0]
        self.assertNotIn('tgname', section)
        for field in ('c.relname', 'k.conname', 'pn.nspname', 'p.proname', 't.tgtype',
                      't.tgenabled', 't.tgdeferrable', 't.tginitdeferred'):
            self.assertIn(field, section)

    def test_catalog_normalizes_only_owner_oid(self):
        value = fixture()
        result = m.canonical(value, 42)
        self.assertEqual(value['functions'][0]['owner'], 42)
        self.assertEqual(result['functions'][0]['owner'], 'fixture-owner')
        self.assertEqual(result['inventory'][0]['left'], 'schema')

    def test_wrong_owner_and_truncated_definition_rejected(self):
        for mutate in (lambda v: v['inventory'][0].update(owner_oid=9),
                       lambda v: v['functions'][0].update(owner=9),
                       lambda v: v['inventory'][0].update(left='a' * 16385),
                       lambda v: v.update(inventory=v['inventory'] * 129)):
            value = fixture(); mutate(value)
            with self.assertRaises(ValueError):
                m.canonical(value, 42)

    def test_comparator_rejects_security_search_path_trigger_column_and_constraint_drift(self):
        expected = m.canonical(fixture(), 42)
        m.compare(expected, copy.deepcopy(expected))
        for mutate in (lambda v: v['functions'][0].update(securityDefiner=True),
                       lambda v: v['functions'][0].update(configuration=['search_path=public']),
                       lambda v: v['triggers'][0].update(enabled='D'),
                       lambda v: v['triggers'][0].update(enabled='R'),
                       lambda v: v['columns'][0].update(notNull=False),
                       lambda v: v['constraints'][0].update(definition='CHECK (true)'),
                       lambda v: v['constraints'][0].update(validated=False),
                       lambda v: v['inventory'][0].update(left='changed function body')):
            observed = copy.deepcopy(expected); mutate(observed)
            with self.assertRaises(ValueError):
                m.compare(expected, observed)

    def test_no_connection_string_or_external_target_argument(self):
        output = io.StringIO()
        with patch.object(m, 'verify') as verify, redirect_stdout(output), redirect_stderr(io.StringIO()):
            self.assertEqual(m.main(['--database-url', 'postgres://synthetic-private']), 1)
            verify.assert_not_called()
        self.assertNotIn('synthetic-private', output.getvalue())
        self.assertEqual(output.getvalue().strip(), m.FAILED)

    def test_missing_pg16_is_failure_not_skip_or_pass(self):
        output = io.StringIO()
        with patch.object(m.os, 'getuid', return_value=1000), redirect_stdout(output):
            self.assertEqual(m.main(['--pg-bin', '/definitely-missing-postgresql16']), 1)
        self.assertEqual(output.getvalue().strip(), m.FAILED)

    def test_root_rejected_before_binary_or_cluster_actions(self):
        with patch.object(m.os, 'getuid', return_value=0), patch.object(m, 'binaries') as binaries:
            with self.assertRaises(ValueError):
                m.verify(Path('/synthetic'))
            binaries.assert_not_called()

    def test_pg_version_guard_rejects_other_major_and_mixed_minor(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            for name in ('initdb', 'postgres', 'psql'):
                (path / name).write_bytes(b'synthetic')
                (path / name).chmod(0o700)
            # Ancestor checks are independently enforced; use safe synthetic
            # metadata here to isolate version parsing without running binaries.
            safe = Mock(st_uid=os.getuid(), st_mode=0o40700)
            real_stat = Path.stat
            def metadata(item, **kwargs):
                return real_stat(item, **kwargs) if kwargs.get('follow_symlinks') is False else safe
            for versions in (['initdb (PostgreSQL) 15.9'],
                             ['initdb (PostgreSQL) 16.2', 'postgres (PostgreSQL) 16.3', 'psql (PostgreSQL) 16.2']):
                with patch.object(Path, 'stat', metadata), patch.object(m, 'run', side_effect=versions) as run:
                    with self.assertRaises(ValueError):
                        m.binaries(path)
                    self.assertEqual(run.call_count, len(versions))

    def test_private_subprocess_never_inherits_credentials(self):
        process = Mock(pid=12345, returncode=0)
        process.communicate.return_value = (b'fixture', None)
        with patch.object(m.subprocess, 'Popen', return_value=process) as popen, patch.object(m.os, 'killpg') as kill:
            self.assertEqual(m.run(['/fixed/local/tool'], 'SELECT 1;'), 'fixture')
        self.assertEqual(popen.call_args.kwargs['env'], m.ENV)
        self.assertNotIn('DATABASE_URL', m.ENV)
        self.assertTrue(popen.call_args.kwargs['start_new_session'])
        process.wait.assert_called_once_with(timeout=3)
        kill.assert_called_once()

    def test_command_timeout_kills_group_and_reaps(self):
        process = Mock(pid=12345)
        process.communicate.side_effect = subprocess.TimeoutExpired('synthetic', 1)
        with patch.object(m.subprocess, 'Popen', return_value=process), patch.object(m.os, 'killpg') as kill:
            with self.assertRaises(subprocess.TimeoutExpired):
                m.run(['/fixed/local/tool'], timeout=1)
        kill.assert_called_once_with(12345, m.signal.SIGKILL)
        process.wait.assert_called_once_with(timeout=3)

    def exercise_cluster(self, cleanup_fault=False, wrong_identity=False, hidden_inspector_mutation=False):
        calls = []
        cluster = []
        def local_run(argv, text=None, timeout=10):
            calls.append((argv, text))
            if argv[0] == '/fixed/initdb':
                cluster.append(argv[2])
                return ''
            self.assertEqual(argv[0], '/fixed/psql')
            self.assertIn('--no-password', argv)
            self.assertTrue(any(x.startswith('--host=/tmp/meridian-pg16-') for x in argv))
            if 'json_build_array' in text:
                return json.dumps([160004, m.OWNER, 'postgres', 'external' if wrong_identity else None, cluster[0], 42])
            if 'jsonb_build_object' not in text:
                return ''
            value = fixture()
            if 'BEGIN;' in text:
                if m.NEGATIVES['disabled_internal_fk_trigger'] in text:
                    value['internalFkTriggers'][0]['enabled'] = 'D'
                    if not hidden_inspector_mutation:
                        value['inventory'][1]['left'] = '{"enabled":"D"}'
                else:
                    value['inventory'][0]['left'] = 'synthetic changed definition'
            return json.dumps(value)
        server = Mock(pid=12345)
        server.poll.return_value = None
        server.wait.side_effect = [subprocess.TimeoutExpired('synthetic', 5), 0] if cleanup_fault else None
        tools = {n: '/fixed/' + n for n in ('initdb', 'postgres', 'psql')}
        with patch.object(m.os, 'getuid', return_value=1000), patch.object(m, 'binaries', return_value=(tools, {}, {})), \
             patch.object(m, 'run', side_effect=local_run), patch.object(m.subprocess, 'Popen', return_value=server) as popen, \
             patch.object(m.os, 'killpg') as kill:
            if cleanup_fault or wrong_identity or hidden_inspector_mutation:
                with self.assertRaises(ValueError):
                    m.verify(Path('/fixed'))
                result = None
            else:
                result = m.verify(Path('/fixed'))
            argv = popen.call_args.args[0]
            self.assertEqual(argv[argv.index('-h') + 1], '')
            self.assertIn('listen_addresses=', argv)
            self.assertIn('unix_socket_permissions=0700', argv)
            self.assertEqual(popen.call_args.kwargs['env'], m.ENV)
            self.assertTrue(kill.called)
        self.assertFalse(Path(cluster[0]).parent.exists())
        return result, calls

    def test_private_cluster_orchestration_and_rollback_negative_cases(self):
        report, calls = self.exercise_cluster()
        self.assertEqual(report['negativeCasesRejected'], list(m.NEGATIVES))
        self.assertEqual(report['serverVersionNum'], 160004)
        self.assertFalse(report['deployedSchemaEquivalent'])
        self.assertFalse(report['fullSemanticsProven'])
        self.assertFalse(report['activationAuthorized'])
        mutations = [text for _, text in calls if text and 'BEGIN;' in text]
        self.assertEqual(len(mutations), len(m.NEGATIVES))
        self.assertTrue(all(text.endswith('ROLLBACK;') for text in mutations))

    def test_internal_fk_mutation_must_be_visible_in_shipped_inventory(self):
        self.exercise_cluster(hidden_inspector_mutation=True)

    def test_server_cleanup_failure_never_returns_report(self):
        self.exercise_cluster(cleanup_fault=True)

    def test_nonlocal_identity_stops_before_fixture_install(self):
        _, calls = self.exercise_cluster(wrong_identity=True)
        self.assertEqual(len(calls), 2)  # initdb and identity only

    def test_private_diagnostics_and_missing_integration_cannot_report_success(self):
        output = io.StringIO()
        with patch.object(m, 'verify', side_effect=RuntimeError('PRIVATE_CANARY')), redirect_stdout(output):
            self.assertEqual(m.main(['--pg-bin', '/synthetic']), 1)
        self.assertEqual(output.getvalue().strip(), m.FAILED)


if __name__ == '__main__':
    unittest.main()
