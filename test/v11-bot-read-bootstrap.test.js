import test from 'node:test';
import assert from 'node:assert/strict';
import {mountBotReadAccess} from '../v11/bot-read-bootstrap.js';
import {createBotReadClient} from '../v11/bot-read-client.js';
const credentials=['synthetic-token','https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch?share='+'a'.repeat(43)];
class Target {
  constructor(){this.listeners=new Map();this.value='';this.textContent='';}
  addEventListener(k,f){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(f);}
  removeEventListener(k,f){this.listeners.get(k)?.delete(f);}
  fire(k){for(const f of this.listeners.get(k)||[])f();}
}
function setup(){
  const nodes=new Map(['bot-read-root','bot-read-token','bot-read-provide','bot-read-access-status'].map(id=>[id,new Target()]));
  const document=new Target(),window=new Target();document.getElementById=id=>nodes.get(id);document.hidden=false;
  let client,credential;const states=[],calls={fetch:0,revalidate:0};
  const mounted=mountBotReadAccess(document,window,{createClient:options=>{
    credential=options.getToken;
    return {lock(){states.push('locked');},refresh(){calls.fetch++;},revalidate(){calls.revalidate++;},dispose(){}};
  },createView:(_root,options)=>{client=options.createClient({getToken:options.getToken});return {revalidate:()=>client.revalidate(),dispose:()=>client.dispose()};}});
  return {nodes,document,window,mounted,calls,states,getToken:()=>credential(),client:()=>client};
}
test('mount and explicit credential provision never start a request; field is cleared',()=>{
  const h=setup();assert.equal(h.calls.fetch,0);assert.equal(h.getToken(),null);
  h.nodes.get('bot-read-token').value=' synthetic-token ';h.nodes.get('bot-read-provide').fire('click');
  assert.equal(h.getToken(),'synthetic-token');assert.equal(h.nodes.get('bot-read-token').value,'');assert.equal(h.calls.fetch,0);
  assert.doesNotMatch(h.nodes.get('bot-read-access-status').textContent,/synthetic-token/);
  h.client().refresh();assert.equal(h.calls.fetch,1);
});
test('view lock, pagehide and hidden revoke memory through client lock',()=>{
  for(const credential of credentials) for(const trigger of [h=>h.client().lock(),h=>h.window.fire('pagehide'),h=>{h.document.hidden=true;h.document.fire('visibilitychange');}]){
    const h=setup();h.nodes.get('bot-read-token').value=credential;h.nodes.get('bot-read-provide').fire('click');
    const prior=h.states.length;trigger(h);assert.equal(h.getToken(),null);assert.ok(h.states.length>prior);
  }
});
test('focus and pageshow revalidate without requesting; disposal removes listeners',()=>{
  const h=setup();h.window.fire('focus');h.window.fire('pageshow');assert.equal(h.calls.revalidate,2);assert.equal(h.calls.fetch,0);
  h.mounted.dispose();h.window.fire('focus');assert.equal(h.calls.revalidate,2);
});
test('invalid replacement clears old credential and has generic user status',()=>{
  const h=setup();const input=h.nodes.get('bot-read-token'),button=h.nodes.get('bot-read-provide');
  input.value='valid';button.fire('click');input.value='bad\nsecret';button.fire('click');
  assert.equal(h.getToken(),null);assert.equal(input.value,'');assert.match(h.nodes.get('bot-read-access-status').textContent,/nicht übernommen/);
});
test('actual read client aborts pending refresh on pagehide and loses its credential',async()=>{
  const document=new Target(),window=new Target(),nodes=new Map(['bot-read-root','bot-read-token','bot-read-provide','bot-read-access-status'].map(id=>[id,new Target()]));
  document.getElementById=id=>nodes.get(id);let client,getToken,signal,calls=0;const states=[];
  const mounted=mountBotReadAccess(document,window,{createClient:options=>{
    getToken=options.getToken;
    return createBotReadClient({...options,onChange:state=>states.push(state.status),fetchImpl:async(_url,options)=>{calls++;signal=options.signal;return new Promise(()=>{});}});
  },createView:(_root,options)=>{client=options.createClient({getToken:options.getToken});return {revalidate:()=>client.revalidate(),dispose:()=>client.dispose()};}});
  nodes.get('bot-read-token').value='synthetic-token';nodes.get('bot-read-provide').fire('click');
  assert.equal(calls,0);const pending=client.refresh();assert.equal(calls,1);
  window.fire('pagehide');await pending;
  assert.equal(signal.aborted,true);assert.equal(getToken(),null);assert.equal(states.at(-1),'locked');
  window.fire('focus');window.fire('pageshow');assert.equal(calls,1);mounted.dispose();
});
test('validated short expiry invalidates once without fetching and lock cancels the deadline',async()=>{
  const document=new Target(),window=new Target(),nodes=new Map(['bot-read-root','bot-read-token','bot-read-provide','bot-read-access-status'].map(id=>[id,new Target()]));
  document.getElementById=id=>nodes.get(id);
  let client,clock=Date.parse('2026-10-13T00:00:00Z'),reads=0,nextTimer=0;
  const timers=new Map(),states=[];
  const mounted=mountBotReadAccess(document,window,{now:()=>clock,
    schedule:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;},cancelSchedule:id=>timers.delete(id),
    createClient:options=>createBotReadClient({...options,now:()=>clock,fetchImpl:async()=>{
      reads++;return new Response(JSON.stringify({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',source:'PIONEX_BOT_API',
        sourceSnapshotAt:new Date(clock).toISOString(),freshnessLimitMs:2000,readOnly:true,executionImpact:false,
        detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,botCount:0,bots:[]}));
    }}),createView:(_root,options)=>{client=options.createClient({getToken:options.getToken,onChange:state=>states.push(state.status)});return {revalidate:()=>client.revalidate(),dispose:()=>client.dispose()};}});
  nodes.get('bot-read-token').value='synthetic-token';nodes.get('bot-read-provide').fire('click');await client.refresh();
  assert.equal(states.at(-1),'fresh');assert.equal(timers.size,1);
  const first=[...timers.values()][0];assert.equal(first.delay,2001);timers.clear();clock+=2001;first.fn();
  assert.equal(states.at(-1),'stale');assert.equal(reads,1);assert.equal(timers.size,0);
  await client.refresh();assert.equal(timers.size,1);const late=[...timers.values()][0];
  client.lock();assert.equal(timers.size,0);late.fn();assert.equal(states.at(-1),'locked');assert.equal(reads,2);
  mounted.dispose();
});
test('actual 401 and 403 revoke the rejected credential until explicitly provided again',async()=>{
  for(const credential of credentials) for(const statusCode of [401,403]) {
    const document=new Target(),window=new Target(),nodes=new Map(['bot-read-root','bot-read-token','bot-read-provide','bot-read-access-status'].map(id=>[id,new Target()]));
    document.getElementById=id=>nodes.get(id);let client,getToken,reads=0;const states=[];
    const mounted=mountBotReadAccess(document,window,{createClient:options=>{
      getToken=options.getToken;
      return createBotReadClient({...options,fetchImpl:async()=>{reads++;return new Response('private-server-error',{status:statusCode});}});
    },createView:(_root,options)=>{client=options.createClient({getToken:options.getToken,onChange:state=>states.push(state.status)});return {revalidate:()=>client.revalidate(),dispose:()=>client.dispose()};}});
    const input=nodes.get('bot-read-token'),provide=nodes.get('bot-read-provide');
    input.value=credential;provide.fire('click');
    assert.equal(getToken(),credential,'access-driven initial lock must not invalidate provision');
    await client.refresh();assert.equal(reads,1);assert.equal(getToken(),null);assert.equal(states.at(-1),'locked');
    assert.equal(nodes.get('bot-read-access-status').textContent,'Gesperrt. Der Lesezugang wird nicht gespeichert.');
    await client.refresh();assert.equal(reads,1,'rejected credential must not be retried');
    input.value='replacement-token';provide.fire('click');assert.equal(getToken(),'replacement-token');
    await client.refresh();assert.equal(reads,2);assert.equal(getToken(),null);
    assert.doesNotMatch(nodes.get('bot-read-access-status').textContent,/synthetic-token|replacement-token|private-server-error/);
    mounted.dispose();
  }
});
