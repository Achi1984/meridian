"""Disposable local-only PG16 fixture evidence; never connects to Neon.

No operation on import. No installation or external-database fallback. A completed
run proves fixture-derived catalog comparison and listed negative cases, not full
trigger semantics or equivalence of a deployed database.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'scripts/publisher_test_readonly_inspection.py': 'dfa65b4258e47d7ae7b4e68d06cdafe4520a3db3d53b9f28cb80bd099a30c951',
    'docs/autonomy/event-adapter/review-binding/fixtures/publication-ledger.sql': 'c7cab138a398936dd59845db9838947b4a308a3d387b2c4102060ac3ae646736',
    'docs/autonomy/event-adapter/review-binding/fixtures/publication-send-record.sql': '84018bd5f335652592ad3bccc4574407e14b90d7751da55480e000da6cf37bce',
}
OWNER = 'publisher_fixture'
FAILED = 'LOCAL_PG16_FIXTURE_FAILED_NO_DEPLOYED_DATABASE_CLAIM'
NEGATIVES = {
    'disabled_internal_fk_trigger': """DO $fixture$
DECLARE trigger_name text;
BEGIN
 SELECT t.tgname INTO STRICT trigger_name
 FROM pg_catalog.pg_trigger t
 JOIN pg_catalog.pg_constraint k ON k.oid=t.tgconstraint
 JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
 JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
 WHERE n.nspname='meridian_publisher' AND c.relname='send_records'
   AND k.conname='send_records_operation_key_fkey' AND k.contype='f'
   AND t.tgisinternal AND pn.nspname='pg_catalog' AND p.proname='RI_FKey_check_ins';
 EXECUTE pg_catalog.format('ALTER TABLE meridian_publisher.send_records DISABLE TRIGGER %I',trigger_name);
END;
$fixture$;""",
    'disabled_trigger': 'ALTER TABLE meridian_publisher.reservations DISABLE TRIGGER guard_reservation_row;',
    'security_definer': 'ALTER FUNCTION meridian_publisher.guard_reservation() SECURITY DEFINER;',
    'changed_function_body': 'CREATE OR REPLACE FUNCTION meridian_publisher.guard_reservation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RETURN NEW; END;$$;',
    'changed_search_path': 'ALTER FUNCTION meridian_publisher.guard_reservation() SET search_path=public;',
    'missing_constraint': 'ALTER TABLE meridian_publisher.reservations DROP CONSTRAINT reservations_run_attempt_check;',
    'changed_column': 'ALTER TABLE meridian_publisher.reservations ALTER COLUMN status DROP NOT NULL;',
}
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'HOME': '/nonexistent'}


def load_inspector():
    result = {}
    for name, digest in PINS.items():
        data = (ROOT / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('source pin')
        result[name] = data
    path = ROOT / next(iter(PINS))
    spec = importlib.util.spec_from_file_location('fixture_inventory', path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(result[next(iter(PINS))], str(path), 'exec'), module.__dict__)
    return module, [result[n].decode() for n in list(PINS)[1:]]

def sources():
    module, fixtures = load_inspector()
    return module.INVENTORY_SQL, fixtures


def run(argv, text=None, timeout=10):
    """Private diagnostics, timeout cleanup, and post-capture output-size validation."""
    proc = subprocess.Popen(argv, stdin=subprocess.PIPE if text is not None else subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            env=ENV, start_new_session=True, close_fds=True)
    try:
        output, _ = proc.communicate(None if text is None else text.encode(), timeout=timeout)
        if proc.returncode != 0 or len(output) > 262144:
            raise ValueError('local command')
        return output.decode('utf-8', errors='strict')
    finally:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait(timeout=3)


def binaries(directory):
    if not directory.is_absolute() or directory.resolve(strict=True) != directory:
        raise ValueError('binary directory')
    for parent in (directory, *directory.parents):
        info = parent.stat()
        if info.st_uid not in (0, os.getuid()) or info.st_mode & 0o022:
            raise ValueError('binary ancestors')
    result, versions, digests = {}, {}, {}
    for name in ('initdb', 'postgres', 'psql'):
        path = directory / name
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022 or info.st_uid not in (0, os.getuid()):
            raise ValueError('binary boundary')
        version = run([str(path), '--version']).strip()
        import re
        if not re.fullmatch(re.escape(name) + r' \(PostgreSQL\) 16\.\d+(?: \([^\n]+\))?', version):
            raise ValueError('PostgreSQL 16 required')
        result[name], versions[name] = str(path), version
        digests[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    versions_numeric = [v.split('PostgreSQL) ', 1)[1].split()[0] for v in versions.values()]
    if len(set(versions_numeric)) != 1:
        raise ValueError('mixed PostgreSQL versions')
    return result, versions, digests


def snapshot_sql(inventory_sql):
    return """SELECT pg_catalog.jsonb_build_object(
 'inventory',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i)) FROM (""" + inventory_sql + """) i),
 'functions',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',p.proname,'owner',p.proowner,'securityDefiner',p.prosecdef,
   'configuration',p.proconfig,'language',l.lanname) ORDER BY p.proname)
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE n.nspname='meridian_publisher'),
 'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal) ORDER BY t.tgname)
   FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='meridian_publisher' AND NOT t.tgisinternal),
 'internalFkTriggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'table',c.relname,'constraint',k.conname,'functionSchema',pn.nspname,'function',p.proname,
   'eventMask',t.tgtype,'enabled',t.tgenabled,'deferrable',t.tgdeferrable,
   'initiallyDeferred',t.tginitdeferred)
   ORDER BY c.relname,k.conname,pn.nspname,p.proname,t.tgtype)
   FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_constraint k ON k.oid=t.tgconstraint
   JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
   JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
   WHERE n.nspname='meridian_publisher' AND t.tgisinternal AND k.contype='f'),
 'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'table',c.relname,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
   'notNull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity) ORDER BY c.relname,a.attnum)
   FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='meridian_publisher' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'table',c.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,
   'definition',pg_catalog.pg_get_constraintdef(k.oid,true)) ORDER BY c.relname,k.conname)
   FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='meridian_publisher'));
"""


def canonical(value, owner_oid):
    if type(value) is not dict or set(value) != {'inventory', 'functions', 'triggers', 'internalFkTriggers', 'columns', 'constraints'}:
        raise ValueError('snapshot shape')
    result = json.loads(json.dumps(value))
    for key in result:
        if type(result[key]) is not list or not 1 <= len(result[key]) <= 128:
            raise ValueError('snapshot bounds')
    seen = set()
    for row in result['inventory']:
        if (set(row) != {'kind', 'name', 'owner_oid', 'left'} or row['owner_oid'] != owner_oid
                or type(row['left']) is not str or len(row['left']) > 16384):
            raise ValueError('inventory boundary')
        if type(row['kind']) is not str or type(row['name']) is not str or (row['kind'], row['name']) in seen:
            raise ValueError('inventory identity collision')
        seen.add((row['kind'], row['name']))
        if row['kind'] == 'internal_fk_trigger':
            key = json.loads(row['name'])
            if (type(key) is not list or len(key) != 5 or any(type(x) is not str for x in key[:4])
                    or type(key[4]) is not int):
                raise ValueError('internal trigger identity truncated or malformed')
        row['owner_oid'] = 'fixture-owner'
    for row in result['functions']:
        if row['owner'] != owner_oid:
            raise ValueError('function owner')
        row['owner'] = 'fixture-owner'
    if len(json.dumps(result).encode()) > 131072:
        raise ValueError('snapshot output bound')
    return result


def require_fixture_facts(value):
    if len(value['columns']) != 11 or len(value['functions']) != 2 or len(value['triggers']) != 4:
        raise ValueError('fixture cardinalities')
    if len(value['internalFkTriggers']) != 4 or any(
            t['enabled'] != 'O' or t['functionSchema'] != 'pg_catalog'
            for t in value['internalFkTriggers']):
        raise ValueError('internal foreign key trigger state')
    if any(t['enabled'] != 'O' or t['internal'] for t in value['triggers']):
        raise ValueError('trigger state')
    if any(f['securityDefiner'] or f['configuration'] != ['search_path=pg_catalog']
           or f['language'] != 'plpgsql' for f in value['functions']):
        raise ValueError('function facts')
    if any(not c['validated'] for c in value['constraints']):
        raise ValueError('constraint validation')


def compare(expected, observed):
    require_fixture_facts(observed)
    if expected != observed:
        raise ValueError('canonical fixture mismatch')


def verify(directory):
    if sys.platform != 'linux' or os.getuid() == 0:
        raise ValueError('unprivileged Linux required')
    inspector, fixtures = load_inspector()
    inventory_sql = inspector.INVENTORY_SQL
    catalog_module, catalog_manifest = inspector.load_catalog()
    tools, versions, digests = binaries(directory)
    # No inherited PG*, DATABASE_URL, HOME or credential environment is forwarded.
    with tempfile.TemporaryDirectory(prefix='meridian-pg16-', dir='/tmp') as temporary:
        root = Path(temporary)
        root.chmod(0o700)
        data, sock = root / 'data', root / 'socket'
        sock.mkdir(mode=0o700)
        sock.chmod(0o700)
        run([tools['initdb'], '-D', str(data), '--username=' + OWNER, '--auth=trust', '--no-locale', '--encoding=UTF8'], timeout=20)
        server = subprocess.Popen([tools['postgres'], '-D', str(data), '-h', '', '-k', str(sock),
            '-c', 'unix_socket_permissions=0700', '-c', 'listen_addresses=', '-c', 'max_connections=10'],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env=ENV, start_new_session=True, close_fds=True)
        try:
            def sql(body):
                return run([tools['psql'], '-X', '-q', '-A', '-t', '--no-password',
                    '--host=' + str(sock), '--port=5432', '--username=' + OWNER,
                    '--dbname=postgres', '--set=ON_ERROR_STOP=1'],
                    "SET statement_timeout='5s'; SET lock_timeout='1s'; SET search_path=pg_catalog;\n" + body)
            deadline = time.monotonic() + 10
            while True:
                if server.poll() is not None:
                    raise ValueError('local server exited')
                try:
                    identity = json.loads(sql("SELECT json_build_array(current_setting('server_version_num')::int,current_user,current_database(),inet_server_addr(),current_setting('data_directory'),(SELECT oid FROM pg_roles WHERE rolname=current_user));"))
                    break
                except ValueError:
                    if time.monotonic() >= deadline:
                        raise ValueError('local startup timeout') from None
                    time.sleep(0.05)
            if not (160000 <= identity[0] < 170000 and identity[1:5] == [OWNER, 'postgres', None, str(data)]):
                raise ValueError('local identity')
            sql('\n'.join(fixtures))
            # Check the actual SQL result type; casting after UNION resolution
            # cannot recover names already truncated to PostgreSQL's name type.
            name_types = json.loads(sql('SELECT pg_catalog.jsonb_agg(DISTINCT pg_catalog.pg_typeof(i.name)::text) FROM (' + inventory_sql + ') i;'))
            if name_types != ['text']:
                raise ValueError('inventory identity SQL type')
            query = snapshot_sql(inventory_sql)
            def production_compare(observed_raw):
                rows = [(r['kind'], r['name'], r['owner_oid'], r['left']) for r in observed_raw['inventory']]
                return catalog_module.compare_fixture_catalog(rows, identity[5], identity[0], catalog_manifest)
            raw_expected = json.loads(sql(query))
            production_compare(raw_expected)
            expected = canonical(raw_expected, identity[5])
            require_fixture_facts(expected)
            raw_clean = json.loads(sql(query))
            production_compare(raw_clean)
            compare(expected, canonical(raw_clean, identity[5]))
            rejected, production_rejected = [], []
            for name, mutation in NEGATIVES.items():
                raw_observed = json.loads(sql('BEGIN;\n' + mutation + '\n' + query + '\nROLLBACK;'))
                observed = canonical(raw_observed, identity[5])
                try:
                    production_compare(raw_observed)
                except ValueError:
                    production_rejected.append(name)
                else:
                    raise ValueError('production comparator accepted negative case')
                if name == 'disabled_internal_fk_trigger':
                    expected_fk = [r for r in expected['inventory'] if r['kind'] == 'internal_fk_trigger']
                    observed_fk = [r for r in observed['inventory'] if r['kind'] == 'internal_fk_trigger']
                    if len(expected_fk) != 4 or len(observed_fk) != 4 or expected_fk == observed_fk:
                        raise ValueError('inspector internal trigger mutation not visible')
                try:
                    compare(expected, observed)
                except ValueError:
                    rejected.append(name)
                else:
                    raise ValueError('negative case accepted')
                raw_clean = json.loads(sql(query))
                production_compare(raw_clean)
                compare(expected, canonical(raw_clean, identity[5]))
            report = {'kind': 'LOCAL_PG16_FIXTURE_COMPARISON', 'sourceSha256': PINS,
                      'toolVersions': versions, 'toolSha256': digests, 'serverVersionNum': identity[0],
                      'inventoryNameSqlType': name_types[0],
                      'inventorySqlSha256': hashlib.sha256(inventory_sql.encode()).hexdigest(),
                      'expectedCatalog': expected, 'negativeCasesRejected': rejected,
                      'productionComparatorNegativeCasesRejected': production_rejected,
                      'fixtureManifestSha256': inspector.CATALOG_PINS['publisher-fixture-catalog-pg16.json'],
                      'fixtureCatalogMatch': True,
                      'deployedSchemaEquivalent': False, 'fullSemanticsProven': False,
                      'activationAuthorized': False}
        finally:
            # All exit paths finish server cleanup before any success report.
            try:
                if server.poll() is None:
                    os.killpg(server.pid, signal.SIGQUIT)
                server.wait(timeout=5)
            except BaseException:
                try:
                    os.killpg(server.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                server.wait(timeout=3)
                raise ValueError('server cleanup indeterminate') from None
        return report


def main(argv=None):
    def interrupted(unused_signum, unused_frame):
        raise KeyboardInterrupt()
    prior = signal.signal(signal.SIGTERM, interrupted)
    try:
        class QuietParser(argparse.ArgumentParser):
            def error(self, unused_message):
                raise ValueError('arguments')
        parser = QuietParser(allow_abbrev=False)
        parser.add_argument('--pg-bin', type=Path, required=True)
        args = parser.parse_args(argv)
        report = verify(args.pg_bin)
        print(json.dumps(report, sort_keys=True, separators=(',', ':')))
        return 0
    except BaseException:
        print(FAILED)
        return 1
    finally:
        signal.signal(signal.SIGTERM, prior)


if __name__ == '__main__':
    sys.exit(main())
