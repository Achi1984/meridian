import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {validateEvidence} from '../scripts/codex-bridge-v3-evidence.mjs';
import {classifyReview, validateStructuredReviewClaim, STRUCTURED_REVIEW_CLAIM_SCHEMA} from '../scripts/codex-bridge-v3-review-coordinator.mjs';

const scope = () => ({requestId:'REQ-001',opId:'OP-001',headSha:'a'.repeat(40),
  baseSha:'b'.repeat(40),repository:'Achi1984/meridian'});
const response = (extra={}) => ({...scope(),reviewCommentId:1,reviewAuthor:'CLAUDE',verdict:'GREEN_LIGHT',...extra});
const input = (extra={}) => ({...scope(),responses:[],inFlight:[],...extra});
const check = extra => classifyReview(input(extra),scope());
const fail = (fn,code) => assert.throws(fn,{name:'ReviewCoordinationError',code});
const denied = result => {
  assert.ok(Object.isFrozen(result));
  for(const k of ['mayRequest','mayMerge','mayActivate','authenticated','provenanceVerified','authorized']) assert.equal(result[k],false);
};
test('all successful classifications explicitly deny authority',()=>{
  for(const [extra,status] of [[{},'UNREQUESTED'],[{inFlight:[scope()]},'WAITING'],[{responses:[response()]},'REVIEWED']]){
    const result=check(extra);assert.equal(result.status,status);denied(result);
  }
});
for(const verdict of ['NEEDS_MORE_EVIDENCE','REVISION_REQUIRED','CHANGES_REQUIRED','STALE_HEAD'])
  test(verdict+' dominates GREEN in either arrival order',()=>{
    const rows=[response(),response({reviewCommentId:2,verdict})];
    for(const responses of [rows,[...rows].reverse()]){
      const result=check({responses});assert.equal(result.status,'BLOCKED');denied(result);
    }
  });
test('identical response and in-flight duplicates are inert',()=>{
  const value=input({responses:[response(),response()],inFlight:[scope(),scope()]});
  const before=structuredClone(value),result=classifyReview(value,scope());
  assert.deepEqual(classifyReview(value,scope()),result);assert.deepEqual(value,before);
  assert.equal(result.status,'REVIEWED');denied(result);
});
for(const key of ['requestId','opId','headSha','baseSha','repository'])
  test('pinned '+key+' is mandatory and exact',()=>{
    const changed={...scope(),[key]:key.endsWith('Sha')?'c'.repeat(40):key==='repository'?'wrong/repo':'OTHER-001'};
    fail(()=>classifyReview(input(),changed),key==='repository'?'INVALID_SCOPE':'SCOPE_MISMATCH');
    const missing=input();delete missing[key];fail(()=>classifyReview(missing,scope()),'INVALID_SCHEMA');
  });
for(const field of ['requestId','opId']) for(const value of ['', 'x','bad|id','x'.repeat(129),{},null])
  test('invalid '+field+' '+String(value),()=>fail(()=>check({[field]:value}),'INVALID_SCOPE'));
for(const value of ['A'.repeat(40),'a'.repeat(39),null,42])
  test('invalid head '+String(value),()=>fail(()=>check({headSha:value}),'INVALID_SHA'));
test('equal head/base rejected',()=>fail(()=>check({baseSha:scope().headSha}),'INVALID_SHA'));
test('unknown, symbol and non-enumerable extra fields rejected',()=>{
  for(const value of [input({extra:true}),Object.assign(input(),{[Symbol('x')]:true}),Object.defineProperty(input(),'extra',{value:1})])
    fail(()=>classifyReview(value,scope()),'INVALID_SCHEMA');
});
test('missing expected pins fail closed',()=>fail(()=>classifyReview(input()),'INVALID_OBJECT'));
for(const where of ['input','expected','response','inFlight','array']){
  test('getter never runs at '+where,()=>{
    let calls=0;const accessor={enumerable:true,get(){calls++;throw Error('getter ran');}};
    const value=input(),expected=scope();
    if(where==='input')Object.defineProperty(value,'requestId',accessor);
    if(where==='expected')Object.defineProperty(expected,'opId',accessor);
    if(where==='response'){value.responses=[response()];Object.defineProperty(value.responses[0],'verdict',accessor);}
    if(where==='inFlight'){value.inFlight=[scope()];Object.defineProperty(value.inFlight[0],'headSha',accessor);}
    if(where==='array'){value.responses=[response()];Object.defineProperty(value.responses,'0',accessor);}
    fail(()=>classifyReview(value,expected),'ACCESSOR_OR_HIDDEN_FIELD');assert.equal(calls,0);
  });
  test('proxy traps never run at '+where,()=>{
    let calls=0;const wrap=x=>new Proxy(x,{getPrototypeOf(){calls++;throw Error('trap');},ownKeys(){calls++;throw Error('trap');},get(){calls++;throw Error('trap');}});
    let value=input(),expected=scope();
    if(where==='input')value=wrap(value);
    if(where==='expected')expected=wrap(expected);
    if(where==='response')value.responses=[wrap(response())];
    if(where==='inFlight')value.inFlight=[wrap(scope())];
    if(where==='array')value.responses=wrap([]);
    fail(()=>classifyReview(value,expected),where==='array'?'INVALID_COLLECTION':'INVALID_OBJECT');assert.equal(calls,0);
  });
}
test('null/custom prototypes, classes and arrays are not records',()=>{
  for(const value of [Object.assign(Object.create(null),input()),Object.assign(Object.create({}),input()),new class {},[],null])
    fail(()=>classifyReview(value,scope()),'INVALID_OBJECT');
});
test('sparse, extended, inherited, hidden-index and oversized collections rejected',()=>{
  for(const rows of [new Array(1),Object.assign([],{extra:true}),Object.setPrototypeOf([],{})])
    fail(()=>check({responses:rows}),'INVALID_COLLECTION');
  fail(()=>check({responses:Object.defineProperty([response()],'0',{enumerable:false})}),'ACCESSOR_OR_HIDDEN_FIELD');
  fail(()=>check({responses:Array(257).fill(response())}),'COLLECTION_LIMIT');
  for(const rows of [null,{},''])fail(()=>check({responses:rows}),'INVALID_COLLECTION');
});
test('unrelated malformed rows cannot hide behind GREEN',()=>{
  fail(()=>check({responses:[response(),{requestId:'OTHER-001'}]}),'INVALID_SCHEMA');
  fail(()=>check({inFlight:[null]}),'INVALID_OBJECT');
  fail(()=>check({responses:[response({requestId:'OTHER-001',opId:'OTHER-OP',headSha:'c'.repeat(40),verdict:'UNKNOWN'})]}),'UNKNOWN_VERDICT');
});
for(const field of ['headSha','baseSha','opId']) for(const kind of ['responses','inFlight'])
  test('same request '+field+' conflict in '+kind,()=>{
    const extra={[field]:field==='opId'?'OTHER-OP':'c'.repeat(40)};
    fail(()=>check({[kind]:[kind==='responses'?response(extra):{...scope(),...extra}]}),'REQUEST_SCOPE_CONFLICT');
  });
test('operation ID cannot be reused for another request',()=>fail(()=>check({inFlight:[{...scope(),requestId:'OTHER-001'}]}),'OP_SCOPE_CONFLICT'));
test('same head cannot claim another base',()=>fail(()=>check({inFlight:[{...scope(),requestId:'OTHER-001',opId:'OTHER-OP',baseSha:'c'.repeat(40)}]}),'HEAD_BASE_CONFLICT'));
test('new request IDs cannot bypass per-head dedupe or inherit GREEN',()=>{
  for(const kind of ['responses','inFlight']){
    const other={...scope(),requestId:'OTHER-001',opId:'OTHER-OP'};
    const result=check({[kind]:[kind==='responses'?response(other):other]});
    assert.equal(result.reason,'HEAD_ALREADY_SCOPED');denied(result);
  }
});
test('GREEN cannot hide an in-flight head conflict',()=>fail(()=>check({responses:[response()],inFlight:[{...scope(),headSha:'c'.repeat(40)}]}),'REQUEST_SCOPE_CONFLICT'));
test('same review ID with conflicting verdict or scope rejected',()=>{
  fail(()=>check({responses:[response(),response({verdict:'CHANGES_REQUIRED'})]}),'REVIEW_ID_CONFLICT');
  fail(()=>check({responses:[response(),response({requestId:'OTHER-001',opId:'OTHER-OP',headSha:'c'.repeat(40)})]}),'REVIEW_ID_CONFLICT');
});
for(const value of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null])
  test('invalid review ID '+String(value),()=>fail(()=>check({responses:[response({reviewCommentId:value})]}),'INVALID_REVIEW_CLAIM'));
test('review author/verdict claims are strict',()=>{
  fail(()=>check({responses:[response({reviewAuthor:'OWNER'})]}),'INVALID_REVIEW_CLAIM');
  for(const verdict of ['GREEN LIGHT','UNKNOWN',null,{}])fail(()=>check({responses:[response({verdict})]}),'UNKNOWN_VERDICT');
});
test('invalid snapshots consume no reservation; recovery remains inert',()=>{
  const value=input({inFlight:[{...scope(),headSha:'c'.repeat(40)}]});
  fail(()=>classifyReview(value,scope()),'REQUEST_SCOPE_CONFLICT');
  value.inFlight=[scope()];assert.equal(classifyReview(value,scope()).status,'WAITING');
  value.responses=[response()];assert.equal(classifyReview(value,scope()).status,'REVIEWED');
  assert.equal(classifyReview(structuredClone(value),scope()).status,'REVIEWED');
});
test('valid unrelated heads do not supply review evidence',()=>{
  const result=check({responses:[response({requestId:'OTHER-001',opId:'OTHER-OP',headSha:'c'.repeat(40)})]});
  assert.equal(result.status,'UNREQUESTED');denied(result);
});
test('concurrent snapshot classification has no shared reservation or authorization',async()=>{
  const value=input({responses:[response()]});const before=structuredClone(value);
  const results=await Promise.all(Array.from({length:32},()=>Promise.resolve().then(()=>classifyReview(value,scope()))));
  for(const result of results){assert.deepEqual(result,results[0]);denied(result);}
  assert.deepEqual(value,before);
});

test('four actual worker threads independently replay identical snapshots', {timeout:10000}, async t=>{
  const workers=[],value=input({responses:[response()],inFlight:[scope()]}),before=structuredClone(value);
  t.after(()=>Promise.all(workers.map(w=>w.terminate())));
  const source=`const {parentPort,workerData}=require('node:worker_threads');
    import(workerData.url).then(({classifyReview})=>{
      const results=[];
      for(let i=0;i<32;i++)results.push(classifyReview(workerData.input,workerData.expected));
      parentPort.postMessage(results);
    }).catch(error=>{throw error;});`;
  const batches=await Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{
    const worker=new Worker(source,{eval:true,workerData:{
      url:new URL('../scripts/codex-bridge-v3-review-coordinator.mjs',import.meta.url).href,
      input:value,expected:scope()}});
    workers.push(worker);worker.once('message',resolve);worker.once('error',reject);
    worker.once('exit',code=>{if(code!==0)reject(new Error('worker exit '+code));});
  })));
  for(const batch of batches){assert.equal(batch.length,32);for(const result of batch){
    assert.deepEqual(result,classifyReview(value,scope()));
    // Structured-cloned messages do not preserve frozen descriptors.
    for(const k of ['mayRequest','mayMerge','mayActivate','authenticated','provenanceVerified','authorized'])assert.equal(result[k],false);
  }}
  assert.deepEqual(value,before);
});

test('classification cannot consume or reset the separate V3 evidence reservation',()=>{
  const seen=new Set(),pinned=scope(),value=input({responses:[response()]});
  const claim={...pinned,ciRunId:1,ciWorkflow:'MERIDIAN Release Safety',ciHeadSha:pinned.headSha,
    ciStatus:'completed',ciConclusion:'success',reviewCommentId:1,reviewAuthor:'CLAUDE',
    reviewHead:pinned.headSha,reviewVerdict:'GREEN_LIGHT'};
  for(let i=0;i<3;i++)denied(classifyReview(value,pinned));
  assert.equal(seen.size,0);
  assert.equal(validateEvidence(claim,pinned,seen).authorized,false);
  const reserved=[...seen];assert.equal(reserved.length,1);
  for(let i=0;i<3;i++)denied(classifyReview(value,pinned));
  assert.deepEqual([...seen],reserved);
  assert.throws(()=>validateEvidence(claim,pinned,seen),{code:'REPLAY_DETECTED'});
});

test('boundary-sized IDs, review ID and collections are accepted without authority',()=>{
  const pinned={...scope(),requestId:'R'.repeat(128),opId:'O'.repeat(128)};
  const row={...response(),...pinned,reviewCommentId:Number.MAX_SAFE_INTEGER};
  const result=classifyReview({...pinned,responses:Array(256).fill(row),inFlight:Array(256).fill(pinned)},pinned);
  assert.equal(result.status,'REVIEWED');denied(result);
});

test('malicious coercion hooks are never called',()=>{
  let calls=0;const hostile={[Symbol.toPrimitive](){calls++;throw Error('coerced');},toString(){calls++;throw Error('coerced');}};
  for(const field of ['requestId','opId','repository'])fail(()=>check({[field]:hostile}),'INVALID_SCOPE');
  for(const field of ['headSha','baseSha'])fail(()=>check({[field]:hostile}),'INVALID_SHA');
  fail(()=>check({responses:[response({reviewCommentId:hostile})]}),'INVALID_REVIEW_CLAIM');
  fail(()=>check({responses:[response({verdict:hostile})]}),'UNKNOWN_VERDICT');
  assert.equal(calls,0);
});

test('revoked proxies fail with controlled errors',()=>{
  const revoked=x=>{const p=Proxy.revocable(x,{});p.revoke();return p.proxy;};
  fail(()=>classifyReview(revoked(input()),scope()),'INVALID_OBJECT');
  fail(()=>classifyReview(input(),revoked(scope())),'INVALID_OBJECT');
  fail(()=>check({responses:[revoked(response())]}),'INVALID_OBJECT');
  fail(()=>check({inFlight:revoked([])}),'INVALID_COLLECTION');
});

for(const kind of ['responses','inFlight'])test(kind+' symbols, prototypes and malformed entries are rejected',()=>{
  const row=kind==='responses'?response():scope();
  const symbolArray=Object.assign([row],{[Symbol('x')]:true});
  fail(()=>check({[kind]:symbolArray}),'INVALID_COLLECTION');
  fail(()=>check({[kind]:Object.setPrototypeOf([row],Object.create(Array.prototype))}),'INVALID_COLLECTION');
  fail(()=>check({[kind]:[Object.assign(Object.create(null),row)]}),'INVALID_OBJECT');
  fail(()=>check({[kind]:[{...row,extra:true}]}),'INVALID_SCHEMA');
  fail(()=>check({[kind]:[Object.defineProperty({...row},'opId',{enumerable:false})]}),'ACCESSOR_OR_HIDDEN_FIELD');
});

test('prototype-pollution keys cannot enter snapshots or alter global prototypes',()=>{
  const before=Object.getPrototypeOf({});
  for(const key of ['__proto__','constructor','prototype']){
    const value=input();Object.defineProperty(value,key,{value:{polluted:true},enumerable:true});
    fail(()=>classifyReview(value,scope()),'INVALID_SCHEMA');
  }
  assert.equal(Object.getPrototypeOf({}),before);assert.equal(Object.hasOwn(Object.prototype,'polluted'),false);
});

test('frozen JSON-shaped snapshots are accepted and never thawed',()=>{
  const pinned=Object.freeze(scope()),row=Object.freeze(response());
  const value=Object.freeze({...pinned,responses:Object.freeze([row]),inFlight:Object.freeze([])});
  denied(classifyReview(value,pinned));assert.ok(Object.isFrozen(value.responses));
});

const ciIdentity = () => ({runId:100,runAttempt:1,workflowId:200,headSha:scope().headSha});
const structuredPins = () => ({...scope(),prNumber:123,ci:ciIdentity()});
const structuredClaim = () => ({schemaVersion:1,...scope(),prNumber:123,verdict:'GREEN_LIGHT',
  ci:{...ciIdentity(),status:'completed',conclusion:'success'}});
test('structured claims preserve all existing verdicts as unauthenticated non-authorizing claims',()=>{
  for(const verdict of STRUCTURED_REVIEW_CLAIM_SCHEMA.properties.verdict.enum){
    const value={...structuredClaim(),verdict},expected=structuredPins();
    const before=structuredClone({value,expected});
    const result=validateStructuredReviewClaim(value,expected);denied(result);
    assert.equal(result.verdict,verdict);assert.equal(result.status,verdict==='GREEN_LIGHT'?'REVIEWED':'BLOCKED');
    assert.deepEqual({value,expected},before);
    assert.deepEqual(validateStructuredReviewClaim(value,expected),result);
  }
});
test('structured scope and CI identity independently pin every identity field',()=>{
  for(const field of [...Object.keys(scope()),'prNumber']){
    const value=structuredClaim();value[field]=field==='prNumber'?124:field.endsWith('Sha')?'c'.repeat(40):field==='repository'?'other/repo':'OTHER-001';
    fail(()=>validateStructuredReviewClaim(value,structuredPins()),field==='repository'?'INVALID_SCOPE':'SCOPE_MISMATCH');
  }
  for(const field of Object.keys(ciIdentity())){
    const value=structuredClaim();value.ci[field]=field==='headSha'?'c'.repeat(40):999;
    fail(()=>validateStructuredReviewClaim(value,structuredPins()),'CI_IDENTITY_MISMATCH');
  }
  const pins=structuredPins();pins.ci.headSha='c'.repeat(40);
  fail(()=>validateStructuredReviewClaim(structuredClaim(),pins),'CI_IDENTITY_MISMATCH');
});
test('structured unknown/missing fields and model-provided provenance are rejected at each level',()=>{
  for(const location of ['claim','expected','ci','expectedCI']){
    for(const mode of ['missing','extra','symbol','provenance']){
      const claim=structuredClaim(),expected=structuredPins();
      const obj=location==='claim'?claim:location==='expected'?expected:location==='ci'?claim.ci:expected.ci;
      if(mode==='missing')delete obj[Object.keys(obj)[0]];
      else Object.defineProperty(obj,mode==='symbol'?Symbol('extra'):mode==='provenance'?'authenticated':'extra',{value:true,enumerable:true});
      fail(()=>validateStructuredReviewClaim(claim,expected),'INVALID_SCHEMA');
    }
  }
});
for(const where of ['claim','expected','ci','expectedCI'])test('structured hostile descriptors at '+where+' never execute',()=>{
  for(const kind of ['proxy','revoked','accessor']){
    let calls=0,claim=structuredClaim(),expected=structuredPins();
    const obj=where==='claim'?claim:where==='expected'?expected:where==='ci'?claim.ci:expected.ci;
    let hostile=obj;
    if(kind==='accessor')Object.defineProperty(obj,Object.keys(obj)[0],{enumerable:true,get(){calls++;throw Error('getter');}});
    else if(kind==='revoked'){const x=Proxy.revocable(obj,{});x.revoke();hostile=x.proxy;}
    else hostile=new Proxy(obj,{get(){calls++;throw Error('trap');},getPrototypeOf(){calls++;throw Error('trap');},ownKeys(){calls++;throw Error('trap');}});
    if(where==='claim')claim=hostile;else if(where==='expected')expected=hostile;else if(where==='ci')claim.ci=hostile;else expected.ci=hostile;
    fail(()=>validateStructuredReviewClaim(claim,expected),kind==='accessor'?'ACCESSOR_OR_HIDDEN_FIELD':'INVALID_OBJECT');assert.equal(calls,0);
  }
});
test('structured integer bounds and coercion hooks are strict for claims and expected pins',()=>{
  let calls=0;const hostile={[Symbol.toPrimitive](){calls++;throw Error('coercion');}};
  for(const value of [true,'1',0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,hostile]){
    for(const side of ['claim','expected'])for(const field of ['prNumber','runId','runAttempt','workflowId']){
      const claim=structuredClaim(),expected=structuredPins(),obj=side==='claim'?claim:expected;
      if(field==='prNumber')obj[field]=value;else obj.ci[field]=value;
      fail(()=>validateStructuredReviewClaim(claim,expected),field==='prNumber'?'INVALID_PR_NUMBER':'INVALID_CI_IDENTITY');
    }
  }
  for(const [field,code] of [['schemaVersion','UNKNOWN_SCHEMA_VERSION'],['verdict','UNKNOWN_VERDICT'],['requestId','INVALID_SCOPE']]){
    const value={...structuredClaim(),[field]:hostile};fail(()=>validateStructuredReviewClaim(value,structuredPins()),code);
  }
  for(const field of ['status','conclusion']){const value=structuredClaim();value.ci[field]=hostile;fail(()=>validateStructuredReviewClaim(value,structuredPins()),'INVALID_CI_STATE');}
  assert.equal(calls,0);
});
test('CI action success never substitutes for a structured verdict, GREEN requires consistent completed success',()=>{
  const value=structuredClaim();delete value.verdict;
  fail(()=>validateStructuredReviewClaim(value,structuredPins()),'INVALID_SCHEMA');
  for(const status of ['queued','in_progress','completed'])for(const conclusion of [null,...STRUCTURED_REVIEW_CLAIM_SCHEMA.properties.ci.properties.conclusion.enum.filter(x=>x!==null)]){
    const claim=structuredClaim();Object.assign(claim.ci,{status,conclusion});
    const consistent=status==='completed'?conclusion!==null:conclusion===null;
    if(!consistent)fail(()=>validateStructuredReviewClaim(claim,structuredPins()),'INCONSISTENT_CI_STATE');
    else if(status!=='completed'||conclusion!=='success')fail(()=>validateStructuredReviewClaim(claim,structuredPins()),'GREEN_CI_CONFLICT');
    else denied(validateStructuredReviewClaim(claim,structuredPins()));
    claim.verdict='NEEDS_MORE_EVIDENCE';
    if(consistent)denied(validateStructuredReviewClaim(claim,structuredPins()));
  }
});
test('structured schema is deeply frozen, closed, bounded and describes implementation fields',()=>{
  const schema=STRUCTURED_REVIEW_CLAIM_SCHEMA;
  function frozen(x){if(x&&typeof x==='object'){assert.ok(Object.isFrozen(x));Object.values(x).forEach(frozen);}}
  frozen(schema);
  for(const obj of [schema,schema.properties.ci]){assert.equal(obj.additionalProperties,false);assert.deepEqual([...obj.required].sort(),Object.keys(obj.properties).sort());}
  assert.deepEqual([...schema.required].sort(),Object.keys(structuredClaim()).sort());
  assert.deepEqual([...schema.properties.ci.required].sort(),Object.keys(structuredClaim().ci).sort());
  assert.equal(schema.properties.prNumber.maximum,Number.MAX_SAFE_INTEGER);
  assert.equal(schema.properties.requestId.maxLength,128);
  assert.equal(schema.properties.headSha.maxLength,40);
  assert.throws(()=>schema.properties.verdict.enum.push('BLOCKED'),TypeError);
  const value=structuredClaim(),pins=structuredPins();value.prNumber=pins.prNumber=Number.MAX_SAFE_INTEGER;
  value.requestId=pins.requestId='R'.repeat(128);denied(validateStructuredReviewClaim(value,pins));
  fail(()=>validateStructuredReviewClaim(JSON.stringify(value),pins),'INVALID_OBJECT');
});
