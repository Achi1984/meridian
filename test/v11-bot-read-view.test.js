import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBotReadState,createBotReadView,renderCommandBotOverview} from '../v11/bot-read-view.js';
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
  removeAttribute(key){delete this.attrs[key];}
  querySelectorAll(selector){const matches=node=>selector.startsWith('.')
    ? node.className===selector.slice(1):node.tagName===selector;
    return this.children.flatMap(node=>[...(matches(node)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){this.ownerDocument.activeElement=this;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  click(){if(!this.disabled)for(const fn of this.listeners.get('click')||[])fn();}
}
function root(){const document={createElement:tag=>new Node(document,tag)};const target=document.createElement('div');
  document.getElementById=id=>[target,...all(target,'details')].find(node=>node.id===id)||null;
  return target;}
const all=(node,tag)=>[...(node.tagName===tag?[node]:[]),...node.children.flatMap(x=>all(x,tag))];
const fresh=()=>({status:'fresh',model:{status:'FRESH_SNAPSHOT',readOnly:true,executionAllowed:false,
  source:'PIONEX_BOT_API',snapshotAt:'2026-10-12T20:00:00Z',
  bots:[{ref:'a'.repeat(20),symbol:'BTC',side:'SHORT',type:'futures_grid',category:'inverse',
    metrics:{leverage:null,pnlUsd:null},secret:'NEVER DISPLAY'}]}});
function mounted(overrides={}){
  const target=root(),calls={refresh:0,lock:0,dispose:0,revalidate:0};let publish,jump;
  const client={refresh(){calls.refresh++;publish({status:'loading'});},lock(){calls.lock++;publish({status:'locked'});},
    dispose(){calls.dispose++;},revalidate(){calls.revalidate++;},...overrides};
  const getter=()=>{throw new Error('renderer must not read token');};
  const view=createBotReadView(target,{getToken:getter,onSnapshot:(_,navigate)=>{jump=navigate;},createClient:options=>{assert.equal(options.getToken,getter);publish=options.onChange;return client;}});
  return {target,view,calls,publish:state=>publish(state),jump:ref=>jump(ref),
    buttons:all(target,'button').filter(node=>['Bots aktualisieren','Botansicht sperren'].includes(node.text))};
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
test('accessible Bot filters report no matches separately and reset without reading again',()=>{
  const h=mounted();h.publish(fresh());
  const search=all(h.target,'input')[0],direction=all(h.target,'select')[0];
  assert.equal(search.getAttribute('aria-label'),'Symbol suchen');
  assert.equal(direction.getAttribute('aria-label'),'Richtung');
  search.value='ETH';for(const listener of search.listeners.get('input')||[])listener();
  assert.match(h.target.textContent,/0 Treffer von 1 Bots/);
  assert.match(h.target.textContent,/Keine Bots entsprechen den Filtern/);
  assert.doesNotMatch(h.target.textContent,/BTC · Short/);
  direction.value='short';for(const listener of direction.listeners.get('change')||[])listener();
  assert.match(h.target.textContent,/Aktive Auswahl: Symbol ETH · Richtung short/);
  const reset=all(h.target,'button').find(node=>node.text==='Filter zurücksetzen');
  reset.click();assert.match(h.target.textContent,/1 Treffer von 1 Bots/);
  assert.match(h.target.textContent,/Keine aktiven Filter/);
  assert.equal(h.calls.refresh,0,'local filtering and reset never read a snapshot');
});
test('mount is inactive, preserves controls and blocks repeated loading clicks',()=>{
  const h=mounted();assert.equal(h.calls.refresh,0);assert.match(h.target.textContent,/Gesperrt/);
  const live=all(h.target,'div').find(node=>node.getAttribute('role')==='status');
  const [refresh,lock]=h.buttons;assert.equal(refresh.getAttribute('type'),'button');
  refresh.click();refresh.click();assert.equal(h.calls.refresh,1);
  assert.equal(all(h.target,'div').find(node=>node.getAttribute('role')==='status'),live);
  assert.ok(all(h.target,'div').some(node=>node.getAttribute('aria-busy')==='true'));
  assert.ok(all(h.target,'div').filter(node=>node.contains(live)).every(node=>node.getAttribute('aria-busy')!=='true'),'loading status must not be hidden by busy ancestors');
  assert.equal(refresh.getAttribute('aria-disabled'),'true');assert.equal(all(h.target,'button').find(node=>node.text==='Bots aktualisieren'),refresh);
  h.publish(fresh());assert.equal(refresh.getAttribute('aria-disabled'),'false');
  assert.equal(all(h.target,'button').find(node=>node.text==='Botansicht sperren'),lock);lock.click();assert.equal(h.calls.lock,1);assert.doesNotMatch(h.target.textContent,/BTC/);
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
test('real client revalidation preserves investigation state only within the same fresh read',async()=>{
  const target=root();let credential='synthetic-token',clock=Date.parse('2026-10-12T20:01:00Z'),payload=snapshot('2026-10-12T20:00:00Z');
  let calls=0,client,lastState,jump;
  const view=createBotReadView(target,{getToken:()=>credential,
    onSnapshot:(_,navigate)=>{jump=navigate;},
    createClient:options=>{
      client=createBotReadClient({...options,now:()=>clock,fetchImpl:async()=>{
        calls++;return new Response(JSON.stringify(payload));
      },onChange:state=>{lastState=state;options.onChange(state);}});
      return client;
    }});
  await client.refresh();
  const firstIdentity=lastState.readIdentity,firstModel=lastState.model;
  const search=all(target,'input')[0],direction=all(target,'select')[0],sort=all(target,'select')[2];
  change(search,'input','BTC');change(direction,'change','short');change(sort,'change','pnl');
  all(target,'details')[0].setAttribute('open','');
  jump('a'.repeat(20));
  assert.equal(returnButton({target}).hidden,false);
  assert.equal(all(target,'details')[0].getAttribute('open'),'');
  client.revalidate();
  assert.equal(lastState.readIdentity,firstIdentity);
  assert.notEqual(lastState.model,firstModel,'revalidation rebuilds the model');
  assert.equal(returnButton({target}).hidden,false,'same-read projection retains the Command return');
  assert.equal(all(target,'details')[0].getAttribute('open'),'','same-read projection retains the expanded Bot');
  returnButton({target}).click();
  assert.equal(search.value,'BTC');assert.equal(direction.value,'short');assert.equal(sort.value,'pnl');
  assert.equal(all(target,'details')[0].getAttribute('open'),'');
  assert.equal(calls,1,'revalidation never reads again');

  await client.refresh();
  assert.notEqual(lastState.readIdentity,firstIdentity,'an explicit identical refresh invalidates the old read');
  assert.equal(search.value,'');assert.equal(returnButton({target}).hidden,true);
  assert.equal(all(target,'details')[0].getAttribute('open'),null);

  change(search,'input','BTC');jump('a'.repeat(20));
  credential='replacement-token';client.revalidate();
  assert.equal(lastState.status,'locked');assert.equal(search.value,'');
  assert.equal(returnButton({target}).hidden,true);assert.equal(all(target,'details').length,0);
  await client.refresh();
  change(search,'input','BTC');all(target,'details')[0].setAttribute('open','');
  payload={...payload,schemaVersion:'MALFORMED'};
  await client.refresh();
  assert.equal(lastState.status,'unavailable');assert.equal(lastState.readIdentity,undefined);
  assert.equal(search.value,'');assert.equal(returnButton({target}).hidden,true);
  assert.equal(all(target,'details').length,0);
  payload=snapshot('2026-10-12T20:00:00Z');await client.refresh();
  change(search,'input','BTC');jump('a'.repeat(20));
  clock=Date.parse('2026-10-12T20:16:00Z');client.revalidate();
  assert.equal(lastState.status,'stale');assert.equal(lastState.readIdentity,undefined);
  assert.equal(search.value,'');assert.equal(returnButton({target}).hidden,true);
  clock=Date.parse('2026-10-12T20:01:00Z');client.revalidate();
  assert.equal(lastState.status,'stale','a clock rollback cannot revive a wiped stale snapshot');
  assert.equal(calls,5,'only explicit reads fetch, including the malformed read');
  view.dispose();
});
test('missing read identity fails closed instead of inheriting retained context',()=>{
  const h=mounted(),state=duplicateSnapshot();state.readIdentity=Symbol('read');
  h.publish(state);change(all(h.target,'input')[0],'input','BTC');
  all(h.target,'details')[0].setAttribute('open','');h.jump('a'.repeat(20));
  const replacement={...state};delete replacement.readIdentity;
  h.publish(replacement);
  assert.equal(all(h.target,'input')[0].value,'');
  assert.equal(returnButton(h).hidden,true);
  assert.ok(all(h.target,'details').every(card=>card.getAttribute('open')===null));
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
  assert.deepEqual(all(target,'details').map(node=>node.id),['bot-card-'+ 'a'.repeat(20),'bot-card-'+ 'b'.repeat(20)]);
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


test('Command equal-symbol equal-loss actions have distinct references and directions',()=>{
  const target=root(),selected=[];
  renderCommandBotOverview(target,{status:'fresh',source:'PIONEX_BOT_API',snapshotAt:'2026-10-18T10:00:00Z',count:2,
    distribution:{long:1,short:1,neutral:0,unknown:0},losses:[
      {ref:'a'.repeat(20),symbol:'BTC',direction:'long',pnl:'-25 USD'},
      {ref:'b'.repeat(20),symbol:'BTC',direction:'short',pnl:'-25 USD'}]},ref=>selected.push(ref));
  const buttons=all(target,'button');
  assert.notEqual(buttons[0].textContent,buttons[1].textContent);
  assert.notEqual(buttons[0].getAttribute('aria-label'),buttons[1].getAttribute('aria-label'));
  assert.match(buttons[0].textContent,/BTC · Long · Referenz a{20}/);
  assert.match(buttons[1].textContent,/BTC · Short · Referenz b{20}/);
  buttons.forEach(button=>button.click());assert.deepEqual(selected,['a'.repeat(20),'b'.repeat(20)]);
});


const change=(node,type,value)=>{node.value=value;for(const listener of node.listeners.get(type)||[])listener();};
const returnButton=h=>all(h.target,'button').find(node=>node.text==='Zur vorherigen Auswahl zurück');
function duplicateSnapshot(){const state=fresh();state.model.bots.push({...state.model.bots[0],ref:'b'.repeat(20),side:'LONG'});return state;}
test('disclosures retain exact reference through filtering sorting and reset within one snapshot',()=>{
  const h=mounted(),state=duplicateSnapshot();h.publish(state);
  all(h.target,'details')[0].setAttribute('open','');
  const direction=all(h.target,'select')[0],sort=all(h.target,'select')[2];
  change(direction,'change','long');assert.equal(all(h.target,'details').length,1);
  assert.equal(all(h.target,'details')[0].getAttribute('open'),null,'same symbol is not the same Bot');
  change(sort,'change','pnl');change(direction,'change','all');
  const [a,b]=all(h.target,'details');assert.equal(a.getAttribute('open'),'');assert.equal(b.getAttribute('open'),null);
  a.removeAttribute('open');change(sort,'change','leverage');
  assert.equal(all(h.target,'details')[0].getAttribute('open'),null,'explicit close survives rerender');
  all(h.target,'details')[1].setAttribute('open','');
  all(h.target,'button').find(node=>node.text==='Filter zurücksetzen').click();
  assert.equal(all(h.target,'details')[1].getAttribute('open'),'');assert.equal(h.calls.refresh,0);
});
test('Command jump and return retain original filters and reveal exact duplicate-symbol Bot',()=>{
  const h=mounted();h.publish(duplicateSnapshot());
  const search=all(h.target,'input')[0],direction=all(h.target,'select')[0],sort=all(h.target,'select')[2];
  change(search,'input','NO_MATCH');change(direction,'change','long');change(sort,'change','pnl');
  h.jump('a'.repeat(20));assert.equal(returnButton(h).hidden,false);assert.equal(search.value,'');
  assert.equal(h.target.ownerDocument.activeElement,all(h.target,'details')[0].querySelector('summary'));
  h.jump('b'.repeat(20));assert.equal(h.target.ownerDocument.activeElement,all(h.target,'details')[1].querySelector('summary'));
  returnButton(h).click();assert.equal(search.value,'NO_MATCH');assert.equal(direction.value,'long');assert.equal(sort.value,'pnl');
  assert.equal(all(h.target,'details').length,0);assert.equal(returnButton(h).hidden,true);
  assert.equal(h.target.ownerDocument.activeElement,search);assert.equal(h.calls.refresh,0);
});
test('every invalidation and snapshot replacement drops disclosure and return memory',()=>{
  for(const status of ['loading','locked','stale','unavailable','malformed','new-snapshot','dispose']){
    const h=mounted(),state=duplicateSnapshot();h.publish(state);
    change(all(h.target,'input')[0],'input','BTC');h.jump('a'.repeat(20));
    const previousReturn=returnButton(h);
    if(status==='dispose')h.view.dispose();
    else if(status==='new-snapshot')h.publish(duplicateSnapshot());
    else if(status==='malformed')h.publish({status:'fresh',model:{...state.model,readOnly:false}});
    else h.publish({status});
    assert.equal(previousReturn.hidden,true,status);previousReturn.click();
    if(status==='dispose'){assert.equal(h.target.textContent,'');continue;}
    h.publish(state);assert.ok(all(h.target,'details').every(node=>node.getAttribute('open')===null),status);
    assert.equal(returnButton(h).hidden,true,status);
    assert.equal(h.calls.refresh,0,status);
  }
});
test('reset discards pending return and unknown Command targets do not change selection',()=>{
  const h=mounted();h.publish(fresh());const search=all(h.target,'input')[0];
  change(search,'input','BTC');h.jump('f'.repeat(20));assert.equal(search.value,'BTC');assert.equal(returnButton(h).hidden,true);
  h.jump('a'.repeat(20));all(h.target,'button').find(node=>node.text==='Filter zurücksetzen').click();
  assert.equal(returnButton(h).hidden,true);returnButton(h).click();assert.equal(search.value,'');
});
