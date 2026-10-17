import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('role_cycle', Path(__file__).resolve().parents[1] / 'scripts/publisher_role_cycle.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def baseline():
    return {'owner_oid': 10, 'roles': {n: {'oid': 100+i, 'grantor_oid': 10} for i,n in enumerate(m.ROLES)}}


def snapshot(login=False):
    b = baseline()
    return {'roles': {n: {'oid': b['roles'][n]['oid'], 'login': login, **dict.fromkeys(m.FLAGS, False)} for n in m.ROLES},
            'memberships': [{'role_oid': b['roles'][n]['oid'], 'member_oid': 10, 'grantor_oid': 10,
                             'admin': True, 'inherit': False, 'set': False} for n in m.ROLES]}


def ready():
    return [{'type': 'precheck', 'snapshot': snapshot()}, {'type': 'activation_started'},
            {'type': 'activation_committed'}, {'type': 'activation_verified', 'snapshot': snapshot(True)},
            {'type': 'activation_cleanup', 'clean': True}]


def dispatched(outcome='success'):
    return ready() + [{'type': 'dispatch_attempted'}, {'type': 'dispatch_finished', 'outcome': outcome}]


def closure():
    return [{'type': 'closure_started', 'snapshot': snapshot(True)}, {'type': 'closure_committed'},
            {'type': 'closure_verified', 'snapshot': snapshot()}, {'type': 'closure_cleanup', 'clean': True},
            {'type': 'sessions_observed', 'clear': True}]


class RoleCycleTests(unittest.TestCase):
    def run_events(self, events):
        return m.evaluate_cycle(baseline(), events)

    def test_closed_cycle_is_observation_not_authority(self):
        result = self.run_events(dispatched() + closure())
        self.assertEqual(result['phase'], 'CLOSED')
        self.assertTrue(result['attemptConsumed'])
        self.assertFalse(result['activationAuthorized'])
        self.assertFalse(result['evidenceAuthenticated'])

    def test_no_dispatch_before_all_activation_facts(self):
        for n in range(5):
            self.assertFalse(self.run_events(ready()[:n])['dispatchEligible'])
            with self.assertRaises(ValueError): self.run_events(ready()[:n] + [{'type':'dispatch_attempted'}])
        self.assertTrue(self.run_events(ready())['dispatchEligible'])

    def test_every_dispatch_outcome_allows_closure_but_no_repeat(self):
        for outcome in ('success','failure','unknown'):
            result = self.run_events(dispatched(outcome))
            self.assertTrue(result['attemptConsumed'])
            self.assertTrue(result['closurePlanAvailable'])
            self.assertEqual(result['dispatchOutcome'], outcome)
            self.assertEqual(result['uncertaintyObserved'], outcome == 'unknown')
            with self.assertRaises(ValueError): self.run_events(dispatched(outcome)+[{'type':'dispatch_attempted'}])
            self.assertEqual(self.run_events(dispatched(outcome)+closure())['phase'],'CLOSED')

    def test_activation_ambiguity_never_replays(self):
        for n in (2,3,4,5):
            prefix = ready()[:n]+[{'type':'uncertain'}]
            self.assertTrue(self.run_events(prefix)['reconciliationRequired'])
            for kind in ('activation_started','activation_committed','dispatch_attempted','closure_started'):
                with self.assertRaises(ValueError): self.run_events(prefix+[{'type':kind}])

    def test_reconciled_enabled_roles_allow_only_closure(self):
        events = ready()[:2]+[{'type':'uncertain'}, {'type':'reconciled','snapshot':snapshot(True),'login':True,'cleanup_confirmed':True}]
        self.assertTrue(self.run_events(events)['closurePlanAvailable'])
        self.assertFalse(self.run_events(events)['dispatchEligible'])
        self.assertEqual(self.run_events(events+closure())['phase'],'CLOSED')

    def test_reconciled_disabled_roles_need_session_observation(self):
        events = ready()[:2]+[{'type':'uncertain'}, {'type':'reconciled','snapshot':snapshot(),'login':False,'cleanup_confirmed':True}]
        self.assertEqual(self.run_events(events)['phase'],'AWAITING_SESSIONS')
        self.assertEqual(self.run_events(events+[{'type':'sessions_observed','clear':True}])['phase'],'CLOSED')

    def test_cleanup_failure_and_sessions_require_reconciliation(self):
        events = ready(); events[-1]['clean']=False
        self.assertTrue(self.run_events(events)['reconciliationRequired'])
        for index, field in ((-2,'clean'),(-1,'clear')):
            events=dispatched()+closure(); events[index][field]=False
            events=events[:len(events)+index+1]
            self.assertTrue(self.run_events(events)['reconciliationRequired'])

    def test_closure_commit_ambiguity_blocks_replay(self):
        events=dispatched()+closure()[:1]+[{'type':'uncertain'}]
        self.assertTrue(self.run_events(events)['reconciliationRequired'])
        with self.assertRaises(ValueError): self.run_events(events+closure())

    def test_cancellation_closes_without_dispatch(self):
        result=self.run_events(ready()+[{'type':'cancel_dispatch'}]+closure())
        self.assertEqual(result['phase'],'CLOSED'); self.assertFalse(result['attemptConsumed'])

    def test_closed_transcript_cannot_restart(self):
        with self.assertRaises(ValueError): self.run_events(dispatched()+closure()+ready())

    def test_exact_role_identity_and_set(self):
        for alteration in ('missing','extra','oid'):
            s=snapshot()
            if alteration=='missing': del s['roles'][m.ROLES[0]]
            elif alteration=='extra': s['roles']['other']=copy.deepcopy(s['roles'][m.ROLES[0]])
            else: s['roles'][m.ROLES[0]]['oid']=999
            with self.assertRaises(ValueError): m.validate_snapshot(baseline(),s,False)

    def test_all_attributes_and_login_must_match(self):
        for flag in m.FLAGS+('login',):
            for value in (True,0,None,'false'):
                s=snapshot(); s['roles'][m.ROLES[0]][flag]=value
                with self.assertRaises(ValueError): m.validate_snapshot(baseline(),s,False)

    def test_membership_edges_options_and_duplicates(self):
        for key in ('role_oid','member_oid','grantor_oid','admin','inherit','set'):
            s=snapshot(); s['memberships'][0][key]=999 if key.endswith('oid') else not s['memberships'][0][key]
            with self.assertRaises(ValueError): m.validate_snapshot(baseline(),s,False)
        s=snapshot(); s['memberships'][1]=s['memberships'][0]
        with self.assertRaises(ValueError): m.validate_snapshot(baseline(),s,False)
        s=snapshot(); s['memberships'].append(copy.deepcopy(s['memberships'][0]))
        with self.assertRaises(ValueError): m.validate_snapshot(baseline(),s,False)

    def test_oid_types_and_bounds(self):
        for oid in (True,False,0,-1,2**32,'10',10.0):
            b=baseline(); b['owner_oid']=oid
            with self.assertRaises(ValueError): m.validate_baseline(b)
            s=snapshot(); s['memberships'][0]['member_oid']=oid
            with self.assertRaises(ValueError): m.validate_snapshot(baseline(),s,False)

    def test_baseline_duplicate_oids_and_unknown_fields(self):
        b=baseline(); b['roles'][m.ROLES[0]]['oid']=10
        with self.assertRaises(ValueError): m.validate_baseline(b)
        for obj, fn in ((baseline(),m.validate_baseline),(snapshot(),lambda x:m.validate_snapshot(baseline(),x,False))):
            obj['extra']=True
            with self.assertRaises(ValueError): fn(obj)

    def test_sql_exact_fixed_roles_and_directions(self):
        for target in (False,True):
            plan=m.fixed_sql_plan(baseline(),snapshot(not target),target)
            self.assertEqual(plan,('BEGIN;',)+tuple('ALTER ROLE '+n+(' LOGIN;' if target else ' NOLOGIN;') for n in m.ROLES)+('COMMIT;',))
            with self.assertRaises(ValueError): m.fixed_sql_plan(baseline(),snapshot(target),target)
        with self.assertRaises(ValueError): m.fixed_sql_plan(baseline(),snapshot(),1)

    def test_strict_events_and_bounds(self):
        for events in ((),[None],[{'type':'unknown'}],[{'type':'precheck','snapshot':snapshot(),'extra':1}],ready()*7):
            with self.assertRaises(ValueError): self.run_events(events)
        for value in (1,None,'true'):
            events=ready(); events[-1]['clean']=value
            with self.assertRaises(ValueError): self.run_events(events)

    def test_reconciliation_needs_exact_state_and_cleanup(self):
        prefix=ready()[:2]+[{'type':'uncertain'}]
        for clear in (False,1,None):
            with self.assertRaises(ValueError): self.run_events(prefix+[{'type':'reconciled','snapshot':snapshot(True),'login':True,'cleanup_confirmed':clear}])
        s=snapshot(True); s['roles'][m.ROLES[0]]['login']=False
        with self.assertRaises(ValueError): self.run_events(prefix+[{'type':'reconciled','snapshot':s,'login':True,'cleanup_confirmed':True}])

    def test_inputs_not_mutated_and_replay_deterministic(self):
        b=baseline(); events=dispatched()+closure(); saved=copy.deepcopy((b,events))
        self.assertEqual(m.evaluate_cycle(b,events),m.evaluate_cycle(b,events))
        self.assertEqual((b,events),saved)

if __name__=='__main__': unittest.main()
