import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOkxDepotModel} from '../v11/depot-current-model.js';
import {createDepotReadClient} from '../v11/depot-read-client.js';
import {createDepotReadView} from '../v11/depot-read-view.js';
import {mountDepotReadAccess} from '../v11/depot-read-bootstrap.js';
const now=Date.parse('2026-01-01T00:00:00Z');
const row={venue:'OKX',valueUsd:'42',updatedAt:new Date(now).toISOString(),source:'OKX_READ_API_ASSET_VALUATION'};
const payload=(rows=[row])=>({private:true,data:{portfolio:{manualVenueBalances:rows}}});
test('OKX expiry is scheduled even when the Pionex projection is unavailable',()=>{
  let callback,delay,emit,revalidated=0,cancelled=0;
  const access={getToken:()=>null,isUnlocked:()=>false,subscribe:()=>()=>{},registerReader:()=>()=>{},lock(){}};
  const root={},doc={getElementById:id=>id==='depot-read-root'?root:null};
  const mounted=mountDepotReadAccess(doc,{}, {access,pionexOnly:true,okxAggregate:true,now:()=>now,
    schedule(fn,ms){callback=fn;delay=ms;return 1;},cancelSchedule(){cancelled++;},
    createClient(options){emit=options.onChange;return {revalidate(){revalidated++;},dispose(){}};},
    createView(_root,{createClient}){createClient({onChange(){}});return {revalidate(){},dispose(){}};}});
  emit({status:'unavailable',okx:buildOkxDepotModel(payload(),{now})});
  assert.equal(delay,900001);callback();assert.equal(revalidated,1);
  emit({status:'unavailable',okx:buildOkxDepotModel(payload(),{now})});
  emit({status:'locked',okx:null});assert.equal(cancelled,1);mounted.dispose();
});
test('OKX aggregate accepts only one fresh API authority, separately from other venues',()=>{
  const value=buildOkxDepotModel(payload([{venue:'Pionex',valueUsd:900},row]),{now});
  assert.equal(value.totalUsd,42);assert.equal(value.currency,'USD');assert.equal(value.status,'ready');
  assert.equal(buildOkxDepotModel(payload([{...row,valueUsd:0}]),{now}).totalUsd,0);
  for(const rows of [[row,row],[{...row,source:'USER_CONFIRMED_PORTFOLIO_AUTHORITY'}],[{...row,valueUsd:true}],[{...row,updatedAt:new Date(now+1).toISOString()}],[]])assert.equal(buildOkxDepotModel(payload(rows),{now}).totalUsd,null);
  assert.equal(buildOkxDepotModel(payload(),{now:now+900001}).status,'stale');
  assert.equal(buildOkxDepotModel(payload(),{now:now+900001}).totalUsd,null);
});
test('OKX projection shares dashboard request, survives unavailable Pionex, expires and clears on lock',async()=>{
  let clock=now,credential='synthetic-read',states=[],calls=[];
  const client=createDepotReadClient({pionexOnly:true,okxAggregate:true,getToken:()=>credential,now:()=>clock,onChange:s=>states.push(s),fetchImpl:async url=>{
    calls.push(url);return new Response(JSON.stringify(url.includes('/dashboard')?payload():{points:[]}));
  }});
  client.revalidate();assert.equal(calls.length,0);await client.refresh();
  assert.equal(calls.length,2);assert.equal(calls.filter(url=>url.includes('/dashboard')).length,1);
  assert.equal(states.at(-1).status,'unavailable');assert.equal(states.at(-1).okx.totalUsd,42);
  clock+=900001;client.revalidate();assert.equal(states.at(-1).okx.totalUsd,null);assert.equal(states.at(-1).okx.status,'stale');assert.equal(calls.length,2);
  credential=null;client.revalidate();assert.equal(states.at(-1).status,'locked');assert.equal(states.at(-1).okx,null);client.dispose();
});
test('separate OKX card never changes Pionex output or retains valuation after lock',()=>{
  class Node{constructor(doc,tag){this.ownerDocument=doc;this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.text='';}
    append(...children){this.children.push(...children);}replaceChildren(...children){this.text='';this.children=children;}
    set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(n=>n.textContent).join(' ');}
    setAttribute(k,v){this.attrs[k]=v;}addEventListener(){}removeEventListener(){}
  }
  const doc={createElement:tag=>new Node(doc,tag),getElementById:()=>null},root=doc.createElement('main');let render;
  const view=createDepotReadView(root,{pionexOnly:true,okxAggregate:true,createClient:({onChange})=>{render=onChange;return {revalidate(){},dispose(){},lock(){},refresh(){}};}});
  render({status:'unavailable',okx:buildOkxDepotModel(payload(),{now})});
  const card=root.children.find(n=>n.className==='card okx-aggregate');assert.match(card.textContent,/42,00/);assert.match(card.textContent,/Nicht zum Pionex/);
  assert.doesNotMatch(root.children[1].textContent,/42,00|OKX/);
  render({status:'locked'});assert.doesNotMatch(card.textContent,/42,00|2026-01-01/);view.dispose();
});
