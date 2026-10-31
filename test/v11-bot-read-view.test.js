import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBotReadState,createBotReadView,renderCommandBotOverview} from '../v11/bot-read-view.js';
import {buildBotReadModel} from '../v11/bot-read-model.js';
import {createBotReadClient} from '../v11/bot-read-client.js';
import {publishDepotPortfolioState} from '../v11/depot-portfolio-state.js?v=B16-M11-FIX4';
import {normalizePionexBotOrder} from '../pionex-bot-auto-sync.js';
import {buildAssetWatchApiSnapshot} from '../asset-watch-bridge.js';

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
test('neutral rows display independent liquidation bounds and explicit partial coverage',()=>{
  const state=fresh(),bot=state.model.bots[0];
  bot.side='NEUTRAL';bot.metrics.liquidationLowerBound=50000;bot.metrics.liquidationUpperBound=60000;
  state.model.coverage={status:'PARTIAL',providerContractStatus:'UNVERIFIED',listRows:2,
    recognizedRows:1,representedRows:1,unsupportedRows:1,unhydratedRows:0};
  const target=root();renderBotReadState(target,state);
  assert.match(target.textContent,/Liquidationsschätzung · Untergrenze/);
  assert.match(target.textContent,/Liquidationsschätzung · Obergrenze/);
  assert.match(target.textContent,/Untergrenze50\.000/);assert.match(target.textContent,/Obergrenze60\.000/);
  assert.doesNotMatch(target.textContent,/Liquidationspreis laut Quelle/);
  assert.match(target.textContent,/Teilabdeckung/);
  assert.match(target.textContent,/Futures Moon ist als cateType von futures_grid dokumentiert/);
});
test('Futures Moon renders as a documented category distinct from the Futures Grid type',()=>{
  const state=fresh(),standard=state.model.bots[0],moon={...structuredClone(standard),
    ref:'b'.repeat(20),symbol:'ETH',side:'NEUTRAL',productCategory:'FUTURES_MOON'};
  state.model.bots=[standard,moon];
  state.model.coverage={status:'DOCUMENTED',providerContractStatus:'DOCUMENTED',
    liveAccountVerification:'NOT_PERFORMED',listRows:2,recognizedRows:2,representedRows:2,
    unsupportedRows:0,unhydratedRows:0,paginationComplete:true,pages:1,pageLimit:20};
  const target=root();renderBotReadState(target,state);
  assert.match(target.textContent,/Typ: Futures Grid · Kategorie: COIN-M/);
  assert.match(target.textContent,/Richtung: Neutral · Typ: Futures Grid · Kategorie: Futures Moon/);
  assert.match(target.textContent,/Dokumentierter API-Vertrag; Live-Kontobestand nicht unabhängig verifiziert/);
  assert.equal(all(target,'span').filter(node=>String(node.className||'').split(' ').includes('bot-card-product')).length,1);
});
test('page-limit continuation is explicitly partial and never described as complete coverage',()=>{
  const state=fresh();
  state.model.coverage={status:'PARTIAL',providerContractStatus:'DOCUMENTED',
    liveAccountVerification:'NOT_PERFORMED',listRows:1,recognizedRows:1,representedRows:1,
    unsupportedRows:0,unhydratedRows:0,paginationComplete:false,pages:20,pageLimit:20};
  const target=root();renderBotReadState(target,state);
  assert.match(target.textContent,/Teilabdeckung/);
  assert.match(target.textContent,/Weitere Listenseiten waren beim Erreichen des Seitenlimits noch vorhanden/);
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
test('renderer fails closed on null and undefined and does not restore previous disclosures',()=>{
  for(const malformed of [null,undefined]){
    const target=root(),state=fresh();state.readIdentity=Symbol('read');
    assert.equal(renderBotReadState(target,state),'fresh');
    all(target,'details')[0].setAttribute('open','');
    assert.doesNotThrow(()=>assert.equal(renderBotReadState(target,malformed),'unavailable'));
    assert.equal(all(target,'details').length,0);
    assert.equal(all(target,'li').length,0);assert.equal(all(target,'time').length,0);
    assert.doesNotMatch(target.textContent,/BTC|2026-10-12|Snapshot-Zeit/);
    assert.equal(target.querySelector('.bot-read-state').getAttribute('data-state'),'unavailable');
    assert.equal(renderBotReadState(target,state),'fresh');
    assert.equal(all(target,'details')[0].getAttribute('open'),null,'valid state cannot revive cleared disclosure');
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
  assert.match(target.textContent,/0 Bots im Snapshot/);assert.match(target.textContent,/Keine darstellbaren Bots in diesem Snapshot/);
  assert.match(target.textContent,/Dies bestätigt kein leeres Wallet/);
  assert.doesNotMatch(target.textContent,/SAFE|sicher|0 aktive Bots/);
});
test('accessible Bot filters report no matches separately and reset without reading again',()=>{
  const h=mounted();h.publish(fresh());
  const search=all(h.target,'input')[0],direction=all(h.target,'select')[0];
  assert.equal(search.getAttribute('aria-label'),'Symbol suchen');
  assert.equal(direction.getAttribute('aria-label'),'Richtung');
  search.value='ETH';for(const listener of search.listeners.get('input')||[])listener();
  assert.match(h.target.textContent,/0 von 1 Bots im Snapshot/);
  assert.match(h.target.textContent,/Keine Bots entsprechen den Filtern/);
  assert.doesNotMatch(h.target.textContent,/BTC · Short/);
  direction.value='short';for(const listener of direction.listeners.get('change')||[])listener();
  assert.match(h.target.textContent,/0 von 1 Bots im Snapshot/);
  const reset=all(h.target,'button').find(node=>node.text==='Filter zurücksetzen');
  reset.click();assert.match(h.target.textContent,/1 von 1 Bots im Snapshot/);
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
test('Bots reuse only the canonical Depot total and clear it on stale or locked state',()=>{
  const model={status:'FRESH_SNAPSHOT',readOnly:true,executionAllowed:false,totalUsd:1234.56,currency:'USD',
    snapshotAt:'2026-10-12T19:59:00.000Z',sourceAt:'2026-10-12T19:58:00.000Z',
    source:'SERVER_PORTFOLIO_CURRENT',expiresAt:Date.parse('2026-10-12T20:14:00.000Z')};
  publishDepotPortfolioState({status:'fresh',model});
  const h=mounted();
  assert.match(h.target.textContent,/1\.234,56 USD/);
  assert.match(h.target.textContent,/Gesamtwert laut Depot/);
  assert.doesNotMatch(h.target.textContent,/1\.434,56 USD/);
  publishDepotPortfolioState({status:'stale'});
  assert.doesNotMatch(h.target.textContent,/1\.234,56 USD/);
  assert.match(h.target.textContent,/Daten veraltet/);
  publishDepotPortfolioState({status:'fresh',model:{...model,totalUsd:0}});
  assert.match(h.target.textContent,/0,00 USD/);
  publishDepotPortfolioState({status:'locked'});
  assert.doesNotMatch(h.target.textContent,/0,00 USD/);
  assert.match(h.target.textContent,/Depotdaten ausgeblendet/);
  h.view.dispose();
});
test('dispose unsubscribes Depot updates and remains harmless when repeated',()=>{
  const model={status:'FRESH_SNAPSHOT',readOnly:true,executionAllowed:false,totalUsd:1234.56,currency:'USD',
    snapshotAt:'2026-10-12T19:59:00.000Z',sourceAt:'2026-10-12T19:58:00.000Z',
    source:'SERVER_PORTFOLIO_CURRENT',expiresAt:Date.parse('2026-10-12T20:14:00.000Z')};
  publishDepotPortfolioState({status:'fresh',model});
  const h=mounted(),portfolio=all(h.target,'div').find(node=>
    String(node.className||'').split(' ').includes('bot-portfolio-total'));
  assert.match(portfolio.textContent,/1\.234,56 USD/);
  h.view.dispose();
  const detachedText=portfolio.textContent;

  publishDepotPortfolioState({status:'fresh',model:{...model,totalUsd:9876.54}});
  h.view.dispose();
  assert.equal(portfolio.textContent,detachedText);
  assert.equal(h.target.textContent,'');
  assert.equal(h.calls.dispose,1);
  publishDepotPortfolioState({status:'locked'});
  assert.equal(portfolio.textContent,detachedText);
});
test('generated Bots controls precede snapshot content and the card list',()=>{
  const h=mounted();h.publish(fresh());
  const section=h.target.children[0],filterIndex=section.children.findIndex(node=>node.className==='bot-overview-filters');
  const contentIndex=section.children.findIndex(node=>node.contains(all(h.target,'ul')[0]));
  const actionIndex=section.children.findIndex(node=>all(node,'button').some(button=>
    ['Bots aktualisieren','Botansicht sperren'].includes(button.text)));
  assert.ok(filterIndex>=0&&filterIndex<contentIndex,'search, filter, sort and reset are above cards');
  assert.ok(actionIndex>=0&&actionIndex<contentIndex,'refresh and lock remain above cards');
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
    fetchImpl:async()=>{calls++;return new Response(JSON.stringify(walletScopeSnapshot()));},
    onChange:state=>{events.push(state.status);renderBotReadState(target,state);}});
  assert.equal(calls,0);await client.refresh();assert.deepEqual(events,['loading','fresh']);
  assert.match(target.textContent,/BTC/);assert.doesNotMatch(target.textContent,/synthetic-token/);
  assert.match(target.textContent,/Futures-Grid-Datenumfang: von der Quelle bestätigt/);
  clock+=900000;client.revalidate();assert.equal(events.at(-1),'stale');assert.equal(all(target,'li').length,0);
  assert.doesNotMatch(target.textContent,/von der Quelle bestätigt|2026-10-12/);
  clock-=900000;client.revalidate();assert.equal(events.at(-1),'stale');
  assert.doesNotMatch(target.textContent,/BTC|Futures-Grid-Datenumfang|2026-10-12/);
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
test('view update fails closed on null and undefined and clears all selection context',()=>{
  for(const malformed of [null,undefined]){
    const h=mounted(),state=duplicateSnapshot();state.readIdentity=Symbol('read');
    h.publish(state);
    const search=all(h.target,'input')[0],direction=all(h.target,'select')[0],sort=all(h.target,'select')[2];
    change(search,'input','BTC');change(direction,'change','long');change(sort,'change','pnl');
    all(h.target,'details')[0].setAttribute('open','');h.jump('a'.repeat(20));
    assert.equal(returnButton(h).hidden,false);
    assert.doesNotThrow(()=>h.publish(malformed));
    assert.equal(h.target.querySelector('.bot-read-state').getAttribute('data-state'),'unavailable');
    assert.equal(all(h.target,'details').length,0);assert.equal(all(h.target,'li').length,0);
    assert.equal(all(h.target,'time').length,0);
    assert.doesNotMatch(h.target.textContent,/BTC|2026-10-12|Snapshot-Zeit/);
    assert.equal(search.value,'');assert.equal(direction.value,'all');assert.equal(sort.value,'symbol');
    assert.equal(returnButton(h).hidden,true);
    h.publish(state);
    assert.equal(search.value,'');assert.equal(direction.value,'all');assert.equal(sort.value,'symbol');
    assert.equal(returnButton(h).hidden,true);
    assert.ok(all(h.target,'details').every(card=>card.getAttribute('open')===null));
  }
});

test('collapsed native cards distinguish equal symbols and render only whitelisted metrics',()=>{
  const state=fresh(), target=root();
  Object.assign(state.model.bots[0],{ref:'a'.repeat(20),metrics:{leverage:5,investmentUsd:125.5,pnlUsd:-2.75,
    lower:0.00001234,upper:0.00002345,liquidationPrice:0,stopLoss:null,takeProfit:'SECRET',gridProfitUsd:999,riskBufferPct:100}});
  state.model.bots.push({...state.model.bots[0],ref:'b'.repeat(20)});
  renderBotReadState(target,state);
  assert.equal(all(target,'details').length,2);assert.equal(all(target,'summary').length,2);
  assert.ok(all(target,'details').every(node=>node.getAttribute('open')===null));
   const [first,second]=all(target,'details'),[firstSummary,secondSummary]=all(target,'summary');
   assert.doesNotMatch(firstSummary.textContent,/Referenz|Bot 1/);
   assert.equal(firstSummary.getAttribute('aria-label'),
     'BTC · Short · Hebel 5× · P/L laut Quelle -2,75 USD · Kapital 125,50 USD/USDT · TP nicht prüfbar · ID-Ende aaaaaa · Aufklappen');
   assert.equal(secondSummary.getAttribute('aria-label'),
     'BTC · Short · Hebel 5× · P/L laut Quelle -2,75 USD · Kapital 125,50 USD/USDT · TP nicht prüfbar · ID-Ende bbbbbb · Aufklappen');
   assert.match(firstSummary.textContent,/BTCShortHebel 5×/);
   assert.match(firstSummary.textContent,/Kapital125,50 USD\/USDT/);
   assert.match(firstSummary.textContent,/P\/L laut Quelle-2,75 USD/);
   assert.match(firstSummary.textContent,/Aufklappen/);
   assert.match(first.textContent,/Technische Referenz: a{20}/);
   assert.match(second.textContent,/Technische Referenz: b{20}/);
   all(first,'button').find(node=>node.text==='Originalwerte anzeigen').click();
   assert.match(target.textContent,/Hebel · Originalwert5×/);
   assert.match(target.textContent,/Kapital · Originalwert125.5 USD\/USDT/);
   assert.match(target.textContent,/P\/L laut Quelle · Originalwert-2.75 USD/);
   assert.match(target.textContent,/0.00001234/);
   assert.match(target.textContent,/Grid-GewinnNicht verfügbar/);assert.match(target.textContent,/RisikopufferNicht verfügbar/);
   assert.match(target.textContent,/Liquidationspreis laut QuelleNicht verfügbar/);assert.doesNotMatch(target.textContent,/SECRET|999|100 %/);
   assert.deepEqual(all(target,'details').map(node=>node.id),['bot-card-'+ 'a'.repeat(20),'bot-card-'+ 'b'.repeat(20)]);
   assert.match(all(target,'div').find(node=>node.getAttribute('role')==='status').textContent,/bestätigt keinen laufenden Bot-Prozess/);
   assert.equal(all(target,'time').length,1,'freshness context appears once');
   renderBotReadState(target,{status:'locked'});assert.equal(all(target,'details').length,0);
   assert.doesNotMatch(target.textContent,/125.5|a{20}|b{20}/);
 });

test('TP indicators are read-only, unknown evidence stays neutral, and mismatch warnings show exact values',()=>{
  const input=snapshot('2026-10-12T20:00:00Z');
  input.bots[0].limits={takeProfit:90,upper:100,takeProfitEvidence:'PRICE_SET'};
  const mismatching=buildBotReadModel(input,{now:Date.parse(input.sourceSnapshotAt)+60000});
  const target=root();renderBotReadState(target,{status:'fresh',model:mismatching});
  let indicators=all(target,'input').filter(node=>node.getAttribute('aria-label')?.startsWith('TP'));
  assert.equal(indicators.length,2);
  assert.ok(indicators.every(node=>node.disabled));
  assert.equal(indicators[0].checked,true);assert.equal(indicators[0].indeterminate,false);
  assert.equal(indicators[1].checked,false);
  assert.match(target.textContent,/TP weicht von oberer Range ab/);
  assert.match(target.textContent,/TP-Wert: 90 · obere Range: 100/);

  input.bots[0].limits={takeProfit:100,upper:100,takeProfitEvidence:'PRICE_SET'};
  const matching=buildBotReadModel(input,{now:Date.parse(input.sourceSnapshotAt)+60000});
  renderBotReadState(target,{status:'fresh',model:matching});
  indicators=all(target,'input').filter(node=>node.getAttribute('aria-label')?.startsWith('TP'));
  assert.ok(indicators.every(node=>node.checked&&!node.indeterminate));
  assert.doesNotMatch(target.textContent,/TP nicht prüfbar|TP weicht von oberer Range ab/);

  input.bots[0].limits={takeProfit:null,upper:100,takeProfitEvidence:'UNKNOWN'};
  const unknown=buildBotReadModel(input,{now:Date.parse(input.sourceSnapshotAt)+60000});
  renderBotReadState(target,{status:'fresh',model:unknown});
  indicators=all(target,'input').filter(node=>node.getAttribute('aria-label')?.startsWith('TP'));
  assert.ok(indicators.every(node=>node.disabled&&node.indeterminate));
  assert.match(target.textContent,/TP nicht prüfbar/);
  assert.match(target.textContent,/belegen kein ungesetztes TP/);
  assert.doesNotMatch(target.textContent,/Kein TP gesetzt|TP weicht von oberer Range ab/);

  renderBotReadState(target,{status:'stale'});
  assert.equal(all(target,'input').filter(node=>node.getAttribute('aria-label')?.startsWith('TP')).length,0);
  assert.doesNotMatch(target.textContent,/TP nicht prüfbar|TP-Wert: 90|obere Range: 100/);
  renderBotReadState(target,{status:'locked'});
  assert.equal(all(target,'input').filter(node=>node.getAttribute('aria-label')?.startsWith('TP')).length,0);
});

test('collapsed card summary visibly labels TP mismatch and unknown status',()=>{
  const input=snapshot('2026-10-12T20:00:00Z');
  input.bots[0].limits={takeProfit:90,upper:100,takeProfitEvidence:'PRICE_SET'};
  const target=root(),mismatch=buildBotReadModel(input,{now:Date.parse(input.sourceSnapshotAt)+60000});
  renderBotReadState(target,{status:'fresh',model:mismatch});
  const summary=all(target,'summary')[0];
  assert.match(summary.textContent,/⚠ TP ≠ obere Range/);
  assert.match(summary.getAttribute('aria-label'),/BTC.*Warnung: TP weicht von oberer Range ab/);
  assert.ok(all(target,'details')[0].getAttribute('open')===null,'warning is in the collapsed summary');

  input.bots[0].limits={takeProfit:null,upper:100,takeProfitEvidence:'UNKNOWN'};
  const unknown=buildBotReadModel(input,{now:Date.parse(input.sourceSnapshotAt)+60000});
  renderBotReadState(target,{status:'fresh',model:unknown});
  assert.match(all(target,'summary')[0].textContent,/TP nicht prüfbar/);
  assert.match(all(target,'summary')[0].getAttribute('aria-label'),/TP nicht prüfbar/);
  assert.doesNotMatch(all(target,'summary')[0].textContent,/TP ≠ obere Range|Kein TP gesetzt/);
});

 test('producer-to-view pipeline preserves typed price evidence and keeps missing evidence neutral',()=>{
   const stamp='2026-10-12T19:59:00Z',now=Date.parse('2026-10-12T20:00:00Z');
   const makeSnapshot=profitStopType=>buildAssetWatchApiSnapshot({
     pionexRisk:{snapshotAt:stamp,detailsComplete:true,bots:[normalizePionexBotOrder({
       buOrderType:'futures_grid',buOrderId:'synthetic-tp-pipeline',base:'BTC.PERP',quote:'USDT',
       status:'running',buOrderData:{status:'running',trend:'short',bottom:'50000',top:'100000',
         profitStopType,profitStop:profitStopType==='price'?'90000':undefined}
     })]},
     pionexBotSync:{status:'OK',lastSuccessAt:stamp}
   },{now});
   const comparable=makeSnapshot('price');
   assert.equal(comparable.bots[0].limits.takeProfitEvidence,'PRICE_SET');
   const model=buildBotReadModel(comparable,{now});
   assert.deepEqual(model.bots[0].takeProfitCheck,{set:true,matchesUpper:false,reason:null});
   const target=root();renderBotReadState(target,{status:'fresh',model});
   assert.match(all(target,'summary')[0].textContent,/⚠ TP ≠ obere Range/);
   assert.match(target.textContent,/TP weicht von oberer Range ab/);
   assert.match(target.textContent,/TP-Wert: 90000 · obere Range: 100000/);

   for(const type of [undefined,'percent','unknown']){
     const snapshot=makeSnapshot(type);
     assert.equal(snapshot.bots[0].limits.takeProfitEvidence,'UNKNOWN');
     const unknown=buildBotReadModel(snapshot,{now});
     assert.equal(unknown.bots[0].takeProfitCheck.set,null);
     renderBotReadState(target,{status:'fresh',model:unknown});
     assert.match(target.textContent,/TP nicht prüfbar/);
     assert.doesNotMatch(target.textContent,/Kein TP gesetzt|TP weicht von oberer Range ab/);
   }
 });

 test('signed P/L keeps tiny values visible and zero or missing values unconfirmed',()=>{
   for(const [value,tone] of [[-2.75,'negative'],[2.75,'positive'],[0,null],[-0,null],[null,null],[undefined,null],['2',null],[NaN,null],[Infinity,null]]){
     const state=fresh(),target=root();state.model.bots[0].metrics={pnlUsd:value,leverage:5,investmentUsd:120};
     renderBotReadState(target,state);
     const colored=all(target,'strong').filter(node=>node.className?.startsWith('bot-pnl-'));
     assert.equal(colored.length,tone?1:0);
     if(tone){assert.equal(colored[0].className,'bot-pnl-'+tone);assert.equal(colored[0].textContent,value<0?'-2,75 USD':'+2,75 USD');}
     else assert.match(target.textContent,/P\/L laut QuelleNicht verfügbar/);
   }
   for(const [value,expected] of [[-0.0004,'-<0,01 USD'],[0.0004,'+<0,01 USD'],[0.01,'+0,01 USD'],[1234567890123.4568,'+1.234.567.890.123,46 USD']]){
     const state=fresh(),target=root();state.model.bots[0].metrics={pnlUsd:value};
     renderBotReadState(target,state);
     const summary=all(target,'summary')[0];
     assert.ok(summary.textContent.includes(expected),expected);
     assert.ok(all(target,'strong').some(node=>node.textContent===expected));
   }
 });

 test('duplicate-symbol accessible names include visible metrics and disambiguate reference-tail collisions',()=>{
   const state=fresh(),target=root(),template=state.model.bots[0];
   state.model.bots=[
     {...template,ref:'a'.repeat(14)+'abcdef',metrics:{leverage:5,investmentUsd:125.5,pnlUsd:-2.75}},
     {...template,ref:'b'.repeat(14)+'abcdef',metrics:{leverage:2,investmentUsd:80,pnlUsd:1.25}}
   ];
   renderBotReadState(target,state);
   const names=all(target,'summary').map(summary=>summary.getAttribute('aria-label'));
   assert.deepEqual(names,[
     'BTC · Short · Hebel 5× · P/L laut Quelle -2,75 USD · Kapital 125,50 USD/USDT · TP nicht prüfbar · ID-Ende aabcdef · Aufklappen',
     'BTC · Short · Hebel 2× · P/L laut Quelle +1,25 USD · Kapital 80,00 USD/USDT · TP nicht prüfbar · ID-Ende babcdef · Aufklappen'
   ]);
   assert.ok(names.every(name=>!name.includes('a'.repeat(14))&&!name.includes('b'.repeat(14))));
 });

 test('USD, USDT and COIN-M capital keep source units and original detail precision',()=>{
   const cases=[
     {investmentUsd:125.5678,investmentAmount:99.9876,investmentCurrency:'USDT',
       collapsed:'125,57 USD/USDT',detail:'125.5678 USD/USDT'},
     {investmentUsd:0.004,investmentAmount:99.9876,investmentCurrency:'USDT',
       collapsed:'<0,01 USD/USDT',detail:'0.004 USD/USDT'},
     {investmentUsd:null,investmentAmount:12.3456,investmentCurrency:'USDT',
       collapsed:'12,35 USDT',detail:'12.3456 USDT'},
     {investmentUsd:null,investmentAmount:0.0000123456789,investmentCurrency:'BTC',
       collapsed:'0,0000123456789 BTC',detail:'0.0000123456789 BTC'}
   ];
   for(const input of cases){
     const state=fresh(),target=root();
     state.model.bots[0].metrics={...input,leverage:5.1234567890123,pnlUsd:0.0034567890123};
     renderBotReadState(target,state);
     const summary=all(target,'summary')[0];
     assert.ok(summary.textContent.includes(input.collapsed),input.collapsed);
     all(target,'button').find(node=>node.text==='Originalwerte anzeigen').click();
     assert.match(target.textContent,new RegExp(input.detail.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
     assert.match(target.textContent,/Hebel · Originalwert5.1234567890123×/);
     assert.match(target.textContent,/P\/L laut Quelle · Originalwert0.0034567890123 USD/);
     assert.match(summary.textContent,/\+<0,01 USD/);
   }
 });

 test('sorting continues to use unrounded source P/L values',()=>{
   const state=duplicateSnapshot(),target=root();
   state.model.bots[0].metrics={pnlUsd:-0.001};
   state.model.bots[1].metrics={pnlUsd:0.002};
   renderBotReadState(target,state,{sort:'pnl'});
   assert.deepEqual(all(target,'details').map(card=>card.id),['bot-card-'+ 'a'.repeat(20),'bot-card-'+ 'b'.repeat(20)]);
 });


test('Command source pill follows snapshot validity and clears counts on expiry, error and lock',()=>{
  const target=root(),pill=root();
  const snapshot={status:'fresh',count:33,snapshotAt:'2026-10-18T10:00:00Z',losses:[]};
  for(const [status,label] of [['loading','Wird geladen'],['stale','Daten veraltet'],
    ['unavailable','Nicht verfügbar'],['locked','Gesperrt'],['unexpected','Nicht verfügbar']]){
    renderCommandBotOverview(target,snapshot,null,pill);
    assert.equal(pill.textContent,'33 Bots im Snapshot');
    renderCommandBotOverview(target,{status},null,pill);
    assert.equal(pill.textContent,label);
    assert.doesNotMatch(pill.textContent,/33/);
  }
  renderCommandBotOverview(target,{...snapshot,count:0},null,pill);
  assert.equal(pill.textContent,'0 Bots im Snapshot');
  assert.match(target.textContent,/Dies bestätigt kein leeres Wallet/);
  renderCommandBotOverview(target,{...snapshot,count:null},null,pill);
  assert.equal(pill.textContent,'Nicht verfügbar');
});

test('Command equal-symbol equal-loss actions have distinct references and directions',()=>{
  const target=root(),selected=[];
  renderCommandBotOverview(target,{status:'fresh',source:'PIONEX_BOT_API',snapshotAt:'2026-10-18T10:00:00Z',count:2,
    distribution:{long:1,short:1,neutral:0,unknown:0},losses:[
      {ref:'a'.repeat(20),symbol:'BTC',direction:'long',pnl:'-25,00 USD',pnlDetail:'-25 USD',pnlTone:'negative'},
      {ref:'b'.repeat(20),symbol:'BTC',direction:'short',pnl:'-25,00 USD',pnlDetail:'-25 USD',pnlTone:'negative'}]},ref=>selected.push(ref));
  const buttons=all(target,'button');
  assert.notEqual(buttons[0].textContent,buttons[1].textContent);
  assert.notEqual(buttons[0].getAttribute('aria-label'),buttons[1].getAttribute('aria-label'));
  assert.match(buttons[0].textContent,/BTC · Long/);assert.match(buttons[0].textContent,/-25,00 USD/);
  assert.match(buttons[1].textContent,/BTC · Short/);assert.match(buttons[1].textContent,/-25,00 USD/);
  assert.doesNotMatch(buttons[0].textContent,/Referenz/);
  assert.match(buttons[0].getAttribute('aria-label'),/Referenz a{20}/);
  assert.match(buttons[1].getAttribute('aria-label'),/Referenz b{20}/);
  assert.match(all(target,'details').find(node=>node.className==='command-bot-details').textContent,/Technische Referenz: a{20}/);
  const detailNames=all(target,'summary').filter(node=>node.getAttribute('aria-label')?.startsWith('Details zu'));
  assert.deepEqual(detailNames.map(node=>node.getAttribute('aria-label')),[
    'Details zu BTC · Long · Referenz '+'a'.repeat(20),'Details zu BTC · Short · Referenz '+'b'.repeat(20)]);
  assert.match(target.textContent,/18\.10\.2026, 10:00 UTC/);
  assert.equal(all(target,'time')[0].textContent,'2026-10-18T10:00:00Z');
  assert.equal(all(target,'time')[0].getAttribute('datetime'),'2026-10-18T10:00:00Z');
  assert.match(target.textContent,/Quelle & Zeit/);assert.match(target.textContent,/Long 1 · Short 1 · Neutral 0 · Unbekannt 0/);
  buttons.forEach(button=>button.click());assert.deepEqual(selected,['a'.repeat(20),'b'.repeat(20)]);
});
test('Command keeps unavailable status distinct from unknown fresh metadata',()=>{
  const target=root();
  renderCommandBotOverview(target,{status:'fresh',source:'unknown',count:null,distribution:{},
    snapshotAt:'invalid',losses:[]});
  assert.equal(target.getAttribute('data-state'),'fresh');
  assert.match(target.textContent,/Zeit unbekannt · Unbekannt Bots · nur lesend/);
  assert.match(target.textContent,/Quelle: Unbekannt/);
  assert.match(target.textContent,/Richtung: Long Unbekannt · Short Unbekannt · Neutral Unbekannt · Unbekannt Unbekannt/);
  assert.match(target.textContent,/Keine bestätigten negativen P\/L-Werte/);
  assert.equal(all(target,'time')[0].getAttribute('datetime'),null);
  for(const status of ['locked','stale','unavailable']){
    renderCommandBotOverview(target,{status});
    assert.equal(target.getAttribute('data-state'),status);
    assert.notEqual(target.textContent,'Zeit unbekannt · Unbekannt Bots · nur lesend');
  }
});


const change=(node,type,value)=>{node.value=value;for(const listener of node.listeners.get(type)||[])listener();};
const returnButton=h=>all(h.target,'button').find(node=>node.text==='Zur vorherigen Auswahl zurück');
function duplicateSnapshot(){const state=fresh();state.model.bots.push({...state.model.bots[0],ref:'b'.repeat(20),side:'LONG'});return state;}
test('disclosure actions open and close visible bots and preserve filtered-out state',()=>{
  const h=mounted(),state=duplicateSnapshot();h.publish(state);
  const cards=()=>all(h.target,'details');
  const button=text=>all(h.target,'button').find(node=>node.text===text);
  const nativeToggle=(card,open)=>{
    if(open)card.setAttribute('open','');else card.removeAttribute('open');
    for(const listener of card.listeners.get('toggle')||[])listener();
  };
  const first=cards()[0],summary=first.querySelector('summary');
  for(const open of [true,false,true]){
    nativeToggle(first,open);
    assert.equal(first.getAttribute('open')!==null,open);
    assert.match(summary.getAttribute('aria-label'),open?/Zuklappen$/:/Aufklappen$/);
  }
  button('Alle aufklappen').click();assert.ok(cards().every(card=>card.getAttribute('open')!==null));
  button('Alle zuklappen').click();assert.ok(cards().every(card=>card.getAttribute('open')===null));
  nativeToggle(cards()[0],true);
  change(all(h.target,'select')[0],'change','long');
  button('Alle aufklappen').click();assert.equal(cards().length,1);
  button('Alle zuklappen').click();
  change(all(h.target,'select')[0],'change','all');
  assert.deepEqual(cards().map(card=>card.getAttribute('open')!==null),[true,false]);
  button('Bot zuklappen').click();
  assert.equal(cards()[0].getAttribute('open'),null);
  assert.equal(h.target.ownerDocument.activeElement,cards()[0].querySelector('summary'));
  change(all(h.target,'select')[2],'change','pnl');
  assert.ok(cards().every(card=>card.getAttribute('open')===null));
  assert.equal(h.calls.refresh,0);assert.equal(h.calls.lock,0);
});

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

const walletScopeSnapshot=()=>({...snapshot('2026-10-12T20:00:00Z'),usableForDisplay:true,
  overwriteScope:'WALLET_FUTURES_GRID',excludedScope:'KNOWN_EXCLUDED_PRODUCTS',overwriteRejectionReasons:[],
  coverage:{status:'PARTIAL',listRows:2,recognizedRows:1,representedRows:1,
    unsupportedRows:1,unhydratedRows:0,paginationComplete:true}});
function scopeViews(input){
  const bots=root(),command=root();
  const model=buildBotReadModel(input,{now:Date.parse('2026-10-12T20:01:00Z')});
  const view=createBotReadView(bots,{createClient:({onChange})=>{
    onChange({status:model.status==='FRESH_SNAPSHOT'?'fresh':model.status==='STALE'?'stale':'unavailable',model});
    return {refresh(){},lock(){},revalidate(){},dispose(){}};
  },onSnapshot:data=>renderCommandBotOverview(command,data)});
  return {bots,command,view};
}
test('both views separate global wallet partial coverage from confirmed supported grid scope',()=>{
  for(const excludedScope of ['KNOWN_EXCLUDED_PRODUCTS','NONE']){
    const input=walletScopeSnapshot();input.excludedScope=excludedScope;
    const {bots,command,view}=scopeViews(input);
    for(const target of [bots,command]){
      assert.match(target.textContent,/Teilabdeckung: 1 von 2/);
      assert.match(target.textContent,/Futures-Grid-Datenumfang: von der Quelle bestätigt/);
      assert.equal(target.textContent.includes('Bekannte ausgeschlossene Produkte'),excludedScope==='KNOWN_EXCLUDED_PRODUCTS');
      assert.match(target.textContent,/Keine Bestätigung der Vollständigkeit des Wallets/);
      assert.doesNotMatch(target.textContent,/WALLET_FUTURES_GRID|KNOWN_EXCLUDED_PRODUCTS|usableForOverwrite/);
    }
    view.dispose();
  }
});
test('missing malformed unknown and rejecting scope evidence never confirms the grid scope in either view',()=>{
  const invalid=[
    ['usableForOverwrite',false],['usableForOverwrite',undefined],['usableForOverwrite','true'],
    ['overwriteScope',undefined],['overwriteScope','NONE'],['overwriteScope','PRIMARY_BOT_API'],
    ['overwriteScope','PRIVATE<script>'],['overwriteScope',{}],
    ['excludedScope',undefined],['excludedScope','UNVERIFIED'],['excludedScope','PRIVATE<script>'],
    ['excludedScope',{}],['overwriteRejectionReasons',undefined],['overwriteRejectionReasons',null],
    ['overwriteRejectionReasons',{}],['overwriteRejectionReasons',''],
    ['overwriteRejectionReasons',['PRIVATE<script>']],['overwriteRejectionReasons',[null]],
    ['overwriteRejectionReasons',[{}]],['overwriteRejectionReasons',Array(1)],
    ['overwriteRejectionReasons',['SOURCE_STALE','PRIVATE<script>']],
    ['overwriteRejectionReasons',Array(11).fill('SOURCE_STALE')]
  ];
  for(const reason of ['UNSUPPORTED_SCOPE','SUPPORTED_HYDRATION_MISSING','SANITIZATION_LOSS_OR_DUPLICATE',
    'PAGINATION_INCOMPLETE','EXPLICIT_PARTIAL','SYNC_PARTIAL','DETAILS_INCOMPLETE',
    'SOURCE_STATUS_NOT_OK','SOURCE_STALE','SOURCE_UNAVAILABLE'])
    invalid.push(['overwriteRejectionReasons',[reason]]);
  for(const [key,value] of invalid){
    const input=walletScopeSnapshot();input[key]=value;
    const {bots,command,view}=scopeViews(input);
    assert.match(bots.textContent,/BTC/);
    for(const target of [bots,command]){
      assert.match(target.textContent,/1 Bots/);
      assert.match(target.textContent,/Futures-Grid-Datenumfang: nicht bestätigt/,key);
      assert.doesNotMatch(target.textContent,/von der Quelle bestätigt|PRIVATE|script|SOURCE_STALE|UNSUPPORTED_SCOPE/);
    }
    view.dispose();
  }
});
test('known rejection reasons render only fixed German explanations and primary API has no wallet claim',()=>{
  const input=walletScopeSnapshot();
  input.overwriteRejectionReasons=['SUPPORTED_HYDRATION_MISSING','PAGINATION_INCOMPLETE'];
  const rejected=scopeViews(input);
  for(const target of [rejected.bots,rejected.command]){
    assert.match(target.textContent,/Details unterstützter Bots fehlen/);
    assert.match(target.textContent,/Die Listenseiten sind nicht vollständig bestätigt/);
    assert.doesNotMatch(target.textContent,/SUPPORTED_HYDRATION_MISSING|PAGINATION_INCOMPLETE/);
  }
  rejected.view.dispose();
  input.source='PIONEX_BOT_API';input.overwriteRejectionReasons=[];
  const primary=scopeViews(input),legacyInput={...input};
  for(const key of ['overwriteScope','excludedScope','usableForOverwrite','overwriteRejectionReasons'])delete legacyInput[key];
  const legacy=scopeViews(legacyInput);
  assert.equal(primary.bots.textContent,legacy.bots.textContent);
  assert.equal(primary.command.textContent,legacy.command.textContent);
  for(const target of [primary.bots,primary.command])
    assert.doesNotMatch(target.textContent,/Futures-Grid-Datenumfang|ausgeschlossene Produkte|Wallet/);
  primary.view.dispose();legacy.view.dispose();
});
test('empty scope snapshots differ from filter-empty results and reset or status updates do not fetch',()=>{
  const input=walletScopeSnapshot();input.bots=[];input.botCount=0;
  const empty=scopeViews(input);
  for(const target of [empty.bots,empty.command]){
    assert.match(target.textContent,/Keine darstellbaren Bots in diesem Snapshot/);
    assert.match(target.textContent,/Dies bestätigt kein leeres Wallet/);
    assert.doesNotMatch(target.textContent,/Keine Bots entsprechen den Filtern/);
  }
  empty.view.dispose();
  const h=mounted(),model=buildBotReadModel(walletScopeSnapshot(),{now:Date.parse('2026-10-12T20:01:00Z')});
  h.publish({status:'fresh',model});
  const live=all(h.target,'div').find(node=>node.getAttribute('role')==='status');
  change(all(h.target,'input')[0],'input','NO_MATCH');
  assert.match(h.target.textContent,/Keine Bots entsprechen den Filtern/);
  assert.doesNotMatch(h.target.textContent,/Keine darstellbaren Bots|kein leeres Wallet/);
  assert.match(h.target.textContent,/Futures-Grid-Datenumfang: von der Quelle bestätigt/);
  all(h.target,'button').find(node=>node.text==='Filter zurücksetzen').click();
  assert.match(h.target.textContent,/BTC/);
  h.publish({status:'stale',model});
  assert.equal(all(h.target,'div').find(node=>node.getAttribute('role')==='status'),live);
  assert.match(h.target.textContent,/Bitte Bots manuell aktualisieren/);
  assert.doesNotMatch(h.target.textContent,/BTC|Futures-Grid-Datenumfang|2026-10-12/);
  assert.equal(h.calls.refresh,0);h.view.dispose();
});
test('both views clear scope rows times and badges on invalidation and keep stable accessible status',()=>{
  const h=mounted(),command=root(),model=buildBotReadModel(walletScopeSnapshot(),{now:Date.parse('2026-10-12T20:01:00Z')});
  model.bots[0].productCategory='FUTURES_MOON';
  renderCommandBotOverview(command,{status:'locked'});
  const live=all(command,'div').find(node=>node.getAttribute('role')==='status');
  assert.equal(live.getAttribute('aria-live'),'polite');assert.equal(live.getAttribute('aria-atomic'),'true');
  for(const status of ['stale','unavailable','locked','loading']){
    h.publish({status:'fresh',model});
    renderCommandBotOverview(command,{...model,status:'fresh',count:1,losses:[]});
    h.publish({status,model});renderCommandBotOverview(command,{...model,status});
    for(const target of [h.target,command]){
      assert.equal(all(target,'li').length,0);assert.equal(all(target,'time').length,0);
      assert.doesNotMatch(target.textContent,/BTC|2026-10-12|Futures-Grid-Datenumfang|Futures Moon/);
      assert.match(target.textContent,new RegExp({stale:'Daten veraltet',unavailable:'Nicht verfügbar',
        locked:'Gesperrt',loading:'Wird geladen'}[status]));
      if(status==='stale')assert.match(target.textContent,/Bitte Bots manuell aktualisieren/);
    }
    assert.equal(all(command,'div').find(node=>node.getAttribute('role')==='status'),live);
  }
  assert.equal(h.calls.refresh,0);h.view.dispose();
});
test('invalid and expired source envelopes cannot publish scope confirmation through either view',()=>{
  for(const mutate of [input=>input.sourceSnapshotAt='2026-10-12T19:00:00Z',
    input=>input.schemaVersion='INVALID',input=>input.botCount=2]){
    const input=walletScopeSnapshot();mutate(input);
    const {bots,command,view}=scopeViews(input);
    for(const target of [bots,command]){
      assert.equal(all(target,'time').length,0);assert.equal(all(target,'li').length,0);
      assert.doesNotMatch(target.textContent,/BTC|Futures-Grid-Datenumfang|2026-10-12/);
    }
    view.dispose();
  }
});

test('readable detail toggle retains exact source values, tiny nonzero prices and TP evidence',()=>{
  const target=root(),state=fresh(),bot=state.model.bots[0];
  bot.metrics={leverage:10,investmentUsd:1000,pnlUsd:-0.0000000123456789,
    lower:71805.1,upper:97148,liquidationPrice:71165.18612216676,takeProfit:180000,
    stopLoss:0.000000000123456789};
  bot.takeProfitEvidence='PRICE_SET';bot.takeProfitCheck={matchesUpper:false};
  const original=structuredClone(bot);
  renderBotReadState(target,state);
  const metrics=all(target,'dl')[0],toggle=all(target,'button').find(node=>node.text==='Originalwerte anzeigen');
  assert.match(metrics.textContent,/Liquidationspreis laut Quelle71\.165,19/);
  assert.match(metrics.textContent,/Grid-Untergrenze71\.805,1/);
  assert.match(metrics.textContent,/Stop-Loss0,000000000123457/);
  assert.doesNotMatch(metrics.textContent,/Originalwert|71165\.18612216676/);
  assert.match(target.textContent,/TP-Wert: 180000 · obere Range: 97148/);
  assert.equal(toggle.getAttribute('aria-pressed'),'false');
  toggle.focus();toggle.click();
  assert.equal(toggle.getAttribute('aria-pressed'),'true');assert.equal(target.ownerDocument.activeElement,toggle);
  assert.match(metrics.textContent,/Liquidationspreis laut Quelle71165\.18612216676/);
  assert.match(metrics.textContent,/P\/L laut Quelle · Originalwert-1\.23456789e-8 USD/);
  assert.match(metrics.textContent,/Stop-Loss1\.23456789e-10/);
  assert.match(metrics.textContent,/Grid-GewinnNicht verfügbar/);
  toggle.click();assert.match(metrics.textContent,/Liquidationspreis laut Quelle71\.165,19/);
  assert.deepEqual(bot,original,'formatting cannot mutate comparison or source data');
  assert.equal(all(target,'details').length,1,'format toggle does not create nested bot disclosures');
  assert.ok(all(target,'button').some(node=>node.text==='Bot zuklappen'));
  renderBotReadState(target,{status:'locked'});assert.doesNotMatch(target.textContent,/71\.165|71165|Originalwerte/);
});

test('missing P/L explains only bounded reason codes and never exposes raw source messages',()=>{
  const labels={USD_VALUE_MISSING:'Kein bestätigter P/L-Wert in USD vorhanden.',
    WALLET_PROFIT_UNIT_UNCONFIRMED:'Die Einheit des gelieferten Gewinnwerts ist nicht bestätigt.',
    WALLET_USD_PRICE_MISSING:'Für den gelieferten Gewinnwert fehlt ein bestätigter USD-Umrechnungskurs.',
    ZERO_VALUE_UNCONFIRMED:'Ein Nullwert ist vorhanden'};
  for(const code of [...Object.keys(labels),undefined,'RAW_SECRET','constructor']){
    const target=root(),state=fresh();state.model.bots[0].metrics.pnlUnavailableReason=code;
    renderBotReadState(target,state);
    const reason=target.querySelector('.bot-pnl-unavailable-reason');
    assert.ok(reason.textContent.includes(Object.hasOwn(labels,code)?labels[code]:labels.USD_VALUE_MISSING));
    assert.doesNotMatch(target.textContent,/RAW_SECRET|constructor/);
    state.model.bots[0].metrics.pnlUsd=12.34;
    renderBotReadState(target,state);
    assert.equal(target.querySelector('.bot-pnl-unavailable-reason'),null,'valid P/L must not show stale missing-value diagnosis');
  }
});
