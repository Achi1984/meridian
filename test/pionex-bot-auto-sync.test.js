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
  assert.equal(normalized.side,'LONG');
  assert.equal(normalized.declaredSide,'SHORT');
  assert.equal(normalized.assetDeclaredSide,'LONG');
});



test('inverse quote Coin-M converts reciprocal API prices before deriving asset side',()=>{
  const long=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'inverse-long',base:'USD',quote:'BTC',cateType:'inverse',status:'running',
    buOrderData:{
      status:'running',trend:'short',leverage:5,
      bottom:String(1/95000),top:String(1/55000),
      positionOpenPrice:String(1/83415.6),liquidationPrice:String(1/53453),
      profitStopType:'price',profitStop:String(1/95000)
    }
  });
  assert.equal(long.symbol,'BTC');
  assert.equal(long.side,'LONG');
  assert.equal(long.declaredSide,'SHORT');
  assert.equal(long.assetDeclaredSide,'LONG');
  assert.equal(long.sideSource,'economic_inverse_asset');
  assert.ok(Math.abs(long.lower-55000)<1e-6);
  assert.ok(Math.abs(long.upper-95000)<1e-6);
  assert.ok(Math.abs(long.positionOpenPrice-83415.6)<1e-6);
  assert.ok(Math.abs(long.liquidationPrice-53453)<1e-6);
  assert.ok(Math.abs(long.takeProfit-95000)<1e-6);

  const short=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'inverse-short',base:'USD',quote:'BTC',cateType:'inverse',status:'running',
    buOrderData:{
      status:'running',trend:'long',leverage:5,
      bottom:String(1/96000),top:String(1/55000),
      positionOpenPrice:String(1/83000),liquidationPrice:String(1/96000)
    }
  });
  assert.equal(short.side,'SHORT');
  assert.equal(short.declaredSide,'LONG');
  assert.equal(short.assetDeclaredSide,'SHORT');
  assert.equal(short.sideSource,'economic_inverse_asset');
  assert.ok(Math.abs(short.positionOpenPrice-83000)<1e-6);
  assert.ok(Math.abs(short.liquidationPrice-96000)<1e-6);
});

test('current SUI screenshots validate reciprocal Coin-M long and short normalization',()=>{
  const long=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'sui-long-sample',base:'USD',quote:'SUI',cateType:'inverse',status:'running',
    buOrderData:{
      status:'running',trend:'short',leverage:4,
      bottom:String(1/1.55),top:String(1/0.6),
      positionOpenPrice:String(1/1.2463),liquidationPrice:String(1/0.6859),
      profitStopType:'price',profitStop:String(1/1.55)
    }
  });
  const short=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'sui-short-sample',base:'USD',quote:'SUI',cateType:'inverse',status:'running',
    buOrderData:{
      status:'running',trend:'long',leverage:4,
      bottom:String(1/1.85),top:String(1/0.65),
      positionOpenPrice:String(1/1.0043),liquidationPrice:String(1/1.5636),
      profitStopType:'price',profitStop:String(1/0.65)
    }
  });
  assert.equal(long.symbol,'SUI');
  assert.equal(long.side,'LONG');
  assert.equal(long.declaredSide,'SHORT');
  assert.equal(long.assetDeclaredSide,'LONG');
  assert.equal(long.sideSource,'economic_inverse_asset');
  assert.ok(Math.abs(long.lower-0.6)<1e-9);
  assert.ok(Math.abs(long.upper-1.55)<1e-9);
  assert.ok(Math.abs(long.positionOpenPrice-1.2463)<1e-9);
  assert.ok(Math.abs(long.liquidationPrice-0.6859)<1e-9);
  assert.ok(Math.abs(long.takeProfit-1.55)<1e-9);

  assert.equal(short.symbol,'SUI');
  assert.equal(short.side,'SHORT');
  assert.equal(short.declaredSide,'LONG');
  assert.equal(short.assetDeclaredSide,'SHORT');
  assert.equal(short.sideSource,'economic_inverse_asset');
  assert.ok(Math.abs(short.lower-0.65)<1e-9);
  assert.ok(Math.abs(short.upper-1.85)<1e-9);
  assert.ok(Math.abs(short.positionOpenPrice-1.0043)<1e-9);
  assert.ok(Math.abs(short.liquidationPrice-1.5636)<1e-9);
  assert.ok(Math.abs(short.takeProfit-0.65)<1e-9);
});

test('inverse Coin-M liquidation estimates are selected after reciprocal normalization',()=>{
  const long=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'estimate-long',base:'USD',quote:'SUI',cateType:'inverse',status:'running',
    buOrderData:{
      status:'running',trend:'short',leverage:4,bottom:String(1/1.55),top:String(1/0.6),
      positionOpenPrice:String(1/1.2463),
      estimateLiquidationPriceUp:String(1/0.6859),
      estimateLiquidationPriceDown:String(1/1.8)
    }
  });
  assert.equal(long.side,'LONG');
  assert.ok(Math.abs(long.liquidationPrice-0.6859)<1e-9);

  const short=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'estimate-short',base:'USD',quote:'SUI',cateType:'inverse',status:'running',
    buOrderData:{
      status:'running',trend:'long',leverage:4,bottom:String(1/1.85),top:String(1/0.65),
      positionOpenPrice:String(1/1.0043),
      estimateLiquidationPriceUp:String(1/0.7),
      estimateLiquidationPriceDown:String(1/1.5636)
    }
  });
  assert.equal(short.side,'SHORT');
  assert.ok(Math.abs(short.liquidationPrice-1.5636)<1e-9);
});

test('current BTC reciprocal sample renders asset-quoted BE and TP instead of raw inverse values',()=>{
  const x=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'btc-current-sample',base:'USD',quote:'BTC',cateType:'inverse',status:'running',
    buOrderData:{
      status:'running',trend:'short',leverage:5,
      bottom:String(1/95000),top:String(1/55000),
      positionOpenPrice:'0.000011999',
      profitStopType:'price',profitStop:'0.000010526'
    }
  });
  assert.equal(x.side,'LONG');
  assert.equal(x.sideSource,'trend_inverse_asset');
  assert.ok(x.positionOpenPrice>83000&&x.positionOpenPrice<84000);
  assert.ok(x.takeProfit>94900&&x.takeProfit<95100);
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
