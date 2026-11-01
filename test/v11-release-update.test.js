import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createReleaseUpdate,readReleaseHtml,readReleaseSources,mountReleaseUpdate} from '../v11/release-update.js';

const names=['app-access-bootstrap.js','bot-read-bootstrap.js','depot-read-bootstrap.js',
  'strategy-workspace-bootstrap.js','agent-status-bootstrap.js'];
const sources=release=>names.map(name=>`./${name}?v=${release}`);
const html=release=>'<meta name="meridian-ui-generation" content="11-preview">'+
  sources(release).map(src=>`<script type="module" src="${src}"></script>`).join('');
const response=release=>new Response(html(release),{headers:{'content-type':'text/html; charset=utf-8'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(options={}){
  let clock=1000,safe=true;
  const requests=[],navigation=[],updates=[],timers=new Map();let serial=0;
  const update=createReleaseUpdate({currentRelease:'B16-M11-FIX12',
    currentUrl:'https://example.test/meridian/v11/?view=bots#view-bots',
    now:()=>clock,canReload:()=>safe,navigate:url=>navigation.push(url),onUpdate:value=>updates.push(value),
    schedule:fn=>{timers.set(++serial,fn);return serial;},cancelSchedule:id=>timers.delete(id),
    fetchImpl:async(url,init)=>{requests.push({url,init});return response('B16-M11-FIX13');},...options});
  return {update,requests,navigation,updates,timers,setSafe:value=>{safe=value;},advance:()=>{clock+=60000;}};
}

test('release identity requires exactly five coherent approved local entries',()=>{
  assert.equal(readReleaseSources(sources('B16-M11-FIX12')),'B16-M11-FIX12');
  assert.equal(readReleaseHtml(html('B17-M11')),'B17-M11');
  for(const invalid of [[],sources('B16-M11-FIX12').slice(1),[...sources('B16-M11-FIX12'),'./extra.js?v=B16-M11-FIX12'],
    [...sources('B16-M11-FIX12').slice(1),sources('B16-M11-FIX12')[1]],
    sources('B16-M11-FIX12').map((s,i)=>i===0?s.replace('FIX12','FIX13'):s),
    sources('B16-M11-FIX12').map(s=>s.replace('./','https://other.test/')),
    sources('B0-M11'),sources('B16-M11-FIX0')])assert.equal(readReleaseSources(invalid),null);
  assert.equal(readReleaseHtml(html('B17-M11').replace('11-preview','10')),null);
  assert.equal(readReleaseHtml('x'.repeat(128*1024+1)),null);
});

test('served index is recognized without a second manually maintained version manifest',()=>{
  assert.equal(readReleaseHtml(readFileSync(new URL('../v11/index.html',import.meta.url),'utf8')),'B16-M11-FIX12');
});

test('locked safe tab checks only public HTML without credentials and reloads a newer release once',async()=>{
  const f=fixture();await f.update.check();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'https://example.test/meridian/v11/index.html');
  const init=f.requests[0].init;
  assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
  assert.equal(init.referrerPolicy,'no-referrer');assert.deepEqual(init.headers,{accept:'text/html'});
  assert.deepEqual(f.navigation,['https://example.test/meridian/v11/?view=bots&m11build=B16-M11-FIX13#view-bots']);
  f.advance();await f.update.check();f.update.reconsider();assert.equal(f.navigation.length,1);
  assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
});

test('same release, older CDN response and incoherent release never reload',async()=>{
  for(const value of ['B16-M11-FIX12','B16-M11-FIX9','B15-M11']){
    const f=fixture({fetchImpl:async()=>response(value)});await f.update.check();
    assert.equal(f.navigation.length,0);assert.equal(f.updates.length,0);
  }
  const f=fixture({fetchImpl:async()=>new Response(html('B17-M11').replace('app-access-bootstrap.js?v=B17','app-access-bootstrap.js?v=B16'),{headers:{'content-type':'text/html'}})});
  await f.update.check();assert.equal(f.navigation.length,0);
});

test('unlocked or typing tab defers reload; explicit button action can apply',async()=>{
  const f=fixture();f.setSafe(false);await f.update.check();
  assert.deepEqual(f.updates,['B16-M11-FIX13']);assert.equal(f.navigation.length,0);
  assert.equal(f.update.applyUpdate(),true);assert.equal(f.navigation.length,1);
});

test('pending release is automatically applied when the tab becomes safe',async()=>{
  const f=fixture();f.setSafe(false);await f.update.check();f.setSafe(true);f.update.reconsider();
  assert.equal(f.navigation.length,1);
});

test('URL attempt marker prevents automatic reload loops even when HTML remains stale',async()=>{
  const f=fixture({currentUrl:'https://example.test/meridian/v11/?m11build=B16-M11-FIX13'});
  await f.update.check();assert.equal(f.navigation.length,0);assert.deepEqual(f.updates,['B16-M11-FIX13']);
  f.advance();await f.update.check();assert.equal(f.navigation.length,0);
  assert.equal(f.update.applyUpdate(),true,'only an explicit retry may navigate again');
});

test('initial/pageshow/focus bursts share one in-flight request and a one-minute throttle',async()=>{
  let resolve,count=0;
  const f=fixture({fetchImpl:()=>{count++;return new Promise(r=>{resolve=r;});}});
  const first=f.update.check();await f.update.check();assert.equal(count,1);
  resolve(response('B16-M11-FIX12'));await first;await f.update.check();assert.equal(count,1);
  f.advance();const next=f.update.check();assert.equal(count,2);resolve(response('B16-M11-FIX12'));await next;
});

test('offline, non-HTML and oversized responses leave the loaded app usable',async()=>{
  for(const fetchImpl of [async()=>{throw Error('offline');},
    async()=>new Response('{}',{headers:{'content-type':'application/json'}}),
    async()=>new Response(html('B17-M11'),{status:503,headers:{'content-type':'text/html'}}),
    async()=>new Response(html('B17-M11'),{headers:{'content-type':'text/html','content-length':'999999'}}),
    async()=>new Response('x'.repeat(128*1024+1),{headers:{'content-type':'text/html'}})]){
    const f=fixture({fetchImpl});await f.update.check();assert.equal(f.navigation.length,0);assert.equal(f.updates.length,0);
    assert.equal(f.timers.size,0);
  }
});

test('deadline releases a stuck fetch and late completion cannot navigate',async()=>{
  let resolve;
  const f=fixture({fetchImpl:()=>new Promise(r=>{resolve=r;})});const pending=f.update.check();
  [...f.timers.values()][0]();await pending;resolve(response('B17-M11'));await tick();
  assert.equal(f.navigation.length,0);assert.equal(f.timers.size,0);
});

test('dispose aborts pending work and removes further update authority',async()=>{
  let resolve;
  const f=fixture({fetchImpl:()=>new Promise(r=>{resolve=r;})});const pending=f.update.check();
  f.update.dispose();await pending;resolve(response('B17-M11'));await tick();
  assert.equal(f.navigation.length,0);assert.equal(f.update.applyUpdate(),false);assert.equal(f.timers.size,0);
});

class Element{
  constructor(tag='DIV'){this.tagName=tag;this.events=new Map();this.children=[];this.value='';}
  addEventListener(name,fn){this.events.set(name,fn);}
  removeEventListener(name){this.events.delete(name);}
  setAttribute(name,value){this[name]=value;}
  append(...items){this.children.push(...items);}
  remove(){this.removed=true;}
}
function mounted({status='locked',typed='',hidden=false}={}){
  const input=new Element('INPUT');input.value=typed;
  const gate=new Element('SECTION'),body=new Element('BODY'),document=new Element(),window=new Element();
  gate.parentNode=body;body.insertBefore=node=>body.children.unshift(node);
  document.hidden=hidden;document.activeElement=input;document.createElement=tag=>new Element(tag.toUpperCase());
  document.getElementById=id=>id==='app-access-password'?input:id==='app-access-gate'?gate:null;
  document.querySelectorAll=()=>sources('B16-M11-FIX12').map(src=>({getAttribute:()=>src}));
  const navigation=[];window.location={href:'https://example.test/v11/',replace:url=>navigation.push(url)};
  let listener,requests=0;
  const access={subscribe:fn=>{listener=fn;fn({status});return ()=>{listener=null;};}};
  const mount=mountReleaseUpdate(document,window,{access,fetchImpl:async()=>{requests++;return response('B17-M11');}});
  return {mount,document,window,input,navigation,body,requests:()=>requests,setStatus:s=>listener?.({status:s})};
}

test('mount checks on opening; safe locked update navigates without any private read',async()=>{
  const f=mounted();await tick();assert.equal(f.requests(),1);assert.equal(f.navigation.length,1);
  assert.ok(f.window.events.has('pageshow'));assert.ok(f.window.events.has('focus'));
  assert.ok(f.document.events.has('visibilitychange'));f.mount.dispose();assert.equal(f.window.events.size,0);
  assert.equal(f.document.events.size,0);assert.equal(f.body.children[0].removed,true);
});

test('mount preserves typed password, checking and unlocked sessions with a visible update action',async()=>{
  for(const options of [{typed:'synthetic-password'},{status:'checking'},{status:'unlocked'}]){
    const f=mounted(options);await tick();assert.equal(f.navigation.length,0);
    const notice=f.body.children[0];assert.equal(notice.hidden,false);
    const button=notice.children[0].children[1];assert.equal(button.textContent,'Jetzt aktualisieren');
    assert.equal(f.input.value,options.typed||'');button.events.get('click')();assert.equal(f.navigation.length,1);f.mount.dispose();
  }
});

test('hidden opening does not request; returning to visible triggers bounded check',async()=>{
  const f=mounted({hidden:true});await tick();assert.equal(f.requests(),0);
  f.document.hidden=false;f.document.events.get('visibilitychange')();await tick();
  assert.equal(f.requests(),1);assert.equal(f.navigation.length,1);f.mount.dispose();
});

test('intermediate locked notification during verification cannot reload a pending update',async()=>{
  const f=mounted({typed:'synthetic-password'});await tick();assert.equal(f.navigation.length,0);
  f.input.value='';f.setStatus('locked');f.setStatus('checking');
  assert.equal(f.navigation.length,0);
  f.window.events.get('focus')();assert.equal(f.navigation.length,0);f.mount.dispose();
});

