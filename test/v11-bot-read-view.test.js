import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBotReadState,createBotReadView} from '../v11/bot-read-view.js';
import {buildBotReadModel} from '../v11/bot-read-model.js';
import {createBotReadClient} from '../v11/bot-read-client.js';

// Deliberately minimal DOM contract fixture, not browser/layout acceptance.
class Node {
  constructor(document,tag){this.ownerDocument=document;this.tagName=tag;this.children=[];this.attrs={};this.listeners=new Map();this.text='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}
  set innerHTML(_){throw new Error('HTML rendering forbidden');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.text='';this.children=nodes;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  click(){if(!this.disabled)for(const fn of this.listeners.get('click')||[])fn();}
}
function root(){const document={createElement:tag=>new Node(document,tag)};return document.createElement('div');}
const all=(node,tag)=>[...(node.tagName===tag?[node]:[]),...node.children.flatMap(x=>all(x,tag))];
const fresh=()=>({status:'fresh',model:{status:'FRESH_SNAPSHOT',readOnly:true,executionAllowed:false,
  snapshotAt:'2026-10-12T20:00:00Z',bots:[{symbol:'BTC',side:'SHORT',type:'futures_grid',category:'inverse',secret:'NEVER DISPLAY'}]}});
function mounted(overrides={}){
  const target=root(),calls={refresh:0,lock:0,dispose:0,revalidate:0};let publish;
  const client={refresh(){calls.refresh++;publish({status:'loading'});},lock(){calls.lock++;publish({status:'locked'});},
    dispose(){calls.dispose++;},revalidate(){calls.revalidate++;},...overrides};
  const getter=()=>{throw new Error('renderer must not read token');};
  const view=createBotReadView(target,{getToken:getter,createClient:options=>{assert.equal(options.getToken,getter);publish=options.onChange;return client;}});
  return {target,view,calls,publish:state=>publish(state),buttons:all(target,'button')};
}
test('fresh rows use bounded labels, UTC time, correct side and no arbitrary data',()=>{
  const target=root();assert.equal(renderBotReadState(target,fresh()),'fresh');
  assert.match(target.textContent,/BTC/);assert.match(target.textContent,/Richtung: Short/);
  assert.match(target.textContent,/Kategorie: COIN-M/);assert.doesNotMatch(target.textContent,/NEVER DISPLAY/);
  assert.equal(all(target,'li').length,1);assert.equal(all(target,'time')[0].getAttribute('datetime'),'2026-10-12T20:00:00Z');
  const live=all(target,'div').find(x=>x.getAttribute('role')==='status');
  assert.equal(live.getAttribute('aria-live'),'polite');assert.equal(live.getAttribute('aria-atomic'),'true');
});
test('live status is attached empty and retains identity across all state transitions',()=>{
  const target=root(),replace=target.replaceChildren.bind(target);let mounts=0;
  target.replaceChildren=(...nodes)=>{
    const live=nodes.flatMap(node=>all(node,'div')).find(node=>node.getAttribute('role')==='status');
    assert.ok(live);assert.equal(live.textContent,'','live region must be empty when attached');
    mounts++;replace(...nodes);
  };
  renderBotReadState(target,{status:'locked'});
  const live=all(target,'div').find(node=>node.getAttribute('role')==='status');
  for(const state of [{status:'loading'},fresh(),{status:'stale'},{status:'unavailable'},{status:'locked'}]) {
    renderBotReadState(target,state);
    assert.equal(all(target,'div').find(node=>node.getAttribute('role')==='status'),live);
    assert.equal(target.contains(live),true);assert.ok(live.textContent.length>0);
  }
  assert.equal(mounts,1);
});
test('every nonfresh state removes all previously visible rows and timestamp',()=>{
  const target=root();
  for(const status of ['locked','loading','stale','unavailable','unexpected']){
    renderBotReadState(target,fresh());renderBotReadState(target,{status,model:fresh().model});
    assert.equal(all(target,'li').length,0);assert.equal(all(target,'time').length,0);
    assert.doesNotMatch(target.textContent,/BTC|2026-10-12/);
  }
});
test('malformed fresh data fails closed atomically',()=>{
  for(const mutate of [s=>s.model.bots.push({symbol:'<script>'}),s=>s.model.bots=Array(101).fill(s.model.bots[0]),
    s=>s.model.readOnly=false,s=>s.model.executionAllowed=true,s=>s.model.snapshotAt='secret',s=>s.model.status='UNKNOWN']){
    const target=root(),state=fresh();mutate(state);
    assert.equal(renderBotReadState(target,state),'unavailable');assert.equal(all(target,'li').length,0);
    assert.doesNotMatch(target.textContent,/BTC|script|secret/);
  }
});
test('unknown enums stay unknown, including inherited object names',()=>{
  const target=root(),state=fresh();Object.assign(state.model.bots[0],{side:'constructor',type:'__proto__',category:'secret'});
  renderBotReadState(target,state);assert.equal((target.textContent.match(/Unbekannt/g)||[]).length,4);
  assert.doesNotMatch(target.textContent,/constructor|__proto__|secret/);
});
test('sparse and undefined rows clear prior private data without throwing',()=>{
  for(const bots of [Array(1),[undefined],[fresh().model.bots[0],,]]) {
    const target=root();renderBotReadState(target,fresh());
    assert.match(target.textContent,/BTC/);
    const state=fresh();state.model.bots=bots;
    assert.doesNotThrow(()=>assert.equal(renderBotReadState(target,state),'unavailable'));
    assert.equal(all(target,'li').length,0);assert.equal(all(target,'time').length,0);
    assert.doesNotMatch(target.textContent,/BTC|2026-10-12/);
  }
});
test('empty fresh snapshot reports absence rather than implying safety or active bots',()=>{
  const target=root(),state=fresh();state.model.bots=[];renderBotReadState(target,state);
  assert.match(target.textContent,/0 Bots im Snapshot/);assert.match(target.textContent,/Keine Bots in diesem Snapshot/);
  assert.doesNotMatch(target.textContent,/SAFE|sicher|0 aktive Bots/);
});
test('mount is inactive, preserves controls and blocks repeated loading clicks',()=>{
  const h=mounted();assert.equal(h.calls.refresh,0);assert.match(h.target.textContent,/Gesperrt/);
  const live=all(h.target,'div').find(node=>node.getAttribute('role')==='status');
  const [refresh,lock]=h.buttons;assert.equal(refresh.getAttribute('type'),'button');
  refresh.click();refresh.click();assert.equal(h.calls.refresh,1);
  assert.equal(all(h.target,'div').find(node=>node.getAttribute('role')==='status'),live);
  assert.ok(all(h.target,'div').some(node=>node.getAttribute('aria-busy')==='true'));
  assert.ok(all(h.target,'div').filter(node=>node.contains(live)).every(node=>node.getAttribute('aria-busy')!=='true'),'loading status must not be hidden by busy ancestors');
  assert.equal(refresh.getAttribute('aria-disabled'),'true');assert.equal(all(h.target,'button')[0],refresh);
  h.publish(fresh());assert.equal(refresh.getAttribute('aria-disabled'),'false');
  assert.equal(all(h.target,'button')[1],lock);lock.click();assert.equal(h.calls.lock,1);assert.doesNotMatch(h.target.textContent,/BTC/);
});
test('lock clears UI even if client lock throws',()=>{
  const h=mounted({lock(){throw new Error('secret');}});h.publish(fresh());h.buttons[1].click();
  assert.match(h.target.textContent,/Gesperrt/);assert.doesNotMatch(h.target.textContent,/BTC|secret/);
});
test('refresh rejection is generic and late rejection does not overwrite lock',async()=>{
  const h=mounted({refresh(){return Promise.reject(new Error('secret'));}});h.publish(fresh());h.buttons[0].click();
  await Promise.resolve();assert.match(h.target.textContent,/Nicht verfügbar/);assert.doesNotMatch(h.target.textContent,/BTC|secret/);
  let reject;const second=mounted({refresh(){return new Promise((_,r)=>{reject=r;});}});
  second.buttons[0].click();second.buttons[1].click();reject(new Error('secret'));await Promise.resolve();
  assert.match(second.target.textContent,/Gesperrt/);
});
test('revalidate delegates only when requested and errors clear displayed data',()=>{
  const h=mounted();h.publish(fresh());h.view.revalidate();assert.equal(h.calls.revalidate,1);
  const failed=mounted({revalidate(){throw Error('secret');}});failed.publish(fresh());failed.view.revalidate();
  assert.match(failed.target.textContent,/Nicht verfügbar/);assert.doesNotMatch(failed.target.textContent,/BTC|secret/);
});
test('dispose wipes content, detaches handlers and ignores late client updates',()=>{
  const h=mounted();h.publish(fresh());h.view.dispose();h.view.dispose();h.view.revalidate();
  h.buttons[0].click();h.buttons[1].click();h.publish(fresh());
  assert.equal(h.target.textContent,'');assert.equal(h.calls.dispose,1);assert.equal(h.calls.refresh,0);assert.equal(h.calls.lock,0);
});
test('factory failure is generic, clears prior data and cannot publish after failure',()=>{
  const target=root();renderBotReadState(target,fresh());let publish;
  assert.throws(()=>createBotReadView(target,{createClient:options=>{publish=options.onChange;throw Error('secret');}}),
    {message:'Botansicht nicht verfügbar'});
  publish(fresh());assert.match(target.textContent,/Nicht verfügbar/);assert.doesNotMatch(target.textContent,/BTC|secret/);
});

const snapshot=stamp=>({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',source:'PIONEX_WALLET_BOT_DETAIL',
  sourceSnapshotAt:stamp,freshnessLimitMs:900000,readOnly:true,executionImpact:false,detailsComplete:true,
  sourceStatusOk:true,fresh:true,usableForOverwrite:true,botCount:1,bots:[{botRef:'a'.repeat(20),symbol:'BTC',
    side:'SHORT',cateType:'inverse',botType:'futures_grid',sideSource:'economic_inverse_asset'}]});
test('real model field names and both canonical timestamp formats render without reinterpretation',()=>{
  for (const stamp of ['2026-10-12T20:00:00Z','2026-10-12T20:00:00.123Z','2024-02-29T20:00:00Z']) {
    const model=buildBotReadModel(snapshot(stamp),{now:Date.parse(stamp)+60000});
    assert.equal(model.status,'FRESH_SNAPSHOT');const target=root();
    assert.equal(renderBotReadState(target,{status:'fresh',model}),'fresh');
    assert.match(target.textContent,/BTC/);assert.match(target.textContent,/Richtung: Short/);
    assert.match(target.textContent,/Typ: Futures Grid/);assert.match(target.textContent,/Kategorie: COIN-M/);
    assert.equal(all(target,'time')[0].getAttribute('datetime'),stamp);
  }
});
test('canonical calendar validation matches corrected model and rejects normalized impossible dates',()=>{
  for(const stamp of ['2026-02-31T20:00:00Z','2026-02-29T20:00:00Z','2026-10-12T24:00:00Z']) {
    const model=buildBotReadModel(snapshot(stamp),{now:Date.parse(stamp)+60000});
    assert.equal(model.status,'UNKNOWN');const target=root();
    const forged=fresh();forged.model.snapshotAt=stamp;
    assert.equal(renderBotReadState(target,forged),'unavailable');assert.equal(all(target,'li').length,0);
  }
});
test('real client to model to renderer pipeline expires data, locks on logout and remains inert until refresh',async()=>{
  const target=root(),events=[];let clock=Date.parse('2026-10-12T20:01:00Z'),credential='synthetic-token',calls=0;
  const client=createBotReadClient({getToken:()=>credential,now:()=>clock,
    fetchImpl:async()=>{calls++;return new Response(JSON.stringify(snapshot('2026-10-12T20:00:00Z')));},
    onChange:state=>{events.push(state.status);renderBotReadState(target,state);}});
  assert.equal(calls,0);await client.refresh();assert.deepEqual(events,['loading','fresh']);
  assert.match(target.textContent,/BTC/);assert.doesNotMatch(target.textContent,/synthetic-token/);
  clock+=900000;client.revalidate();assert.equal(events.at(-1),'stale');assert.equal(all(target,'li').length,0);
  credential='';client.revalidate();assert.equal(events.at(-1),'locked');assert.equal(all(target,'li').length,0);
  client.dispose();await client.refresh();assert.equal(calls,1);
});

test('collapsed native cards distinguish equal symbols and render only whitelisted metrics',()=>{
  const state=fresh(), target=root();
  Object.assign(state.model.bots[0],{ref:'a'.repeat(20),metrics:{leverage:5,investmentUsd:125.5,pnlUsd:-2.75,
    lower:0.00001234,upper:0.00002345,liquidationPrice:0,stopLoss:null,takeProfit:'SECRET',gridProfitUsd:999,riskBufferPct:100}});
  state.model.bots.push({...state.model.bots[0],ref:'b'.repeat(20)});
  renderBotReadState(target,state);
  assert.equal(all(target,'details').length,2);assert.equal(all(target,'summary').length,2);
  assert.ok(all(target,'details').every(node=>node.getAttribute('open')===null));
  assert.match(target.textContent,/Referenz a{20}/);assert.match(target.textContent,/Referenz b{20}/);
  assert.match(target.textContent,/5×/);assert.match(target.textContent,/125,5 USD\/USDT/);
  assert.match(target.textContent,/P\/L laut Quelle: -2,75 USD/);assert.match(target.textContent,/0,00001234/);
  assert.match(target.textContent,/Grid-GewinnNicht verfügbar/);assert.match(target.textContent,/RisikopufferNicht verfügbar/);
  assert.match(target.textContent,/Liquidationspreis laut QuelleNicht verfügbar/);assert.doesNotMatch(target.textContent,/SECRET|999|100 %/);
  renderBotReadState(target,{status:'locked'});assert.equal(all(target,'details').length,0);
  assert.doesNotMatch(target.textContent,/125,5|a{20}|b{20}/);
});

 test('P/L alone receives semantic color; missing and coerced zeros remain neutral',()=>{
  for(const [value,tone] of [[-2.75,'negative'],[2.75,'positive'],[0,null],[-0,null],[null,null],[undefined,null],['2',null],[NaN,null],[Infinity,null]]){
    const state=fresh(),target=root();state.model.bots[0].metrics={pnlUsd:value,leverage:5,investmentUsd:120};
    renderBotReadState(target,state);
    const colored=all(target,'strong').filter(node=>node.className?.startsWith('bot-pnl-'));
    assert.equal(colored.length,tone?1:0);
    if(tone){assert.equal(colored[0].className,'bot-pnl-'+tone);assert.equal(colored[0].textContent,value<0?'-2,75 USD':'2,75 USD');}
  }
});
