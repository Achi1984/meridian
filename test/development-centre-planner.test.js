import test from 'node:test';
import assert from 'node:assert/strict';
import { planWork } from '../scripts/development-centre-planner.mjs';
const head = 'a'.repeat(40), base = 'b'.repeat(40);
function packet() {
  const scope = {repository:'Achi1984/meridian', requestId:'REQ001', opId:'OP001', headSha:head, baseSha:base};
  return {deliveryId:'EVT001',workId:'WORK001',...scope, paths:['src/feature.js'],owner:'NONE',execution:'PLANNED',
    ci:{headSha:head,baseSha:base,runId:123,jobs:[{name:'release-tests',conclusion:'SUCCESS',total:10,passed:10,failed:0}]},
    responses:[{...scope,reviewCommentId:42,reviewAuthor:'CLAUDE',verdict:'GREEN_LIGHT'}],inFlight:[]};
}
const run = (...work) => planWork({requiredJobs:['release-tests'],work});
test('ready is explicitly unauthenticated and unauthorized; inputs remain unchanged', () => {
  const p = packet(), before = structuredClone(p), first = run(p);
  assert.equal(first[0].status,'READY_FOR_OWNER_DECISION');
  for (const field of ['authenticated','provenanceVerified','dispatchAllowed','mergeAllowed','authorized']) assert.equal(first[0][field],false);
  assert.deepEqual(run(p),first); assert.deepEqual(p,before); assert.ok(Object.isFrozen(first[0]));
});
test('duplicate events collapse but conflicting identities fail closed', () => {
  const p=packet(); assert.equal(run(p,{...p,deliveryId:'EVT002'}).length,1);
  assert.throws(()=>run(p,{...p,paths:['different.js']}),/DELIVERY_CONFLICT/);
  assert.throws(()=>run(p,{...p,deliveryId:'EVT002',paths:['different.js']}),/WORK_CONFLICT/);
  assert.throws(()=>run(p,{...p,deliveryId:'EVT002',workId:'WORK002'}),/REQUEST_SCOPE_CONFLICT/);
});
test('stale integration, missing jobs, pending and failed CI cannot advance', () => {
  for (const [change,reason] of [
    [p=>p.ci.baseSha='c'.repeat(40),'STALE_CI'],
    [p=>p.ci.headSha='c'.repeat(40),'STALE_CI'],
    [p=>p.ci.jobs=[],'CI_INCOMPLETE'],
    [p=>p.ci.jobs[0].conclusion='PENDING','CI_INCOMPLETE'],
    [p=>p.ci.jobs[0].conclusion='FAILURE','CI_FAILED'],
    [p=>p.ci=null,'CI_MISSING']]) { const p=packet();change(p);assert.equal(run(p)[0].reason,reason); }
  const p=packet();p.ci.jobs[0].total=11;assert.throws(()=>run(p),/INVALID_CI/);
});
test('review blocking verdict takes precedence and no review waits', () => {
  const p=packet(); p.responses.push({...p.responses[0],reviewCommentId:43,verdict:'REVISION_REQUIRED'});
  assert.equal(run(p)[0].reason,'STRICTEST_VERDICT');
  p.responses=[]; assert.equal(run(p)[0].status,'WAITING_REVIEW');
  p.inFlight=[{requestId:p.requestId,opId:p.opId,headSha:head,baseSha:base,repository:p.repository}];
  assert.equal(run(p)[0].reason,'ALREADY_REQUESTED');
});
test('unknown outcomes and overlapping paths block; active owners wait', () => {
  const p=packet();p.execution='UNKNOWN';assert.equal(run(p)[0].reason,'RECONCILE_UNKNOWN_OUTCOME');
  p.execution='RUNNING';assert.throws(()=>run(p),/OWNER_REQUIRED/);p.owner='CODEX';assert.equal(run(p)[0].status,'WAITING_AGENT');
  const q=packet();Object.assign(q,{deliveryId:'EVT002',workId:'WORK002',requestId:'REQ002',opId:'OP002',headSha:'d'.repeat(40),paths:['src'],responses:[]});
  assert.ok(run(p,q).every(r=>r.reason==='OVERLAPPING_SCOPE'));
});
test('strict inputs reject unknown fields, path traversal, proxies, getters, sparse and oversized arrays', () => {
  const p=packet();assert.throws(()=>run({...p,authorized:true}),/INVALID_SCHEMA/);
  assert.throws(()=>run({...p,paths:['src/../secrets']}),/INVALID_PATHS/);
  assert.throws(()=>run(new Proxy(p,{ownKeys(){throw Error('trap ran');}})),/INVALID_OBJECT/);
  const getter={...p};Object.defineProperty(getter,'owner',{enumerable:true,get(){throw Error('getter ran');}});
  assert.throws(()=>run(getter),/INVALID_DESCRIPTOR/);
  assert.throws(()=>run({...p,paths:new Array(1)}),/INVALID_ARRAY/);
  assert.throws(()=>run({...p,paths:Array(129).fill('x')}),/INPUT_LIMIT/);
});
test('output order is independent of input order',()=>{
  const p=packet(),q=packet();Object.assign(q,{deliveryId:'EVT002',workId:'WORK002',requestId:'REQ002',opId:'OP002',headSha:'d'.repeat(40),paths:['other.js'],responses:[]});
  assert.deepEqual(run(p,q),run(q,p));
});

test('new request IDs cannot bypass per-head work deduplication',()=>{ const p=packet(),q=packet();Object.assign(q,{deliveryId:'EVT002',workId:'WORK002',requestId:'REQ002',opId:'OP002',responses:[]});assert.throws(()=>run(p,q),/HEAD_ALREADY_SCOPED/); });

test('snapshot-wide review and CI identities cannot attest conflicting heads',()=>{
  const p=packet();
  function second() {
    const q=packet();Object.assign(q,{deliveryId:'EVT002',workId:'WORK002',requestId:'REQ002',opId:'OP002',headSha:'d'.repeat(40),paths:['other.js']});
    Object.assign(q.responses[0],{requestId:q.requestId,opId:q.opId,headSha:q.headSha,reviewCommentId:43});
    Object.assign(q.ci,{headSha:q.headSha,runId:124});return q;
  }
  const reviewCollision=second();reviewCollision.responses[0].reviewCommentId=42;
  assert.throws(()=>run(p,reviewCollision),/REVIEW_ID_CONFLICT/);
  const ciCollision=second();ciCollision.ci.runId=123;
  assert.throws(()=>run(p,ciCollision),/CI_RUN_CONFLICT/);
  assert.ok(run(p,second()).every(r=>r.status==='READY_FOR_OWNER_DECISION'));
});

test('additional pending CI jobs delay readiness; failures retain precedence',()=>{
  const p=packet();
  p.ci.jobs.push({name:'optional-check',conclusion:'PENDING',total:0,passed:0,failed:0});
  assert.equal(run(p)[0].status,'WAITING_CI');
  assert.equal(run(p)[0].reason,'CI_INCOMPLETE');
  p.ci.jobs.push({name:'failed-check',conclusion:'FAILURE',total:1,passed:0,failed:1});
  assert.equal(run(p)[0].status,'BLOCKED');
  assert.equal(run(p)[0].reason,'CI_FAILED');
  p.ci.jobs.pop();
  p.ci.jobs[1].conclusion='SUCCESS';
  assert.equal(run(p)[0].status,'READY_FOR_OWNER_DECISION');
});
test('job IDs require explicit valid collector mappings',()=>{
  for(const name of ['ci','Release Safety']) {
    assert.throws(()=>planWork({requiredJobs:[name],work:[packet()]}),/INVALID_COLLECTION/);
    const p=packet();p.ci.jobs[0].name=name;assert.throws(()=>run(p),/INVALID_CI/);
  }
});
function independentPair() {
  const p=packet(),q=packet();
  Object.assign(q,{deliveryId:'EVT002',workId:'WORK002',requestId:'REQ002',opId:'OP002',headSha:'d'.repeat(40),paths:['other.js']});
  Object.assign(q.responses[0],{requestId:q.requestId,opId:q.opId,headSha:q.headSha,reviewCommentId:43});
  Object.assign(q.ci,{headSha:q.headSha,runId:124});return [p,q];
}
function historicalScope() {
  return {repository:'Achi1984/meridian',requestId:'HISTREQ',opId:'HISTOP',headSha:'e'.repeat(40),baseSha:base};
}
function addHistory(work,kind,row,commentId) {
  work[kind].push(kind==='responses'?{...row,reviewCommentId:commentId,reviewAuthor:'CLAUDE',verdict:'GREEN_LIGHT'}:row);
}
test('nested response and in-flight scopes must agree across the entire snapshot',()=>{
  for(const firstKind of ['responses','inFlight'])for(const secondKind of ['responses','inFlight']) {
    for(const [change,expected] of [
      [r=>{r.headSha='f'.repeat(40);r.opId='OTHEROP';},/REQUEST_SCOPE_CONFLICT/],
      [r=>{r.headSha='f'.repeat(40);r.requestId='OTHERREQ';},/OP_SCOPE_CONFLICT/],
      [r=>{r.baseSha='c'.repeat(40);r.requestId='OTHERREQ';r.opId='OTHEROP';},/HEAD_BASE_CONFLICT/]
    ]) {
      const [p,q]=independentPair(),a=historicalScope(),b={...a};change(b);
      addHistory(p,firstKind,a,50);addHistory(q,secondKind,b,51);
      assert.throws(()=>run(p,q),expected,firstKind+' / '+secondKind);
      assert.throws(()=>run(q,p),expected,'reversed '+firstKind+' / '+secondKind);
    }
  }
});
test('nested identities cannot conflict with another top-level packet',()=>{
  for(const kind of ['responses','inFlight']) {
    const [p,q]=independentPair(),row=historicalScope();row.requestId=q.requestId;
    addHistory(p,kind,row,50);assert.throws(()=>run(p,q),/REQUEST_SCOPE_CONFLICT/);
    assert.throws(()=>run(q,p),/REQUEST_SCOPE_CONFLICT/);
  }
});
test('consistent historical evidence can repeat across packets without granting current review',()=>{
  const [p,q]=independentPair(),history=historicalScope();
  addHistory(p,'responses',history,50);addHistory(q,'responses',{...history},50);
  addHistory(p,'inFlight',{...history});addHistory(q,'inFlight',{...history});
  assert.ok(run(p,q).every(r=>r.status==='READY_FOR_OWNER_DECISION'));
  p.responses=p.responses.filter(r=>r.headSha!==p.headSha);
  assert.equal(run(p,q).find(r=>r.workId===p.workId).status,'WAITING_REVIEW');
});
test('running owners cannot mask stale or failed supplied CI',()=>{
  for(const [change,status,reason] of [
    [p=>p.ci.headSha='c'.repeat(40),'BLOCKED','STALE_CI'],
    [p=>p.ci.baseSha='c'.repeat(40),'BLOCKED','STALE_CI'],
    [p=>p.ci.jobs[0].conclusion='FAILURE','BLOCKED','CI_FAILED'],
    [p=>{p.ci.jobs[0].passed=9;p.ci.jobs[0].failed=1;},'BLOCKED','CI_FAILED'],
    [()=>{},'WAITING_AGENT','OWNER_IN_FLIGHT'],
    [p=>p.ci=null,'WAITING_AGENT','OWNER_IN_FLIGHT'],
    [p=>p.ci.jobs[0].conclusion='PENDING','WAITING_AGENT','OWNER_IN_FLIGHT']
  ]) {
    const p=packet();p.execution='RUNNING';p.owner='CODEX';change(p);
    const actual=run(p)[0];assert.equal(actual.status,status);assert.equal(actual.reason,reason);
  }
});
test('CI reorder preserves reconciliation, review and stale-before-failed precedence',()=>{
  const p=packet();p.owner='CODEX';p.execution='RUNNING';
  p.ci.headSha='c'.repeat(40);p.ci.jobs[0].conclusion='FAILURE';
  assert.equal(run(p)[0].reason,'STALE_CI');
  p.responses[0].verdict='REVISION_REQUIRED';assert.equal(run(p)[0].reason,'STRICTEST_VERDICT');
  p.execution='UNKNOWN';assert.equal(run(p)[0].reason,'RECONCILE_UNKNOWN_OUTCOME');
});
test('invalid nested repository fails closed even for historical evidence',()=>{
  for(const kind of ['responses','inFlight']) {
    const p=packet(),row=historicalScope();row.repository='other/repository';
    addHistory(p,kind,row,50);assert.throws(()=>run(p),/INVALID_SCOPE/);
  }
});
test('active-scope adverse reviews cannot hide inside another packet',()=>{
  for(const verdict of ['REVISION_REQUIRED','NEEDS_MORE_EVIDENCE','CHANGES_REQUIRED','STALE_HEAD']) {
    const [p,q]=independentPair();q.responses.push({...p.responses[0],reviewCommentId:50,verdict});
    for(const order of [[p,q],[q,p]]) {
      const results=run(...order);
      assert.equal(results.find(r=>r.workId===p.workId).reason,'STRICTEST_VERDICT');
      assert.equal(results.find(r=>r.workId===q.workId).status,'READY_FOR_OWNER_DECISION');
    }
  }
});
test('in-flight evidence routes to its active scope regardless of containing packet',()=>{
  const [p,q]=independentPair();
  const row=Object.fromEntries(['repository','requestId','opId','headSha','baseSha'].map(k=>[k,p[k]]));
  q.inFlight.push(row);p.responses=[];
  for(const order of [[p,q],[q,p]])assert.equal(run(...order).find(r=>r.workId===p.workId).reason,'ALREADY_REQUESTED');
  q.responses.push({...row,reviewCommentId:50,reviewAuthor:'CLAUDE',verdict:'GREEN_LIGHT'});
  assert.ok(run(p,q).every(r=>r.status==='READY_FOR_OWNER_DECISION'),'answered in-flight request retains existing GREEN semantics');
});
test('alternate request on an active head cannot hide in foreign historical rows',()=>{
  for(const kind of ['responses','inFlight']) {
    const [p,q]=independentPair();
    const row={...historicalScope(),headSha:p.headSha};addHistory(q,kind,row,50);
    for(const order of [[p,q],[q,p]])assert.equal(run(...order).find(r=>r.workId===p.workId).reason,'HEAD_ALREADY_SCOPED');
  }
});
