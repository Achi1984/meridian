import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppAccess} from '../v11/app-access.js';
import {createDepotReadClient} from '../v11/depot-read-client.js';
import {mountDepotReadAccess} from '../v11/depot-read-bootstrap.js';
class Node {
  constructor(document,tag){this.ownerDocument=document;this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.listeners=new Map();this.text='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.text='';this.children=nodes;}
  setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  click(){for(const fn of this.listeners.get('click')||[])fn();}
  find(tag,text){return this.tagName===tag&&this.text===text?this:this.children.map(c=>c.find?.(tag,text)).find(Boolean);}
}
function setup({status=200}={}){
  const d={createElement:t=>new Node(d,t),createElementNS:(_n,t)=>new Node(d,t)};
  const root=d.createElement('div'),command=d.createElement('div');
  const fields=new Map(['.portfolio-value','.state-label','.portfolio-description','.caption','[data-command-depot-status]'].map(s=>[s,d.createElement('span')]));
  command.querySelector=s=>fields.get(s);
  d.getElementById=id=>id==='depot-read-root'?root:id==='command-portfolio'?command:null;
  const urls=[];
  const fetchImpl=async url=>{urls.push(url);return new Response(JSON.stringify(url.includes('portfolio-history')?{points:[]}:{}),{status});};
  const access=createAppAccess({fetchImpl});
  const h={d,root,command,fields,urls,access,fetchImpl,fetchFor:fetchImpl,
    text:()=>root.textContent};
  return h;
}
// Real createAppAccess + real createDepotReadView/createDepotReadClient, synthetic data only.
function mountReal(h){
  return mountDepotReadAccess(h.d,{},{access:h.access,createClient:o=>createDepotReadClient({...o,fetchImpl:(u,i)=>h.fetchFor(u,i)})});
}
test('locked start, central verify gives not_loaded with no extra Depot reads, Command aligned',async()=>{
  const h=setup();const m=mountReal(h);
  assert.match(h.text(),/Gesperrt/);assert.equal(h.urls.length,0);
  assert.equal(await h.access.verify('synthetic-password'),'unlocked');
  const afterVerify=h.urls.length;
  assert.equal(afterVerify,1,'only the central verify request');
  assert.match(h.text(),/Noch nicht geladen/);assert.match(h.text(),/Depot manuell aktualisieren/);
  assert.equal(h.command.dataset.state,'not_loaded');
  assert.match(h.fields.get('[data-command-depot-status]').textContent,/Noch nicht geladen/);
  assert.equal(h.fields.get('.portfolio-value').textContent,'—');
  assert.ok(h.access.isUnlocked());
  m.dispose();
});
test('already unlocked mount starts not_loaded without reads',async()=>{
  const h=setup();await h.access.verify('synthetic-password');
  const before=h.urls.length;const m=mountReal(h);
  assert.match(h.text(),/Noch nicht geladen/);assert.equal(h.urls.length,before);m.dispose();
});
test('manual refresh reads, reports unavailable categories; revalidation preserves it; lock and re-unlock reset',async()=>{
  const h=setup();const m=mountReal(h);await h.access.verify('synthetic-password');
  const before=h.urls.length;
  h.root.find('button','Depot aktualisieren').click();
  await new Promise(r=>setTimeout(r,20));
  assert.equal(h.urls.length-before,3);
  assert.equal(h.root.children[1].dataset.state,'unavailable');
  assert.match(h.text(),/Nicht verfügbar/);assert.match(h.text(),/Aktuell: unvollständig/);
  assert.doesNotMatch(h.text(),/synthetic-password/);
  h.access.revalidateReaders();
  assert.equal(h.root.children[1].dataset.state,'unavailable','attempted state is not replaced by not_loaded');
  h.access.lock();
  assert.match(h.text(),/Gesperrt/);assert.equal(h.command.dataset.state,'locked');
  await h.access.verify('synthetic-password');
  assert.match(h.text(),/Noch nicht geladen/);
  m.dispose();
});
test('401 on a manual read globally locks; dispose unsubscribes and late completion is ignored',async()=>{
  let denyDepot=false;
  const h=setup();
  const real=h.fetchImpl;
  const guarded=async(url,o)=>denyDepot&&!url.includes('binance')?new Response('{}',{status:401}):real(url,o);
  const access=createAppAccess({fetchImpl:guarded});
  h.access=access;h.fetchFor=guarded;
  const m=mountReal(h);await access.verify('synthetic-password');
  denyDepot=true;
  h.root.find('button','Depot aktualisieren').click();
  await new Promise(r=>setTimeout(r,20));
  assert.equal(access.isUnlocked(),false);assert.match(h.text(),/Gesperrt/);
  denyDepot=false;await access.verify('synthetic-password');
  assert.match(h.text(),/Noch nicht geladen/);
  h.root.find('button','Depot aktualisieren').click();
  m.dispose();
  await new Promise(r=>setTimeout(r,20));
  assert.equal(h.root.children.length,0);
  assert.equal(await access.verify('synthetic-password'),'unlocked');
  assert.equal(h.root.children.length,0);
  access.dispose();
});
