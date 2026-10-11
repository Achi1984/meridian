import hashlib
import importlib.util
import json
import pathlib
import subprocess
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('binder',ROOT/'scripts'/'review-evidence-binding.py')
binder=importlib.util.module_from_spec(spec);spec.loader.exec_module(binder)
A='a'*40;B='b'*40;C='c'*40
T='2026-10-11T19:00:00Z'

def fixture():
    scope={'repository':'Achi1984/meridian','requestId':'REQ001','opId':'OP001','headSha':B,'baseSha':A,'prNumber':704,
           'ci':{'runId':456,'runAttempt':1,'workflowId':123,'headSha':B}}
    claim={'schemaVersion':1,**scope,'verdict':'GREEN_LIGHT','ci':{**scope['ci'],'status':'completed','conclusion':'success'}}
    body=json.dumps(claim,separators=(',',':'))
    actor={'id':209825114,'login':'claude[bot]','type':'Bot'}
    expected={'scope':scope,'actor':actor,'version':{'commentId':789,'createdAt':T,'updatedAt':T,'bodySha256':hashlib.sha256(body.encode()).hexdigest()},'issueNumber':571,'reviewerFamily':'claude'}
    observed={'repository':'Achi1984/meridian','issueNumber':571,'eventAction':'created','comment':{'id':789,'user':dict(actor),'created_at':T,'updated_at':T,'body':body}}
    return observed,expected

def bind(o,e):return binder.bind_review(json.dumps(o),json.dumps(e))
def repin(o,e):e['version']['bodySha256']=hashlib.sha256(o['comment']['body'].encode()).hexdigest()

def adapter_input(o,e):
    scope={k:e['scope'][k] for k in ('repository','requestId','opId','headSha','baseSha')}
    manifest={'schema':1,'repository':scope['repository'],'baseSha':A,'issuedAt':1000,'expiresAt':2000,'maxInvocations':1,'ownerApprovalRef':'https://github.com/Achi1984/meridian/issues/571#issuecomment-123','packets':[{'id':'first','paths':['docs/v11/first.md','test/v11-first.test.js'],'dependencies':[],'dependencyGate':'draft','outputClass':'docs-with-trusted-test','templateDigest':'d'*64}]}
    # Reproduce existing canonical manifest order, without inventing a trusted receipt.
    ledger={'kind':'OFFLINE_CLAIMS_ONLY','manifestDigest':hashlib.sha256(json.dumps(manifest,separators=(',',':')).encode()).hexdigest(),'revision':4,'revoked':False,'dispatchAllowed':False,'mergeAllowed':False,'authenticated':False,'durable':False,
            'packets':[{'id':'first','state':'REVIEW_WAIT','baseSha':A,'headSha':B,'ciHeadSha':B,'reviewHeadSha':None,'mergeSha':None}]}
    comment=o['comment'];claims={'issueNumber':571,'commentId':789,'action':o['eventAction'],'createdAt':comment['created_at'],'updatedAt':comment['updated_at'],'bodyDigest':hashlib.sha256(comment['body'].encode()).hexdigest()}
    payload={'repository':{'full_name':scope['repository'],'fork':False},'action':o['eventAction'],'issue':{'number':571},'comment':comment}
    binding={'eventIdentity':'mailbox-comment:Achi1984/meridian:571:789','revisionDigest':hashlib.sha256(json.dumps(claims,separators=(',',':')).encode()).hexdigest()}
    work={'deliveryId':'EVT001','workId':'WORK001',**scope,'paths':manifest['packets'][0]['paths'],'owner':'CODEX','execution':'PLANNED','ci':{'headSha':B,'baseSha':A,'runId':456,'jobs':[{'name':'release-tests','conclusion':'SUCCESS','total':10,'passed':10,'failed':0}]},'responses':[],'inFlight':[]}
    return {'trigger':{'name':'issue_comment','payloadJson':json.dumps(payload)},'config':{'repository':scope['repository'],'mailboxIssue':571,'workflowIds':[123]},'expected':{**scope,'packetId':'first','mainSha':A,'now':1500,'maxAgeSeconds':60,'ci':dict(e['scope']['ci'])},
            'snapshot':{'repository':scope['repository'],'observedAt':1499,'mainSha':A,'pr':{'headSha':B,'baseSha':A,'state':'open','mergeSha':None},'work':work,'eventBinding':binding,'ciBinding':dict(e['scope']['ci'])},'manifest':manifest,'ledger':ledger,'requiredJobs':['release-tests']}

def composed(o,e):
    binding=bind(o,e)
    process=subprocess.run(['node',str(ROOT/'test'/'adapter-bridge.mjs')],input=json.dumps({'binding':binding,'adapter':adapter_input(o,e)}),text=True,capture_output=True,timeout=10)
    if process.returncode:raise AssertionError(process.stderr)
    return binding,json.loads(process.stdout)

class BindingTests(unittest.TestCase):
    def test_pinned_dependencies(self):
        for row in json.loads((ROOT/'provenance.json').read_text()):
            raw=(ROOT/row['localPath']).read_bytes()
            self.assertEqual(hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),row['blob'])
    def test_matching_structured_claim_stays_unverified(self):
        o,e=fixture();r=bind(o,e);self.assertEqual(r['decision'],'CANDIDATE_REVIEW');self.assertEqual(r['plannerResponse']['verdict'],'GREEN_LIGHT')
        for field in ('authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable'):self.assertIs(r[field],False)
    def test_actual_adapter_positive_composition(self):
        o,e=fixture();b,r=composed(o,e);self.assertEqual(r['decision'],'READY_FOR_OWNER_DECISION');self.assertEqual(r['ledger']['packets'][0]['state'],'COMPLETE_DRAFT');self.assertIs(r['authenticated'],False)
    def test_prose_and_markdown_are_not_structured_claims(self):
        for body in ('GREEN_LIGHT approved','```json\n{}\n```'):
            o,e=fixture();o['comment']['body']=body;repin(o,e);b,r=composed(o,e);self.assertEqual(b['reason'],'STRUCTURED_CLAUDE_CLAIM_MISSING');self.assertNotEqual(r['decision'],'READY_FOR_OWNER_DECISION')
    def test_changed_body_or_timestamp_invalidates(self):
        for field,value in [('body','GREEN_LIGHT'),('updated_at','2026-10-11T19:00:01Z')]:
            o,e=fixture();o['comment'][field]=value;b,r=composed(o,e);self.assertEqual(b['reason'],'COMMENT_VERSION_CHANGED');self.assertIsNone(b['plannerResponse']);self.assertNotEqual(r['decision'],'READY_FOR_OWNER_DECISION')
    def test_deleted_comment_invalidates_despite_old_green_body(self):
        o,e=fixture();o['eventAction']='deleted';b,r=composed(o,e);self.assertEqual(b['reason'],'REVIEW_DELETED');self.assertEqual(r['reason'],'REVIEW_EVENT_DELETED')
    def test_actor_exact_id_login_type_no_boolean_identity(self):
        for field,value in [('id',54321),('login','other-reviewer'),('type','User'),('id',True)]:
            o,e=fixture();o['comment']['user'][field]=value;self.assertEqual(bind(o,e)['reason'],'ACTOR_MISMATCH')
    def test_copilot_and_family_substitution_blocked(self):
        o,e=fixture();e['reviewerFamily']='copilot';self.assertEqual(bind(o,e)['reason'],'CLAUDE_REVIEW_REQUIRED')
        o,e=fixture();e['actor']['login']='copilot-pull-request-reviewer[bot]';o['comment']['user']=dict(e['actor']);self.assertEqual(bind(o,e)['reason'],'COPILOT_SUBSTITUTION_REJECTED')
    def test_expected_actor_cannot_authorize_owner_or_other_bot(self):
        for actor in ({'id':319562141,'login':'Achi1984','type':'User'},{'id':12345,'login':'other-bot','type':'Bot'}):
            o,e=fixture();e['actor']=actor;o['comment']['user']=dict(actor);self.assertEqual(bind(o,e)['reason'],'CLAUDE_ACTOR_PIN_REQUIRED')
    def test_request_head_base_pr_and_ci_identity_cannot_drift(self):
        edits=[('requestId','REQ002'),('headSha',C),('baseSha',C),('prNumber',705)]
        for field,value in edits:
            o,e=fixture();claim=json.loads(o['comment']['body']);claim[field]=value;o['comment']['body']=json.dumps(claim);repin(o,e);self.assertEqual(bind(o,e)['reason'],'CLAIM_REJECTED')
        for field,value in [('runId',457),('runAttempt',2),('workflowId',124),('headSha',C)]:
            o,e=fixture();claim=json.loads(o['comment']['body']);claim['ci'][field]=value;o['comment']['body']=json.dumps(claim);repin(o,e);self.assertEqual(bind(o,e)['reason'],'CLAIM_REJECTED')
    def test_strict_transport_duplicate_keys(self):
        o,e=fixture();o['comment']['body']=o['comment']['body'].replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1');repin(o,e);self.assertEqual(bind(o,e)['reason'],'DUPLICATE_KEY')
        raw=json.dumps(e).replace('"reviewerFamily": "claude"','"reviewerFamily": "claude", "reviewerFamily": "claude"');self.assertEqual(binder.bind_review(json.dumps(o),raw)['reason'],'DUPLICATE_KEY')
    def test_non_green_keeps_adverse_evidence_for_actual_adapter(self):
        o,e=fixture();claim=json.loads(o['comment']['body']);claim['verdict']='REVISION_REQUIRED';o['comment']['body']=json.dumps(claim);repin(o,e);b,r=composed(o,e);self.assertEqual(b['reason'],'NON_GREEN_REVIEW');self.assertEqual(r['reason'],'STRICTEST_VERDICT');self.assertEqual(r['decision'],'BLOCKED')
    def test_malformed_or_oversized_data_no_raw_content_leak(self):
        o,e=fixture();o['comment']['body']='sensitive-marker'*2000;r=bind(o,e);self.assertEqual(r['decision'],'BLOCKED');self.assertNotIn('sensitive-marker',json.dumps(r))
        self.assertEqual(binder.bind_review('not-json',json.dumps(e))['decision'],'BLOCKED')
    def test_mailbox_repository_and_comment_id_bound(self):
        for edit in (lambda o:o.update(repository='other/repo'),lambda o:o.update(issueNumber=572),lambda o:o['comment'].update(id=790)):
            o,e=fixture();edit(o);self.assertEqual(bind(o,e)['decision'],'BLOCKED')
    def test_caller_cannot_reconfigure_canonical_mailbox(self):
        for mailbox in (572,1,True,'571',571.0):
            with self.subTest(mailbox=mailbox):
                o,e=fixture();o['issueNumber']=e['issueNumber']=mailbox
                result=bind(o,e)
                self.assertEqual(result['decision'],'BLOCKED')
                if type(mailbox) is int:self.assertEqual(result['reason'],'MAILBOX_PIN_REQUIRED')
                self.assertIsNone(result['plannerResponse'])
                for flag in ('authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable'):
                    self.assertIs(result[flag],False)
        o,e=fixture();self.assertEqual(bind(o,e)['decision'],'CANDIDATE_REVIEW')

if __name__=='__main__':unittest.main(verbosity=2)
