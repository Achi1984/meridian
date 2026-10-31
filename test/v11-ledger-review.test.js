import test from 'node:test';
import assert from 'node:assert/strict';
import {ledgerReviewHoldings} from '../v11/ledger-review-model.js';
import {confirmReviewedLedger} from '../ledger-reviewed-authority.js';
import {createLedgerReviewClient} from '../v11/ledger-review-client.js';
import {mountLedgerReview} from '../v11/ledger-review-view.js';
import fs from 'node:fs';
const current=()=>({privateRevision:3,portfolio:{holdings:[{venue:'Ledger',symbol:'BTC',quantity:'0.123456789'},{venue:'OKX',symbol:'ETH',quantity:8}]}});
const payload=()=>({private:true,data:current()});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('projects actual stored quantities only and rejects missing or invalid Ledger rows',()=>{
  assert.deepEqual(ledgerReviewHoldings(current()),[{symbol:'BTC',quantity:'0.123456789'}]);
  for(const quantity of [null,'',-1,Infinity,'Infinity','1e9999']){
    const c=current();c.portfolio.holdings[0].quantity=quantity;assert.equal(ledgerReviewHoldings(c),null);
  }
  assert.equal(ledgerReviewHoldings({}),null);
});
test('reviewed action compares quantities before any write and CAS blocks concurrent change',async()=>{
  const c=current(),reviewedHoldings=ledgerReviewHoldings(c);let writes=0;
  const db={async query(sql,args){writes++;assert.match(sql,/WHERE key=\$1 AND value=\$3::jsonb RETURNING key/);assert.deepEqual(JSON.parse(args[2]),c);return {rowCount:0};}};
  assert.equal((await confirmReviewedLedger({db,key:'test',current:c,body:{reviewedHoldings:[]}})).status,409);
  assert.equal(writes,0);
  assert.equal((await confirmReviewedLedger({db,key:'test',current:c,body:{reviewedHoldings}})).status,409);
  assert.equal(writes,1);
});
test('successful guarded update preserves amounts and stamps only Ledger authority',async()=>{
  const c=current(),now='2026-10-31T12:00:00.000Z';let saved;
  const result=await confirmReviewedLedger({db:{async query(sql,args){saved=JSON.parse(args[1]);return {rowCount:1};}},key:'test',current:c,body:{reviewedHoldings:ledgerReviewHoldings(c)},now});
  assert.equal(result.action,'confirm_ledger_reviewed');assert.equal(saved.portfolio.ledgerAuthorityAt,now);
  assert.equal(saved.portfolio.holdings[0].quantity,'0.123456789');assert.deepEqual(saved.portfolio.holdings[1],c.portfolio.holdings[1]);
});
test('quantity changes and added Ledger assets since display reject before SQL',async()=>{
  const displayed=ledgerReviewHoldings(current());let writes=0;
  const db={query(){writes++;throw Error('must not write');}};
  for(const change of [c=>c.portfolio.holdings[0].quantity='0.5',c=>c.portfolio.holdings.push({venue:'Ledger',symbol:'ETH',quantity:2})]){
    const c=current();change(c);
    const result=await confirmReviewedLedger({db,key:'test',current:c,body:{reviewedHoldings:displayed}});
    assert.equal(result.status,409);assert.equal(c.portfolio.ledgerAuthorityAt,undefined);
  }
  assert.equal(writes,0);
});
test('reads never confirm; explicit confirmation uses exactly displayed holdings and cannot double-submit',async()=>{
  let requests=[],states=[],release;
  const client=createLedgerReviewClient({getToken:()=> 'password',onChange:s=>states.push(s),fetchImpl:async(url,opts)=>{
    requests.push({url,...opts});if(opts.method==='GET')return response(payload());
    await new Promise(r=>release=r);return response({ok:true,action:'confirm_ledger_reviewed',updatedAt:'2026-10-31T12:00:00Z'});
  }});
  await client.confirm();assert.equal(requests.length,0);
  await client.load();assert.equal(requests.length,1);assert.deepEqual(states.at(-1).holdings,ledgerReviewHoldings(current()));
  const pending=client.confirm();await client.confirm();assert.equal(requests.length,2);
  assert.deepEqual(JSON.parse(requests[1].body),{action:'confirm_ledger_reviewed',reviewedHoldings:ledgerReviewHoldings(current())});
  release();await pending;assert.equal(states.at(-1).status,'confirmed');client.dispose();
});
test('lock/token change/auth rejection wipe review and prevent writes',async()=>{
  let token='password',calls=0,states=[],locks=0;
  const c=createLedgerReviewClient({getToken:()=>token,onChange:s=>states.push(s),onLock:()=>locks++,fetchImpl:async()=>{calls++;return response(payload());}});
  await c.load();token='new-password';await c.confirm();assert.equal(calls,1);assert.equal(states.at(-1).status,'locked');
  token=null;await c.load();assert.equal(calls,1);c.dispose();
  const denied=createLedgerReviewClient({getToken:()=> 'password',onChange:s=>states.push(s),onLock:()=>locks++,fetchImpl:async()=>response({},401)});
  await denied.load();assert.equal(locks,1);assert.equal(states.at(-1).status,'locked');denied.dispose();
});
test('failed write or changed review clears pending holdings; no retry without new review',async()=>{
  for(const status of [409,500]){
    let calls=0,states=[];
    const c=createLedgerReviewClient({getToken:()=> 'password',onChange:s=>states.push(s),fetchImpl:async()=>{calls++;return calls===1?response(payload()):response({},status);}});
    await c.load();await c.confirm();assert.equal(states.at(-1).status,status===409?'changed':'write_failed');
    await c.confirm();assert.equal(calls,2);c.dispose();
  }
});
test('displayed review is actual stored quantity, explicit control only; lock clears it and success is Ledger-only',()=>{
  class Node{
    constructor(doc,tag){this.ownerDocument=doc;this.tag=tag;this.children=[];this.text='';this.events={};}
    set textContent(t){this.text=t;this.children=[];}get textContent(){return this.text+this.children.map(n=>n.textContent).join(' ');}
    append(...n){this.children.push(...n);}replaceChildren(...n){this.text='';this.children=n;}
    setAttribute(){}addEventListener(t,f){this.events[t]=f;}removeEventListener(t){delete this.events[t];}
  }
  const doc={createElement:t=>new Node(doc,t)},root=doc.createElement('div');let emit,loads=0,writes=0,clear;
  const access={getToken:()=> 'password',lock(){clear();},registerReader(fn){clear=fn;return()=>{};},subscribe(){return()=>{};}};
  const mounted=mountLedgerReview(root,{access,createClient:({onChange})=>{emit=onChange;return {load(){loads++;},confirm(){writes++;},lock(){emit({status:'locked'});},revalidate(){},dispose(){}};}});
  const section=root.children[0],load=section.children[2],confirm=section.children[4];
  assert.equal(loads,0);assert.equal(writes,0);assert.equal(confirm.hidden,true);
  load.events.click();assert.equal(loads,1);
  emit({status:'review',holdings:ledgerReviewHoldings(current())});
  assert.match(root.textContent,/BTC: 0.123456789/);assert.equal(confirm.hidden,false);assert.equal(writes,0);
  confirm.events.click();assert.equal(writes,1);
  emit({status:'saving'});assert.equal(confirm.disabled,true);assert.equal(load.disabled,true);
  emit({status:'confirmed',updatedAt:'2026-10-31T12:00:00Z'});
  assert.match(root.textContent,/24 Stunden/);assert.match(root.textContent,/Nur Ledger bestätigt/);assert.match(root.textContent,/weiterhin fehlen oder veraltet/);
  clear();assert.doesNotMatch(root.textContent,/0.123456789/);assert.equal(confirm.hidden,true);mounted.dispose();
});
test('lock during pending load ignores late data and no confirmation is possible',async()=>{
  let resolve,calls=0,states=[];
  const c=createLedgerReviewClient({getToken:()=> 'password',onChange:s=>states.push(s),fetchImpl:()=>{calls++;return new Promise(r=>resolve=r);}});
  const p=c.load();c.lock();resolve(response(payload()));await p;
  assert.equal(states.at(-1).status,'locked');await c.confirm();assert.equal(calls,1);c.dispose();
});
test('gateway retains auth and only legacy path uses blind stateSet',()=>{
  const source=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
  const route=source.slice(source.indexOf('if(req.method==="POST"&&u.pathname==="/api/private/portfolio-authority")'),source.indexOf('if(req.method==="POST"&&u.pathname==="/api/private/asset-watch-share")'));
  assert.match(route,/if\(!authorizedRead\(req\)\)/);
  assert.match(route,/body\?\.action==="confirm_ledger_reviewed"/);
  assert.match(route,/await confirmReviewedLedger\(/);
  assert.match(route,/if\(!reviewed\)await stateSet\(PRIVATE_STATE_KEY,merged.data\)/);
  assert.ok(route.indexOf('if(!merged.ok)')<route.indexOf('capturePortfolioHistoryOnce'));
});
