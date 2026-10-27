import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

test('share links, URL-shaped credentials and malformed password values are rejected before verification',async()=>{
  let reads=0;
  const h=harness({fetchImpl:async()=>{reads++;return new Response('{}');}});
  const share='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch?share='+'a'.repeat(43);
  for(const value of [share,'https://foreign.example/read','bad\npassword','']){
    assert.equal(await h.access.verify(value),'rejected');
    assert.equal(h.access.getToken(),null);
  }
  assert.equal(reads,0);
});

test('43-character bearer passwords, including raw share-shaped values, are server-validated',async()=>{
  const bearer='a'.repeat(43);
  let request;
  const accepted=harness({fetchImpl:async(url,options)=>{
    request={url,options};
    return new Response(JSON.stringify({version:'7.64-CANONICAL-PORTFOLIO-HISTORY-V3',points:[]}));
  }});
  assert.equal(await accepted.access.verify(bearer),'unlocked');
  assert.equal(request.url,ENDPOINT);
  assert.equal(request.options.headers.authorization,'Bearer '+bearer);
  assert.equal(accepted.access.getToken(),bearer);

  let rejectedRequest;
  const rawShare=harness({fetchImpl:async(url,options)=>{
    rejectedRequest={url,options};
    return new Response('unauthorized',{status:401});
  }});
  assert.equal(await rawShare.access.verify('s'.repeat(43)),'rejected');
  assert.equal(rejectedRequest.url,ENDPOINT);
  assert.equal(rejectedRequest.options.headers.authorization,'Bearer '+'s'.repeat(43));
  assert.equal(rawShare.access.getToken(),null);
});

test('failed verification publishes locked state without publishing over a newer generation',async()=>{
  const h=harness({fetchImpl:async()=>new Response('{}',{status:403})});
  const states=[];
  h.access.subscribe(state=>states.push(state.status));
  assert.equal(await h.access.verify(PASSWORD),'rejected');
  assert.deepEqual(states.slice(-3),['locked','checking','locked']);

  let resolve;
  const pendingHarness=harness({fetchImpl:()=>new Promise(r=>{resolve=()=>r(new Response('{}'));})});
  const pendingStates=[];
  pendingHarness.access.subscribe(state=>pendingStates.push(state.status));
  const pending=pendingHarness.access.verify(PASSWORD);
  pendingHarness.access.lock();
  resolve();
  assert.equal(await pending,'unavailable');
  assert.equal(pendingStates.at(-1),'locked');
  assert.deepEqual(pendingStates.slice(-3),['locked','checking','locked']);
});

test('shared reader revalidation is synchronous and does not outlive the access deadline',async()=>{
  let clock=1000,bot=0,depot=0;
  const h=harness({now:()=>clock});
  h.access.registerReader(()=>{},()=>bot++);
  h.access.registerReader(()=>{},()=>depot++);
  await h.access.verify(PASSWORD);
  assert.equal(h.access.revalidateReaders(),true);
  assert.deepEqual([bot,depot],[1,1]);
  clock=1000+15*60*1000;
  assert.equal(h.access.revalidateReaders(),false);
  assert.deepEqual([bot,depot],[1,1]);
  assert.equal(h.access.getToken(),null);
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

test('verification timeout aborts the request and remains a data-unavailable result',async()=>{
  let signal;
  const h=harness({fetchImpl:(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  const pending=h.access.verify(PASSWORD);
  const [id]=h.timers.keys();
  h.fire(id);
  assert.equal(await pending,'unavailable');
  assert.equal(signal.aborted,true);
  assert.equal(h.access.getToken(),null);
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

function mountHarness({initialCredential=PASSWORD,verifyResult='unlocked',revalidateReaders=()=>{},access:providedAccess}={}){
  const ids=['app','app-access-gate','app-access-form','app-access-password','app-access-status','app-access-lock','app-main'];
  const nodes=new Map(ids.map(id=>[id,new Target()]));
  const document=new Target(),window=new Target();
  document.getElementById=id=>nodes.get(id);
  let credential=initialCredential,locks=0;const subscribers=new Set();
  const publish=()=>{for(const listener of subscribers)listener({status:credential?'unlocked':'locked'});};
  const access=providedAccess||{
    isUnlocked:()=>credential!==null,getToken:()=>credential,
    revalidateReaders,
    subscribe(fn){subscribers.add(fn);fn({status:credential?'unlocked':'locked'});return ()=>subscribers.delete(fn);},
    verify:async value=>{if(verifyResult==='unlocked')credential=value;publish();return verifyResult;},
    lock(){credential=null;locks++;publish();}
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

test('foreground, focus, and pageshow reproject both private readers before access is shown',()=>{
  let clock=1000,bot='fresh',depot='fresh',command='fresh',reads=0,calls=0,app,canAssertOrder=false;
  const revalidateReaders=()=>{
    calls++;
    if(canAssertOrder)assert.equal(app.hidden,true,'private shell remains hidden during synchronous revalidation');
    const status=clock>2000?'stale':'fresh';
    bot=status;depot=status;command=status;
  };
  const h=mountHarness({revalidateReaders});
  app=h.nodes.get('app');
  const initialCalls=calls;
  canAssertOrder=true;
  h.document.hidden=true;h.document.fire('visibilitychange');
  clock=2001;
  h.document.hidden=false;h.document.fire('visibilitychange');
  assert.equal(h.access.isUnlocked(),true,'source freshness expiry does not end the app session');
  assert.deepEqual([bot,depot,command],['stale','stale','stale']);
  assert.equal(reads,0,'resume only reprojects cached data');
  assert.equal(calls,initialCalls+1,'foreground return revalidates before showing the app');
  canAssertOrder=false;
  h.window.fire('focus');
  h.window.fire('pageshow');
  assert.equal(calls,initialCalls+3,'focus and pageshow each revalidate');
  assert.deepEqual([bot,depot,command],['stale','stale','stale']);
  assert.equal(reads,0);
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
  assert.equal(h.nodes.get('app').hidden,true);
  assert.equal(input.focused,true);
  h.mounted.dispose();
  const prior=h.locks();
  h.window.fire('pagehide');
  assert.equal(h.locks(),prior);
});

test('unsubmitted password is cleared on global lock, pagehide, BFCache restoration, and disposal',()=>{
  const h=mountHarness({initialCredential:null}),input=h.nodes.get('app-access-password');
  input.value='unsubmitted-secret';h.window.fire('pagehide');
  assert.equal(input.value,'');
  input.value='unsubmitted-secret';h.window.fire('pageshow',{persisted:true});
  assert.equal(input.value,'');
  input.value='unsubmitted-secret';h.access.lock();
  assert.equal(input.value,'');
  input.value='unsubmitted-secret';h.mounted.dispose();
  assert.equal(input.value,'');
});

test('expiry clears an unsubmitted password through the shared locked-state publication',async()=>{
  let clock=1000;
  const access=createAppAccess({now:()=>clock,fetchImpl:async()=>new Response('{}')});
  assert.equal(await access.verify(PASSWORD),'unlocked');
  const h=mountHarness({access});
  const input=h.nodes.get('app-access-password');input.value='unsubmitted-secret';
  clock=1000+15*60*1000;
  assert.equal(access.isUnlocked(),false);
  assert.equal(input.value,'');
  h.mounted.dispose();
});

test('rejected and unavailable states are distinct and never include the submitted value',async()=>{
  for(const [result,message] of [
    ['rejected','Passwort nicht akzeptiert. Bitte erneut versuchen.'],
    ['unavailable','Zugang derzeit nicht verfügbar. Bitte Verbindung prüfen und erneut versuchen.']
  ]){
    const h=mountHarness({initialCredential:null,verifyResult:result});
    const input=h.nodes.get('app-access-password');input.value='not-the-password';
    h.nodes.get('app-access-form').fire('submit');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.nodes.get('app-access-status').textContent,message);
    assert.doesNotMatch(h.nodes.get('app-access-status').textContent,/not-the-password/);
    assert.equal(input.value,'');
    assert.equal(h.nodes.get('app').hidden,true);
    h.mounted.dispose();
  }
});

test('Escape clears the masked entry without disclosing or submitting it',()=>{
  const h=mountHarness({initialCredential:null});
  const input=h.nodes.get('app-access-password');input.value=PASSWORD;
  h.document.fire('keydown',{key:'Escape'});
  assert.equal(input.value,'');
  assert.equal(h.access.getToken(),null);
  h.mounted.dispose();
});

test('access modules do not persist credentials or private snapshots',()=>{
  const source=readFileSync(new URL('../v11/app-access.js',import.meta.url),'utf8')+
    readFileSync(new URL('../v11/app-access-bootstrap.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|document\.cookie|location\.href/);
});
