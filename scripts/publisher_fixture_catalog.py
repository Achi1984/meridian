"""Offline pinned fixture manifest generation and strict catalog comparison.

Inert on import. A manifest matches catalog observations only; neither generation
nor comparison attests report provenance, full SQL semantics or activation rights.
Generation receipts bind input/output bytes separately to avoid source-hash cycles.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

CONTRACT = 'publisher-fixture-catalog-v1'
SERVER_VERSION = 160015
QUERY_SHA256 = 'eead021680c07d6da2cca799e1836a9d2d18c55149cd3cd6514a9dd1f6979eef'
FIXTURES = {
    'docs/autonomy/event-adapter/review-binding/fixtures/publication-ledger.sql':
        'c7cab138a398936dd59845db9838947b4a308a3d387b2c4102060ac3ae646736',
    'docs/autonomy/event-adapter/review-binding/fixtures/publication-send-record.sql':
        '84018bd5f335652592ad3bccc4574407e14b90d7751da55480e000da6cf37bce',
}
INSPECTOR_PATH = 'scripts/publisher_test_readonly_inspection.py'
KINDS = frozenset(('schema', 'relation', 'column', 'constraint', 'trigger', 'internal_fk_trigger', 'function'))
NEGATIVES = frozenset(('disabled_internal_fk_trigger', 'disabled_trigger', 'security_definer',
    'changed_function_body', 'changed_search_path', 'missing_constraint', 'changed_column'))
MAX_BYTES = 262144
FAILED = 'FIXTURE_CATALOG_FAILED'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def valid_digest(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def encoding(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'),
                       allow_nan=False) + '\n').encode('ascii')


def parse(data):
    if type(data) is not bytes or not 1 <= len(data) <= MAX_BYTES:
        raise ValueError('input size')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    def constant(unused):
        raise ValueError('nonfinite JSON')
    return json.loads(data.decode('utf-8', errors='strict'), object_pairs_hook=pairs, parse_constant=constant)


def version(value):
    if type(value) is not int or value != SERVER_VERSION:
        raise ValueError('unsupported server version')


def identity(kind, name):
    if type(kind) is not str or kind not in KINDS or type(name) is not str or not 1 <= len(name) <= 256:
        raise ValueError('catalog identity')
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in name):
        raise ValueError('catalog name controls')
    return kind, name


def entries(rows, owner_oid):
    if type(owner_oid) is not int or not 0 < owner_oid <= 4294967295:
        raise ValueError('owner OID')
    if type(rows) is not list or not 1 <= len(rows) <= 128:
        raise ValueError('catalog count')
    result, seen = [], set()
    for row in rows:
        if type(row) not in (tuple, list) or len(row) != 4:
            raise ValueError('catalog row')
        kind, name, owner, definition = row
        key = identity(kind, name)
        if key in seen or type(owner) is not int or owner != owner_oid:
            raise ValueError('catalog duplicate or owner')
        if type(definition) is not str or not 1 <= len(definition) <= 16384:
            raise ValueError('definition bounds')
        seen.add(key)
        result.append({'kind': kind, 'name': name, 'definitionSha256': digest(definition.encode('utf-8'))})
    return sorted(result, key=lambda item: (item['kind'], item['name']))


def validate_manifest(value):
    if type(value) is not dict or set(value) != {
            'schemaVersion', 'contract', 'serverVersionNum', 'inventorySqlSha256', 'fixtureSha256', 'entries'}:
        raise ValueError('manifest shape')
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or value['contract'] != CONTRACT:
        raise ValueError('manifest contract')
    version(value['serverVersionNum'])
    if value['inventorySqlSha256'] != QUERY_SHA256 or value['fixtureSha256'] != FIXTURES:
        raise ValueError('manifest source pins')
    rows = value['entries']
    if type(rows) is not list or not 1 <= len(rows) <= 128:
        raise ValueError('manifest count')
    keys = []
    for row in rows:
        if type(row) is not dict or set(row) != {'kind', 'name', 'definitionSha256'}:
            raise ValueError('manifest entry')
        keys.append(identity(row['kind'], row['name']))
        if not valid_digest(row['definitionSha256']):
            raise ValueError('manifest definition digest')
    if keys != sorted(keys) or len(set(keys)) != len(keys):
        raise ValueError('manifest order or duplicate')
    if len(encoding(value)) > MAX_BYTES:
        raise ValueError('manifest size')
    return value


def generate_manifest(report):
    if type(report) is not dict or report.get('kind') != 'LOCAL_PG16_FIXTURE_COMPARISON':
        raise ValueError('report kind')
    version(report.get('serverVersionNum'))
    pins = report.get('sourceSha256')
    if (type(pins) is not dict or set(pins) != set(FIXTURES) | {INSPECTOR_PATH}
            or any(pins[name] != expected for name, expected in FIXTURES.items())
            or not valid_digest(pins[INSPECTOR_PATH]) or report.get('inventorySqlSha256') != QUERY_SHA256):
        raise ValueError('report source pins')
    if any(report.get(key) is not False for key in ('deployedSchemaEquivalent', 'fullSemanticsProven', 'activationAuthorized')):
        raise ValueError('report claim')
    negatives = report.get('negativeCasesRejected')
    if (type(negatives) is not list or len(negatives) != len(NEGATIVES)
            or any(type(n) is not str for n in negatives) or set(negatives) != NEGATIVES):
        raise ValueError('negative evidence shape')
    catalog = report.get('expectedCatalog')
    if (type(catalog) is not dict or type(catalog.get('inventory')) is not list
            or not 1 <= len(catalog['inventory']) <= 128):
        raise ValueError('report catalog')
    raw = []
    for row in catalog['inventory']:
        if type(row) is not dict or set(row) != {'kind', 'name', 'owner_oid', 'left'} or row['owner_oid'] != 'fixture-owner':
            raise ValueError('normalized fixture row')
        raw.append((row['kind'], row['name'], 1, row['left']))
    return validate_manifest({'schemaVersion': 1, 'contract': CONTRACT, 'serverVersionNum': report['serverVersionNum'],
        'inventorySqlSha256': QUERY_SHA256, 'fixtureSha256': dict(FIXTURES), 'entries': entries(raw, 1)})


def compare_fixture_catalog(rows, owner_oid, server_version_num, manifest):
    """Exact identity/definition comparison; caller owns source and runtime trust."""
    validate_manifest(manifest)
    version(server_version_num)
    if entries(rows, owner_oid) != manifest['entries']:
        raise ValueError('fixture catalog mismatch')
    return {'fixtureCatalogMatch': True, 'schemaEquivalenceEstablished': False, 'activationAuthorized': False}


def read_report(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 1 <= info.st_size <= MAX_BYTES:
            raise ValueError('report file')
        data = os.read(fd, MAX_BYTES + 1)
        if len(data) != info.st_size:
            raise ValueError('report length')
        return data
    finally:
        os.close(fd)


def write_new(path, data):
    # Exclusive creation: never overwrite a prior candidate or follow symlinks.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)  # inherited directory ACL must not expose output
        with os.fdopen(fd, 'wb', closefd=False) as output:
            output.write(data)
            output.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def main(argv=None):
    class QuietParser(argparse.ArgumentParser):
        def error(self, unused):
            raise ValueError('arguments')
    try:
        parser = QuietParser(add_help=False, allow_abbrev=False)
        parser.add_argument('--report', required=True, type=Path)
        parser.add_argument('--output', required=True, type=Path)
        args = parser.parse_args(argv)
        source = read_report(args.report)
        manifest = encoding(generate_manifest(parse(source)))
        write_new(args.output, manifest)
        # This receipt is deliberately outside the manifest dependency graph.
        print(json.dumps({'kind': 'FIXTURE_MANIFEST_GENERATED', 'reportSha256': digest(source),
            'manifestSha256': digest(manifest), 'serverVersionNum': SERVER_VERSION,
            'reportProvenanceAttested': False, 'schemaEquivalenceEstablished': False,
            'activationAuthorized': False}, sort_keys=True, separators=(',', ':')))
        return 0
    except BaseException:
        print(FAILED)
        return 1


if __name__ == '__main__':
    sys.exit(main())
