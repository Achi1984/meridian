"""Offline TEST-role cycle planning. No I/O, execution, credentials or authority.

Inputs are untrusted observations, not authenticated receipts. An eventual adapter
must bind fresh Gate A, owner approval, workflow/run identity and supervisor facts.
Only the enumerated pg_roles attributes and membership edges are compared; password
identity, effective grants and active sessions are not inferred from these fields.
"""

ROLES = ('meridian_test_reservation', 'meridian_test_sender', 'meridian_test_reader')
FLAGS = ('superuser', 'create_db', 'create_role', 'replication', 'bypass_rls',
         'inherit', 'owns_objects')
MAX_EVENTS = 32


def _keys(value, expected):
    if type(value) is not dict or set(value) != set(expected):
        raise ValueError('unexpected fields')


def _oid(value):
    if type(value) is not int or not 0 < value < 2**32:
        raise ValueError('invalid OID')
    return value


def validate_baseline(baseline):
    _keys(baseline, ('owner_oid', 'roles'))
    owner = _oid(baseline['owner_oid'])
    _keys(baseline['roles'], ROLES)
    ids = [owner]
    for name in ROLES:
        role = baseline['roles'][name]
        _keys(role, ('oid', 'grantor_oid'))
        ids.append(_oid(role['oid']))
        _oid(role['grantor_oid'])
    if len(set(ids)) != 4:
        raise ValueError('duplicate role OID')


def validate_snapshot(baseline, snapshot, login):
    """Require exact role set, fixed observed attributes and exact membership edges."""
    validate_baseline(baseline)
    if type(login) is not bool:
        raise ValueError('login must be boolean')
    _keys(snapshot, ('roles', 'memberships'))
    _keys(snapshot['roles'], ROLES)
    for name in ROLES:
        role = snapshot['roles'][name]
        _keys(role, ('oid', 'login') + FLAGS)
        if _oid(role['oid']) != baseline['roles'][name]['oid']:
            raise ValueError('role OID changed')
        if role['login'] is not login or any(role[f] is not False for f in FLAGS):
            raise ValueError('role attribute mismatch')
    edges = snapshot['memberships']
    if type(edges) is not list or len(edges) != 3:
        raise ValueError('membership count')
    actual = []
    for edge in edges:
        _keys(edge, ('role_oid', 'member_oid', 'grantor_oid', 'admin', 'inherit', 'set'))
        actual.append(tuple(_oid(edge[k]) for k in ('role_oid', 'member_oid', 'grantor_oid')))
        if edge['admin'] is not True or edge['inherit'] is not False or edge['set'] is not False:
            raise ValueError('membership options')
    expected = {(baseline['roles'][n]['oid'], baseline['owner_oid'],
                 baseline['roles'][n]['grantor_oid']) for n in ROLES}
    if len(set(actual)) != 3 or set(actual) != expected:
        raise ValueError('membership identity mismatch')


def fixed_sql_plan(baseline, snapshot, target_login):
    """Return literals for review only; this function never executes a statement.

    This stateless planner enforces no attempt history and cannot authorize replay.
    Event history and durable one-attempt enforcement belong to a future adapter."""
    if type(target_login) is not bool:
        raise ValueError('target must be boolean')
    validate_snapshot(baseline, snapshot, not target_login)
    if target_login:
        return ('BEGIN;', 'ALTER ROLE meridian_test_reservation LOGIN;',
                'ALTER ROLE meridian_test_sender LOGIN;', 'ALTER ROLE meridian_test_reader LOGIN;', 'COMMIT;')
    return ('BEGIN;', 'ALTER ROLE meridian_test_reservation NOLOGIN;',
            'ALTER ROLE meridian_test_sender NOLOGIN;', 'ALTER ROLE meridian_test_reader NOLOGIN;', 'COMMIT;')


def evaluate_cycle(baseline, events):
    """Replay one bounded transcript; invalid events raise, uncertainty stops dispatch.

    Reconciliation is a new observation, never permission to retry activation.
    Unknown dispatch consumes the attempt but permits closure planning. Closure
    commit uncertainty also requires reconciliation; no blind SQL replay is emitted.
    """
    validate_baseline(baseline)
    if type(events) is not list or len(events) > MAX_EVENTS:
        raise ValueError('event bound')
    phase, consumed, uncertain = 'INITIAL', False, False
    ever_uncertain = False
    dispatch_outcome = None
    for event in events:
        if type(event) is not dict or type(event.get('type')) is not str:
            raise ValueError('event shape')
        kind = event['type']
        fields = {'precheck': ('snapshot',), 'activation_verified': ('snapshot',),
                  'closure_started': ('snapshot',), 'closure_verified': ('snapshot',),
                  'reconciled': ('snapshot', 'login', 'cleanup_confirmed'),
                  'activation_cleanup': ('clean',), 'closure_cleanup': ('clean',),
                  'dispatch_finished': ('outcome',), 'sessions_observed': ('clear',)}.get(kind, ())
        _keys(event, ('type',) + fields)
        if kind == 'precheck' and phase == 'INITIAL':
            validate_snapshot(baseline, event['snapshot'], False)
            phase = 'PRECHECKED'
        elif kind == 'activation_started' and phase == 'PRECHECKED':
            phase = 'ACTIVATING'
        elif kind == 'activation_committed' and phase == 'ACTIVATING':
            phase = 'ACTIVATION_COMMITTED'
        elif kind == 'activation_verified' and phase == 'ACTIVATION_COMMITTED':
            validate_snapshot(baseline, event['snapshot'], True)
            phase = 'ACTIVATION_VERIFIED'
        elif kind == 'activation_cleanup' and phase == 'ACTIVATION_VERIFIED':
            if type(event['clean']) is not bool:
                raise ValueError('cleanup boolean')
            phase = 'READY' if event['clean'] else 'RECONCILE'
            uncertain = not event['clean']
        elif kind == 'dispatch_attempted' and phase == 'READY' and not consumed and not ever_uncertain:
            consumed, phase = True, 'DISPATCHING'
        elif kind == 'dispatch_finished' and phase == 'DISPATCHING':
            if type(event['outcome']) is not str or event['outcome'] not in ('success', 'failure', 'unknown'):
                raise ValueError('dispatch outcome')
            dispatch_outcome = event['outcome']
            ever_uncertain = ever_uncertain or dispatch_outcome == 'unknown'
            phase = 'CLOSURE_READY'
        elif kind == 'cancel_dispatch' and phase == 'READY':
            phase = 'CLOSURE_READY'
        elif kind == 'closure_started' and phase == 'CLOSURE_READY':
            validate_snapshot(baseline, event['snapshot'], True)
            phase = 'CLOSING'
        elif kind == 'closure_committed' and phase == 'CLOSING':
            phase = 'CLOSURE_COMMITTED'
        elif kind == 'closure_verified' and phase == 'CLOSURE_COMMITTED':
            validate_snapshot(baseline, event['snapshot'], False)
            phase = 'CLOSURE_VERIFIED'
        elif kind == 'closure_cleanup' and phase == 'CLOSURE_VERIFIED':
            if type(event['clean']) is not bool:
                raise ValueError('cleanup boolean')
            phase = 'AWAITING_SESSIONS' if event['clean'] else 'RECONCILE'
            uncertain = not event['clean']
        elif kind == 'sessions_observed' and phase == 'AWAITING_SESSIONS':
            if type(event['clear']) is not bool:
                raise ValueError('session boolean')
            phase = 'CLOSED' if event['clear'] else 'RECONCILE'
            uncertain = not event['clear']
        elif kind == 'uncertain' and phase in ('ACTIVATING', 'ACTIVATION_COMMITTED',
                'ACTIVATION_VERIFIED', 'READY', 'CLOSING', 'CLOSURE_COMMITTED', 'CLOSURE_VERIFIED'):
            phase, uncertain = 'RECONCILE', True
        elif kind == 'reconciled' and phase == 'RECONCILE':
            if event['cleanup_confirmed'] is not True:
                raise ValueError('reconciliation cleanup unconfirmed')
            validate_snapshot(baseline, event['snapshot'], event['login'])
            phase = 'CLOSURE_READY' if event['login'] else 'AWAITING_SESSIONS'
            uncertain = False
        else:
            raise ValueError('invalid transition')
        ever_uncertain = ever_uncertain or uncertain
    return {'phase': phase, 'dispatchEligible': phase == 'READY' and not consumed and not ever_uncertain,
            'closurePlanAvailable': phase == 'CLOSURE_READY', 'attemptConsumed': consumed,
            'reconciliationRequired': uncertain, 'uncertaintyObserved': ever_uncertain,
            'dispatchOutcome': dispatch_outcome,
            'activationAuthorized': False, 'evidenceAuthenticated': False}
