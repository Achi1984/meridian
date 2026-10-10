import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest,initialLedger,advance,ContractError} from '../scripts/continuation-contract.mjs';

const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40), D='d'.repeat(40);
const fixture=()=>({schema:1,repository:'Achi1984/meridian',baseSha:A,issuedAt:1000,expiresAt:2000,
  maxInvocations:2,ownerApprovalRef:'https://github.com/Achi1984/meridian/issues/571#issuecomment-123',
  packets:['first','second'].map((id,i)=>({id,paths:[`docs/v11/${id}.md`,`test/v11-${id}.test.js`],
    dependencies:i?['first']:[],dependencyGate:'draft',outputClass:'docs-with-trusted-test',templateDigest:'d'.repeat(64)}))});
const run=(m,l,type,packetId='first',sha=null,now=1500)=>advance(m,l,{type,packetId,sha,expectedRevision:l.revision},now);
function completed(m){let l=initialLedger(m);for(const [type,sha] of [['CLAIM',A],['MODEL_STARTED',null],['DRAFT_OBSERVED',B],['CI_PASSED',B],['REVIEW_PASSED',B]])l=run(m,l,type,'first',sha);return l;}
const rejects=(fn,code)=>assert.throws(fn,e=>e instanceof ContractError && e.code===code);

test('two approved independent packets proceed only through claimed exact-head observations',()=>{
  const m=fixture();let l=completed(m);
  l=run(m,l,'CLAIM','second',A);l=run(m,l,'MODEL_STARTED','second');l=run(m,l,'DRAFT_OBSERVED','second',C);
  l=run(m,l,'CI_PASSED','second',C);l=run(m,l,'REVIEW_PASSED','second',C);
  assert.deepEqual(l.packets.map(p=>p.state),['COMPLETE_DRAFT','COMPLETE_DRAFT']);
  for(const k of ['dispatchAllowed','mergeAllowed','authenticated','durable'])assert.equal(l[k],false);
});
test('manifest validation does not infer authorization from its reference',()=>{
  const m=fixture();const out=validateManifest(m);m.packets[0].paths[0]='docs/v11/changed.md';
  assert.equal(out.packets[0].paths[0],'docs/v11/first.md');assert.ok(Object.isFrozen(out.packets[0].paths));
  const reordered=Object.fromEntries(Object.entries(fixture()).reverse());
  assert.equal(initialLedger(reordered).manifestDigest,initialLedger(fixture()).manifestDigest);
});
test('wrong repository, extra fields and widened output classes fail closed',()=>{
  for(const change of [m=>m.repository='attacker/repo',m=>m.autoMerge=true,m=>m.packets[0].outputClass='arbitrary-code',m=>m.packets[0].templateDigest='no']){
    const m=fixture();change(m);assert.throws(()=>validateManifest(m),ContractError);
  }
});
test('workflow paths, traversal, globs and Unicode separators are rejected',()=>{
  for(const bad of ['.github/workflows/ci.yml','docs/v11/../secret.md','docs/v11/*.md','docs/v11/a/b.md','docs/v11/a\u2215b.md','test/v11-x.test.js']){
    const m=fixture();m.packets[0].paths[0]=bad;rejects(()=>validateManifest(m),'PACKET_PATHS');
  }
});
test('dependency cycles, forward references, duplicate IDs and duplicate dependencies are rejected',()=>{
  for(const change of [m=>m.packets[0].dependencies=['second'],m=>m.packets[1].id='first',m=>m.packets[1].dependencies=['first','first']]){
    const m=fixture();change(m);assert.throws(()=>validateManifest(m),ContractError);
  }
});
test('accessors, symbols, sparse arrays and prototype objects are not evaluated as input',()=>{
  let called=false;const m=fixture();Object.defineProperty(m,'repository',{enumerable:true,get(){called=true;throw Error('getter');}});
  rejects(()=>validateManifest(m),'MANIFEST_SCHEMA');assert.equal(called,false);
  const withSymbol=fixture();withSymbol[Symbol('auth')]=true;rejects(()=>validateManifest(withSymbol),'MANIFEST_SCHEMA');
  const sparse=fixture();delete sparse.packets[0];rejects(()=>validateManifest(sparse),'PACKETS');
  assert.throws(()=>validateManifest(Object.assign(Object.create({}),fixture())),ContractError);
});
test('claim consumes slot before generation, and duplicate claim or replay cannot generate twice',()=>{
  const m=fixture(),zero=initialLedger(m),one=run(m,zero,'CLAIM','first',A);
  assert.equal(zero.packets[0].state,'READY');assert.equal(one.packets[0].state,'CLAIMED');
  rejects(()=>run(m,one,'CLAIM','first',A),'CLAIM_CONSUMED');
  rejects(()=>advance(m,one,{type:'MODEL_STARTED',packetId:'first',sha:null,expectedRevision:0},1500),'STALE_REVISION');
  const two=run(m,one,'MODEL_STARTED');rejects(()=>run(m,two,'MODEL_STARTED'),'INVALID_TRANSITION');
});
test('single-writer gate blocks a different packet even when it has no dependency',()=>{
  const m=fixture();m.packets[1].dependencies=[];
  const l=run(m,initialLedger(m),'CLAIM','first',A);
  rejects(()=>run(m,l,'CLAIM','second',A),'WRITER_BUSY');
});
test('draft and merged dependencies are distinct; post-merge evidence pins merge SHA',()=>{
  const m=fixture();m.packets[1].dependencyGate='merged';let l=completed(m);
  rejects(()=>run(m,l,'CLAIM','second',A),'DEPENDENCY_WAIT');
  l=run(m,l,'MERGE_OBSERVED','first',D);
  rejects(()=>run(m,l,'POST_MERGE_PASSED','first',C),'MERGE_MISMATCH');
  l=run(m,l,'POST_MERGE_PASSED','first',D);
  assert.equal(run(m,l,'CLAIM','second',A).packets[1].state,'CLAIMED');
  // This is a fixed-base simulation; real main advancing requires a new manifest.
  rejects(()=>run(m,l,'CLAIM','second',D),'BASE_MISMATCH');
});
test('changed head and revoked review invalidate dependent readiness',()=>{
  const m=fixture();let l=completed(m);l=run(m,l,'HEAD_CHANGED','first',C);
  assert.equal(l.packets[0].ciHeadSha,null);assert.equal(l.packets[0].reviewHeadSha,null);
  rejects(()=>run(m,l,'CI_PASSED','first',B),'HEAD_MISMATCH');
  rejects(()=>run(m,l,'REVIEW_PASSED','first',C),'INVALID_TRANSITION');
  l=run(m,l,'CI_PASSED','first',C);l=run(m,l,'REVIEW_PASSED','first',C);
  l=run(m,l,'REVIEW_REVOKED','first',C);rejects(()=>run(m,l,'CLAIM','second',A),'WRITER_BUSY');
});
test('unknown outcome freezes the pipeline; restart cannot free its consumed claim',()=>{
  const m=fixture();let l=run(m,initialLedger(m),'CLAIM','first',A);l=run(m,l,'OUTCOME_UNKNOWN');
  const restored=JSON.parse(JSON.stringify(l));
  rejects(()=>run(m,restored,'CLAIM','first',A),'CLAIM_CONSUMED');
  rejects(()=>run(m,restored,'CLAIM','second',A),'WRITER_BUSY');
  rejects(()=>run(m,restored,'MODEL_STARTED'),'INVALID_TRANSITION');
  rejects(()=>run(m,restored,'RESET'),'UNKNOWN_EVENT');
});
test('failed generation consumes invocation cap and never grants inference retry',()=>{
  const m=fixture();m.maxInvocations=1;let l=run(m,initialLedger(m),'CLAIM','first',A);
  l=run(m,l,'MODEL_STARTED');l=run(m,l,'FAIL');
  rejects(()=>run(m,l,'CLAIM','first',A),'CLAIM_CONSUMED');
  rejects(()=>run(m,l,'CLAIM','second',A),'INVOCATION_CAP');
});
test('deadline applies to output as well as new claim; revocation can still be recorded',()=>{
  const m=fixture();let l=run(m,initialLedger(m),'CLAIM','first',A);l=run(m,l,'MODEL_STARTED');
  rejects(()=>run(m,l,'DRAFT_OBSERVED','first',B,2000),'EXPIRED_OR_NOT_STARTED');
  rejects(()=>run(m,l,'DRAFT_OBSERVED','first',B,999),'EXPIRED_OR_NOT_STARTED');
  l=run(m,l,'REVOKE','first',null,2500);
  rejects(()=>run(m,l,'DRAFT_OBSERVED','first',B,1500),'REVOKED');
});
test('manifest changes, forged readiness and capability flags invalidate a snapshot',()=>{
  const m=fixture(),l=completed(m);const changed=fixture();changed.expiresAt++;
  rejects(()=>run(changed,l,'CLAIM','second',A),'LEDGER_IDENTITY');
  for(const edit of [x=>x.dispatchAllowed=true,x=>x.packets[0].ciHeadSha=C,x=>x.packets[0].reviewHeadSha=C,x=>x.packets[1].baseSha=A]){
    const corrupt=JSON.parse(JSON.stringify(l));edit(corrupt);assert.throws(()=>run(m,corrupt,'CLAIM','second',A),ContractError);
  }
});
test('rejected observations do not mutate the input snapshot',()=>{
  const m=fixture(),l=completed(m),before=JSON.stringify(l);
  rejects(()=>run(m,l,'CI_PASSED','first',C),'INVALID_TRANSITION');assert.equal(JSON.stringify(l),before);
});
test('earlier head change or review revocation freezes an already claimed descendant',()=>{
  for(const type of ['HEAD_CHANGED','REVIEW_REVOKED']){
    const m=fixture();let l=run(m,completed(m),'CLAIM','second',A);
    l=run(m,l,type,'first',type==='HEAD_CHANGED'?C:B);
    assert.equal(l.revoked,true);assert.deepEqual(l.packets.map(x=>x.state),['UNKNOWN_OUTCOME','UNKNOWN_OUTCOME']);
    assert.ok(l.packets.every(x=>x.reviewHeadSha===null && x.ciHeadSha===null));
    rejects(()=>run(m,l,'MODEL_STARTED','second'),'REVOKED');
  }
});
test('late invalidation removes both completed packets readiness without erasing their claims',()=>{
  const m=fixture();let l=completed(m);
  for(const [type,sha] of [['CLAIM',A],['MODEL_STARTED',null],['DRAFT_OBSERVED',C],['CI_PASSED',C],['REVIEW_PASSED',C]])l=run(m,l,type,'second',sha);
  l=run(m,l,'REVIEW_REVOKED','first',B);
  assert.equal(l.revoked,true);assert.ok(l.packets.every(x=>x.state==='UNKNOWN_OUTCOME' && x.baseSha===A));
  rejects(()=>run(m,l,'CLAIM','first',A),'REVOKED');
});
test('review revocation after merge observation or post-check freezes downstream and retains merge history',()=>{
  for(const checked of [false,true]){
    const m=fixture();m.packets[1].dependencyGate='merged';let l=run(m,completed(m),'MERGE_OBSERVED','first',D);
    if(checked)l=run(m,l,'POST_MERGE_PASSED','first',D);
    l=run(m,l,'REVIEW_REVOKED','first',B);
    assert.equal(l.revoked,true);assert.equal(l.packets[0].mergeSha,D);
    rejects(()=>run(m,l,'POST_MERGE_PASSED','first',D),'REVOKED');
    rejects(()=>run(m,l,'CLAIM','second',A),'REVOKED');
  }
});
test('manifest order prevents skipping failed or unstarted packets despite disjoint paths',()=>{
  const m=fixture();m.packets[1].dependencies=[];let l=initialLedger(m);
  rejects(()=>run(m,l,'CLAIM','second',A),'PACKET_ORDER');
  l=run(m,l,'CLAIM','first',A);l=run(m,l,'FAIL');
  rejects(()=>run(m,l,'CLAIM','second',A),'PACKET_ORDER');
});
test('a restored snapshot cannot carry active dependent work with invalid parent evidence',()=>{
  const m=fixture();let l=run(m,completed(m),'CLAIM','second',A);
  const bad=JSON.parse(JSON.stringify(l));bad.packets[0]={id:'first',state:'READY',baseSha:null,headSha:null,ciHeadSha:null,reviewHeadSha:null,mergeSha:null};
  rejects(()=>run(m,bad,'MODEL_STARTED','second'),'DEPENDENCY_INVALIDATED');
});
test('observing a Lead merge after two reviewed Drafts retains valid draft dependency evidence',()=>{
  const m=fixture();let l=completed(m);
  for(const [type,sha] of [['CLAIM',A],['MODEL_STARTED',null],['DRAFT_OBSERVED',C],['CI_PASSED',C],['REVIEW_PASSED',C]])l=run(m,l,type,'second',sha);
  l=run(m,l,'MERGE_OBSERVED','first',D);
  assert.equal(l.packets[1].state,'COMPLETE_DRAFT');
  l=run(m,l,'POST_MERGE_PASSED','first',D);
  assert.deepEqual(l.packets.map(x=>x.state),['COMPLETE_MERGED','COMPLETE_DRAFT']);
});
