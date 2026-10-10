import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvidence,requireAuthenticatedTransport} from '../scripts/codex-bridge-v3-evidence.mjs';
const base='a'.repeat(40),head='b'.repeat(40);
const expected=()=>({requestId:'V3-001',opId:'OP-001',headSha:head,baseSha:base,repository:'Achi1984/meridian'});
const valid=()=>({...expected(),ciRunId:123,ciWorkflow:'MERIDIAN Release Safety',ciHeadSha:head,ciStatus:'completed',ciConclusion:'success',reviewCommentId:456,reviewAuthor:'CLAUDE',reviewHead:head,reviewVerdict:'GREEN_LIGHT'});
const check=(e=valid(),p=expected(),s=new Set())=>validateEvidence(e,p,s);
const error=(fn,code)=>assert.throws(fn,{code});
test('offline consistency is never provenance or authorization',()=>{
  assert.deepEqual(check(),{offlineConsistent:true,provenanceVerified:false,authenticated:false,authorized:false,mergeAllowed:false,dispatchAllowed:false});
});
for(const [name,change,code] of [
  ['wrong head',{headSha:base},'SCOPE_MISMATCH'],
  ['wrong base',{baseSha:head},'SCOPE_MISMATCH'],
  ['wrong repository',{repository:'other/repo'},'SCOPE_MISMATCH'],
  ['wrong request',{requestId:'V3-002'},'SCOPE_MISMATCH'],
  ['wrong operation',{opId:'OP-002'},'SCOPE_MISMATCH'],
  ['pending CI',{ciStatus:'pending'},'CI_NOT_GREEN'],
  ['failed CI',{ciConclusion:'failure'},'CI_NOT_GREEN'],
  ['wrong CI head',{ciHeadSha:base},'CI_PROVENANCE_CLAIM_INVALID'],
  ['wrong workflow',{ciWorkflow:'Other'},'CI_PROVENANCE_CLAIM_INVALID'],
  ['missing CI id',{ciRunId:0},'CI_PROVENANCE_CLAIM_INVALID'],
  ['wrong review author',{reviewAuthor:'OTHER'},'REVIEW_PROVENANCE_CLAIM_INVALID'],
  ['missing review comment id',{reviewCommentId:0},'REVIEW_PROVENANCE_CLAIM_INVALID'],
  ['stale review',{reviewHead:base},'REVIEW_PROVENANCE_CLAIM_INVALID'],
  ['blocking review',{reviewVerdict:'REVISION_REQUIRED'},'REVIEW_NOT_GREEN'],
  ['review case mismatch',{reviewVerdict:'green_light'},'REVIEW_NOT_GREEN'],
])test(name+' fails closed',()=>error(()=>check({...valid(),...change}),code));
test('replay is rejected by caller-provided local set',()=>{
  const seen=new Set();check(valid(),expected(),seen);
  error(()=>check(valid(),expected(),seen),'REPLAY_DETECTED');
});
test('missing replay set fails closed',()=>error(()=>validateEvidence(valid(),expected()),'REPLAY_STORE_REQUIRED'));
test('missing evidence fails closed',()=>error(()=>check(null),'INVALID_OBJECT'));
test('empty request id fails closed',()=>error(()=>check({...valid(),requestId:''},{...expected(),requestId:''}),'EXPECTED_SCOPE_INVALID'));
test('wrong repository pin fails closed',()=>error(()=>check({...valid(),repository:'foo/bar'},{...expected(),repository:'foo/bar'}),'EXPECTED_SCOPE_INVALID'));
test('malformed pinned SHA fails closed',()=>error(()=>check({...valid(),headSha:'BAD',ciHeadSha:'BAD',reviewHead:'BAD'},{...expected(),headSha:'BAD'}),'INVALID_SHA'));
test('unknown evidence field fails closed',()=>error(()=>check({...valid(),authorized:true}),'UNKNOWN_FIELDS'));
test('arrays fail closed',()=>error(()=>check([]),'INVALID_OBJECT'));
test('class instances fail closed',()=>error(()=>check(new (class Evidence {})()),'INVALID_OBJECT'));
test('getters fail closed',()=>{
  const e=valid();Object.defineProperty(e,'ciStatus',{get(){return 'completed';}});
  error(()=>check(e),'ACCESSOR_REJECTED');
});
test('validation does not mutate inputs',()=>{
  const e=valid(),p=expected(),e0={...e},p0={...p};
  check(e,p);assert.deepEqual(e,e0);assert.deepEqual(p,p0);
});
test('authenticated transport remains unavailable',()=>error(()=>requireAuthenticatedTransport(),'AUTHENTICATED_TRANSPORT_UNAVAILABLE'));
