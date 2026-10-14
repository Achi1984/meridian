import importlib.util
import json
import pathlib
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('contract',ROOT/'scripts/review-evidence-contract.py');contract=importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)
A='a'*40;B='b'*40;C='c'*40

def fixture():
 expected={'repository':'Achi1984/meridian','requestId':'REQ001','opId':'OP001','headSha':B,'baseSha':A,'prNumber':703,'ci':{'runId':456,'runAttempt':1,'workflowId':123,'headSha':B}}
 claim={'schemaVersion':1,**expected,'verdict':'GREEN_LIGHT','ci':{**expected['ci'],'status':'completed','conclusion':'success'}}
 policy={'requiredChecks':[{'id':'release-safety','commandSha256':'c'*64},{'id':'exact-head','commandSha256':'d'*64}]}
 checks=[{'id':r['id'],'commandSha256':r['commandSha256'],'executed':True,'status':'passed','exitCode':0,'evidenceSha256':'e'*64,'headSha':B,'baseSha':A,'requestId':'REQ001','opId':expected['opId'],'prNumber':expected['prNumber'],'ci':dict(expected['ci'])} for r in policy['requiredChecks']]
 return claim,{'findings':[],'checks':checks},expected,policy

def produce(c,a,e,p):return contract.produce_envelope(json.dumps(c),json.dumps(a),json.dumps(e),json.dumps(p))
def validate(body,e,p):return contract.validate_envelope(body,json.dumps(e),json.dumps(p))
def rehash(value):value['evidenceSha256']=contract.digest({k:v for k,v in value.items() if k!='evidenceSha256'});return json.dumps(value)

class EvidenceTests(unittest.TestCase):
 def test_complete_explicit_evidence_roundtrip_and_false_authority(self):
  c,a,e,p=fixture();body=produce(c,a,e,p);r=validate(body,e,p);self.assertEqual(r['verdict'],'GREEN_LIGHT');self.assertEqual(r['assessment'],a)
  for flag in contract.FLAGS:self.assertIs(r[flag],False)
  self.assertEqual(body,produce(dict(reversed(list(c.items()))),a,e,{'requiredChecks':list(reversed(p['requiredChecks']))}))
 def test_tamper_any_assessment_fails_integrity_without_rehash(self):
  c,a,e,p=fixture();body=json.loads(produce(c,a,e,p));body['assessment']['checks'][0]['status']='failed'
  with self.assertRaisesRegex(ValueError,'EVIDENCE_DIGEST_MISMATCH'):validate(json.dumps(body),e,p)
 def test_recomputed_digest_cannot_bypass_independent_policy_or_scope(self):
  c,a,e,p=fixture();body=produce(c,a,e,p)
  edits=[lambda b:b['assessment']['checks'][0].update(commandSha256='f'*64),lambda b:b['assessment']['checks'][0].update(headSha=C),lambda b:b['assessment']['checks'][0].update(baseSha=C),lambda b:b['assessment']['checks'][0].update(requestId='REQ002'),lambda b:b['assessment']['checks'][0]['ci'].update(runAttempt=2),lambda b:b['claim'].update(headSha=C),lambda b:b.update(policySha256='f'*64)]
  for edit in edits:
   b=json.loads(body);edit(b)
   with self.assertRaises(ValueError):validate(rehash(b),e,p)
 def test_check_operation_pr_required_and_strict_even_after_rehash(self):
  c,a,e,p=fixture();body=produce(c,a,e,p)
  for key,value in (('opId','OP002'),('prNumber',704),('prNumber',True)):
   b=json.loads(body);b['assessment']['checks'][0][key]=value
   with self.assertRaisesRegex(ValueError,'CHECK_SCOPE_MISMATCH'):validate(rehash(b),e,p)
  for key in ('opId','prNumber'):
   b=json.loads(body);del b['assessment']['checks'][0][key]
   with self.assertRaises(ValueError):validate(rehash(b),e,p)
  c,a,e,p=fixture();c['prNumber']=e['prNumber']=1
  for row in a['checks']:row['prNumber']=1
  body=json.loads(produce(c,a,e,p));body['assessment']['checks'][0]['prNumber']=True
  with self.assertRaisesRegex(ValueError,'CHECK_SCOPE_MISMATCH'):validate(rehash(body),e,p)
 def test_rehashed_missing_failed_or_unexecuted_check_forbids_green(self):
  c,a,e,p=fixture();body=produce(c,a,e,p)
  edits=[lambda b:b['assessment']['checks'].pop(),lambda b:b['assessment']['checks'][0].update(status='failed',exitCode=1),lambda b:b['assessment']['checks'][0].update(status='not_executed',executed=False,exitCode=None,evidenceSha256=None)]
  for edit in edits:
   b=json.loads(body);edit(b)
   with self.assertRaisesRegex(ValueError,'MANDATORY_CHECK'):validate(rehash(b),e,p)
 def test_duplicates_unexpected_checks_and_blocking_findings_reject_green(self):
  for edit in [lambda a:a['checks'].append(dict(a['checks'][0])),lambda a:a['checks'][0].update(id='unexpected'),lambda a:a['findings'].append({'severity':'blocking','text':'Required evidence missing.'})]:
   c,a,e,p=fixture();edit(a)
   with self.assertRaises(ValueError):produce(c,a,e,p)
 def test_boolean_exit_code_missing_execution_and_failed_exit_cannot_pass(self):
  for edit in [lambda a:a['checks'][0].update(exitCode=True),lambda a:a['checks'][0].update(executed=False),lambda a:a['checks'][0].update(exitCode=2),lambda a:a['checks'][0].update(evidenceSha256=None)]:
   c,a,e,p=fixture();edit(a)
   with self.assertRaises(ValueError):produce(c,a,e,p)
 def test_negative_assessment_preserves_missing_execution_no_upgrade(self):
  c,a,e,p=fixture();c['verdict']='REVISION_REQUIRED';a['findings']=[{'severity':'blocking','text':'Mandatory command was not run.'}];a['checks'][0].update(status='not_executed',executed=False,exitCode=None,evidenceSha256=None)
  r=validate(produce(c,a,e,p),e,p);self.assertEqual(r['verdict'],'REVISION_REQUIRED');self.assertFalse(r['assessment']['checks'][0]['executed'])
 def test_findings_are_inside_body_integrity(self):
  c,a,e,p=fixture();first=produce(c,a,e,p);a['findings']=[{'severity':'advisory','text':'Explicit observation.'}];second=produce(c,a,e,p)
  self.assertNotEqual(first,second);self.assertNotEqual(json.loads(first)['evidenceSha256'],json.loads(second)['evidenceSha256'])
 def test_required_policy_cannot_be_replaced_from_claim(self):
  c,a,e,p=fixture();body=produce(c,a,e,p);other={'requiredChecks':[{'id':'different-check','commandSha256':'c'*64}]}
  with self.assertRaisesRegex(ValueError,'REQUIRED_POLICY_MISMATCH'):validate(body,e,other)
 def test_empty_duplicate_and_response_supplied_policy_cannot_authorize(self):
  c,a,e,p=fixture()
  for policy in ({'requiredChecks':[]},{'requiredChecks':[p['requiredChecks'][0],p['requiredChecks'][0]]},{'requiredChecks':p['requiredChecks'],'authenticated':True}):
   with self.assertRaises(ValueError):produce(c,a,e,policy)
  body=json.loads(produce(c,a,e,p));body['requiredPolicy']=p
  with self.assertRaises(ValueError):validate(rehash(body),e,p)
 def test_strict_bounds_duplicates_and_no_default_green(self):
  c,a,e,p=fixture();body=produce(c,a,e,p)
  with self.assertRaises(ValueError):validate(body.replace('"schemaVersion":2','"schemaVersion":2,"schemaVersion":2'),e,p)
  with self.assertRaises(ValueError):validate(' '*17000,e,p)
  c.pop('verdict')
  with self.assertRaises(ValueError):produce(c,a,e,p)
  c,a,e,p=fixture();a['findings']=[{'severity':'advisory','text':'x'*513}]
  with self.assertRaises(ValueError):produce(c,a,e,p)

class NegativePublicationTests(unittest.TestCase):
 def candidate(self):
  c,a,e,p=fixture();c['verdict']='REVISION_REQUIRED'
  a['findings']=[{'severity':'blocking','text':'COMPATIBILITY-ONLY SUPPLIED TEST DATA. No checks executed.'}]
  for row in a['checks']:row.update(status='not_executed',executed=False,exitCode=None,evidenceSha256=None)
  return c,a,e,p
 def prepare(self,body,e,p,digest=None):
  return contract.prepare_negative_publication(body,json.dumps(e),json.dumps(p),digest or contract.hashlib.sha256(body.encode()).hexdigest())
 def test_preserves_exact_bytes_and_false_authority(self):
  c,a,e,p=self.candidate();body=produce(c,a,e,p)
  r=self.prepare(body,e,p);self.assertEqual(r['body'],body);self.assertEqual(r['verdict'],'REVISION_REQUIRED')
  for flag in contract.FLAGS:self.assertIs(r[flag],False)
  with self.assertRaisesRegex(ValueError,'PUBLICATION_BODY_MISMATCH'):self.prepare(body+'\n',e,p,r['bodySha256'])
 def test_no_wrapper_repair_or_green(self):
  c,a,e,p=self.candidate();body=produce(c,a,e,p)
  for wrapped in ['Claude finished\n'+body,'```json\n'+body+'\n```']:
   with self.assertRaises(ValueError):self.prepare(wrapped,e,p)
  c,a,e,p=fixture()
  with self.assertRaisesRegex(ValueError,'PUBLICATION_NEGATIVE_ONLY'):self.prepare(produce(c,a,e,p),e,p)
 def test_complete_unexecuted_policy_required_even_for_negative(self):
  c,a,e,p=self.candidate();a['checks'].pop()
  with self.assertRaisesRegex(ValueError,'PUBLICATION_COMPLETE_POLICY'):self.prepare(produce(c,a,e,p),e,p)
  for status,exit_code in [('passed',0),('failed',1)]:
   c,a,e,p=self.candidate();a['checks'][0].update(status=status,executed=True,exitCode=exit_code,evidenceSha256='e'*64)
   with self.assertRaisesRegex(ValueError,'PUBLICATION_UNEXECUTED_ONLY'):self.prepare(produce(c,a,e,p),e,p)
 def test_marker_and_trigger_guards(self):
  c,a,e,p=self.candidate();a['findings'][0]['text']='Ordinary negative assessment'
  with self.assertRaisesRegex(ValueError,'PUBLICATION_TEST_MARKER'):self.prepare(produce(c,a,e,p),e,p)
  for text in [' @Claude',' cross_model_request']:
   c,a,e,p=self.candidate();a['findings'][0]['text']+=text
   with self.assertRaisesRegex(ValueError,'PUBLICATION_TRIGGER_FORBIDDEN'):self.prepare(produce(c,a,e,p),e,p)

if __name__=='__main__':unittest.main(verbosity=2)
