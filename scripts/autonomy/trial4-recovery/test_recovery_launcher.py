import base64
import copy
import importlib.util
import json
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch
ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('launcher', ROOT/'recovery_launcher.py')
l = importlib.util.module_from_spec(spec); spec.loader.exec_module(l)
c = l.load('recovery_core.py'); h = l.load('recovery_http.py')

class LauncherTests(unittest.TestCase):
    def fixture(self, event_path, base=c.BASE):
        env = dict(APPROVED_RECOVERY_BASE=base, GITHUB_SHA=base, GITHUB_WORKFLOW_SHA=base,
            GITHUB_ACTIONS='true', GITHUB_REPOSITORY=c.REPO, GITHUB_REF='refs/heads/main',
            GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_RUN_ATTEMPT='1', GITHUB_TRIGGERING_ACTOR='Achi1984',
            GITHUB_WORKFLOW_REF=c.REPO+'/'+l.WORKFLOW+'@refs/heads/main', GITHUB_RUN_ID='999',
            GITHUB_EVENT_PATH=str(event_path), RECOVERY_SOURCE_COMMIT='a'*40)
        repo = {'id':1342084551,'full_name':c.REPO,'fork':False,'owner':{'id':319562141,'login':'Achi1984'}}
        owner = {'id':319562141,'login':'Achi1984','type':'User'}
        data = {'actions/runs/999':dict(id=999,head_sha=base,head_branch='main',event='workflow_dispatch',
            run_attempt=1,status='in_progress',conclusion=None,path=l.WORKFLOW,workflow_id=777,repository=repo,head_repository=repo,
            actor=owner,triggering_actor=owner),
            'actions/workflows/trial4-artifact-recovery.yml':{'id':777,'path':l.WORKFLOW},
            'git/ref/heads/main':{'object':{'sha':base}},
            'contents/'+l.WORKFLOW+'?ref='+base:{'encoding':'base64','type':'file',
                'content':base64.b64encode(l.render_workflow('a'*40).encode()).decode()},
            'actions/runs/999/approvals':[{'state':'approved','user':owner,
                'environments':[{'id':24007408163,'name':'meridian-draft-publisher','can_admins_bypass':False}]}]}
        event_path.write_text(json.dumps({'inputs':{'approved_base':base}}))
        return env,data

    def test_authenticated_execution_and_adversarial_changes(self):
        with tempfile.TemporaryDirectory() as td:
            event = pathlib.Path(td)/'event.json'; env,data = self.fixture(event)
            self.assertTrue(l.authenticated_context(data.__getitem__,c,env)['environment_approved'])
            for field,value in [('head_sha','b'*40),('run_attempt',2),('workflow_id',778),('event','push'),('status','completed'),('conclusion','success')]:
                bad=copy.deepcopy(data);bad['actions/runs/999'][field]=value
                with self.assertRaises(ValueError):l.authenticated_context(bad.__getitem__,c,env)
            for key,value in [('APPROVED_RECOVERY_BASE','b'*40),('GITHUB_WORKFLOW_SHA','b'*40)]:
                with self.assertRaises(ValueError):l.authenticated_context(data.__getitem__,c,{**env,key:value})
            bad=copy.deepcopy(data);bad['contents/'+l.WORKFLOW+'?ref='+c.BASE]['content']=base64.b64encode(b'changed').decode()
            with self.assertRaises(ValueError):l.authenticated_context(bad.__getitem__,c,env)

    def test_new_recovery_base_and_malformed_input(self):
        with tempfile.TemporaryDirectory() as td:
            event=pathlib.Path(td)/'event.json'; env,data=self.fixture(event, 'd'*40)
            self.assertEqual(l.authenticated_context(data.__getitem__,c,env)['sha'], 'd'*40)
            calls=[]
            with self.assertRaises(ValueError):
                l.authenticated_context(lambda path:calls.append(path),c,{**env,'APPROVED_RECOVERY_BASE':'$(bad)'})
            self.assertEqual(calls,[])

    def test_approval_and_event_ambiguity_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            event=pathlib.Path(td)/'event.json';env,data=self.fixture(event)
            route='actions/runs/999/approvals'
            for value in ([],data[route]*2,[{**data[route][0],'state':'rejected'}]):
                with self.assertRaises(ValueError):l.authenticated_context({**data,route:value}.__getitem__,c,env)
            bad=copy.deepcopy(data);bad[route][0]['environments'][0]['can_admins_bypass']=True
            with self.assertRaises(ValueError):l.authenticated_context(bad.__getitem__,c,env)
            event.write_text('{"inputs":{},"inputs":{"approved_base":"'+c.BASE+'"}}')
            with self.assertRaises(ValueError):l.authenticated_context(data.__getitem__,c,env)

    def test_original_receipt_is_unique_and_preserves_historical_stop(self):
        record={'schema_version':1,'stage':'initial','outcome':'stopped','completed_at':1791729107}
        def raw(r):return ('2026-10-11T14:31:47Z MERIDIAN_PUBLISHER_RECEIPT '+json.dumps(r)).encode()
        l.validate_failure_receipt(raw(record),h.strict_json)
        for value in (b'',raw(record)+b'\n'+raw(record),raw({**record,'stage':'validated'}),
                      raw({**record,'post_attempted':True}),raw({**record,'completed_at':1})):
            with self.assertRaises(ValueError):l.validate_failure_receipt(value,h.strict_json)

    def test_deadline_blocks_mint_but_never_revoke(self):
        calls=[]
        broker=types.SimpleNamespace(github_http=lambda *args:(calls.append(args) or (204,{})))
        factory=l.BrokerFactory(broker,b'synthetic',c.window)
        with patch.object(c.time,'time',return_value=c.DEADLINE-1):
            factory.bounded_http('GET','https://api.github.com/app','jwt',None)
        with patch.object(c.time,'time',return_value=c.DEADLINE):
            with self.assertRaises(ValueError):factory.bounded_http('POST','https://api.github.com/app/installations/170212503/access_tokens','jwt',{})
            factory.bounded_http('DELETE','https://api.github.com/installation/token','ghs_synthetic',None)
        self.assertEqual([a[0] for a in calls],['GET','DELETE'])

    def test_broker_receipt_requires_confirmed_cleanup(self):
        factory=l.BrokerFactory(None,b'synthetic',lambda:None)
        events=[('app_verified',{'app_id':5272026}),('installation_verified',{'installation_id':170212503}),
            ('mint_attempted',{'mint_requested_at':1791736000}),('mint_response_received',{}),
            ('scope_verified',{'repository_id':1342084551,'expires_at':1791738000}),('revocation_attempted',{})]
        for event,fields in events:factory.observe(event,**fields)
        with self.assertRaises(ValueError):factory.receipt()
        factory.observe('revocation_confirmed')
        self.assertTrue(factory.receipt()['revocation_confirmed'])
        with self.assertRaises(ValueError):factory.observe('revocation_confirmed')

if __name__=='__main__':unittest.main()
