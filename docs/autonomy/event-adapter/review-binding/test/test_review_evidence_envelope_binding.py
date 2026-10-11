import copy
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
def load(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
fixtures=load('legacy_fixtures',ROOT/'test'/'test_review_binding.py')
binder=load('envelope_binder',ROOT/'scripts'/'review-evidence-envelope-binding.py')
contract=binder._contract
POLICY={'requiredChecks':[{'id':'release-tests','commandSha256':'d'*64}]}

def fixture(verdict='GREEN_LIGHT'):
    observation,expected=fixtures.fixture()
    claim=json.loads(observation['comment']['body']);claim['verdict']=verdict
    scope=expected['scope']
    assessment={'findings':[],'checks':[{'id':'release-tests','commandSha256':'d'*64,
        'executed':True,'status':'passed','exitCode':0,'evidenceSha256':'e'*64,
        'headSha':scope['headSha'],'baseSha':scope['baseSha'],'requestId':scope['requestId'],'ci':dict(scope['ci'])}]}
    if verdict != 'GREEN_LIGHT':
        assessment['findings']=[{'severity':'blocking','text':'Revision needed for supplied test fixture.'}]
    body=contract.produce_envelope(json.dumps(claim),json.dumps(assessment),json.dumps(scope),json.dumps(POLICY))
    observation['comment']['body']=body
    # Initial independent fixture pins; never rewritten after an observed edit.
    expected['version']['bodySha256']=hashlib.sha256(body.encode()).hexdigest()
    return observation,expected

def bind(o,e,policy=POLICY):
    return binder.bind_envelope(json.dumps(o),json.dumps(e),json.dumps(policy))

def compose(o,e):
    binding=bind(o,e)
    result=subprocess.run(['node',str(ROOT/'test'/'adapter-bridge.mjs')],input=json.dumps({'binding':binding,'adapter':fixtures.adapter_input(o,e)}),text=True,capture_output=True,timeout=10,check=True)
    return binding,json.loads(result.stdout)

class EnvelopeBindingTests(unittest.TestCase):
    def test_actual_producer_binder_adapter_ready(self):
        o,e=fixture();b,r=compose(o,e)
        self.assertEqual(b['decision'],'CANDIDATE_REVIEW')
        self.assertEqual(r['decision'],'READY_FOR_OWNER_DECISION')
        self.assertEqual(r['ledger']['packets'][0]['state'],'COMPLETE_DRAFT')
        for key in ('authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable'):
            self.assertIs(b[key],False)
        self.assertNotIn('assessment',json.dumps(b));self.assertNotIn('commandSha256',json.dumps(b))
    def test_adverse_verdict_preserved_in_actual_adapter(self):
        o,e=fixture('REVISION_REQUIRED');b,r=compose(o,e)
        self.assertEqual(b['plannerResponse']['verdict'],'REVISION_REQUIRED')
        self.assertEqual(r['decision'],'BLOCKED');self.assertEqual(r['reason'],'STRICTEST_VERDICT')
    def test_original_version_edit_cannot_repin_inner_claim(self):
        o,e=fixture();o['comment']['body']=o['comment']['body'].replace('release-tests','other-check')
        b=bind(o,e);self.assertEqual(b['reason'],'COMMENT_VERSION_CHANGED');self.assertIsNone(b['plannerResponse'])
        o,e=fixture();o['comment']['updated_at']='2026-10-11T19:00:01Z'
        self.assertEqual(bind(o,e)['reason'],'COMMENT_VERSION_CHANGED')
    def test_legacy_v1_cannot_satisfy_full_evidence(self):
        o,e=fixtures.fixture();b,r=compose(o,e)
        self.assertIsNone(b['plannerResponse']);self.assertNotEqual(r['decision'],'READY_FOR_OWNER_DECISION')
    def test_independent_policy_scope_mismatch(self):
        o,e=fixture()
        self.assertIsNone(bind(o,e,{'requiredChecks':[{'id':'release-tests','commandSha256':'f'*64}]})['plannerResponse'])
        for field,value in [('headSha','c'*40),('requestId','REQ002'),('baseSha','c'*40)]:
            altered=copy.deepcopy(e);altered['scope'][field]=value
            self.assertIsNone(bind(o,altered)['plannerResponse'])
    def test_actor_deleted_and_mailbox_guards(self):
        o,e=fixture();o['comment']['user']['id']=1;self.assertEqual(bind(o,e)['reason'],'ACTOR_MISMATCH')
        o,e=fixture();o['eventAction']='deleted';self.assertEqual(bind(o,e)['reason'],'REVIEW_DELETED')
        o,e=fixture();o['issueNumber']=e['issueNumber']=572;self.assertEqual(bind(o,e)['reason'],'MAILBOX_PIN_REQUIRED')
    def test_version_pinned_invalid_evidence_still_blocked(self):
        # Pin independently supplied invalid candidate at initial observation;
        # integrity alone must never turn missing/false evidence into a review.
        for edit in (lambda v:v['assessment']['checks'].clear(),
                     lambda v:v['assessment']['checks'][0].update(executed=False,status='not_executed',exitCode=None,evidenceSha256=None),
                     lambda v:v['assessment']['findings'].append({'severity':'blocking','text':'private-sensitive-marker'})):
            o,e=fixture();v=json.loads(o['comment']['body']);edit(v)
            evidence={k:value for k,value in v.items() if k!='evidenceSha256'}
            v['evidenceSha256']=hashlib.sha256(json.dumps(evidence,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
            o['comment']['body']=json.dumps(v,separators=(',',':'))
            e['version']['bodySha256']=hashlib.sha256(o['comment']['body'].encode()).hexdigest()
            b=bind(o,e);self.assertIsNone(b['plannerResponse']);self.assertNotIn('private-sensitive-marker',json.dumps(b))
    def test_malformed_input_bounded_errors(self):
        o,e=fixture();self.assertIsNone(binder.bind_envelope('not-json',json.dumps(e),json.dumps(POLICY))['plannerResponse'])

if __name__=='__main__':unittest.main()
