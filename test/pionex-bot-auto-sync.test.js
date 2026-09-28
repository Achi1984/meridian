import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  canonicalQuery,signPionexGet,inspectPionexBotOrder,normalizePionexBotOrder,
  buildPionexRiskSnapshot,mergePionexSyncState,fetchFuturesGridOrderDetail,
  fetchRunningBotOrders,summarizePionexBotList
} from '../pionex-bot-auto-sync.js';

test('Pionex GET signing is canonical and deterministic',()=>{
  const q=canonicalQuery({timestamp:1700000000000,status:'running'});
  assert.equal(q,'status=running&timestamp=1700000000000');
  assert.equal(canonicalQuery({pageToken:'a/b=',timestamp:1},false),'pageToken=a/b=&timestamp=1');
  assert.equal(canonicalQuery({pageToken:'a/b=',timestamp:1},true),'pageToken=a%2Fb%3D&timestamp=1');
  assert.equal(
    signPionexGet('/api/v1/bot/orders',{timestamp:1700000000000,status:'running'},'test-secret'),
    'a66fc134b331daa12ffc2f2a4cea1984adcc1729b3e53a8184883cff5f4ac6f2'
  );
});


test('running bot list uses one unfiltered signed GET and filters supported types locally',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return {ok:true,status:200,text:async()=>JSON.stringify({result:true,data:{results:[]}})};
  };
  await fetchRunningBotOrders({apiKey:'read-key',apiSecret:'read-secret',fetchImpl,now:()=>1700000000000});
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'GET');
  const u=new URL(calls[0].url);
  assert.equal(u.searchParams.get('status'),'running');
  assert.equal(u.searchParams.has('buOrderTypes'),false);
});

test('bot list diagnostics expose only privacy-safe aggregate types and statuses',()=>{
  const d=summarizePionexBotList([
    {buOrderType:'futures_grid',buOrderId:'secret-1',status:'running',base:'BTC'},
    {buOrderType:'future_hedge_grid',buOrderId:'secret-2',buOrderData:{status:'paused'},base:'ETH'}
  ]);
  assert.equal(d.listRows,2);
  assert.equal(d.requestMode,'ALL_RUNNING_LOCAL_ALLOWLIST');
  assert.deepEqual(d.localSupportedTypes,['futures_grid','future_hedge_grid']);
  assert.deepEqual(d.typeCounts,{futures_grid:1,future_hedge_grid:1});
  assert.deepEqual(d.statusCounts,{running:1,paused:1});
  assert.equal(JSON.stringify(d).includes('secret-1'),false);
  assert.equal(JSON.stringify(d).includes('BTC'),false);
});

test('running futures-grid rows normalize without inventing unsupported values',()=>{
  const x=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'bot-1',base:'BTC.PERP',quote:'BTC',status:'running',
    buOrderData:{
      status:'running',trend:'long',leverage:7,bottom:'55000',top:'100000',row:174,
      liquidationPrice:'62001.6',profitStopType:'price',profitStop:'100000',lossStopType:'price',lossStop:'61000',
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
  assert.equal(x.stopLoss,61000);
  assert.equal(x.investmentUsd,123.45);
  assert.equal(x.pnlUsd,12.34);
  assert.equal(x.totalProfitPct,4.5);
  assert.equal(x.positionOpenPrice,85900);
  assert.equal(x.source,'PIONEX_BOT_API');
});


test('documented bot enums tolerate surrounding whitespace without broadening allowlists',()=>{
  const x=normalizePionexBotOrder({
    buOrderType:' futures_grid ',buOrderId:'trimmed',base:'BTC.PERP',status:' running ',
    buOrderData:{status:' running ',trend:' short ',leverage:5,bottom:'1',top:'2'}
  });
  assert.ok(x);
  assert.equal(x.symbol,'BTC');
  assert.equal(x.side,'SHORT');
  assert.equal(x.botType,' futures_grid ');
  const unknown=normalizePionexBotOrder({
    buOrderType:' future_magic_grid ',buOrderId:'nope',base:'BTC.PERP',status:' running ',
    buOrderData:{status:' running ',trend:' long '}
  });
  assert.equal(unknown,null);
});


test('normalizer inspector reports the exact four gating stages',()=>{
  const good=inspectPionexBotOrder({
    buOrderType:'futures_grid',base:'BTC.PERP',quote:'USDT',status:'running',
    buOrderData:{status:'running',trend:'long'}
  });
  assert.deepEqual(
    {typePass:good.typePass,statusPass:good.statusPass,symbolPass:good.symbolPass,sidePass:good.sidePass,baseClass:good.baseClass,quoteClass:good.quoteClass},
    {typePass:true,statusPass:true,symbolPass:true,sidePass:true,baseClass:'asset',quoteClass:'stable_quote'}
  );
  const quoteAsBase=inspectPionexBotOrder({
    buOrderType:'futures_grid',base:'USD',quote:'BTC',status:'running',
    buOrderData:{status:'running',trend:'short'}
  });
  assert.equal(quoteAsBase.typePass,true);
  assert.equal(quoteAsBase.statusPass,true);
  assert.equal(quoteAsBase.symbolPass,false);
  assert.equal(quoteAsBase.sidePass,true);
  assert.equal(quoteAsBase.baseClass,'stable_quote');
  assert.equal(quoteAsBase.quoteClass,'asset');

  const inverse=inspectPionexBotOrder({
    buOrderType:'futures_grid',base:'USD',quote:'BTC',status:'running',
    buOrderData:{status:'running',trend:'short',cateType:'inverse'}
  });
  assert.equal(inverse.symbolPass,true);
  assert.equal(inverse.symbolSource,'quote_inverse');
  const normalized=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'inverse-btc',base:'USD',quote:'BTC',status:'running',
    buOrderData:{status:'running',trend:'short',cateType:'inverse',leverage:5,bottom:'50000',top:'100000'}
  });
  assert.equal(normalized.symbol,'BTC');
  assert.equal(normalized.side,'SHORT');
});



test('inverse Coin-M uses direct liquidation geometry when it contradicts declared trend',()=>{
  const long=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'inverse-long',base:'USD',quote:'BTC',cateType:'inverse',status:'running',
    buOrderData:{status:'running',trend:'short',leverage:5,bottom:'55000',top:'95000',positionOpenPrice:'83415.6',liquidationPrice:'53453'}
  });
  assert.equal(long.symbol,'BTC');
  assert.equal(long.side,'LONG');
  assert.equal(long.declaredSide,'SHORT');
  assert.equal(long.sideSource,'economic_inverse');

  const short=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'inverse-short',base:'USD',quote:'BTC',cateType:'inverse',status:'running',
    buOrderData:{status:'running',trend:'long',leverage:5,bottom:'55000',top:'95000',positionOpenPrice:'83000',liquidationPrice:'96000'}
  });
  assert.equal(short.side,'SHORT');
  assert.equal(short.declaredSide,'LONG');
  assert.equal(short.sideSource,'economic_inverse');
});

test('inverse quote fallback is not applied without an explicit inverse category',()=>{
  const x=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'not-inverse',base:'USD',quote:'BTC',status:'running',
    buOrderData:{status:'running',trend:'long',cateType:'linear'}
  });
  assert.equal(x,null);
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


test('grid bounds are not invented as take-profit when no explicit TP exists',()=>{
  const x=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'no-tp',base:'BTC.PERP',status:'running',
    buOrderData:{status:'running',trend:'long',leverage:5,bottom:'50000',top:'100000'}
  });
  assert.equal(x.takeProfit,null);
  assert.equal(x.lower,50000);
  assert.equal(x.upper,100000);
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
  assert.equal(next.pionexBotSync.queryMode,'ALL_RUNNING_LOCAL_ALLOWLIST');
  assert.deepEqual(next.pionexBotSync.supportedTypes,['futures_grid','future_hedge_grid']);
});

test('futures-grid details are loaded with the signed read-only detail endpoint',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return {ok:true,status:200,text:async()=>JSON.stringify({result:true,data:{status:'running',trend:'long',leverage:'5',bottom:'1',top:'2'}})};
  };
  const detail=await fetchFuturesGridOrderDetail({
    buOrderId:'bot-42',
    apiKey:'read-key',
    apiSecret:'read-secret',
    fetchImpl,
    now:()=>1700000000000
  });
  assert.equal(detail.trend,'long');
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'GET');
  assert.match(calls[0].url,/\/api\/v1\/bot\/orders\/futuresGrid\/order\?/);
  assert.match(calls[0].url,/buOrderId=bot-42/);
  assert.match(calls[0].url,/timestamp=1700000000000/);
});

test('runtime implementation is Pionex read-only',()=>{
  const src=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
  assert.match(src,/GET \/api\/v1\/bot\/orders/);
  assert.match(src,/PIONEX_FUTURES_GRID_DETAIL_PATH/);
  assert.match(src,/hydratePionexBotSummaries/);
  assert.doesNotMatch(src,/method:'POST'/);
  assert.doesNotMatch(src,/futuresGrid\/create/);
  assert.doesNotMatch(src,/futuresGrid\/cancel/);
});


test('unknown futures bot direction is rejected instead of assumed LONG',()=>{
  const x=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'mystery',base:'BTC.PERP',status:'running',
    buOrderData:{status:'running',leverage:5,bottom:'1',top:'2'}
  });
  assert.equal(x,null);
});
