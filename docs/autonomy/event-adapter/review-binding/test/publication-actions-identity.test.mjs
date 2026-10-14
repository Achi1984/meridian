import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireActionsPublicationToken as acquire,createActionsPublicationIdentity} from '../scripts/publication-actions-identity.mjs';
const endpoint='https://runner.actions.githubusercontent.com/identity/token?api-version=2';
const config=()=>({requestUrl:endpoint,endpointPin:endpoint,requestToken:'REQUEST-SECRET',audience:'meridian-negative-publisher'});
const token='header.payload.signature';
const finalUrl=endpoint+'&audience=meridian-negative-publisher';
function response(value={value:token},overrides={}){
 return {status:200,url:finalUrl,redirected:false,
  body:new ReadableStream({start(c){c.enqueue(Buffer.from(typeof value==='string'?value:JSON.stringify(value)));c.close();}}),...overrides};
}
const failure={message:'publication identity rejected'};

test('manifest endpoint cannot replace missing independent runner URL',async()=>{
 const fetchFn=()=>assert.fail('must not fetch');
 await assert.rejects(acquire(config(),{fetchFn}),failure);
 await assert.rejects(createActionsPublicationIdentity({fetchFn})(config()),failure);
});

test('independent policy rejects even matching manifest and runner URLs outside allowed host family',async()=>{
 const hosts=['example.test','actions.githubusercontent.com','runner.actions.githubusercontent.com.evil.test',
  'evilactions.githubusercontent.com','runner.actions.githubusercontent.com.',
  '-bad.actions.githubusercontent.com','bad-.actions.githubusercontent.com',
  'bad_name.actions.githubusercontent.com','a'.repeat(64)+'.actions.githubusercontent.com'];
 const urls=hosts.map(host=>'https://'+host+'/identity');
 urls.push('http://runner.actions.githubusercontent.com/identity',
  'https://runner.actions.githubusercontent.com:444/identity',
  'https://runner.actions.githubusercontent.com:443/identity',
  'https://user@runner.actions.githubusercontent.com/identity',
  'https://runner.actions.githubusercontent.com/identity#');
 for(const runnerUrl of urls){
  const cfg={...config(),requestUrl:runnerUrl,endpointPin:runnerUrl};
  await assert.rejects(acquire(cfg,{runnerUrl,fetchFn:()=>assert.fail('must not fetch')}),failure);
 }
});

test('manifest cannot switch host, path or query even within allowed domain family',async()=>{
 for(const requestUrl of [endpoint.replace('runner.','other.'),endpoint.replace('/identity/','/other/'),endpoint+'&extra=1']){
  await assert.rejects(acquire({...config(),requestUrl,endpointPin:requestUrl},{runnerUrl:endpoint,
   fetchFn:()=>assert.fail('must not fetch')}),failure);
 }
});

test('factory snapshots independent URL before mutable configuration is supplied',async()=>{
 const options={runnerUrl:endpoint,fetchFn:async()=>response()};
 const identity=createActionsPublicationIdentity(options);
 options.runnerUrl='https://other.actions.githubusercontent.com/identity';
 assert.equal(await identity(config()),token);
 await assert.rejects(identity({...config(),requestUrl:options.runnerUrl,endpointPin:options.runnerUrl}),failure);
});

test('factory acquires syntactic token using explicit audience and request credential',async()=>{
 let calls=0;
 const identity=createActionsPublicationIdentity({runnerUrl:endpoint,fetchFn:async(url,options)=>{
  calls++;assert.equal(url,finalUrl);assert.equal(options.redirect,'error');
  assert.equal(options.cache,'no-store');assert.equal(options.method,'GET');
  assert.equal(options.headers.authorization,'Bearer REQUEST-SECRET');
  assert.equal(options.headers.accept,'application/json');assert.ok(options.signal instanceof AbortSignal);
  return response();
 }});
 assert.equal(await identity(config()),token);assert.equal(calls,1);
});

test('invalid configuration never sends a request',async()=>{
 const cases=[null,{}, {...config(),extra:true},{...config(),audience:'other'},
  {...config(),requestUrl:'https://evil.example/token'},
  {...config(),requestToken:''},{...config(),requestToken:'a\r\nb'},
  {...config(),requestToken:'a'.repeat(16385)}];
 for(const url of ['http://runner.example/token','https://user:pass@runner.example/token',
  endpoint+'#fragment',endpoint+'#','https://RUNNER.example.test/token','https://runner.example.test/a/../token',
  endpoint+'&audience=other'])cases.push({...config(),requestUrl:url,endpointPin:url});
 for(const cfg of cases)await assert.rejects(acquire(cfg,{runnerUrl:endpoint,fetchFn:()=>{assert.fail('must not fetch');}}),failure);
});

test('rejects redirect, mismatched response URL, status and absent stream',async()=>{
 for(const overrides of [{redirected:true},{url:'https://evil.example/token'},{status:302},{status:401},{body:null}]){
  await assert.rejects(acquire(config(),{runnerUrl:endpoint,fetchFn:async()=>response(undefined,overrides)}),failure);
 }
});

test('bounded streamed response cancels overflow',async()=>{
 let cancelled=false;
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(32769));},cancel(){cancelled=true;}});
 await assert.rejects(acquire(config(),{runnerUrl:endpoint,fetchFn:async()=>response(undefined,{body})}),failure);
 assert.equal(cancelled,true);
});

test('rejects malformed JSON, invalid token types and invalid token syntax',async()=>{
 for(const value of ['{','null','[]',{}, {value:null},{value:13},{value:''},{value:'a.b'},
  {value:'a.b.c\n'},{value:'a'.repeat(16380)+'.bbbb.cccc'}]){
  await assert.rejects(acquire(config(),{runnerUrl:endpoint,fetchFn:async()=>response(value)}),failure);
 }
});

test('rejects invalid UTF-8 without echoing response',async()=>{
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([0xff]));c.close();}});
 await assert.rejects(acquire(config(),{runnerUrl:endpoint,fetchFn:async()=>response(undefined,{body})}),failure);
});

test('fetch rejection is sanitized and contains no upstream cause',async()=>{
 await assert.rejects(acquire(config(),{runnerUrl:endpoint,fetchFn:async()=>{throw new Error('REQUEST-SECRET '+token);}}),error=>{
  assert.equal(error.message,failure.message);assert.equal(error.cause,undefined);
  assert.equal(error.stack.includes('REQUEST-SECRET'),false);assert.equal(error.stack.includes(token),false);return true;
 });
});

test('deadline rejects fetch that ignores abort and cancels late response',async()=>{
 let release,abortedSignal,cancelled=false;
 const pending=acquire(config(),{runnerUrl:endpoint,timeoutMs:10,fetchFn:(_url,options)=>{
  abortedSignal=options.signal;return new Promise(resolve=>{release=resolve;});
 }});
 await assert.rejects(pending,failure);assert.equal(abortedSignal.aborted,true);
 const body=new ReadableStream({cancel(){cancelled=true;}});
 release(response(undefined,{body}));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cancelled,true);
});

test('deadline bounds response reader ignoring cancellation',async()=>{
 let cancelled=false;
 const body={getReader(){return {read:()=>new Promise(()=>{}),cancel(){cancelled=true;return Promise.resolve();},releaseLock(){}};}};
 await assert.rejects(acquire(config(),{runnerUrl:endpoint,timeoutMs:10,fetchFn:async()=>response(undefined,{body})}),failure);
 assert.equal(cancelled,true);
});

test('pre-aborted parent never starts fetch',async()=>{
 const abort=new AbortController();abort.abort();
 await assert.rejects(acquire(config(),{runnerUrl:endpoint,signal:abort.signal,fetchFn:()=>assert.fail('must not fetch')}),failure);
});

test('parent cancellation aborts inflight request and ignores its late token',async()=>{
 const abort=new AbortController();let release,internalSignal;
 const pending=acquire(config(),{runnerUrl:endpoint,signal:abort.signal,fetchFn:(_url,options)=>{
  internalSignal=options.signal;return new Promise(resolve=>{release=resolve;});
 }});
 abort.abort();await assert.rejects(pending,failure);assert.equal(internalSignal.aborted,true);
 release(response());await new Promise(resolve=>setImmediate(resolve));
});

test('invalid deadlines cannot enlarge the fixed maximum',async()=>{
 for(const timeoutMs of [0,-1,5001,Infinity,1.5])await assert.rejects(acquire(config(),{runnerUrl:endpoint,timeoutMs,fetchFn:()=>assert.fail('must not fetch')}),failure);
});
