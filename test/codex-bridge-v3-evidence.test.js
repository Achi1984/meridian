import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvidence,requireAuthenticatedTransport} from '../scripts/codex-bridge-v3-evidence.mjs';
const base='a'.repeat(40), head='b'.repeat(40);
const expected=Object.freeze({requestId:'V3-001',headSha:head,baseSha:base,repository:'Achi1984/meridian'});
const valid=()=>({...expected,ciStatus:'completed',ciConclusion:'success',reviewHead:head,reviewVerdict:'GREEN_LIGHT'});
test('offline evidence is never an authorization',()=>{
  assert.deepEqual(validateEvidence(valid(),expected),{offlineValid:true,authenticated:false,authorized:false,mergeAllowed:false,dispatchAllowed:false});
});
for(const [name,change] of [
  ['wrong head',{headSha:base}],['wrong base',{baseSha:head}],['wrong repo',{repository:'other/repo'}],
  ['wrong request',{requestId:'V3-002'}],['pending CI',{ciStatus:'pending'}],
  ['failed CI',{ciConclusion:'failure'}],['stale review',{reviewHead:base}],
  ['blocking review',{reviewVerdict:'REVISION_REQUIRED'}]
]) test(name+' fails closed',()=>assert.throws(()=>validateEvidence({...valid(),...change},expected)));
test('missing evidence fails closed',()=>assert.throws(()=>validateEvidence(null,expected)));
test('malformed pinned head fails closed',()=>assert.throws(()=>validateEvidence(valid(),{...expected,headSha:'bad'})));
test('authenticated transport remains unavailable',()=>assert.throws(()=>requireAuthenticatedTransport(),{code:'AUTHENTICATED_TRANSPORT_UNAVAILABLE'}));
