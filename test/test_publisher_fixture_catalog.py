"""Offline comparator/generator contracts; no provider or database connections."""
from contextlib import redirect_stdout
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fixture_catalog', ROOT / 'scripts/publisher_fixture_catalog.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def raw_rows():
    return [('schema', 'meridian_publisher', 42, 'schema'),
            ('trigger', 'reservations.guard_reservation_row', 42, '{"enabled":"O","definition":"synthetic trigger"}'),
            ('internal_fk_trigger', '["send_records","synthetic_fk","pg_catalog","RI_FKey_check_ins",5]', 42,
             '{"enabled":"O","deferrable":false}'),
            ('function', 'guard_reservation()', 42,
             'CREATE FUNCTION synthetic() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RETURN NEW; END;$$'),
            ('constraint', 'reservations.synthetic_check', 42, 'CHECK (run_attempt = 1)'),
            ('column', 'reservations.status', 42, '{"notNull":true,"type":"text"}')]


def report():
    return {'kind': 'LOCAL_PG16_FIXTURE_COMPARISON', 'serverVersionNum': 160015,
            'sourceSha256': {**m.FIXTURES, m.INSPECTOR_PATH: 'a' * 64},
            'inventorySqlSha256': m.QUERY_SHA256,
            'negativeCasesRejected': sorted(m.NEGATIVES),
            'deployedSchemaEquivalent': False, 'fullSemanticsProven': False, 'activationAuthorized': False,
            'expectedCatalog': {'inventory': [dict(kind=k, name=n, owner_oid='fixture-owner', left=d)
                                              for k, n, _, d in raw_rows()]}}


class Tests(unittest.TestCase):
    def test_import_is_inert(self):
        with patch.object(socket, 'socket', side_effect=AssertionError), patch.object(subprocess, 'Popen', side_effect=AssertionError):
            SPEC.loader.exec_module(m)

    def test_query_and_fixture_pins_match_shipped_sources(self):
        spec = importlib.util.spec_from_file_location('inspection', ROOT / 'scripts/publisher_test_readonly_inspection.py')
        inspector = importlib.util.module_from_spec(spec); spec.loader.exec_module(inspector)
        self.assertEqual(m.digest(inspector.INVENTORY_SQL.encode()), m.QUERY_SHA256)
        for name, expected in m.FIXTURES.items():
            self.assertEqual(m.digest((ROOT / name).read_bytes()), expected)

    def test_deterministic_manifest_ignores_report_order_and_source_hash_cycle(self):
        source = report(); first = m.encoding(m.generate_manifest(source))
        source['expectedCatalog']['inventory'].reverse()
        source['sourceSha256'][m.INSPECTOR_PATH] = 'b' * 64
        self.assertEqual(first, m.encoding(m.generate_manifest(source)))
        self.assertTrue(first.endswith(b'\n'))
        self.assertNotIn(b'CREATE FUNCTION', first)
        self.assertNotIn(b'"sourceSha256"', first)
        self.assertNotIn(b'a' * 64, first)
        self.assertEqual(m.encoding(m.parse(first)), first)

    def test_matching_catalog_is_order_independent_and_narrow_claim(self):
        manifest = m.generate_manifest(report())
        rows = list(reversed(raw_rows()))
        self.assertEqual(m.compare_fixture_catalog(rows, 42, 160015, manifest),
                         {'fixtureCatalogMatch': True, 'schemaEquivalenceEstablished': False, 'activationAuthorized': False})

    def test_seven_mutation_classes_are_rejected(self):
        mutations = {
            'disabled_trigger': (1, 'DISABLED'),
            'disabled_internal_fk_trigger': (2, '{"enabled":"D"}'),
            'security_definer': (3, 'SECURITY DEFINER'),
            'changed_function_body': (3, 'BEGIN RETURN NULL; END;'),
            'changed_search_path': (3, 'SET search_path=public'),
            'changed_column': (5, '{"notNull":false}'),
        }
        manifest = m.generate_manifest(report())
        for label, (index, definition) in mutations.items():
            rows = raw_rows(); rows[index] = (*rows[index][:3], definition)
            with self.subTest(label=label), self.assertRaises(ValueError):
                m.compare_fixture_catalog(rows, 42, 160015, manifest)
        with self.assertRaises(ValueError):
            m.compare_fixture_catalog([r for r in raw_rows() if r[0] != 'constraint'], 42, 160015, manifest)
        self.assertEqual(set(mutations) | {'missing_constraint'}, m.NEGATIVES)

    def test_missing_extra_duplicate_and_identity_changes_rejected(self):
        manifest = m.generate_manifest(report())
        variants = [raw_rows()[:-1], raw_rows() + [raw_rows()[0]],
                    raw_rows() + [('column', 'unexpected', 42, 'unexpected')]]
        changed = raw_rows(); changed[0] = ('schema', 'other', 42, 'schema'); variants.append(changed)
        for rows in variants:
            with self.assertRaises(ValueError):
                m.compare_fixture_catalog(rows, 42, 160015, manifest)

    def test_owner_is_checked_separately_from_stable_manifest(self):
        manifest = m.generate_manifest(report())
        for owner in (True, 0, -1, 4294967296, '42', 99):
            with self.assertRaises(ValueError):
                m.compare_fixture_catalog(raw_rows(), owner, 160015, manifest)
        rows = raw_rows(); rows[0] = (*rows[0][:2], 99, rows[0][3])
        with self.assertRaises(ValueError):
            m.compare_fixture_catalog(rows, 42, 160015, manifest)
        changed_owner = [(k, n, 1234, d) for k, n, _, d in raw_rows()]
        self.assertTrue(m.compare_fixture_catalog(changed_owner, 1234, 160015, manifest)['fixtureCatalogMatch'])

    def test_actual_server_version_required_not_inferred_from_tool_version(self):
        for v in (None, True, '160015', 160014, 170000):
            source = report(); source['serverVersionNum'] = v
            source['toolVersions'] = {'postgres': 'postgres (PostgreSQL) 16.15'}
            with self.assertRaises(ValueError):
                m.generate_manifest(source)
            with self.assertRaises(ValueError):
                m.compare_fixture_catalog(raw_rows(), 42, v, m.generate_manifest(report()))
        source = report(); del source['serverVersionNum']
        with self.assertRaises(ValueError):
            m.generate_manifest(source)

    def test_report_pins_and_claims_cannot_be_caller_overridden(self):
        mutations = [lambda r: r.update(inventorySqlSha256='b' * 64),
                     lambda r: r['sourceSha256'].update({next(iter(m.FIXTURES)): 'b' * 64}),
                     lambda r: r['sourceSha256'].update({m.INSPECTOR_PATH: 'bad'}),
                     lambda r: r.update(negativeCasesRejected=[]),
                     lambda r: r.update(activationAuthorized=True),
                     lambda r: r.update(fullSemanticsProven=True),
                     lambda r: r.update(deployedSchemaEquivalent=True),
                     lambda r: r['expectedCatalog']['inventory'][0].update(owner_oid=42)]
        for change in mutations:
            source = report(); change(source)
            with self.assertRaises(ValueError): m.generate_manifest(source)

    def test_manifest_contract_pin_digest_order_and_type_corruption(self):
        mutations = [lambda v: v.update(schemaVersion=True), lambda v: v.update(contract='other'),
                     lambda v: v.update(serverVersionNum=160014),
                     lambda v: v.update(inventorySqlSha256='b' * 64),
                     lambda v: v.update(fixtureSha256={}), lambda v: v.update(extra='x'),
                     lambda v: v['entries'][0].update(definitionSha256='bad'),
                     lambda v: v['entries'].reverse(), lambda v: v['entries'].append(v['entries'][0]),
                     lambda v: v['entries'][0].update(extra='x')]
        for change in mutations:
            value = m.generate_manifest(report()); change(value)
            with self.assertRaises(ValueError): m.validate_manifest(value)

    def test_catalog_bounds_and_malformed_rows_fail(self):
        variants = [[], raw_rows() * 22, [('unknown', 'x', 42, 'x')],
                    [('column', '', 42, 'x')], [('column', 'x' * 257, 42, 'x')],
                    [('column', 'x\n', 42, 'x')], [('column', 'x', True, 'x')],
                    [('column', 'x', 42, '')], [('column', 'x', 42, 'x' * 16385)],
                    [('column', 'x', 42, None)], [('column', 'x', 42)], ['wrong']]
        for rows in variants:
            with self.assertRaises(ValueError): m.entries(rows, 42)

    def test_duplicate_json_keys_nonfinite_and_input_size_rejected(self):
        for data in (b'{"x":1,"x":2}', b'{"x":{"y":1,"y":2}}', b'NaN', b'Infinity',
                     b'-Infinity', b'\xff', b'', b' ' * (m.MAX_BYTES + 1)):
            with self.assertRaises(ValueError): m.parse(data)

    def test_cli_generates_private_output_and_separate_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            src, dst = Path(directory) / 'report.json', Path(directory) / 'manifest.json'
            src.write_bytes(m.encoding(report())); output = io.StringIO()
            with redirect_stdout(output):
                result = m.main(['--report', str(src), '--output', str(dst)])
            self.assertEqual(result, 0)
            self.assertEqual(dst.stat().st_mode & 0o777, 0o600)
            self.assertEqual(dst.read_bytes(), m.encoding(m.generate_manifest(report())))
            receipt = json.loads(output.getvalue())
            self.assertEqual(receipt['reportSha256'], m.digest(src.read_bytes()))
            self.assertEqual(receipt['manifestSha256'], m.digest(dst.read_bytes()))
            self.assertFalse(receipt['reportProvenanceAttested'])
            self.assertNotIn('CREATE FUNCTION', output.getvalue())

    def test_cli_never_overwrites_existing_output_or_follows_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            src, dst, link = [Path(directory) / n for n in ('report', 'manifest', 'link')]
            src.write_bytes(m.encoding(report())); dst.write_bytes(b'preserve'); link.symlink_to(dst)
            for path in (dst, link):
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(m.main(['--report', str(src), '--output', str(path)]), 1)
                self.assertEqual(dst.read_bytes(), b'preserve')

    def test_cli_rejects_symlink_oversize_and_nonregular_report(self):
        with tempfile.TemporaryDirectory() as directory:
            src, link, fifo, dst = [Path(directory) / n for n in ('report', 'link', 'fifo', 'out')]
            src.write_bytes(m.encoding(report())); link.symlink_to(src); os.mkfifo(fifo)
            for path in (link, fifo, Path(directory)):
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(m.main(['--report', str(path), '--output', str(dst)]), 1)
                self.assertFalse(dst.exists())
            src.write_bytes(b'x' * (m.MAX_BYTES + 1))
            with patch.object(m.os, 'read', side_effect=AssertionError('must fail before reading')):
                with self.assertRaises(ValueError): m.read_report(src)

    def test_cli_rejects_remote_modes_and_does_not_leak_exceptions(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(m.main(['--database-url', 'PRIVATE_CANARY']), 1)
        self.assertEqual(output.getvalue().strip(), m.FAILED)


if __name__ == '__main__':
    unittest.main()
