import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPionexDepotModel} from '../v11/depot-current-model.js';
import {createDepotReadClient} from '../v11/depot-read-client.js';
const now=Date.parse('2026-10-31T18:00:00Z'),at=new Date(now-1000).toISOString();
const data=()=>({private:true,data:{portfolio:{pionexEquityUsd:3450,pionexEquityUpdatedAt:at,holdings:[{venue:'Ledger',quantity:'invalid'}],manualVenueBalances:'invalid'},bots:[{investment:999999}]}});
test('Pionex-only authority ignores unrelated invalid venues and never adds bot capital',()=>{
 const m=buildPionexDepotModel(data(),{now});assert.equal(m.status,'FRESH_SNAPSHOT');assert.equal(m.totalUsd,3450);assert.equal(m.spotUsd,null);assert.equal(m.source,'SERVER_PIONEX_CURRENT');assert.equal(m.currency,'USD/USDT');assert.equal(m.expiresAt,now-1000+900000);
});
test('Pionex-only missing stale future invalid and zero are truthful',()=>{
 for(const value of [null,'',true,'bad',-1,Infinity]){const d=data();d.data.portfolio.pionexEquityUsd=value;assert.notEqual(buildPionexDepotModel(d,{now}).status,'FRESH_SNAPSHOT');}
 const d=data();d.data.portfolio.pionexEquityUsd=0;assert.equal(buildPionexDepotModel(d,{now}).totalUsd,0);
 d.data.portfolio.pionexEquityUpdatedAt=new Date(now-900001).toISOString();assert.equal(buildPionexDepotModel(d,{now}).status,'STALE');
 d.data.portfolio.pionexEquityUpdatedAt=new Date(now+1000).toISOString();assert.notEqual(buildPionexDepotModel(d,{now}).status,'FRESH_SNAPSHOT');
});
test('Pionex wallet selection preserves existing newest authority contract',()=>{
 const d=data();d.data.portfolio.pionexEquityUpdatedAt='invalid';d.data.pionexAccount={walletStatus:'OK',updatedAt:at,wallet:{totalInUsdt:'123.45'}};d.data.pionexAccountSync={status:'OK'};
 assert.equal(buildPionexDepotModel(d,{now}).totalUsd,123.45);
 d.data.pionexAccountSync.status='FAILED';assert.notEqual(buildPionexDepotModel(d,{now}).status,'FRESH_SNAPSHOT');
});
test('Pionex client makes one dashboard read, no prices/history, expires and never falls back',async()=>{
 let clock=now,token='password',states=[],calls=[],payload=data();
 const c=createDepotReadClient({pionexOnly:true,getToken:()=>token,now:()=>clock,onChange:s=>states.push(s),fetchImpl:async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(payload),{status:200});}});
 c.revalidate();assert.equal(states.at(-1).status,'not_loaded');assert.equal(calls.length,0);
 await c.refresh();assert.equal(calls.length,1);assert.match(calls[0].url,/\/dashboard$/);assert.equal(calls[0].opts.headers.authorization,'Bearer password');assert.equal(states.at(-1).model.totalUsd,3450);assert.equal(states.at(-1).history,null);
 clock=now+900000;c.revalidate();assert.equal(states.at(-1).status,'stale');assert.equal(states.at(-1).model,null);assert.equal(calls.length,1);
 payload={private:true,data:{portfolio:{}}};await c.refresh();assert.equal(states.at(-1).status,'unavailable');assert.equal(states.at(-1).model,null);assert.equal(states.at(-1).history,null);assert.equal(calls.length,2);
 token=null;c.revalidate();assert.equal(states.at(-1).status,'locked');c.dispose();
});
