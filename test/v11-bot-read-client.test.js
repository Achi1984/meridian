import test from 'node:test';
import assert from 'node:assert/strict';
import {createBotReadClient} from '../v11/bot-read-client.js';

const TIME = Date.parse('2026-10-12T20:00:00Z');
const fixture = () => ({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
  source:'PIONEX_WALLET_BOT_DETAIL', sourceSnapshotAt:'2026-10-12T19:59:00Z',
  freshnessLimitMs:900000,readOnly:true,executionImpact:false,detailsComplete:true,
  sourceStatusOk:true,fresh:true,usableForOverwrite:true,botCount:1,
  bots:[{botRef:'a'.repeat(20),symbol:'BTC',side:'SHORT',cateType:'inverse',
    botType:'futures_grid',sideSource:'economic_inverse_asset'}]});
const response = (value=fixture()) => new Response(JSON.stringify(value));
const deferred = () => {let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness(extra={}) {
  const events=[];let credential='private-test-token';let clock=TIME;
  const client=createBotReadClient({getToken:()=>credential,onChange:s=>events.push(s),now:()=>clock,
    fetchImpl:async()=>response(),...extra});
  return {client,events, token:v=>{credential=v;},time:v=>{clock=v;}};
}
test('manual exact protected GET uses header only, exposes projected state',async()=>{
  const calls=[];
  const h=harness({fetchImpl:async(...args)=>{calls.push(args);return response();}});
  assert.equal(calls.length,0);
  await h.client.refresh();
  const [url,options]=calls[0];
  assert.equal(url,'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch');
  assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  assert.equal(options.headers.authorization,'Bearer private-test-token');
  assert.deepEqual(h.events.map(x=>x.status),['loading','fresh']);
  assert.equal(h.events.at(-1).model.bots[0].side,'SHORT');
  assert.doesNotMatch(JSON.stringify(h.events),/private-test-token/);
});
test('missing, malformed and throwing credentials lock without fetch',async()=>{
  for(const getToken of [()=>'',()=>null,()=>({}),()=> 'x\r\ny',()=> 'x'.repeat(4097),()=>{throw Error('secret');}]) {
    let calls=0;const h=harness({getToken,fetchImpl:()=>{calls++;}});
    await h.client.refresh();assert.equal(calls,0);assert.deepEqual(h.events,[{status:'locked',model:null}]);
  }
});
test('401 and 403 clear previously visible rows',async()=>{
  for(const status of [401,403]) {
    let calls=0;const h=harness({fetchImpl:async()=>++calls===1?response():new Response('secret',{status})});
    await h.client.refresh();await h.client.refresh();
    assert.deepEqual(h.events.at(-1),{status:'locked',model:null});
  }
});
test('stale source withholds rows and focus revalidation expires a fresh snapshot',async()=>{
  const h=harness();await h.client.refresh();h.time(TIME+900001);h.client.revalidate();
  assert.equal(h.events.at(-1).status,'stale');assert.deepEqual(h.events.at(-1).model.bots,[]);
  assert.equal('readIdentity' in h.events.at(-1),false);
  await h.client.refresh();assert.equal(h.events.at(-1).status,'stale');
});
test('same-read revalidation keeps an opaque identity while every explicit read gets a new one',async()=>{
  const h=harness();await h.client.refresh();
  const first=h.events.at(-1),firstIdentity=first.readIdentity;
  assert.equal(typeof firstIdentity,'symbol');
  h.client.revalidate();
  assert.equal(h.events.at(-1).status,'fresh');
  assert.notEqual(h.events.at(-1).model,first.model,'revalidation reprojects instead of caching a model');
  assert.equal(h.events.at(-1).readIdentity,firstIdentity);
  assert.doesNotMatch(JSON.stringify(h.events),/private-test-token/);
  await h.client.refresh();
  assert.equal(h.events.at(-1).status,'fresh');
  assert.notEqual(h.events.at(-1).readIdentity,firstIdentity,'explicit identical read starts a new identity');
  h.token('replacement-token');h.client.revalidate();
  assert.deepEqual(h.events.at(-1),{status:'locked',model:null});
});
test('lock invalidates ignored abort and late fetch resolution',async()=>{
  const d=deferred();const h=harness({fetchImpl:()=>d.promise});
  const work=h.client.refresh();h.client.lock();await work;
  d.resolve(response());await Promise.resolve();await Promise.resolve();
  assert.deepEqual(h.events.map(x=>x.status),['loading','locked']);
});
test('new request wins and old late response cannot overwrite it',async()=>{
  const d=deferred();let calls=0;const h=harness({fetchImpl:()=>++calls===1?d.promise:Promise.resolve(response())});
  const first=h.client.refresh();await h.client.refresh();await first;
  d.resolve(response({...fixture(),botCount:0,bots:[]}));await Promise.resolve();await Promise.resolve();
  assert.equal(h.events.at(-1).status,'fresh');assert.equal(h.events.at(-1).model.bots.length,1);
  assert.equal(h.events.filter(x=>x.status==='fresh').length,1);
});
test('logout or token replacement while pending cannot publish rows',async()=>{
  for(const next of ['', 'new-token']) {
    const d=deferred();const h=harness({fetchImpl:()=>d.promise});const work=h.client.refresh();
    h.token(next);d.resolve(response());await work;
    assert.deepEqual(h.events.at(-1),{status:'locked',model:null});
  }
});
test('revalidation aborts pending request after credential replacement',async()=>{
  const h=harness({fetchImpl:()=>new Promise(()=>{})});const work=h.client.refresh();
  h.token('new');h.client.revalidate();await work;assert.equal(h.events.at(-1).status,'locked');
});
test('stream and declared body bounds, invalid UTF8 and JSON fail generically',async()=>{
  for(const make of [()=>new Response('x'.repeat(262145)),
    ()=>new Response('{}',{headers:{'content-length':'262145'}}),
    ()=>new Response(new Uint8Array([0xc3,0x28])),()=>new Response('private-test-token'),
    ()=>new Response('secret',{status:500})]) {
    const h=harness({fetchImpl:async()=>make()});await h.client.refresh();
    assert.deepEqual(h.events.at(-1),{status:'unavailable',model:null});
    assert.doesNotMatch(JSON.stringify(h.events),/secret|private-test-token/);
  }
});
test('timeout settles even when fetch ignores cancellation',async()=>{
  let timeout;const h=harness({fetchImpl:()=>new Promise(()=>{}),
    schedule:(fn,ms)=>{assert.equal(ms,10000);timeout=fn;return 1;},cancelSchedule:()=>{}});
  const work=h.client.refresh();timeout();await work;
  assert.deepEqual(h.events.at(-1),{status:'unavailable',model:null});
});
test('transport exceptions never disclose credentials or server text',async()=>{
  const h=harness({fetchImpl:async()=>{throw Error('private-test-token secret');}});
  await h.client.refresh();assert.deepEqual(h.events.at(-1),{status:'unavailable',model:null});
});
test('timeout cancels a stalled response stream and clears visible rows',async()=>{
  let timeout,cancelled=false;
  const h=harness({fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})),
    schedule:fn=>{timeout=fn;return 1;},cancelSchedule:()=>{}});
  const work=h.client.refresh();await Promise.resolve();await Promise.resolve();timeout();await work;
  assert.equal(cancelled,true);assert.deepEqual(h.events.at(-1),{status:'unavailable',model:null});
});
test('dispose wipes, invalidates pending work and prevents later requests',async()=>{
  let calls=0;const h=harness({fetchImpl:()=>{calls++;return new Promise(()=>{});}});
  const work=h.client.refresh();h.client.dispose();await work;await h.client.refresh();h.client.revalidate();
  assert.equal(calls,1);assert.deepEqual(h.events.at(-1),{status:'locked',model:null});
});
test('consumer mutation cannot change retained source and throwing callbacks are contained',async()=>{
  const h=harness();await h.client.refresh();h.events.at(-1).model.bots[0].symbol='BAD';
  h.client.revalidate();assert.equal(h.events.at(-1).model.bots[0].symbol,'BTC');
  await harness({onChange:()=>{throw Error('consumer');}}).client.refresh();
});
test('reentrant lock during loading does not dispatch or leak rejection',async()=>{
  let client,calls=0;client=createBotReadClient({getToken:()=> 'token',fetchImpl:()=>{calls++;},
    onChange:state=>{if(state.status==='loading')client.lock();}});
  await client.refresh();assert.equal(calls,0);
});

const shareBase='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch';
const shareToken='a'.repeat(43);
const shareLink=shareBase+'?share='+shareToken;
test('scoped link performs one manual fixed GET with no bearer or credential disclosure',async()=>{
 const calls=[];const h=harness({fetchImpl:async(...args)=>{calls.push(args);return response();}});
 h.token(shareLink);assert.equal(calls.length,0);await h.client.refresh();
 assert.equal(calls.length,1);assert.equal(calls[0][0],shareLink);
 assert.equal(calls[0][1].headers.authorization,undefined);
 assert.equal(calls[0][1].redirect,'error');assert.equal(calls[0][1].referrerPolicy,'no-referrer');
 assert.equal(h.events.at(-1).status,'fresh');assert.ok(!JSON.stringify(h.events).includes(shareToken));
});
test('foreign, noncanonical and malformed share URLs never fetch or fall back to bearer',async()=>{
 const invalid=[shareLink+'&x=1',shareLink+'&share='+shareToken,shareLink+'#x',shareLink+'#',
 shareBase+'?share=',shareBase+'?share='+'a'.repeat(42),shareBase+'?share='+'a'.repeat(44),
 shareBase+'?share=%61'+ 'a'.repeat(42),shareBase+'?share='+shareToken+'=',
 shareLink.replace('https:','http:'),shareLink.replace('.code.run','.code.run.evil'),
 shareLink.replace('https://','https://user@'),shareLink.replace('.run/','.run:443/'),
 shareLink.replace('/api/','/x/../api/'),shareLink.replace('/api/','//api/'),
 shareLink.replace('https://','//'), 'www.evil.test/?share='+shareToken,
 shareLink.replace('/asset-watch?','/asset-watch/?'),shareLink.replace('?share=','?SHARE=')];
 for(const input of invalid){let calls=0;const h=harness({fetchImpl:async()=>{calls++;return response();}});
 h.token(input);await h.client.refresh();assert.equal(calls,0,input);assert.equal(h.events.at(-1).status,'locked');}
});
test('share authentication rejection locks and late share replies cannot restore locked data',async()=>{
 for(const status of [401,403]){const h=harness({fetchImpl:async()=>new Response('',{status})});
 h.token(shareLink);await h.client.refresh();assert.equal(h.events.at(-1).status,'locked');}
 const d=deferred();const h=harness({fetchImpl:()=>d.promise});h.token(shareLink);
 const work=h.client.refresh();h.client.lock();await work;d.resolve(response());await Promise.resolve();
 assert.equal(h.events.at(-1).status,'locked');
});
