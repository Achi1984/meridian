import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  canonicalQuery,signPionexGet,normalizePionexBotOrder,
  buildPionexRiskSnapshot,mergePionexSyncState
} from '../pionex-bot-auto-sync.js';

test('Pionex GET signing is canonical and deterministic',()=>{
  const q=canonicalQuery({timestamp:1700000000000,status:'running'});
  assert.equal(q,'status=running&timestamp=1700000000000');
  assert.equal(
    signPionexGet('/api/v1/bot/orders',{timestamp:1700000000000,status:'running'},'test-secret'),
    'a66fc134b331daa12ffc2f2a4cea1984adcc1729b3e53a8184883cff5f4ac6f2'
  );
});

test('running futures-grid rows normalize without inventing unsupported values',()=>{
  const x=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'bot-1',base:'BTC.PERP',quote:'BTC',status:'running',
    buOrderData:{
      status:'running',trend:'long',leverage:7,bottom:'55000',top:'100000',row:174,
      liquidationPrice:'62001.6',profitStopType:'price',profitStop:'100000',
      usdtInvestment:'123.45',position:'0.03',positionOpenPrice:'85900',extraMargin:'0.002',
      cateType:'FUTURE_GRID_COIN_MARGINED',totalProfitUsd:'12.34',totalProfitPct:'4.5'
    }
  });
  assert.equal(x.symbol,'BTC');
  assert.equal(x.side,'LONG');
  assert.equal(x.leverage,7);
  assert.equal(x.lower,55000);
  assert.equal(x.upper,100000);
  assert.equal(x.liquidationPrice,62001.6);
  assert.equal(x.takeProfit,100000);
  assert.equal(x.investmentUsd,123.45);
  assert.equal(x.pnlUsd,12.34);
  assert.equal(x.totalProfitPct,4.5);
  assert.equal(x.positionOpenPrice,85900);
  assert.equal(x.source,'PIONEX_BOT_API');
});

test('coin-m investment is not mislabeled USD when API gives only coin investment',()=>{
  const x=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'bot-2',base:'ETH.PERP',status:'running',
    buOrderData:{status:'running',trend:'short',leverage:4,bottom:'1500',top:'3500',investCoin:'ETH',quoteInvestment:'0.42'}
  });
  assert.equal(x.investmentUsd,null);
  assert.equal(x.quoteInvestment,0.42);
  assert.equal(x.investCurrency,'ETH');
});

test('risk snapshot keeps only supported active futures bot rows',()=>{
  const running={buOrderType:'futures_grid',buOrderId:'a',base:'BTC.PERP',status:'running',buOrderData:{status:'running',trend:'long',leverage:3,bottom:'1',top:'2'}};
  const finished={buOrderType:'futures_grid',buOrderId:'b',base:'ETH.PERP',status:'finished',buOrderData:{status:'canceled',trend:'long',leverage:3,bottom:'1',top:'2'}};
  const spot={buOrderType:'spot_grid',buOrderId:'c',base:'SOL',status:'running',buOrderData:{status:'running'}};
  const snap=buildPionexRiskSnapshot([running,finished,spot],'2026-09-26T16:00:00.000Z');
  assert.equal(snap.apiRows,3);
  assert.equal(snap.botCount,1);
  assert.equal(snap.bots[0].id,'a');
  assert.equal(snap.source,'PIONEX_BOT_API');
});

test('failed sync diagnostics never refresh the old bot snapshot timestamp',()=>{
  const current={privateRevision:4,pionexRisk:{updatedAt:'2026-09-03T10:00:00.000Z',bots:[{id:'old'}]},pionexBotSync:{lastSuccessAt:'2026-09-03T10:00:00.000Z'}};
  const next=mergePionexSyncState(current,{status:'ERROR',error:'boom',attemptAt:'2026-09-26T16:00:00.000Z',configured:true});
  assert.equal(next.pionexRisk.updatedAt,'2026-09-03T10:00:00.000Z');
  assert.deepEqual(next.pionexRisk.bots,[{id:'old'}]);
  assert.equal(next.pionexBotSync.status,'ERROR');
  assert.equal(next.privateRevision,5);
});

test('successful sync replaces bot rows and stamps a fresh Pionex source',()=>{
  const current={privateRevision:4,pionexRisk:{updatedAt:'old',bots:[{id:'old'}]}};
  const risk={source:'PIONEX_BOT_API',updatedAt:'2026-09-26T16:00:00.000Z',snapshotAt:'2026-09-26T16:00:00.000Z',apiRows:2,bots:[{id:'new'}],botCount:1};
  const next=mergePionexSyncState(current,{risk,status:'OK',attemptAt:risk.updatedAt,successAt:risk.updatedAt,configured:true,pages:1});
  assert.equal(next.pionexRisk.updatedAt,risk.updatedAt);
  assert.deepEqual(next.pionexRisk.bots,[{id:'new'}]);
  assert.equal(next.pionexBotSync.readOnly,true);
  assert.equal(next.pionexBotSync.status,'OK');
});

test('runtime implementation is Pionex read-only',()=>{
  const src=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
  assert.match(src,/GET \/api\/v1\/bot\/orders/);
  assert.doesNotMatch(src,/method:'POST'/);
  assert.doesNotMatch(src,/futuresGrid\/create/);
  assert.doesNotMatch(src,/futuresGrid\/cancel/);
});
