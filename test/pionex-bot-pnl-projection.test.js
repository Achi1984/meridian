import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePionexBotOrder} from '../pionex-bot-auto-sync.js';
import {buildAssetWatchApiSnapshot} from '../asset-watch-bridge.js';
import {buildBotReadModel} from '../v11/bot-read-model.js';

const AT='2026-10-31T06:40:00.000Z',NOW=Date.parse(AT)+1000;
function normalize(fields={}){
  return normalizePionexBotOrder({buOrderId:'synthetic-pnl',buOrderType:'futures_grid',
    base:'BTC.PERP',quote:'USDT',status:'running',
    buOrderData:{status:'running',trend:'long',...fields}});
}
function project(row){
  const persisted=JSON.parse(JSON.stringify({pionexRisk:{snapshotAt:AT,detailsComplete:true,bots:[row]},
    pionexBotSync:{status:'OK',lastSuccessAt:AT}}));
  const snapshot=buildAssetWatchApiSnapshot(persisted,{now:NOW});
  const model=buildBotReadModel(snapshot,{now:NOW});
  assert.equal(model.status,'FRESH_SNAPSHOT');
  return {snapshot,model};
}

test('optional P/L skips absent or invalid alternatives and preserves a valid fallback through the read model',()=>{
  for(const missing of [undefined,null,'','   ',false,true,[],{},'invalid',Infinity]){
    const row=normalize({totalProfitUsd:missing,totalProfitUSDT:missing,pnlUsd:'-12.34',
      totalProfitPct:missing,pnlPct:'-1.25'});
    assert.equal(row.pnlUsd,-12.34);
    assert.equal(row.totalProfitPct,-1.25);
    const {snapshot,model}=project(row);
    assert.equal(snapshot.bots[0].pnl.usd,-12.34);
    assert.equal(model.bots[0].metrics.pnlUsd,-12.34);
  }
  assert.equal(normalize({totalProfitUsd:null,pnlUsd:12.34}).pnlUsd,12.34);
});

test('explicit numeric zero keeps P/L precedence and confirmation through the read model',()=>{
  for(const zero of [0,'0','0.00']){
    const row=normalize({totalProfitUsd:zero,pnlUsd:12.34,totalProfitPct:zero,pnlPct:1.25});
    assert.equal(row.pnlUsd,0);
    assert.equal(row.totalProfitPct,0);
    const {snapshot,model}=project(row);
    assert.equal(snapshot.bots[0].pnl.usd,0);
    assert.equal(model.bots[0].metrics.pnlUsd,0);
    assert.equal(model.bots[0].metrics.pnlEvidence,'EXPLICIT_USD_VALUE');
  }
});

test('missing P/L remains unknown throughout the existing projection',()=>{
  const row=normalize({totalProfitUsd:null,pnlUsd:' ',totalProfitPct:false});
  assert.equal(row.pnlUsd,null);
  assert.equal(row.totalProfitPct,null);
  const {model}=project(row);
  assert.equal(model.bots[0].metrics.pnlUsd,null);
});

test('legacy zero and malformed values cannot acquire source confirmation at the bridge',()=>{
  for(const value of [null,undefined,'',' ',false,true,[],{},'0',Infinity,NaN]){
    const {snapshot,model}=project({...normalize(),pnlUsd:value,pnlEvidence:'EXPLICIT_USD_VALUE'});
    assert.equal(snapshot.bots[0].pnl.usd,null);
    assert.equal(snapshot.bots[0].pnl.evidence,null);
    assert.equal(model.bots[0].metrics.pnlUsd,null);
  }
  for(const evidence of [undefined,null,'',true,{},'EXPLICIT_USD_VALUE_FAKE']){
    const {model}=project({...normalize(),pnlUsd:0,pnlEvidence:evidence});
    assert.equal(model.bots[0].metrics.pnlUsd,null);
  }
  for(const value of [-12.34,12.34]){
    const {model}=project({...normalize(),pnlUsd:value,pnlEvidence:null});
    assert.equal(model.bots[0].metrics.pnlUsd,value);
  }
  const row=normalize({totalProfitUsd:null,pnlEvidence:'EXPLICIT_USD_VALUE'});
  assert.equal(row.pnlEvidence,null);
});
