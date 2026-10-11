import contextlib
import datetime
import importlib.util
import pathlib
import sys
import time
import unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('budget_launcher',ROOT/'recovery_launcher.py')
l=importlib.util.module_from_spec(spec);spec.loader.exec_module(l)

class BudgetTests(unittest.TestCase):
    def test_elapsed_premint_reserve_and_native_job_budget(self):
        with patch.object(l.time,'monotonic',return_value=100),patch.object(l.time,'time',return_value=1791736000):
            b=l.ExecutionBudget();b.bind_job('2026-10-11T16:20:00Z')
            b.check(mint=True)
        with patch.object(l.time,'monotonic',return_value=461),patch.object(l.time,'time',return_value=1791736361):
            with self.assertRaises(ValueError):b.check(mint=True)
        with patch.object(l.time,'monotonic',return_value=100),patch.object(l.time,'time',return_value=1791737000):
            with self.assertRaises(ValueError):b.bind_job('2026-10-11T16:20:00Z')

    def broker_fixture(self,budget,slow_cleanup=False):
        broker=l.load('publisher_broker.py');calls=[]
        owner={'id':319562141,'login':'Achi1984','type':'User'}
        perms={'pull_requests':'write','metadata':'read'}
        repo={'id':1342084551,'full_name':'Achi1984/meridian','fork':False,'owner':owner}
        installation={'id':170212503,'app_id':5272026,'app_slug':'meridian-draft-publisher',
            'repository_selection':'selected','suspended_at':None,'target_id':319562141,
            'target_type':'User','account':owner,'permissions':perms}
        def http(method,url,credential,payload):
            calls.append((method,url))
            if method=='DELETE':
                if slow_cleanup:time.sleep(.15)
                return 204,None
            if method=='POST':return 201,{'token':'ghs_synthetic','repository_selection':'selected',
                'permissions':perms,'repositories':[repo],
                'expires_at':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=30)).strftime('%Y-%m-%dT%H:%M:%SZ')}
            if url.endswith('/app'):return 200,{'id':5272026,'slug':'meridian-draft-publisher','owner':owner,'permissions':perms}
            if '/installation/repositories?' in url:return 200,{'total_count':1,'repositories':[repo]}
            return 200,installation
        broker.github_http=http;broker.rsa_signer=lambda key:lambda message:b'x'*256
        return broker,l.BrokerFactory(broker,b'synthetic',lambda:None,budget),calls

    def test_actual_alarm_unwinds_real_broker_and_allows_cleanup(self):
        b=l.ExecutionBudget();b.WORK_SECONDS=.07;b.MINT_RESERVE_SECONDS=.001;b.CLEANUP_SECONDS=.1
        b.job_end=time.time()+1200
        broker,factory,calls=self.broker_fixture(b)
        b.install()
        try:
            with self.assertRaises(broker.BrokerError):
                with factory():time.sleep(.3)
            self.assertTrue(factory.receipt()['revocation_confirmed'])
            self.assertEqual([m for m,u in calls].count('POST'),1)
            self.assertEqual([m for m,u in calls].count('DELETE'),1)
        finally:b.close()

    def test_cleanup_timeout_cannot_confirm_revocation(self):
        b=l.ExecutionBudget();b.WORK_SECONDS=1;b.MINT_RESERVE_SECONDS=.001;b.CLEANUP_SECONDS=.04
        b.job_end=time.time()+1200
        broker,factory,calls=self.broker_fixture(b,slow_cleanup=True)
        b.install()
        try:
            with self.assertRaises(broker.BrokerError):
                with factory():pass
            with self.assertRaises(ValueError):factory.receipt()
            self.assertEqual([m for m,u in calls].count('DELETE'),1)
        finally:b.close()

    def test_pending_work_alarm_at_exact_broker_finally_boundary(self):
        for invalid_mint in (False, True):
            with self.subTest(pre_yield_failure=invalid_mint):
                b=l.ExecutionBudget();b.job_end=time.time()+1200
                broker,factory,calls=self.broker_fixture(b)
                original_http=broker.github_http
                if invalid_mint:
                    def bad_mint(*args):
                        status,result=original_http(*args)
                        if args[0]=='POST':result['permissions']={'contents':'write'}
                        return status,result
                    broker.github_http=bad_mint
                target=next(i for i,line in enumerate((ROOT/'publisher_broker.py').read_text().splitlines(),1)
                            if line.strip()=='if token is not None:')
                hit=[]
                def trace(frame,event,arg):
                    if event=='line' and frame.f_code.co_name=='publisher_token' and frame.f_lineno==target:
                        hit.append(True)
                        self.assertIsNotNone(b.cleanup_deadline)
                        # Simulate a pending work signal delivered after switching phases,
                        # exactly before broker's unprotected first finally statement.
                        b.expired(None,None)
                    return trace
                b.install();sys.settrace(trace)
                try:
                    if invalid_mint:
                        with self.assertRaises(broker.BrokerError):
                            with factory():self.fail('invalid scope yielded')
                    else:
                        with factory():pass
                        self.assertTrue(factory.receipt()['revocation_confirmed'])
                    self.assertEqual(hit,[True]);self.assertEqual([m for m,u in calls].count('DELETE'),1)
                finally:sys.settrace(None);b.close()

    def test_work_alarm_interrupting_preyield_cleanup_hook_still_revokes(self):
        b=l.ExecutionBudget();b.job_end=time.time()+1200
        broker,factory,calls=self.broker_fixture(b)
        original_http=broker.github_http
        def bad_mint(*args):
            status,result=original_http(*args)
            if args[0]=='POST':result['permissions']={'contents':'write'}
            return status,result
        broker.github_http=bad_mint
        target=next(i for i,line in enumerate((ROOT/'publisher_broker.py').read_text().splitlines(),1)
                    if line.strip()=="observe('cleanup_started')")
        hits=[]
        def trace(frame,event,arg):
            if event=='line' and frame.f_code.co_name=='publisher_token' and frame.f_lineno==target:
                hits.append(True);b.alarm_deadline=time.monotonic()-1
                b.expired(None,None)
            return trace
        b.install();sys.settrace(trace)
        try:
            with self.assertRaises(broker.BrokerError):
                with factory():self.fail('invalid scope yielded')
            self.assertEqual(hits,[True]);self.assertEqual([m for m,u in calls].count('DELETE'),1)
        finally:sys.settrace(None);b.close()

    def test_cleanup_transition_is_idempotent_and_stale_signal_preserves_deadline(self):
        b=l.ExecutionBudget()
        with patch.object(l.time,'monotonic',return_value=100),patch.object(l.signal,'setitimer') as alarm:
            b.begin_cleanup();deadline=b.cleanup_deadline
            b.begin_cleanup();b.expired(None,None)
            self.assertEqual(b.cleanup_deadline,deadline)
            self.assertEqual([x.args[1] for x in alarm.call_args_list],[60,60])
        with patch.object(l.time,'monotonic',return_value=161):
            with self.assertRaises(TimeoutError):b.expired(None,None)

    def test_operation_alarm_is_replaced_not_rearmed_for_cleanup(self):
        b=l.ExecutionBudget()
        with patch.object(l.signal,'setitimer') as alarm:
            with b.cleanup():pass
            values=[x.args[1] for x in alarm.call_args_list]
            self.assertEqual(len(values),2);self.assertTrue(59 < values[0] <= 60);self.assertEqual(values[1],0)

if __name__=='__main__':unittest.main()
