import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLedgerManualSnapshot,saveLedgerManualSnapshot,validateLedgerManualSnapshot} from '../ledger-manual-snapshot.js';
import {buildLedgerManualModel,parseLedgerManualText} from '../v11/ledger-manual-model.js';
import {createLedgerManualClient} from '../v11/ledger-manual-client.js';
import {mountLedgerManual} from '../v11/ledger-manual-view.js';
const at='2026-01-01T00:00:00.000Z',now=Date.parse(at)+1000;
const snapshot=()=>({source:'USER_MANUAL_SNAPSHOT',observedAt:at,holdings:[{symbol:'BTC',quantity:'0.2'},{symbol:'USDC',quantity:'0'}]});
const current=()=>({privateRevision:2,portfolio:{ledgerAuthorityAt:at,ledgerAuthoritySource:'old',holdings:[{venue:'Ledger',symbol:'BTC',quantity:'1'},{venue:'Pionex',symbol:'ETH',quantity:'9'}]}});
test('manual snapshot bounds, exact decimals and times reject ambiguous/invalid data',()=>{
  assert.equal(parseLedgerManualText('BTC;0,2\nUSDC;0',at).holdings[0].quantity,'0.2');
  for(const q of ['-1','1e3','NaN','1,000.1','']){const s=snapshot();s.holdings[0].quantity=q;assert.equal(validateLedgerManualSnapshot(s,{now}),null);}
  const duplicate=snapshot();duplicate.holdings.push(duplicate.holdings[0]);assert.equal(validateLedgerManualSnapshot(duplicate,{now}),null);
  assert.equal(validateLedgerManualSnapshot({...snapshot(),observedAt:'2026-02-30T00:00:00.000Z'},{now}),null);
  assert.equal(validateLedgerManualSnapshot({...snapshot(),observedAt:new Date(now+1).toISOString()},{now}),null);
});
test('only Ledger replaced, zero retained, legacy authority removed and CAS forbids concurrent overwrite',async()=>{
  const c=current(),body={expectedRevision:2,snapshot:snapshot()},prepared=prepareLedgerManualSnapshot(c,body,{now:new Date(now).toISOString()});
  assert.equal(prepared.ok,true);assert.deepEqual(prepared.data.portfolio.holdings[0],c.portfolio.holdings[1]);
  assert.equal(prepared.data.portfolio.holdings[2].quantity,'0');assert.equal(prepared.data.portfolio.ledgerAuthorityAt,undefined);
  assert.equal(c.portfolio.holdings[0].quantity,'1');let writes=0;
  const db={async query(sql,args){writes++;assert.match(sql,/value=\$3::jsonb/);assert.deepEqual(JSON.parse(args[2]),c);return {rowCount:0};}};
  assert.equal((await saveLedgerManualSnapshot({db,key:'fixture',current:c,body:{...body,expectedRevision:1}})).status,409);assert.equal(writes,0);
  assert.equal((await saveLedgerManualSnapshot({db,key:'fixture',current:c,body})).status,409);assert.equal(writes,1);
});
test('valuation uses latest returned public quotes, never screenshot dollars; stale/missing price blocks total',()=>{
  let m=buildLedgerManualModel(snapshot(),{tickers:[{symbol:'BTCUSDT',price:'100'}],pricesAt:now,now});
  assert.equal(m.total,20);assert.equal(m.holdings[1].value,0);assert.equal(m.observedAt,at);
  m=buildLedgerManualModel(snapshot(),{tickers:[{symbol:'BTCUSDT',price:'200'}],pricesAt:now,now});assert.equal(m.total,40);
  for(const tickers of [[],[{symbol:'BTCUSDT',price:'0'}],[{symbol:'BTCUSDT',price:'100'},{symbol:'BTCUSDT',price:'200'}]])
    assert.equal(buildLedgerManualModel(snapshot(),{tickers,pricesAt:now,now}).total,null);
  assert.equal(buildLedgerManualModel(snapshot(),{tickers:[{symbol:'BTCUSDT',price:'100'}],pricesAt:now-180001,now}).total,null);
});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('public quote request carries no credential; private save needs explicit separate key and fresh revision',async()=>{
  const calls=[],states=[];const c=createLedgerManualClient({getToken:()=> 'read-fixture',now:()=>now,onChange:s=>states.push(s),fetchImpl:async(url,opts)=>{
    calls.push({url,...opts});if(url.includes('ticker')){assert.equal(opts.headers.authorization,undefined);return response([{symbol:'BTCUSDT',price:'100'}]);}
    if(opts.method==='POST'){assert.equal(opts.headers.authorization,'Bearer read-fixture');assert.equal(opts.headers['x-meridian-write-token'],'write-fixture');assert.equal(JSON.parse(opts.body).expectedRevision,2);return response({ok:true,revision:3});}
    return response({private:true,data:{...current(),portfolio:{ledgerManualSnapshot:snapshot()}}});
  }});
  await c.save(snapshot(),'write-fixture');assert.equal(calls.length,0);await c.load();assert.equal(states.at(-1).model.total,20);
  await c.save(snapshot(),'');assert.equal(calls.length,2);await c.save(snapshot(),'write-fixture');assert.equal(states.at(-1).status,'saved');
  await c.save(snapshot(),'write-fixture');assert.equal(calls.length,3);c.dispose();assert.equal(states.at(-1).status,'locked');
});
test('failed/unknown save cannot retry and lock cancels late private response',async()=>{
  let resolve,posts=0;const states=[];const c=createLedgerManualClient({getToken:()=> 'read-fixture',now:()=>now,onChange:s=>states.push(s),fetchImpl:async(url,opts)=>{
    if(url.includes('ticker'))return response([]);if(opts.method==='POST'){posts++;return response({},500);}
    return response({private:true,data:current()});
  }});
  await c.load();await c.save(snapshot(),'write-fixture');assert.equal(states.at(-1).status,'write_unknown');await c.save(snapshot(),'write-fixture');assert.equal(posts,1);c.dispose();
  const late=createLedgerManualClient({getToken:()=> 'read-fixture',onChange:s=>states.push(s),fetchImpl:async(url)=>url.includes('ticker')?response([]):new Promise(r=>resolve=r)});
  const p=late.load();late.lock();resolve(response({private:true,data:current()}));await p;assert.equal(states.at(-1).status,'locked');late.dispose();
});
test('Ledger UI separates quantities and prices, only explicit submit writes, lock wipes private inputs',()=>{
  class Node{constructor(doc,tag){this.ownerDocument=doc;this.tag=tag;this.children=[];this.events={};this.value='';this.text='';}
    append(...n){this.children.push(...n);}replaceChildren(...n){this.text='';this.children=n;}remove(){}
    set textContent(t){this.text=t;this.children=[];}get textContent(){return this.text+this.children.map(x=>x.textContent).join(' ');}
    setAttribute(){}addEventListener(k,f){this.events[k]=f;}removeEventListener(k){delete this.events[k];}}
  const doc={createElement:t=>new Node(doc,t)},root=doc.createElement('main');let emit,clear,saves=0,loads=0;
  const access={getToken:()=> 'read-fixture',isUnlocked:()=>true,lock(){clear();},registerReader(f){clear=f;return()=>{};},subscribe(){return()=>{};}};
  const view=mountLedgerManual(root,{access,createClient:({onChange})=>{emit=onChange;return {load(){loads++;},save(){saves++;emit({status:'saving'});},lock(){emit({status:'locked'});},revalidate(){},dispose(){}};}});
  const all=(node)=>[node,...node.children.flatMap(all)],nodes=all(root),load=nodes.find(n=>n.tag==='button'),form=nodes.find(n=>n.tag==='form');
  const qty=nodes.find(n=>n.tag==='textarea'),date=nodes.find(n=>n.type==='datetime-local'),key=nodes.find(n=>n.type==='password');
  assert.equal(loads,0);assert.equal(saves,0);load.events.click();assert.equal(loads,1);
  emit({status:'ready',model:buildLedgerManualModel(snapshot(),{tickers:[{symbol:'BTCUSDT',price:'100'}],pricesAt:now,now})});
  assert.match(root.textContent,/20,00 USDT/);assert.match(root.textContent,/kein Gesamtvermögen/);
  qty.value='BTC;0.2';date.value='2026-01-01T01:00';key.value='write-fixture';form.events.submit({preventDefault(){}});
  assert.equal(saves,1);assert.equal(key.value,'');qty.value='BTC;0.3';key.value='secret-fixture';clear();
  assert.equal(qty.value,'');assert.equal(key.value,'');assert.equal(date.value,'');assert.doesNotMatch(root.textContent,/20,00 USDT/);view.dispose();
});
