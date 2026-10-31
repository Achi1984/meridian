import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  canonicalQuery,signPionexGet,inspectPionexBotOrder,normalizePionexBotOrder,
  buildPionexRiskSnapshot,mergePionexSyncState,fetchFuturesGridOrderDetail,
  fetchRunningBotOrders,summarizePionexBotList,buildPionexBotCoverage,runPionexBotSyncOnce
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

test('running bot list follows documented continuation tokens and exposes bounded cutoff',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(new URL(url));
    const page=calls.length;
    return {ok:true,status:200,text:async()=>JSON.stringify({result:true,data:{
      results:[{buOrderId:'synthetic-'+page,buOrderType:'futures_grid'}],
      nextPageToken:page<3?'synthetic-page-'+(page+1):null,
      previousPageToken:page>1?'synthetic-page-'+(page-1):null
    }})};
  };
  const complete=await fetchRunningBotOrders({apiKey:'read-key',apiSecret:'read-secret',fetchImpl,
    now:()=>1700000000000,maxPages:3,delayMs:0});
  assert.equal(complete.pages,3);assert.equal(complete.pageLimit,3);
  assert.equal(complete.paginationComplete,true);assert.equal(complete.truncated,false);
  assert.equal(complete.orders.length,3);
  assert.equal(calls[1].searchParams.get('pageToken'),'synthetic-page-2');
  assert.equal(calls[2].searchParams.get('pageToken'),'synthetic-page-3');

  calls.length=0;
  const bounded=await fetchRunningBotOrders({apiKey:'read-key',apiSecret:'read-secret',fetchImpl,
    now:()=>1700000000000,maxPages:1,delayMs:0});
  assert.equal(bounded.pages,1);assert.equal(bounded.pageLimit,1);
  assert.equal(bounded.paginationComplete,false);assert.equal(bounded.truncated,true);
  assert.equal(calls.length,1);

  calls.length=0;
  const clamped=await fetchRunningBotOrders({apiKey:'read-key',apiSecret:'read-secret',fetchImpl,
    now:()=>1700000000000,maxPages:100,delayMs:0});
  assert.equal(clamped.pageLimit,20,'caller input cannot raise the fixed bound');
  assert.equal(clamped.paginationComplete,true);assert.equal(clamped.pages,3);
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
  assert.equal(x.takeProfitEvidence,'PRICE_SET');
  assert.equal(x.stopLoss,61000);
  assert.equal(x.investmentUsd,123.45);
  assert.equal(x.pnlUsd,12.34);
  assert.equal(x.totalProfitPct,4.5);
  assert.equal(x.positionOpenPrice,85900);
  assert.equal(x.source,'PIONEX_BOT_API');
});

test('documented Futures Moon category stays distinct from the Futures Grid bot type and neutral direction',()=>{
  const standard=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'synthetic-standard-grid',base:'BTC.PERP',quote:'USDT',
    cateType:'linear',status:'running',buOrderData:{status:'running',trend:'long',bottom:'50000',top:'80000'}
  });
  const moon=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'synthetic-moon-grid',base:'BTC.PERP',quote:'USDT',
    cateType:'FUTURES_MOON',status:'running',
    buOrderData:{status:'running',trend:'no_trend',movingTop:'80000',movingBottom:'50000',
      estimateLiquidationPriceUp:'79000',estimateLiquidationPriceDown:'51000'}
  });
  assert.equal(standard.botType,'futures_grid');assert.equal(standard.cateType,'linear');
  assert.equal(moon.botType,'futures_grid');assert.equal(moon.cateType,'FUTURES_MOON');
  assert.equal(moon.lower,50000);assert.equal(moon.upper,80000);
  assert.equal(moon.side,'NEUTRAL');assert.equal(moon.liquidationPrice,null);
  assert.equal(moon.liquidationLowerBound,51000);assert.equal(moon.liquidationUpperBound,79000);
  assert.notEqual(standard.botOrderId,moon.botOrderId);
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

test('neutral liquidation estimates preserve both independent bounds through inverse normalization',()=>{
  const normalize=overrides=>normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'synthetic-neutral',base:'USD',quote:'BTC',
    cateType:'inverse',status:'running',
    buOrderData:{status:'running',trend:'no_trend',cateType:'inverse',
      estimateLiquidationPriceUp:'0.00002',estimateLiquidationPriceDown:'0.00001',...overrides}
  });
  const both=normalize({});
  assert.equal(both.side,'NEUTRAL');assert.equal(both.liquidationPrice,null);
  assert.ok(Math.abs(both.liquidationLowerBound-50000)<1e-8);assert.ok(Math.abs(both.liquidationUpperBound-100000)<1e-8);
  const missingUp=normalize({estimateLiquidationPriceUp:null});
  assert.equal(missingUp.liquidationLowerBound,null);assert.ok(Math.abs(missingUp.liquidationUpperBound-100000)<1e-8);
  const missingDown=normalize({estimateLiquidationPriceDown:null});
  assert.ok(Math.abs(missingDown.liquidationLowerBound-50000)<1e-8);assert.equal(missingDown.liquidationUpperBound,null);
  const invalid=normalize({estimateLiquidationPriceUp:'not-a-price',estimateLiquidationPriceDown:0});
  assert.equal(invalid.liquidationLowerBound,null);assert.equal(invalid.liquidationUpperBound,null);
});

test('coverage reports observed unsupported rows without inventing their provider identity',()=>{
  const coverage=buildPionexBotCoverage([
    {buOrderType:'futures_grid'},{buOrderType:'future_hedge_grid'},
    {buOrderType:'synthetic_unverified_enum'}
  ],{detailRows:2});
  assert.deepEqual(coverage,{status:'PARTIAL',providerContractStatus:'DOCUMENTED',
    liveAccountVerification:'NOT_PERFORMED',listRows:3,recognizedRows:2,representedRows:2,
    unsupportedRows:1,unhydratedRows:0,paginationComplete:true,pages:null,pageLimit:20});
  assert.doesNotMatch(JSON.stringify(coverage),/synthetic_unverified_enum/);
  assert.equal(buildPionexBotCoverage([{buOrderType:'futures_grid'}],{detailRows:1}).status,'DOCUMENTED',
    'the public contract is documented without claiming live account verification');
  const cutoff=buildPionexBotCoverage([{buOrderType:'futures_grid'}],{
    detailRows:1,pages:20,pageLimit:20,paginationComplete:false
  });
  assert.equal(cutoff.status,'PARTIAL');assert.equal(cutoff.paginationComplete,false);
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
  assert.equal(x.takeProfitEvidence,'UNKNOWN');
  assert.equal(x.lower,50000);
  assert.equal(x.upper,100000);
});

test('only an explicitly typed valid price yields comparable TP evidence',()=>{
  const order=type=>normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'tp-evidence',base:'BTC.PERP',quote:'USDT',status:'running',
    buOrderData:{status:'running',trend:'long',bottom:'50000',top:'100000',
      profitStopType:type,profitStop:'90000'}
  });
  assert.equal(order('price').takeProfitEvidence,'PRICE_SET');
  for(const type of [undefined,null,'','percent','unknown',{},17]){
    const row=order(type);
    assert.equal(row.takeProfit,null);assert.equal(row.takeProfitEvidence,'UNKNOWN');
  }
  const malformed=normalizePionexBotOrder({
    buOrderType:'futures_grid',buOrderId:'malformed-tp',base:'BTC.PERP',quote:'USDT',status:'running',
    buOrderData:{status:'running',trend:'long',profitStopType:'price',profitStop:'not-a-price'}
  });
  assert.equal(malformed.takeProfit,null);assert.equal(malformed.takeProfitEvidence,'UNKNOWN');
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

test('incomplete refresh preserves the authoritative snapshot and clears only after a complete refresh',()=>{
  const complete={source:'PIONEX_BOT_API',updatedAt:'2026-09-26T15:00:00.000Z',
    snapshotAt:'2026-09-26T15:00:00.000Z',detailsComplete:true,paginationComplete:true,
    coverage:{status:'DOCUMENTED',paginationComplete:true},bots:[{id:'synthetic-a'},{id:'synthetic-b'}],botCount:2};
  const initial=mergePionexSyncState({privateRevision:1},{
    risk:complete,status:'OK',attemptAt:complete.updatedAt,successAt:complete.updatedAt,configured:true,pages:2
  });
  const partial={...complete,updatedAt:'2026-09-26T16:00:00.000Z',snapshotAt:'2026-09-26T16:00:00.000Z',
    paginationComplete:false,coverage:{status:'PARTIAL',paginationComplete:false},
    bots:[{id:'synthetic-new-page'}],botCount:1};
  const truncated=mergePionexSyncState(initial,{
    risk:partial,status:'OK',attemptAt:partial.updatedAt,successAt:partial.updatedAt,configured:true,pages:20,truncated:true
  });
  assert.deepEqual(truncated.pionexRisk,initial.pionexRisk);
  assert.deepEqual(truncated.pionexRiskPartial,partial);
  assert.equal(truncated.pionexBotSync.status,'PARTIAL');
  assert.equal(truncated.pionexBotSync.truncated,true);
  assert.equal(truncated.pionexBotSync.lastSuccessAt,complete.updatedAt);
  assert.equal(truncated.pionexBotSync.error,'incomplete_bot_coverage');

  const refreshed={...complete,updatedAt:'2026-09-26T17:00:00.000Z',snapshotAt:'2026-09-26T17:00:00.000Z',
    bots:[{id:'synthetic-a'},{id:'synthetic-b'},{id:'synthetic-c'}],botCount:3};
  const recovered=mergePionexSyncState(truncated,{
    risk:refreshed,status:'OK',attemptAt:refreshed.updatedAt,successAt:refreshed.updatedAt,configured:true,pages:3
  });
  assert.deepEqual(recovered.pionexRisk.bots,refreshed.bots);
  assert.equal(Object.hasOwn(recovered,'pionexRiskPartial'),false);
  assert.equal(recovered.pionexBotSync.status,'OK');
  assert.equal(recovered.pionexBotSync.truncated,false);
  assert.equal(recovered.pionexBotSync.lastSuccessAt,refreshed.updatedAt);
});

test('sync orchestration persists partial pages separately and accepts the next complete refresh',async()=>{
  let at=Date.parse('2026-09-26T18:00:00.000Z');
  const env={DATABASE_URL:'synthetic://state',PIONEX_BOT_READ_API_KEY:'synthetic-key',PIONEX_BOT_READ_API_SECRET:'synthetic-secret'};
  const listFor=ids=>ids.map(id=>({buOrderType:'futures_grid',buOrderId:id,base:'BTC.PERP',status:'running',
    buOrderData:{status:'running',trend:'long',leverage:2,bottom:'1',top:'2'}}));
  const details=new Map();
  const fetchImpl=async raw=>{
    const url=new URL(raw);
    if(url.pathname==='/api/v1/bot/orders/futuresGrid/order'){
      const id=url.searchParams.get('buOrderId');
      return{ok:true,status:200,text:async()=>JSON.stringify({result:true,data:details.get(id)})};
    }
    return{ok:true,status:200,text:async()=>JSON.stringify({result:true,data:{
      results:details.get('list')||[],nextPageToken:details.get('next')||null
    }})};
  };
  let state={privateRevision:1};
  const updateState=async(_env,mutate)=>{state=mutate(state);return true};
  const run=()=>runPionexBotSyncOnce({env,fetchImpl,now:()=>at,updateState,maxPages:1,listDelayMs:0,detailDelayMs:0});
  const setRows=(ids,next=null)=>{
    details.set('list',listFor(ids));details.set('next',next);
    for(const id of ids)details.set(id,{status:'running',trend:'long',leverage:2,bottom:'1',top:'2'});
  };

  setRows(['synthetic-a','synthetic-b']);
  const first=await run();
  assert.equal(first.status,'OK');assert.equal(state.pionexRisk.bots.length,2);
  const authoritative=structuredClone(state.pionexRisk);
  const lastSuccessAt=state.pionexBotSync.lastSuccessAt;

  at+=60000;
  setRows(['synthetic-page-only'],'synthetic-next-page');
  const partial=await run();
  assert.equal(partial.status,'PARTIAL');assert.equal(partial.ok,false);
  assert.deepEqual(state.pionexRisk,authoritative);
  assert.equal(state.pionexBotSync.lastSuccessAt,lastSuccessAt);
  assert.equal(state.pionexBotSync.truncated,true);
  assert.deepEqual(state.pionexRiskPartial.bots.map(row=>row.botOrderId),['synthetic-page-only']);

  at+=60000;
  setRows(['synthetic-a','synthetic-b','synthetic-c']);
  const recovered=await run();
  assert.equal(recovered.status,'OK');assert.equal(recovered.ok,true);
  assert.deepEqual(state.pionexRisk.bots.map(row=>row.botOrderId),['synthetic-a','synthetic-b','synthetic-c']);
  assert.equal(Object.hasOwn(state,'pionexRiskPartial'),false);
  assert.equal(state.pionexBotSync.truncated,false);
  assert.notEqual(state.pionexBotSync.lastSuccessAt,lastSuccessAt);
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
