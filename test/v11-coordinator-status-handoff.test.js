import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
  createAtomicRecordEnvelope,createAtomicRecordMemoryTransport,createCoordinatorAtomicRecordBackend
} from '../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {projectCoordinatorStatus} from '../scripts/autonomy/m11-coordinator-status-projection.mjs';
import {mountAgentStatus} from '../v11/agent-status-bootstrap.js';
import {createAgentStatusClient} from '../v11/agent-status-client.js?v=B16-M11-FIX8';
import {createAppAccess} from '../v11/app-access.js?v=B16-M11-FIX8';

const NOW=1700000000000;
const TASK_URL='https://github.com/Achi1984/meridian/issues/1036';
const iso=time=>new Date(time).toISOString();
const key=n=>n.toString(16).padStart(64,'0');

async function projection(withClaim=true){
  const transport=createAtomicRecordMemoryTransport({initialEnvelope:createAtomicRecordEnvelope({totalQuota:3})});
  const backend=createCoordinatorAtomicRecordBackend({transport,now:()=>NOW-100000});
  if(withClaim){
    const store=createCoordinatorStateStore({backend,enabled:true});
    const {snapshot}=await store.read();
    const claim=await store.claim({actionKey:key(2),executionKey:key(3),packetKey:key(999),
      expectedRevision:snapshot.revision,expectedOid:snapshot.oid,owner:'test-owner',now:NOW-100000});
    assert.equal(claim.status,'CLAIMED');
  }
  const envelope=await backend.exportCanonicalEnvelope();
  const context={schemaVersion:1,operations:envelope.claims.map(claim=>({
    executionKey:claim.executionKey,taskUrl:TASK_URL,observedAt:iso(NOW-1000),expiresAt:iso(NOW+1000)
  }))};
  return projectCoordinatorStatus(JSON.stringify(envelope),JSON.stringify(context),NOW);
}

function harness(providedAccess){
  let time=NOW,unlocked=true,reader,client,nextId=0;
  const listeners=new Map(),jobs=new Map(),cancelled=[];
  class Node {
    constructor(document,tag){this.ownerDocument=document;this.tagName=tag;this.children=[];this.attrs={};this.text='';}
    set textContent(value){this.text=String(value);this.children=[];}
    get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;this.text='';}
    setAttribute(name,value){this.attrs[name]=value;}
  }
  const document={createElement(tag){return new Node(document,tag);},getElementById(){return root;}};
  const root=document.createElement('div');
  const window={addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  const access=providedAccess||{
    isUnlocked:()=>unlocked,
    registerReader(clear,revalidate){reader={clear,revalidate};return ()=>{reader=null;};}
  };
  const mount=mountAgentStatus(document,window,{access,now:()=>time,
    schedule(fn,delay){const id=++nextId;jobs.set(id,{fn:()=>{jobs.delete(id);fn();},delay});return id;},
    cancelSchedule(id){cancelled.push(jobs.get(id)?.fn);jobs.delete(id);},
    createClient(options){client=createAgentStatusClient(options);return client;}
  });
  function find(tag){
    const visit=node=>[...(node.tagName===tag?[node]:[]),...node.children.flatMap(visit)];
    return visit(root);
  }
  return {mount,root,document,client,jobs,cancelled,listeners,find,
    setTime(value){time=value;},reader:()=>reader,
    lock(){unlocked=false;reader.clear();},
    unlock(){unlocked=true;reader.revalidate();},
    silentlyLock(){unlocked=false;}
  };
}

function cleared(h,text='Statusdaten nicht verfügbar.'){
  assert.equal(h.root.textContent,text);
  assert.equal(h.find('article').length,0);
  assert.equal(h.find('a').length,0);
  assert.equal(h.jobs.size,0);
  assert.equal(h.client.revalidate(),false,'client cache was discarded');
}

test('canonical backend → offline projector → mount API → actual client and renderer stays stored-only',async()=>{
  const result=await projection();
  assert.equal(result.status,'READY');
  const dto=JSON.parse(result.serializedDTO);
  assert.equal(dto.freshness,'UNKNOWN');
  for(const row of dto.rows){
    for(const field of ['providerRequested','providerVerified','modelRequested','modelVerified','coordinatorMode','freshness'])
      assert.equal(row[field],'UNKNOWN',field);
    for(const field of ['providerEvidence','modelEvidence','coordinatorEvidence','evidenceUrl'])
      assert.equal(row[field],null,field);
    assert.equal(row.taskState,'UNKNOWN');
  }
  const h=harness();
  assert.deepEqual(Object.keys(h.mount).sort(),['acceptSnapshot','clearSnapshot','dispose']);
  assert.ok(Object.isFrozen(h.mount));
  cleared(h,'Keine verifizierten Statusdaten.');
  assert.equal(h.mount.acceptSnapshot(result.serializedDTO),true);
  assert.equal(h.find('article').length,1);
  assert.equal(h.find('article')[0].attrs['data-task-state'],'UNKNOWN');
  assert.equal(h.find('article')[0].attrs['data-freshness'],'UNKNOWN');
  assert.match(h.root.textContent,/stored coordinator operations/);
  assert.match(h.root.textContent,/Stored operation state; current runtime unknown/);
  assert.doesNotMatch(h.root.textContent,/Laufend|Aktiv/);
  assert.deepEqual(h.find('a').map(link=>link.href),[TASK_URL]);
  assert.equal(h.jobs.size,1);
  h.mount.dispose();
});

test('offline caller maps EMPTY and UNAVAILABLE explicitly and never hands result objects to the mount',async()=>{
  const ready=await projection(),empty=await projection(false);
  const unavailable=await projectCoordinatorStatus('{','{}',NOW);
  assert.equal(empty.status,'EMPTY');
  assert.equal(unavailable.status,'UNAVAILABLE');
  const h=harness();
  for(const result of [empty,unavailable]){
    assert.equal(h.mount.acceptSnapshot(ready.serializedDTO),true);
    assert.equal(Object.hasOwn(result,'serializedDTO'),false);
    h.mount.clearSnapshot(result.status==='UNAVAILABLE'?'unavailable':'empty');
    cleared(h,result.status==='UNAVAILABLE'?'Statusdaten nicht verfügbar.':'Keine verifizierten Statusdaten.');
    h.reader().revalidate();
    assert.equal(h.find('article').length,0);
  }
  assert.equal(h.mount.acceptSnapshot(ready.serializedDTO),true);
  h.mount.clearSnapshot();
  cleared(h,'Keine verifizierten Statusdaten.');
  h.mount.dispose();
});

test('malformed, oversized and renderer-rejected DTOs erase prior cards, links, cache and expiry',async()=>{
  const {serializedDTO}=await projection();
  const invalid=JSON.parse(serializedDTO);invalid.rows[0].taskUrl='javascript:alert(1)';
  const invalidRow=JSON.parse(serializedDTO);invalidRow.rows[0].agentId=null;
  const many=JSON.parse(serializedDTO);many.rows=Array(51).fill(many.rows[0]);
  const h=harness();
  for(const bad of ['{',null,{},'x'.repeat(512*1024+1),'ü'.repeat(300*1024),
    JSON.stringify(invalid),JSON.stringify(invalidRow),JSON.stringify(many),JSON.stringify({schemaVersion:1,rows:[]})]){
    assert.equal(h.mount.acceptSnapshot(serializedDTO),true);
    assert.equal(h.mount.acceptSnapshot(bad),false);
    cleared(h);
    h.reader().revalidate();
    assert.equal(h.find('a').length,0);
  }
  assert.equal(h.mount.acceptSnapshot(serializedDTO),true);
  const create=h.document.createElement;
  h.document.createElement=()=>{throw new Error('render failed');};
  assert.equal(h.mount.acceptSnapshot(serializedDTO),false);
  cleared(h);
  h.document.createElement=create;
  h.reader().revalidate();
  assert.equal(h.find('a').length,0);
  h.mount.dispose();
});

test('replacement keeps one timer; expiry and stale callbacks cannot promote or resurrect snapshots',async()=>{
  const {serializedDTO}=await projection();
  const h=harness();
  assert.equal(h.mount.acceptSnapshot(serializedDTO),true);
  const late=[...h.jobs.values()][0].fn;
  assert.equal(h.mount.acceptSnapshot(serializedDTO),true);
  const [id,job]=[...h.jobs][0];
  assert.equal(job.delay,1000);
  late();
  assert.equal(h.jobs.size,1);
  assert.equal([...h.jobs.keys()][0],id);
  h.setTime(NOW+1000);job.fn();
  assert.equal(h.jobs.size,0);
  assert.equal(h.find('article')[0].attrs['data-freshness'],'UNKNOWN');
  assert.equal(h.find('article')[0].attrs['data-task-state'],'UNKNOWN');
  h.mount.clearSnapshot();
  late();job.fn();
  cleared(h,'Keine verifizierten Statusdaten.');
  h.mount.dispose();
});

test('late delivery is rejected after lock or pagehide; unlock and pageshow do not restore the old cache',async()=>{
  const {serializedDTO}=await projection();
  for(const boundary of ['lock','pagehide','silent-lock']){
    const h=harness();
    h.mount.acceptSnapshot(serializedDTO);
    const late=[...h.jobs.values()][0].fn;
    if(boundary==='lock')h.lock();
    else if(boundary==='silent-lock')h.silentlyLock();
    else h.listeners.get('pagehide')();
    assert.equal(h.mount.acceptSnapshot(serializedDTO),false);
    cleared(h);
    late();
    if(boundary==='pagehide')h.listeners.get('pageshow')();
    else h.unlock();
    h.reader().revalidate();
    assert.equal(h.find('article').length,0);
    assert.equal(h.client.revalidate(),false);
    assert.equal(h.mount.acceptSnapshot(serializedDTO),true,'only a new explicit handoff restores cards');
    h.mount.dispose();
  }
});

test('disposal is terminal, repeatable and rejects delayed delivery without changing cleared DOM',async()=>{
  const {serializedDTO}=await projection();
  const h=harness();
  h.mount.acceptSnapshot(serializedDTO);
  const late=[...h.jobs.values()][0].fn;
  const oldReader=h.reader(),pageshow=h.listeners.get('pageshow');
  h.mount.dispose();
  for(let n=0;n<2;n++){
    assert.equal(h.mount.acceptSnapshot(serializedDTO),false);
    h.mount.clearSnapshot('unavailable');
    h.mount.dispose();late();oldReader.revalidate();pageshow();
    cleared(h,'Keine verifizierten Statusdaten.');
  }
  assert.equal(h.reader(),null);
  assert.equal(h.listeners.size,0);
});

test('actual access expiry gates handoff and reverification cannot resurrect the snapshot',async()=>{
  const {serializedDTO}=await projection();
  let time=NOW;
  const access=createAppAccess({now:()=>time,schedule:()=>1,cancelSchedule:()=>{},
    fetchImpl:async()=>new Response('{}',{headers:{'content-type':'application/json'}})});
  const h=harness(access);
  assert.equal(h.mount.acceptSnapshot(serializedDTO),false);
  assert.equal(await access.verify('synthetic-only-password'),'unlocked');
  assert.equal(h.mount.acceptSnapshot(serializedDTO),true);
  time+=15*60*1000;
  assert.equal(h.mount.acceptSnapshot(serializedDTO),false);
  cleared(h);
  await access.verify('synthetic-only-password');
  access.revalidateReaders();
  assert.equal(h.find('article').length,0);
  assert.equal(h.client.revalidate(),false);
  h.mount.dispose();access.dispose();
});

test('handoff adds no producer, Node projector, persistence or summary promotion',()=>{
  const source=readFileSync(new URL('../v11/agent-status-bootstrap.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/scripts\/autonomy|projectCoordinatorStatus|\bfetch\b|XMLHttpRequest|WebSocket|localStorage|sessionStorage|setInterval|dispatchEvent|globalThis\[/);
  assert.deepEqual([...source.matchAll(/addEventListener\('([^']+)'/g)].map(match=>match[1]),['pagehide','pageshow']);
  const html=readFileSync(new URL('../v11/index.html',import.meta.url),'utf8');
  assert.match(html,/<summary><span id="autonomy-heading">Autonome Entwicklung · <strong>Unbekannt<\/strong>/);
});
