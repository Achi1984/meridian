"""Injected TEST-role transaction driver; no CLI, driver import or credential I/O.

API: drive_transition(request, baseline, transcript, services). Services are a
TRUSTED boundary: expected_binding(), claim(binding), connect(), prewrite(conn,
binding), phase(token), record(binding, stage, status). claim returns True only
for a newly durably claimed operation; False blocks; exceptions are uncertain.
record and phase return None or raise. connect returns an injected transaction
connection with begin/commit/rollback/close/cursor and pgconn TLS observation.
This abstract begin contract is not a direct psycopg connection API. No default implementations exist here.
prewrite must freshly verify complete Gate A on this exact write transaction for
activation and independently enforce approval/target/concurrency constraints.
The existing inspector connection factory is read-only and is NOT a write
adapter. Its collector cannot verify post-LOGIN because original.verify requires
NOLOGIN. prewrite has no implementation in this package; matching receipts or
booleans are not attestations. Only injected tests exercise it here.

A future reviewed launcher must authenticate immutable owner approval, source and
baseline bytes, scope/expiry, workflow identity and durable operation history;
pin/load dependencies; acquire credentials; enforce TLS/connection configuration,
timeouts and parent supervision; and exclude concurrent role/schema changes.
This driver cannot make catalog observations atomic against unrelated privileged
actors. It does not install/dispatch workflows or authenticate any evidence.
Closure failure/mixed roles requires owner reconciliation, never automatic repair.
Independent session observation remains necessary after closure. No retry occurs.
"""
import copy
import re
import publisher_role_cycle as cycle

HOST = 'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech'
MANIFEST = '611ce25904b59473149f5cb8bc69613309b0b8b147df6296defdfecc0ee11274'
TARGET = {'repository': 'Achi1984/meridian', 'project': 'wandering-queen-12324132',
          'branch': 'br-delicate-field-b9uijh3y', 'host': HOST, 'database': 'publisher_ledger',
          'owner': 'publisher_owner', 'workflow': '.github/workflows/meridian-database-readiness.yml'}
IDENTITY_SQL = """SELECT pg_catalog.current_database(), current_user, session_user,
 pg_catalog.current_setting('server_version_num')::integer,
 (SELECT oid::bigint FROM pg_catalog.pg_roles WHERE rolname=current_user),
 pg_catalog.current_setting('search_path'),
 pg_catalog.current_setting('createrole_self_grant'),
 pg_catalog.current_setting('transaction_read_only') = 'on'"""
ROLE_SQL = """SELECT r.rolname, r.oid::bigint, r.rolcanlogin, r.rolsuper,
 r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit,
 EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d
 WHERE d.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass
 AND d.refobjid=r.oid AND d.deptype='o')
 FROM pg_catalog.pg_roles r WHERE r.rolname IN
 ('meridian_test_reservation','meridian_test_sender','meridian_test_reader')"""
MEMBERSHIP_SQL = """SELECT m.roleid::bigint, m.member::bigint, m.grantor::bigint,
 m.admin_option, m.inherit_option, m.set_option FROM pg_catalog.pg_auth_members m
 WHERE m.roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN
 ('meridian_test_reservation','meridian_test_sender','meridian_test_reader'))
 OR m.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN
 ('meridian_test_reservation','meridian_test_sender','meridian_test_reader'))"""


def _keys(value, names):
    if type(value) is not dict or set(value) != set(names):
        raise ValueError('fields')


def validate_binding(expected, observed):
    fields = ('operation_id', 'cycle_id', 'direction', 'source_sha', 'baseline_sha256',
              'manifest_sha256', 'workflow_sha', 'approval_ref', 'target')
    for binding in (expected, observed):
        _keys(binding, fields)
        for key, length in (('operation_id',32),('cycle_id',32),('source_sha',40),
                            ('baseline_sha256',64),('workflow_sha',40)):
            if type(binding[key]) is not str or re.fullmatch('[0-9a-f]{'+str(length)+'}',binding[key]) is None:
                raise ValueError('binding digest/id')
        if (type(binding['direction']) is not str or binding['direction'] not in ('activation','closure')
                or type(binding['manifest_sha256']) is not str or binding['manifest_sha256'] != MANIFEST
                or type(binding['approval_ref']) is not str
                or re.fullmatch('[1-9][0-9]{0,19}',binding['approval_ref']) is None):
            raise ValueError('binding scope')
        _keys(binding['target'], TARGET)
        if any(type(binding['target'][k]) is not str or binding['target'][k] != v for k,v in TARGET.items()):
            raise ValueError('binding target')
    if expected != observed:
        raise ValueError('binding mismatch')


def observe_roles(connection, baseline, login):
    """Read bounded fixed rows on the supplied connection; no caller row coercion."""
    cycle.validate_baseline(baseline)
    if getattr(getattr(connection,'pgconn',None),'ssl_in_use',None) is not True:
        raise ValueError('client TLS')
    cursor = connection.cursor()
    cursor.execute(IDENTITY_SQL)
    rows = cursor.fetchmany(2)
    if type(rows) is not list or len(rows) != 1 or type(rows[0]) is not tuple or len(rows[0]) != 8:
        raise ValueError('identity shape')
    row = rows[0]
    if (row[:3] != ('publisher_ledger','publisher_owner','publisher_owner')
            or type(row[3]) is not int or row[3] != 160015
            or type(row[4]) is not int or row[4] != baseline['owner_oid']
            or row[5:7] != ('pg_catalog','') or row[7] is not False):
        raise ValueError('identity mismatch')
    cursor.execute(ROLE_SQL)
    rows = cursor.fetchmany(4)
    if type(rows) is not list or len(rows) != 3:
        raise ValueError('role count')
    roles = {}
    for row in rows:
        if type(row) is not tuple or len(row) != 10 or type(row[0]) is not str or row[0] not in cycle.ROLES or row[0] in roles:
            raise ValueError('role row')
        roles[row[0]] = dict(zip(('oid','login')+cycle.FLAGS,row[1:]))
    cursor.execute(MEMBERSHIP_SQL)
    rows = cursor.fetchmany(4)
    if type(rows) is not list or len(rows) != 3 or any(type(r) is not tuple or len(r) != 6 for r in rows):
        raise ValueError('membership rows')
    snapshot = {'roles':roles,'memberships':[dict(zip(('role_oid','member_oid','grantor_oid','admin','inherit','set'),r)) for r in rows]}
    cycle.validate_snapshot(baseline,snapshot,login)
    return snapshot


def drive_transition(request, baseline, transcript, services):
    """One injected activation OR closure; result never authorizes dispatch.

    All errors are sanitized. Once a claim could have occurred, no retry is
    attempted. Even journal/phase failures cannot skip connection cleanup.
    The returned transcript is observation-only, not durable operation history.
    state.dispatchEligible is model eligibility only. phase(L) acknowledges
    cleanup start, not parent supervisor completion; the original full supervisor
    protocol is not composed here. A future launcher must await its clean exit.
    """
    connection = None
    cycle.validate_baseline(baseline)
    cycle.evaluate_cycle(baseline,transcript)
    if len(transcript) > cycle.MAX_EVENTS - 6:
        raise ValueError('insufficient transcript budget')
    events = copy.deepcopy(transcript)
    binding = None
    outcome, claimed, started, committing, committed = 'BLOCKED', False, False, False, False
    cleanup_ok = True
    connecting = False
    try:
        cycle.validate_baseline(baseline)
        baseline = copy.deepcopy(baseline)
        current = cycle.evaluate_cycle(baseline,events)
        binding = copy.deepcopy(request)
        validate_binding(services.expected_binding(),binding)
        activating = binding['direction'] == 'activation'
        if current['phase'] != ('INITIAL' if activating else 'CLOSURE_READY'):
            raise ValueError('phase')
        # A missing composition adapter must fail before claim/connect/effects.
        if not callable(getattr(services,'prewrite',None)):
            raise ValueError('missing prewrite adapter')
        outcome = 'INDETERMINATE'  # claim may be durable even if its reply is lost
        claim = services.claim(copy.deepcopy(binding))
        if claim is False:
            outcome = 'BLOCKED'
            raise ValueError('already claimed')
        if claim is not True:
            raise ValueError('claim result')
        claimed, outcome = True, 'FAILED'
        connecting = True
        connection = services.connect()
        if connection is None:
            raise ValueError('connection')
        cursor = connection.cursor()
        connection.begin()
        if services.prewrite(connection,copy.deepcopy(binding)) is not None:
            raise ValueError('prewrite contract')
        before = observe_roles(connection,baseline,not activating)
        plan = cycle.fixed_sql_plan(baseline,before,activating)
        if activating:
            events.append({'type':'precheck','snapshot':before})
        # Mark uncertainty before ACK/first ALTER. A failed ACK never sends ALTER.
        started = True
        events.append({'type':'activation_started'} if activating else {'type':'closure_started','snapshot':before})
        if services.record(copy.deepcopy(binding),'mutation_started','PENDING') is not None:
            raise ValueError('journal acknowledgement')
        if services.phase(b'M') is not None:
            raise ValueError('phase acknowledgement')
        for sql in plan[1:-1]:
            cursor.execute(sql)
        observe_roles(connection,baseline,activating)
        committing = True
        if services.record(copy.deepcopy(binding),'commit_started','PENDING') is not None:
            raise ValueError('journal acknowledgement')
        connection.commit()
        committed = True
        events.append({'type':'activation_committed' if activating else 'closure_committed'})
        after = observe_roles(connection,baseline,activating)
        events.append({'type':'activation_verified' if activating else 'closure_verified','snapshot':after})
        outcome = 'CONFIRMED'
    except BaseException:
        if started or outcome == 'INDETERMINATE' or (connecting and connection is None):
            outcome = 'INDETERMINATE'
    finally:
        if connection is not None:
            try:
                if services.phase(b'L') is not None:
                    raise ValueError('cleanup acknowledgement')
            except BaseException:
                cleanup_ok = False
            # Never infer rollback after an ambiguous commit. Close independently.
            # A confirmed commit may open a new read transaction for verification.
            if not committing or committed:
                try:
                    connection.rollback()
                except BaseException:
                    cleanup_ok = False
            try:
                connection.close()
            except BaseException:
                cleanup_ok = False
        if not cleanup_ok:
            outcome = 'INDETERMINATE'
        if claimed:
            try:
                if services.record(copy.deepcopy(binding),'finished',outcome) is not None:
                    raise ValueError('journal acknowledgement')
            except BaseException:
                outcome = 'INDETERMINATE'
    if started:
        state = cycle.evaluate_cycle(baseline,events)['phase']
        if state in ('ACTIVATION_VERIFIED','CLOSURE_VERIFIED'):
            events.append({'type':'activation_cleanup' if state == 'ACTIVATION_VERIFIED' else 'closure_cleanup',
                           'clean':outcome == 'CONFIRMED'})
        elif outcome != 'CONFIRMED':
            events.append({'type':'uncertain'})
    state = cycle.evaluate_cycle(baseline,events)
    return {'outcome':outcome,'transcript':events,'state':state,
            'operationClaimConfirmed':claimed,'connectionCleanupConfirmed':connection is not None and cleanup_ok,
            'activationAuthorized':False,'dispatchAuthorized':False,
            'supervisorCompletionEstablished':False,
            'ownerReconciliationRequired':outcome == 'INDETERMINATE' or (claimed and outcome == 'FAILED'),
            'evidenceAuthenticated':False}
