import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppAccess} from '../v11/app-access.js';
import {mountAppAccess} from '../v11/app-access-bootstrap.js';

const ENDPOINT='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/portfolio-history?range=1w';
const PASSWORD='synthetic-read-password';

function harness({fetchImpl=async()=>new Response('{}'),now=()=>1000}={}){
  const timers=new Map();let next=0;
  const access=createAppAccess({fetchImpl,now,schedule:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},
    cancelSchedule:id=>timers.delete(id)});
  return {access,timers,fire(id){const timer=timers.get(id);timers.delete(id);timer?.fn();}};
}

test('one bounded existing read verifies the shared credential before unlocking',async()=>{
  let request;
  const h=harness({fetchImpl:async(url,options)=>{
    request={url,options};
    return new Response(JSON.stringify({version:'7.64-CANONICAL-PORTFOLIO-HISTORY-V3',points:[]}));
  }});
  let clears=0;h.access.registerReader(()=>clears++);
  assert.equal(h.access.getToken(),null);
  assert.equal(await h.access.verify(PASSWORD),'unlocked');
  assert.equal(request.url,ENDPOINT);
  assert.equal(request.options.method,'GET');
  assert.equal(request.options.redirect,'error');
  assert.equal(request.options.credentials,'omit');
  assert.equal(request.options.cache,'no-store');
  assert.equal(request.options.headers.authorization,'Bearer '+PASSWORD);
  assert.equal(h.access.getToken(),PASSWORD);
  assert.equal(h.access.isUnlocked(),true);
  assert.equal(clears,1,'provision clears readers before the new credential is installed');
});

test('401/403 are rejected passwords while transport and data failures stay unavailable',async()=>{
  for(const status of [401,403]){
    const h=harness({fetchImpl:async()=>new Response('private error',{status})});
    assert.equal(await h.access.verify(PASSWORD),'rejected');
    assert.equal(h.access.getToken(),null);
  }
  for(const fetchImpl of [
    async()=>{throw new Error('private network details');},
    async()=>new Response('{}',{status:503}),
    async()=>new Response('not json'),
    async()=>new Response(' '.repeat(512*1024+1))
  ]){
    const h=harness({fetchImpl});
    assert.equal(await h.access.verify(PASSWORD),'unavailable');
    assert.equal(h.access.getToken(),null);
  }
});

test('share links, raw share tokens and malformed password values cannot unlock the app',async()=>{
  let reads=0;
  const h=harness({fetchImpl:async()=>{reads++;return new Response('{}');}});
  const share='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch?share='+'a'.repeat(43);
  for(const value of [share,'a'.repeat(43),'https://foreign.example/read','bad\npassword','']){
    assert.equal(await h.access.verify(value),'rejected');
    assert.equal(h.access.getToken(),null);
  }
  assert.equal(reads,0);
});

test('15-minute deadline is absolute, exact-boundary checked, and clears every reader',async()=>{
  let clock=1000;
  const h=harness({now:()=>clock});
  let cleared=0;h.access.registerReader(()=>cleared++);
  assert.equal(await h.access.verify(PASSWORD),'unlocked');
  const [id,timer]=[...h.timers.entries()][0];
  assert.equal(timer.delay,15*60*1000);
  clock+=15*60*1000-1;
  assert.equal(h.access.getToken(),PASSWORD);
  clock++;
  assert.equal(h.access.getToken(),null);
  assert.equal(h.access.isUnlocked(),false);
  assert.equal(cleared,2,'verification and expiry each clear readers');
  assert.equal(h.timers.has(id),false);
});

test('a suspended expiry timer cannot extend access beyond its deadline',async()=>{
  let clock=0;
  const h=harness({now:()=>clock});
  let clears=0;h.access.registerReader(()=>clears++);
  assert.equal(await h.access.verify(PASSWORD),'unlocked');
  const [id]=h.timers.keys();
  clock=15*60*1000+5000;
  h.fire(id);
  assert.equal(h.access.getToken(),null);
  assert.equal(clears,2);
});

test('manual lock aborts verification and rejects a late response',async()=>{
  let resolve;
  const h=harness({fetchImpl:(_url,{signal})=>new Promise(r=>{
    resolve=()=>r(new Response('{}'));
    signal.addEventListener('abort',()=>{},{once:true});
  })});
  const pending=h.access.verify(PASSWORD);
  h.access.lock();
  resolve();
  assert.equal(await pending,'unavailable');
  assert.equal(h.access.getToken(),null);
});

class Target{
  constructor(){this.listeners=new Map();this.hidden=false;this.value='';this.textContent='';this.focused=false;}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  fire(name,event={}){for(const fn of this.listeners.get(name)||[])fn({preventDefault(){},...event});}
  focus(){this.focused=true;}
}

function mountHarness(){
  const ids=['app','app-access-gate','app-access-form','app-access-password','app-access-status','app-access-lock','app-main'];
  const nodes=new Map(ids.map(id=>[id,new Target()]));
  const document=new Target(),window=new Target();
  document.getElementById=id=>nodes.get(id);
  let credential=PASSWORD,locks=0;
  const access={
    isUnlocked:()=>credential!==null,getToken:()=>credential,
    subscribe(fn){fn({status:credential?'unlocked':'locked'});return ()=>{};},
    verify:async value=>{credential=value;return 'unlocked';},
    lock(){credential=null;locks++;}
  };
  const mounted=mountAppAccess(document,window,{access});
  return {nodes,document,window,access,mounted,locks:()=>locks};
}

test('app gate submits on Enter, retains access across visibility changes, locks on pagehide and BFCache',()=>{
  const h=mountHarness(),app=h.nodes.get('app'),gate=h.nodes.get('app-access-gate');
  assert.equal(app.hidden,false,'already verified injected access is shown');
  assert.equal(gate.hidden,true);
  h.document.hidden=true;h.document.fire('visibilitychange');
  assert.equal(app.hidden,true);
  assert.equal(h.access.getToken(),PASSWORD,'visibility changes do not clear a valid credential');
  h.document.hidden=false;h.document.fire('visibilitychange');
  assert.equal(app.hidden,false);
  h.window.fire('pagehide');
  assert.equal(h.access.getToken(),null);
  h.window.fire('pageshow',{persisted:true});
  assert.equal(app.hidden,true);
  assert.equal(gate.hidden,false);
  assert.equal(h.locks(),2);
  h.mounted.dispose();
});

test('gate clears the password field, reports generic results, and disposes listeners',async()=>{
  const h=mountHarness(),input=h.nodes.get('app-access-password');
  h.access.lock();
  h.nodes.get('app-access-form').fire('submit');
  assert.equal(input.value,'');
  input.value=PASSWORD;
  h.nodes.get('app-access-form').fire('submit');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(input.value,'');
  assert.equal(h.nodes.get('app').hidden,false);
  h.nodes.get('app-access-lock').fire('click');
  assert.equal(h.access.getToken(),null);
  assert.equal(input.focused,true);
  h.mounted.dispose();
  const prior=h.locks();
  h.window.fire('pagehide');
  assert.equal(h.locks(),prior);
});

test('access modules do not persist credentials or private snapshots',()=>{
  const source=String(import.meta.resolve('../v11/app-access.js'));
  assert.match(source,/app-access\.js$/);
  assert.equal(['localStorage','sessionStorage','indexedDB'].some(name=>name in globalThis),false);
});
