import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createAgentStatusClient} from '../v11/agent-status-client.js';
import {mountAgentStatus} from '../v11/agent-status-bootstrap.js';
import {createAppAccess} from '../v11/app-access.js?v=B15-M11';

const NOW=Date.parse('2026-10-29T12:00:00.000Z');
const iso=time=>new Date(time).toISOString();
function dto(overrides={}){
  const binding=value=>({agentId:'synthetic-agent',taskId:'synthetic-task',value,
    observedAt:iso(NOW-1000),expiresAt:iso(NOW+1000),
    evidenceUrl:'https://github.com/acme/meridian/actions/runs/123',evidenceType:'github-workflow'});
  return JSON.stringify({schemaVersion:1,status:'READY',freshness:'CURRENT',rows:[{
    agentId:'synthetic-agent',agentName:'Synthetic agent',taskId:'synthetic-task',
    taskLabel:'Synthetic status',taskState:'RUNNING',coordinatorMode:'STOPPED',
    providerRequested:'github',providerVerified:'github',modelRequested:'requested-model',
    modelVerified:'observed-model',providerEvidence:binding('github'),modelEvidence:binding('observed-model'),
    coordinatorEvidence:binding('STOPPED'),taskUrl:'https://github.com/acme/meridian/issues/42',
    observedAt:iso(NOW-1000),expiresAt:iso(NOW+2000),
    evidenceUrl:'https://github.com/acme/meridian/actions/runs/123',evidenceType:'github-workflow',
    blocker:null,nextAction:'Wait',ownerDecisionRequired:false,ownerDecisionReason:null,...overrides
  }]});
}

function harness({access:providedAccess}={}){
  let time=NOW,unlocked=true,reader,client;
  const listeners=new Map(),jobs=new Map(),cancelled=[];
  let nextId=0;
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
  const find=tag=>{
    const visit=node=>[...(node.tagName===tag?[node]:[]),...node.children.flatMap(visit)];
    return visit(root);
  };
  return {root,client,mount,jobs,cancelled,listeners,find,
    setTime(value){time=value;},reader:()=>reader,lock(){unlocked=false;reader.clear();}};
}

test('default mount is empty; exact evidence expiry reprojects without losing requested model',()=>{
  const h=harness();
  assert.equal(h.root.textContent,'Keine verifizierten Statusdaten.');
  assert.equal(h.jobs.size,0);
  assert.equal(h.client.accept(dto()),true);
  assert.equal(h.find('article')[0].attrs['data-freshness'],'CURRENT');
  assert.match(h.root.textContent,/Modell angefragtrequested-modelModell verifiziertobserved-model/);
  assert.equal(h.find('a').length,2);
  assert.equal(h.jobs.size,1);
  const first=[...h.jobs.values()][0];
  assert.equal(first.delay,1000,'earliest binding expiry, not outer row expiry');
  h.setTime(NOW+1000);first.fn();
  assert.equal(h.find('article')[0].attrs['data-freshness'],'STALE');
  assert.equal(h.find('article')[0].attrs['data-task-state'],'UNKNOWN');
  assert.match(h.root.textContent,/Modell angefragtrequested-modelModell verifiziertUnbekannt/);
  h.mount.dispose();
});

test('missing or invalid evidence never claims running or verified models',()=>{
  for(const evidence of [null,{taskId:'wrong-task'}]){
    const h=harness();
    assert.equal(h.client.accept(dto({providerEvidence:evidence,modelEvidence:evidence,coordinatorEvidence:evidence})),true);
    assert.equal(h.find('article')[0].attrs['data-freshness'],'UNKNOWN');
    assert.equal(h.find('article')[0].attrs['data-task-state'],'UNKNOWN');
    assert.match(h.root.textContent,/Modell verifiziertUnbekannt/);
    h.mount.dispose();
  }
});

test('malformed, hostile, oversized and excessive updates discard cards, links and cached DTO',()=>{
  const h=harness();
  const many=JSON.parse(dto());many.rows=Array(51).fill(many.rows[0]);
  const fifty=JSON.parse(dto());fifty.rows=Array(50).fill(fifty.rows[0]);
  assert.equal(h.client.accept(JSON.stringify(fifty)),true);
  assert.equal(h.find('article').length,50);
  for(const bad of ['{',{},'x'.repeat(512*1024+1),'ü'.repeat(300*1024),JSON.stringify(many),dto({agentId:null}),
    dto({taskUrl:'javascript:alert(1)'}),JSON.stringify({schemaVersion:1,rows:[]})]){
    assert.equal(h.client.accept(dto()),true);
    assert.equal(h.client.accept(bad),false);
    assert.equal(h.root.textContent,'Statusdaten nicht verfügbar.');
    assert.equal(h.find('article').length,0);
    assert.equal(h.find('a').length,0);
    assert.equal(h.jobs.size,0);
    assert.equal(h.client.revalidate(),false);
    h.reader().revalidate();
    assert.equal(h.find('article').length,0);
  }
  h.mount.dispose();
});

test('render exceptions explicitly remove previous DOM and discard the cached DTO',()=>{
  const h=harness();
  h.client.accept(dto());
  const create=h.root.ownerDocument.createElement;
  h.root.ownerDocument.createElement=()=>{throw new Error('render failed');};
  assert.equal(h.client.accept(dto()),false);
  assert.equal(h.root.textContent,'Statusdaten nicht verfügbar.');
  h.root.ownerDocument.createElement=create;
  assert.equal(h.client.revalidate(),false);
  assert.equal(h.find('a').length,0);
  h.mount.dispose();
});

test('replacement, lock, pagehide and disposal invalidate late callbacks without resurrection',()=>{
  const h=harness();
  h.client.accept(dto());
  const late=[...h.jobs.values()][0].fn;
  h.client.accept(dto({agentName:'Replacement'}));
  const replacementTimer=[...h.jobs.keys()][0];
  late();
  assert.match(h.root.textContent,/Replacement/);
  assert.equal(h.jobs.size,1);
  assert.equal([...h.jobs.keys()][0],replacementTimer,'late callback cannot replace the new generation timer');
  h.lock();
  for(const callback of h.cancelled)callback?.();
  assert.equal(h.root.textContent,'Keine verifizierten Statusdaten.');
  assert.equal(h.client.revalidate(),false);
  assert.equal(h.client.accept(dto()),false,'locked access rejects producer delivery');
  assert.equal(h.find('a').length,0);
  h.mount.dispose();

  const page=harness();
  page.client.accept(dto());const pending=[...page.jobs.values()][0].fn;
  page.listeners.get('pagehide')();pending();
  assert.equal(page.client.revalidate(),false);
  assert.equal(page.client.accept(dto()),false,'pagehide blocks late deliveries');
  page.listeners.get('pageshow')();
  assert.equal(page.client.revalidate(),false);
  page.client.accept(dto());page.mount.dispose();pending();
  assert.equal(page.client.accept(dto()),false);
  assert.equal(page.root.textContent,'Keine verifizierten Statusdaten.');
  assert.equal(page.listeners.size,0);
  assert.equal(page.jobs.size,0);
  assert.equal(page.reader(),null);
});

test('real shared access expiry discards the cached DTO and cannot re-unlock it',async()=>{
  let time=NOW;
  const access=createAppAccess({now:()=>time,schedule:()=>1,cancelSchedule:()=>{},
    fetchImpl:async()=>new Response('{}',{headers:{'content-type':'application/json'}})});
  await access.verify('synthetic-only-password');
  const h=harness({access});
  assert.equal(h.client.accept(dto()),true);
  time=NOW+15*60*1000;
  assert.equal(access.revalidateReaders(),false);
  assert.equal(h.root.textContent,'Keine verifizierten Statusdaten.');
  assert.equal(h.client.revalidate(),false);
  await access.verify('synthetic-only-password');
  assert.equal(h.client.revalidate(),false);
  h.mount.dispose();access.dispose();
});

test('client disposal is terminal before reentrant or throwing consumer notification',()=>{
  for(const throws of [false,true]){
    let client,reentrant;
    const states=[];
    client=createAgentStatusClient({now:()=>NOW,onChange(state){
      states.push(state.status);
      if(state.status==='empty'){
        reentrant=client.accept(dto());
        if(throws)throw new Error('Synthetic consumer failure');
      }
    }});
    assert.equal(client.accept(dto()),true);
    assert.doesNotThrow(()=>client.dispose());
    assert.equal(reentrant,false);
    assert.deepEqual(states,['ready','empty']);
    assert.equal(client.accept(dto()),false);
    assert.equal(client.revalidate(),false);
    client.dispose();client.clear();
    assert.deepEqual(states,['ready','empty']);
  }
});

test('clock failures clear data and cannot be recovered by revalidation alone',()=>{
  const h=harness();
  h.client.accept(dto());
  h.setTime(NaN);
  assert.equal(h.client.revalidate(),false);
  assert.equal(h.root.textContent,'Statusdaten nicht verfügbar.');
  assert.equal(h.find('a').length,0);
  assert.equal(h.jobs.size,0);
  h.setTime(NOW);
  assert.equal(h.client.revalidate(),false);
  h.mount.dispose();
});

test('status mount keeps the operating summary independent and has no producer or persistence hooks',()=>{
  const html=readFileSync(new URL('../v11/index.html',import.meta.url),'utf8');
  assert.match(html,/<summary><span id="autonomy-heading">Autonome Entwicklung · <strong>Unbekannt<\/strong>/);
  assert.match(html,/Diese Anzeige überwacht den Betrieb nicht\.<\/p>\s*<div id="agent-status-root"/);
  for(const name of ['agent-status-client.js','agent-status-bootstrap.js']){
    const source=readFileSync(new URL('../v11/'+name,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bfetch\b|XMLHttpRequest|WebSocket|localStorage|sessionStorage|setInterval|dispatchEvent|globalThis\[/);
  }
});
