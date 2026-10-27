import test from 'node:test';
import assert from 'node:assert/strict';
import {mountBotReadAccess} from '../v11/bot-read-bootstrap.js';
import {createBotReadClient} from '../v11/bot-read-client.js';

class Target{
  constructor(){this.listeners=new Map();this.textContent='';}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  fire(name){for(const fn of this.listeners.get(name)||[])fn();}
}
function makeAccess(){
  let credential=null;const readers=new Set();
  return {
    getToken:()=>credential,isUnlocked:()=>credential!==null,
    set(value){credential=value;},
    lock(){credential=null;for(const clear of readers)clear();},
    registerReader(clear){readers.add(clear);return ()=>readers.delete(clear);}
  };
}
function setup({createClient:factory,now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout}={}){
  const nodes=new Map(['bot-read-root','command-bot-overview'].map(id=>[id,new Target()]));
  const document=new Target(),window=new Target();document.getElementById=id=>nodes.get(id);
  const access=makeAccess();let client,view;
  const mounted=mountBotReadAccess(document,window,{access,now,schedule,cancelSchedule,
    createClient:factory||((options)=>({
      lock(){options.onChange({status:'locked'});},refresh(){return options.getToken();},
      revalidate(){},dispose(){}
    })),
    createView:(_root,options)=>{
      client=options.createClient({getToken:options.getToken,onChange:state=>view?.onChange?.(state)});
      return view={revalidate:()=>client.revalidate(),dispose:()=>client.dispose()};
    }});
  return {nodes,document,window,access,mounted,client:()=>client};
}

test('mount shares the verified credential and keeps reads manual',async()=>{
  const h=setup();h.access.set('verified-password');
  assert.equal(h.client().refresh(),'verified-password');
  assert.equal(h.access.getToken(),'verified-password');
});

test('explicit bot lock invalidates shared app access and every reader',()=>{
  const h=setup();h.access.set('verified-password');
  h.client().lock();
  assert.equal(h.access.getToken(),null);
});

test('bot freshness deadline revalidates without polling; shared lock cancels it',async()=>{
  let clock=Date.parse('2026-10-13T00:00:00Z'),reads=0,next=0;
  const timers=new Map(),states=[];
  const h=setup({now:()=>clock,
    schedule:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},
    cancelSchedule:id=>timers.delete(id),
    createClient:options=>createBotReadClient({...options,now:()=>clock,
      onChange:state=>{states.push(state.status);options.onChange(state);},
      fetchImpl:async()=>{
        reads++;
        return new Response(JSON.stringify({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',source:'PIONEX_BOT_API',
          sourceSnapshotAt:new Date(clock).toISOString(),freshnessLimitMs:2000,readOnly:true,executionImpact:false,
          detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,botCount:0,bots:[]}));
      }})
  });
  h.access.set('verified-password');await h.client().refresh();
  assert.equal(states.at(-1),'fresh');assert.equal(timers.size,1);
  const [id,timer]=[...timers.entries()][0];assert.equal(timer.delay,2001);
  timers.delete(id);clock+=2001;timer.fn();
  assert.equal(states.at(-1),'stale');assert.equal(reads,1);
  await h.client().refresh();assert.equal(timers.size,1);
  h.access.lock();assert.equal(timers.size,0);
  assert.equal(states.at(-1),'locked');assert.equal(reads,2);
  h.mounted.dispose();
});

test('401 and 403 from a manual bot read revoke the shared credential',async()=>{
  for(const status of [401,403]){
    const h=setup({createClient:options=>createBotReadClient({...options,
      fetchImpl:async()=>new Response('private response body',{status})})});
    h.access.set('verified-password');
    await h.client().refresh();
    assert.equal(h.access.getToken(),null);
    h.mounted.dispose();
  }
});

test('disposing the bot mount unregisters listeners and reader ownership',()=>{
  const h=setup();h.mounted.dispose();h.access.set('still-app-owned');
  assert.equal(h.access.getToken(),'still-app-owned');
});
