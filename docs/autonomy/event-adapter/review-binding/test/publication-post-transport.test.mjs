import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicationPostTransport} from '../scripts/publication-post-transport.mjs';
const url='https://api.github.com/repos/Achi1984/meridian/issues/571/comments';
const response=(raw='{"id":3333}',extra={})=>({status:201,url,redirected:false,
 body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(raw));c.close();}}),...extra});
test('requires explicit trusted fetch; fixed one-shot POST and capture shape',async()=>{
 assert.throws(()=>createPublicationPostTransport());let calls=0;
 const post=createPublicationPostTransport({fetchFn:async(u,o)=>{calls++;assert.equal(u,url);
  assert.equal(o.method,'POST');assert.equal(o.redirect,'error');assert.equal(o.cache,'no-store');
  assert.equal(o.headers.authorization,'Bearer test_token');assert.equal(o.body,'{"body":"hello"}');
  return response();}});
 const out=await post({body:'hello'},'test_token');assert.equal(out.outcome,'RESPONSE_CAPTURED');
 assert.deepEqual(out.response,{status:201,url,redirected:false,comment:{id:3333}});
 for(const k of ['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable','sendAllowed'])assert.equal(out[k],false);
 assert.equal((await post({body:'hello'},'test_token')).outcome,'ALREADY_CONSUMED');assert.equal(calls,1);
});
test('invalid input and pre-abort do not invoke fetch or consume instance',async()=>{
 let calls=0;const post=createPublicationPostTransport({fetchFn:async()=>{calls++;return response();}});
 for(const [req,token] of [[{body:''},'x'],[{body:'💡'.repeat(2049)},'x'],[{body:'ok',url},'x'],[{body:'ok'},'x\r\ny'],[{body:'ok'},'x'.repeat(1025)]])
  assert.equal((await post(req,token)).outcome,'NOT_ATTEMPTED');
 assert.equal((await post({body:'ok'},'x',AbortSignal.abort())).outcome,'NOT_ATTEMPTED');assert.equal(calls,0);
 assert.equal((await post({body:'ok'},'x')).outcome,'RESPONSE_CAPTURED');
});
test('concurrent calls consume before await and snapshot body',async()=>{
 let release,calls=0,encoded;const post=createPublicationPostTransport({fetchFn:async(_u,o)=>{calls++;encoded=o.body;return new Promise(r=>release=r);}});
 const req={body:'original'};const pending=post(req,'x');req.body='changed';
 assert.equal((await post(req,'x')).outcome,'ALREADY_CONSUMED');release(response());
 assert.equal((await pending).outcome,'RESPONSE_CAPTURED');assert.equal(encoded,'{"body":"original"}');assert.equal(calls,1);
});
test('HTTP errors, redirects, foreign URL, malformed and oversized responses stay uncertain',async()=>{
 for(const make of [()=>response('{}',{status:429}),()=>response('{}',{redirected:true}),()=>response('{}',{url:url+'/evil'}),
  ()=>response('bad'),()=>response('null'),()=>response('[]'),()=>response(' '.repeat(131073)),
  ()=>response('',{body:new ReadableStream({start(c){c.enqueue(new Uint8Array([255]));c.close();}})})]){
  let calls=0;const post=createPublicationPostTransport({fetchFn:async()=>{calls++;return make();}});
  assert.equal((await post({body:'x'},'x')).outcome,'UNCERTAIN');
  assert.equal((await post({body:'x'},'x')).outcome,'ALREADY_CONSUMED');assert.equal(calls,1);
 }
});
test('network exceptions do not expose credentials or retry',async()=>{
 let calls=0;const post=createPublicationPostTransport({fetchFn:async()=>{calls++;throw Error('secret_test_token');}});
 const out=await post({body:'x'},'secret_test_token');assert.equal(out.outcome,'UNCERTAIN');assert.ok(!JSON.stringify(out).includes('secret'));
 assert.equal((await post({body:'x'},'secret_test_token')).outcome,'ALREADY_CONSUMED');assert.equal(calls,1);
});
test('parent abort ends hanging fetch and consumes instance',async()=>{
 const parent=new AbortController();let signal;
 const post=createPublicationPostTransport({fetchFn:(_u,o)=>{signal=o.signal;return new Promise(()=>{});}});
 const pending=post({body:'x'},'x',parent.signal);parent.abort();
 assert.equal((await pending).outcome,'UNCERTAIN');assert.equal(signal.aborted,true);
 assert.equal((await post({body:'x'},'x')).outcome,'ALREADY_CONSUMED');
});
test('deadline bounds a stalled response stream',async()=>{
 let cancelled=false;const post=createPublicationPostTransport({fetchFn:async()=>response('',{body:new ReadableStream({cancel(){cancelled=true;}})})});
 const start=Date.now();assert.equal((await post({body:'x'},'x')).outcome,'UNCERTAIN');
 assert.ok(Date.now()-start<6500);assert.equal(cancelled,true);
});
test('late response after abort is cancelled without capture',async()=>{
 let resolve,cancelled=false;const parent=new AbortController();
 const post=createPublicationPostTransport({fetchFn:()=>new Promise(r=>resolve=r)});
 const pending=post({body:'x'},'x',parent.signal);parent.abort();assert.equal((await pending).outcome,'UNCERTAIN');
 resolve(response('',{body:new ReadableStream({cancel(){cancelled=true;}})}));
 await new Promise(r=>setImmediate(r));assert.equal(cancelled,true);
});
