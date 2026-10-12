import hashlib
import importlib.util
import json
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
producer=module('producer',ROOT/'scripts'/'structured-response-producer.py')
bridge=module('binding_tests',ROOT/'test'/'test_review_binding.py')

def serialize(verdict='GREEN_LIGHT',findings=None):
    o,e=bridge.fixture()
    r=producer.produce_response(json.dumps(e['scope']),verdict,[] if findings is None else findings,json.dumps({'status':'completed','conclusion':'success'}))
    o['comment']['body']=r['body'];e['version']['bodySha256']=r['bodySha256']
    return o,e,r

class ProducerTests(unittest.TestCase):
    def test_deterministic_full_json_and_no_authority(self):
        o,e,r=serialize();o2,e2,r2=serialize();self.assertEqual(r,r2)
        scope=dict(reversed(list(e['scope'].items())))
        reordered=producer.produce_response(json.dumps(scope),'GREEN_LIGHT',[],json.dumps({'conclusion':'success','status':'completed'}));self.assertEqual(r,reordered)
        self.assertEqual(hashlib.sha256(r['body'].encode()).hexdigest(),r['bodySha256'])
        for flag in ('authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable'):self.assertIs(r[flag],False)
    def test_actual_producer_binder_adapter_positive(self):
        o,e,p=serialize();b,r=bridge.composed(o,e);self.assertEqual(b['decision'],'CANDIDATE_REVIEW');self.assertEqual(r['decision'],'READY_FOR_OWNER_DECISION');self.assertIs(r['mergeAllowed'],False)
    def test_adverse_roundtrip_never_upgrades_verdict(self):
        for verdict in ('NEEDS_MORE_EVIDENCE','REVISION_REQUIRED','CHANGES_REQUIRED','STALE_HEAD'):
            o,e,p=serialize(verdict,[{'severity':'blocking','text':'Exact head requires correction.'}]);b,r=bridge.composed(o,e);self.assertEqual(json.loads(p['body'])['verdict'],verdict);self.assertEqual(b['plannerResponse']['verdict'],verdict);self.assertEqual(r['decision'],'BLOCKED')
    def test_no_default_prose_verdict_or_contradictory_green(self):
        o,e=bridge.fixture();scope=json.dumps(e['scope']);state='{"status":"completed","conclusion":"success"}'
        for verdict in (None,'','looks GREEN_LIGHT','APPROVED'):
            with self.assertRaisesRegex(ValueError,'EXPLICIT_VERDICT_REQUIRED'):producer.produce_response(scope,verdict,[],state)
        with self.assertRaisesRegex(ValueError,'GREEN_BLOCKING_FINDINGS'):producer.produce_response(scope,'GREEN_LIGHT',[{'severity':'blocking','text':'A blocker exists.'}],state)
        with self.assertRaisesRegex(ValueError,'NON_GREEN_REASON_REQUIRED'):producer.produce_response(scope,'REVISION_REQUIRED',[],state)
    def test_findings_preserved_separately_without_schema_widening(self):
        findings=[{'severity':'advisory','text':'Keep this finding in the review evidence.'}];o,e,r=serialize('GREEN_LIGHT',findings)
        self.assertEqual(r['assessment']['findings'],findings);self.assertNotIn('findings',json.loads(r['body']))
        findings[0]['text']='mutated';self.assertNotEqual(r['assessment']['findings'],findings)
    def test_sidecar_binds_scope_body_but_claim_does_not_bind_sidecar(self):
        o,e,first=serialize('GREEN_LIGHT',[{'severity':'advisory','text':'First advisory.'}])
        _,_,second=serialize('GREEN_LIGHT',[{'severity':'advisory','text':'Different advisory.'}])
        self.assertEqual(first['body'],second['body'])
        self.assertNotEqual(first['assessmentSha256'],second['assessmentSha256'])
        self.assertEqual(first['assessment']['bodySha256'],first['bodySha256'])
        self.assertEqual(first['assessment']['scope'],e['scope'])
        self.assertNotIn('assessmentSha256',json.loads(first['body']))
    def test_scope_and_ci_drift_rejected_by_binder(self):
        for field,value in [('requestId','REQ002'),('headSha','c'*40),('baseSha','c'*40),('prNumber',705)]:
            o,e,r=serialize();claim=json.loads(r['body']);claim[field]=value;o['comment']['body']=json.dumps(claim);bridge.repin(o,e);self.assertEqual(bridge.bind(o,e)['decision'],'BLOCKED')
        o,e,r=serialize();claim=json.loads(r['body']);claim['ci']['runAttempt']=2;o['comment']['body']=json.dumps(claim);bridge.repin(o,e);self.assertEqual(bridge.bind(o,e)['decision'],'BLOCKED')
    def test_changed_or_deleted_serialized_body_cannot_reuse_previous_version(self):
        o,e,r=serialize();o['comment']['body']+=' ';b,a=bridge.composed(o,e);self.assertEqual(b['reason'],'COMMENT_VERSION_CHANGED');self.assertNotEqual(a['decision'],'READY_FOR_OWNER_DECISION')
        o,e,r=serialize();o['eventAction']='deleted';b,a=bridge.composed(o,e);self.assertEqual(b['reason'],'REVIEW_DELETED');self.assertEqual(a['decision'],'BLOCKED')
    def test_duplicate_pins_failed_ci_unknown_fields_and_bounds(self):
        o,e=bridge.fixture();scope=json.dumps(e['scope']);state='{"status":"completed","conclusion":"success"}'
        with self.assertRaises(ValueError):producer.produce_response(scope.replace('"prNumber": 704','"prNumber": 704, "prNumber": 704'),'GREEN_LIGHT',[],state)
        with self.assertRaises(ValueError):producer.produce_response(scope,'GREEN_LIGHT',[],'{"status":"completed","conclusion":"failure"}')
        with self.assertRaises(ValueError):producer.produce_response(scope,'GREEN_LIGHT',[],'{"status":"completed","conclusion":"success","actor":"CLAUDE"}')
        for findings in ([{'severity':'advisory','text':'x'}]*33,[{'severity':'advisory','text':'x'*2049}],[{'severity':'advisory','text':'x','override':'GREEN_LIGHT'}]):
            with self.assertRaises(ValueError):producer.produce_response(scope,'GREEN_LIGHT',findings,state)

if __name__=='__main__':unittest.main(verbosity=2)
