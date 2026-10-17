"""Explicit read-only inspection, never activation or schema-equivalence approval.

Imports are inert. Runtime/source/session trust and approval are external gates.
An inventory line alone is not completion: require final status and outer exit0.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path(__file__).resolve().parent
PINS = {
    'publisher_test_auto_setup.py': 'c859d4413eb2b50f7aae04e1d28eb23961989eb64beb29cb751eb65f06a8bfc0',
    'publisher_test_password_setup.py': '3f3e4cab7fa64b5890fda1483bc73ac277636f001ec933bf514c926267ef68fb',
    'publisher-test-readonly-queries.json': '99ac288ed3e1dd5681345aa828bed3e129e729a1430f9022ca456622b62e7789',
}
OBSERVED = 'READONLY_INSPECTION_COMPLETE_SCHEMA_EQUIVALENCE_NOT_ESTABLISHED'
FAILED = 'READONLY_INSPECTION_FAILED_STOP'
_USED = False
RESOURCE_PINS = {
    'baseline': 'cb60f0aab88dd3f23560ad14e2d4849a8ed7abc8dab0e437ba263fa217356e6c',
    'ca': '9481fcd95f41b221f02f14d896535fe500bec539bc563c4cdca1acee483a8bdd',
    'gh': '553949e2efa12842771efe6012aa4de21f1d591530ec17fc435f610f10e017ee',
    'neon': 'e90831b13bfcf75df8d7322617965022508d28b0b8116530992c2a5db776371a',
}

def verify_resources(args):
    for name, digest in RESOURCE_PINS.items():
        if name != 'baseline' and getattr(args, name + '_sha256') != digest:
            raise ValueError('resource pin argument')
        path = getattr(args, name)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022
                    or info.st_uid not in (0, os.getuid()) or info.st_size > 134217728):
                raise ValueError('resource boundary')
            actual = hashlib.sha256()
            while chunk := os.read(fd, 1048576):
                actual.update(chunk)
            if actual.hexdigest() != digest:
                raise ValueError('resource pin')
        finally:
            os.close(fd)


# Catalog-only inventory. Rendered PostgreSQL definitions are observations, not
# equivalent to CREATE-source bytes; never derive an authorization from hashes.
INVENTORY_SQL = """WITH ns AS (
 SELECT oid,nspowner FROM pg_catalog.pg_namespace WHERE nspname='meridian_publisher'
), inventory(kind,name,owner_oid,definition) AS (
 SELECT 'schema','meridian_publisher',nspowner,'schema' FROM ns
 UNION ALL SELECT 'relation',c.relname,c.relowner,c.relkind::text
 FROM pg_catalog.pg_class c JOIN ns ON c.relnamespace=ns.oid WHERE c.relkind<>'i'
 UNION ALL SELECT 'column',c.relname||'.'||a.attname,c.relowner,
 pg_catalog.jsonb_build_object('type',pg_catalog.format_type(a.atttypid,a.atttypmod),
 'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
 'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid))::text
 FROM pg_catalog.pg_class c JOIN ns ON c.relnamespace=ns.oid
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE c.relkind='r'
 UNION ALL SELECT 'constraint',c.relname||'.'||k.conname,c.relowner,
 pg_catalog.jsonb_build_object('type',k.contype,'validated',k.convalidated,
 'definition',pg_catalog.pg_get_constraintdef(k.oid,true))::text
 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON k.conrelid=c.oid
 JOIN ns ON c.relnamespace=ns.oid
 UNION ALL SELECT 'trigger',c.relname||'.'||t.tgname,c.relowner,
 pg_catalog.jsonb_build_object('enabled',t.tgenabled,'definition',pg_catalog.pg_get_triggerdef(t.oid,true))::text
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON t.tgrelid=c.oid
 JOIN ns ON c.relnamespace=ns.oid WHERE NOT t.tgisinternal
 UNION ALL SELECT 'function',p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
 p.proowner,pg_catalog.pg_get_functiondef(p.oid)
 FROM pg_catalog.pg_proc p JOIN ns ON p.pronamespace=ns.oid
)
SELECT kind,name,owner_oid,pg_catalog.left(definition,16385)
FROM inventory ORDER BY kind,name LIMIT 129"""

def pinned(name):
    fd = os.open(ROOT / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_size > 262144 or s.st_mode & 0o022 or s.st_uid not in (0, os.getuid()):
            raise ValueError('source boundary')
        data = os.read(fd, 262145)
        if len(data) != s.st_size or hashlib.sha256(data).hexdigest() != PINS[name]:
            raise ValueError('source pin')
        return data
    finally:
        os.close(fd)

def load_dependencies():
    source = {name: pinned(name) for name in PINS}
    def module(name):
        path = ROOT / (name + '.py')
        spec = importlib.util.spec_from_file_location(name, path)
        result = importlib.util.module_from_spec(spec)
        exec(compile(source[name + '.py'], str(path), 'exec'), result.__dict__)
        return result
    original, auto = module('publisher_test_password_setup'), module('publisher_test_auto_setup')
    auto.load_original = lambda: original
    return auto, original, json.loads(source['publisher-test-readonly-queries.json'])

def validate_post_setup(auto, repo, user, environment, policies, repo_page, env_page):
    repo_names, env_names = auto._secret_names(repo_page), auto._secret_names(env_page)
    expected = set(auto.SECRET_NAMES)
    if expected & repo_names or expected != env_names:
        raise ValueError('prepared secret metadata')
    # Reuse the unchanged identity/protection checks after checking the NEW
    # metadata contract independently; never change auto setup's conflict gate.
    empty = {'total_count': 0, 'secrets': []}
    auto.validate_github(repo, user, environment, policies, empty, empty)

def collect(cursor, original, baseline, queries):
    original.verify(cursor, baseline)
    cursor.execute(queries['grantMatrixSql'])
    if cursor.fetchmany(1):
        raise ValueError('effective grant mismatch')
    cursor.execute(queries['temporarySql'])
    temporary = cursor.fetchmany(4)
    if (len(temporary) != 3 or {r[0] for r in temporary} != set(original.ROLES)
            or any(len(r) != 3 or any(type(v) is not bool for v in r[1:]) for r in temporary)):
        raise ValueError('temporary inventory')
    cursor.execute(INVENTORY_SQL)
    rows = cursor.fetchmany(129)
    if not 1 <= len(rows) <= 128:
        raise ValueError('inventory bounds')
    entries, seen = [], set()
    for kind, name, owner, definition in rows:
        if (kind not in {'schema', 'relation', 'column', 'constraint', 'trigger', 'function'}
                or type(name) is not str or len(name) > 256 or (kind, name) in seen
                or type(owner) is not int or owner != baseline['owner_oid']
                or type(definition) is not str or len(definition) > 16384):
            raise ValueError('inventory schema')
        seen.add((kind, name))
        entries.append({'kind': kind, 'nameSha256': hashlib.sha256(name.encode()).hexdigest(),
                        'definitionSha256': hashlib.sha256(definition.encode()).hexdigest()})
    if {n for k, n in seen if k == 'relation'} != {'reservations', 'send_records'}:
        raise ValueError('relations')
    if {n for k, n in seen if k == 'function'} != {'guard_reservation()', 'guard_send_record()'}:
        raise ValueError('functions')
    if {n for k, n in seen if k == 'trigger'} != {
            'reservations.guard_reservation_row', 'reservations.guard_reservation_truncate',
            'send_records.guard_send_record_row', 'send_records.guard_send_record_truncate'}:
        raise ValueError('triggers')
    return {'kind': 'READONLY_SCHEMA_INVENTORY', 'schemaEquivalenceEstablished': False,
            'activationAuthorized': False, 'temporary': [list(r) for r in temporary],
            'definitions': entries}

class InspectionServices:
    def __init__(self, args, auto, original, queries):
        self.auto, self.original, self.queries = auto, original, queries
        verify_resources(args)
        self.base = auto.Services(args, original)

    def preflight(self):
        b, a = self.base, self.auto
        verify_resources(b.args)
        b.original.verify_installed_dependency()
        b.original.load_ca(b.args.ca)
        if hashlib.sha256(b.args.ca.read_bytes()).hexdigest() != b.args.ca_sha256:
            raise ValueError('ca')
        identity = json.loads(b.command.run([b.neon, 'me', '--output', 'json']))
        if type(identity) is not dict or not identity.get('id'):
            raise ValueError('neon identity')
        prefix = 'repos/' + a.REPO
        target = prefix + '/environments/' + a.ENVIRONMENT
        validate_post_setup(a, b.api(prefix), b.api('user'), b.api(target),
            b.api(target + '/deployment-branch-policies?per_page=100'),
            b.api(prefix + '/actions/secrets?per_page=100'), b.api(target + '/secrets?per_page=100'))
        variable = b.api(target + '/variables/MERIDIAN_PUBLISHER_TEST_DATABASE')
        if variable.get('name') != 'MERIDIAN_PUBLISHER_TEST_DATABASE' or variable.get('value') != 'publisher_ledger':
            raise ValueError('database binding')
        return True

    def inspect(self):
        b, a, original = self.base, self.auto, self.original
        # Finish the private bounded CLI and its process-group cleanup BEFORE
        # forking the DB worker. A worker deadline must not orphan CLI children.
        admin = b.admin_password()
        def worker(phase):
            original.load_ca(b.args.ca)
            if hashlib.sha256(b.args.ca.read_bytes()).hexdigest() != b.args.ca_sha256:
                raise ValueError('ca')
            import psycopg
            original.verify_dependency_origin(psycopg.__file__)
            if psycopg.__version__ != '3.3.6':
                raise ValueError('driver')
            # A/P are untimed input phases in the existing supervisor. Move
            # immediately into timed C/M before any blocking work; no prompts.
            phase(b'A')
            phase(b'C')
            connection = None
            try:
                connection = psycopg.connect(host=a.HOST, port=5432, dbname='publisher_ledger',
                    user='publisher_owner', password=admin, sslmode='verify-full',
                    sslrootcert=str(b.args.ca), connect_timeout=10, autocommit=False,
                    options='-c search_path=pg_catalog -c statement_timeout=10000 -c lock_timeout=2000 -c default_transaction_read_only=on')
                notices = []
                connection.add_notice_handler(lambda unused: notices.append(True))
                phase(b'P')
                phase(b'M')  # Timed observation phase, not a write authorization.
                report = collect(connection.cursor(), original, b.baseline, self.queries)
                if notices:
                    raise ValueError('notice')
            finally:
                if connection is not None:
                    phase(b'L')
                    try:
                        connection.rollback()
                    finally:
                        connection.close()
            if notices:
                raise ValueError('cleanup notice')
            encoded = json.dumps(report, sort_keys=True, separators=(',', ':'))
            if len(encoded.encode()) > 16384 or not original.emit_status(encoded):
                return original.STATUS_FAIL
            return original.STATUS_OK
        return original.supervise(worker) == original.STATUS_OK

def run_inspection(services):
    try:
        if services.preflight() is True and services.inspect() is True and services.preflight() is True:
            return OBSERVED
    except BaseException:
        pass
    return FAILED

def main(argv=None):
    global _USED
    if _USED:
        return 1
    _USED = True
    original, result = None, FAILED
    try:
        auto, original, queries = load_dependencies()
        parser = original.QuietParser(add_help=False, allow_abbrev=False)
        for flag in ('inspect-read-only', 'owner-approved-cli-sessions', 'acknowledge-provider-logging', 'exclusive-owner-window'):
            parser.add_argument('--' + flag, action='store_true', required=True)
        for name in ('baseline', 'ca', 'gh', 'neon'):
            parser.add_argument('--' + name, type=Path, required=True)
        for name in ('ca', 'gh', 'neon'):
            parser.add_argument('--' + name + '-sha256', required=True)
        args = parser.parse_args(argv)
        if (sys.platform != 'linux' or sys.flags.isolated != 1 or sys.gettrace() or sys.getprofile()
                or any(k.startswith(('PG', 'PSYCOPG', 'OTEL_', 'PYTHON', 'SSL_CERT_'))
                       or k in {'LD_PRELOAD', 'LD_LIBRARY_PATH', 'OPENSSL_CONF', 'SSLKEYLOGFILE'} for k in os.environ)
                or not sys.stdin.isatty() or not sys.stderr.isatty()):
            raise ValueError('invocation')
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        result = run_inspection(InspectionServices(args, auto, original, queries))
    except BaseException:
        pass
    try:
        delivered = original is not None and original.emit_status(result)
    except BaseException:
        delivered = False
    return 0 if delivered and result == OBSERVED else 1

if __name__ == '__main__':
    sys.exit(main())
