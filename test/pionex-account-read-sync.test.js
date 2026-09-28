import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalPionexQuery,signPionexReadGet,pionexReadGet} from '../pionex-read-client.js';
import {
  normalizeSpotBalances,normalizeFuturesBalances,normalizeFuturesPositions,normalizeWalletOverview,
  normalizeWalletBotEntries,probeWalletBotDetails,buildWalletBotRisk,
  fetchPionexReadSnapshot,readCredentials,mergePionexAccountState
} from '../pionex-account-read-sync.js';

test('shared Pionex read signer matches canonical GET contract',()=>{
  assert.equal(canonicalPionexQuery({timestamp:1700000000000,status:'running'}),'status=running&timestamp=1700000000000');
  assert.equal(canonicalPionexQuery({pageToken:'a/b=',timestamp:1},false),'pageToken=a/b=&timestamp=1');
  assert.equal(
    signPionexReadGet('/api/v1/bot/orders',{timestamp:1700000000000,status:'running'},'test-secret'),
    'a66fc134b331daa12ffc2f2a4cea1984adcc1729b3e53a8184883cff5f4ac6f2'
  );
});

test('read client sends only signed GET requests',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return {ok:true,status:200,text:async()=>JSON.stringify({result:true,data:{balances:[]}})};
  };
  await pionexReadGet('/api/v1/account/balances',{},{
    apiKey:'read-key',apiSecret:'read-secret',fetchImpl,now:()=>1700000000000
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'GET');
  assert.match(calls[0].url,/\/api\/v1\/account\/balances\?timestamp=1700000000000/);
  assert.equal(calls[0].options.headers['PIONEX-KEY'],'read-key');
  assert.ok(calls[0].options.headers['PIONEX-SIGNATURE']);
});

test('read snapshot normalizes spot, futures balances and active positions without inventing values',async()=>{
  const fetchImpl=async url=>{
    let data={};
    if(url.includes('/api/v1/account/balances'))data={balances:[{coin:'BTC',free:'0.1',frozen:'0'}]};
    else if(url.includes('/uapi/v1/account/balances'))data={balances:[{coin:'USDT',free:'10',frozen:'2',debts:'0'}],isolates:[]};
    else if(url.includes('/uapi/v1/account/positions'))data={positions:[{positionId:'p1',symbol:'BTC_USDT_PERP',positionSide:'LONG',netSize:'0.01',avgPrice:'80000',unrealizedPnL:'12.5',markPrice:'81250',liquidationPrice:'60000',leverage:'5'}]};
    else if(url.includes('/api/v1/wallet/balancesFull'))data={totalInUsdt:'123',botAccount:{totalInUsdt:'100',detail:[{type:'TRADING_BOT',title:'Bots',count:2,hasMore:false,list:[{buOrderId:'bot-a',buOrderType:'futures_grid',cateType:'FUTURE_GRID_COIN_MARGINED',baseList:['BTC.PERP'],foo:'x',bar:'y'},{buOrderId:'bot-b',buOrderType:'future_hedge_grid',cateType:'FULLY_HEDGING',foo:'z'}]}]},traderAccount:{totalInUsdt:'23',detail:[]}};
    else if(url.includes('/api/v1/bot/orders/futuresGrid/order'))data={buOrderData:{status:'running',trend:'long'}};
    return {ok:true,status:200,text:async()=>JSON.stringify({result:true,data})};
  };
  const snap=await fetchPionexReadSnapshot({
    apiKey:'read-key',apiSecret:'read-secret',fetchImpl,now:()=>1700000000000
  });
  assert.equal(snap.readOnly,true);
  assert.equal(snap.spotBalanceCount,1);
  assert.equal(snap.futuresBalanceCount,1);
  assert.equal(snap.futuresPositionCount,1);
  assert.equal(snap.spotBalances[0].free,0.1);
  assert.equal(snap.futuresPositions[0].side,'LONG');
  assert.equal(snap.futuresPositions[0].asset,'BTC');
  assert.equal(snap.futuresPositions[0].liquidationPrice,60000);
  assert.equal(snap.walletStatus,'OK');
  assert.equal(snap.wallet.botCategoryCount,1);
  assert.equal(snap.wallet.botReportedCount,2);
  assert.equal(snap.wallet.botListCount,2);
  assert.deepEqual(snap.wallet.botCategories[0].entryFields,['bar','baseList','buOrderId','buOrderType','cateType','foo']);
  assert.equal(snap.wallet.botEntryCount,2);
  assert.equal(snap.walletBotProbe.candidateCount,2);
  assert.equal(snap.walletBotProbe.successCount,2);
  assert.equal(snap.walletBotRisk.supportedRows,1);
  assert.equal(snap.walletBotRisk.botCount,1);
  assert.equal(snap.walletBotRisk.detailsComplete,true);
  assert.equal(snap.walletBotRisk.bots[0].source,'PIONEX_WALLET_BOT_DETAIL');
});



test('wallet bot entries retain private IDs/types for internal detail hydration only',()=>{
  const rows=normalizeWalletBotEntries([
    {type:'TRADING_BOT',list:[
      {buOrderId:'id-1',buOrderType:'futures_grid',cateType:'FUTURE_GRID_COIN_MARGINED',baseList:['BTC'],investmentAmount:'0.1',investmentToken:'BTC',profit:'12.3'},
      {buOrderId:'id-2',buOrderType:'spot_grid',cateType:'SPOT',baseList:['ETH']}
    ]},
    {type:'SPOT',list:[{buOrderId:'ignored',buOrderType:'spot_grid'}]},
    {type:'FUTURES_LITE',list:[{buOrderId:'id-3',buOrderType:'future_hedge_grid',cateType:'FULLY_HEDGING'}]}
  ]);
  assert.equal(rows.length,3);
  assert.equal(rows[0].buOrderId,'id-1');
  assert.equal(rows[0].cateType,'FUTURE_GRID_COIN_MARGINED');
  assert.deepEqual(rows[0].baseList,['BTC']);
  assert.equal(rows[2].walletCategory,'FUTURES_LITE');
});

test('wallet bot detail probe is read-only, aggregate-safe, and fail-soft per candidate',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(url);
    const id=new URL(url).searchParams.get('buOrderId');
    if(id==='bad')return {ok:true,status:200,text:async()=>JSON.stringify({result:false,code:'BOT_INVALID_ARGUMENT',message:'no detail'})};
    return {ok:true,status:200,text:async()=>JSON.stringify({result:true,data:{buOrderId:id,status:'running',buOrderData:{status:'running',trend:'long'}}})};
  };
  const result=await probeWalletBotDetails([
    {buOrderId:'good',buOrderType:'futures_grid',cateType:'FUTURE_GRID_COIN_MARGINED'},
    {buOrderId:'bad',buOrderType:'other',cateType:'UNKNOWN'}
  ],{apiKey:'k',apiSecret:'s',fetchImpl,now:()=>1700000000000,delayMs:0});
  assert.equal(calls.length,2);
  assert.equal(result.candidateCount,2);
  assert.equal(result.successCount,1);
  assert.equal(result.failureCount,1);
  assert.deepEqual(result.buOrderTypeCounts,{futures_grid:1,other:1});
  assert.deepEqual(result.successCateTypeCounts,{FUTURE_GRID_COIN_MARGINED:1});
  assert.equal(result.details[0].wallet.buOrderId,'good');
});


test('wallet bot risk promotes only fully hydrated futures_grid rows',()=>{
  const risk=buildWalletBotRisk({
    candidateCount:2,
    buOrderTypeCounts:{futures_grid:1,futures_lite:1},
    successBuOrderTypeCounts:{futures_grid:1},
    details:[{
      wallet:{buOrderId:'grid-1',buOrderType:'futures_grid',baseList:['BTC.PERP'],investmentToken:'BTC'},
      detail:{base:'BTC.PERP',quote:'BTC',status:'running',buOrderData:{status:'running',trend:'long',leverage:'5',bottom:'55000',top:'95000',liquidationPrice:'57000',positionOpenPrice:'86000'}}
    }]
  },'2026-09-28T14:00:00.000Z');
  assert.equal(risk.apiRows,2);
  assert.equal(risk.supportedRows,1);
  assert.equal(risk.unsupportedRows,1);
  assert.equal(risk.detailRows,1);
  assert.equal(risk.normalizedRows,1);
  assert.equal(risk.detailsComplete,true);
  assert.equal(risk.bots[0].symbol,'BTC');
  assert.equal(risk.bots[0].side,'LONG');
  assert.equal(risk.bots[0].leverage,5);
  assert.equal(risk.bots[0].source,'PIONEX_WALLET_BOT_DETAIL');
  assert.deepEqual(risk.statusCounts,{running:1});
  assert.deepEqual(risk.trendCounts,{long:1});
  assert.deepEqual(risk.rejectReasonCounts,{});
  assert.equal(risk.detailBasePresentCount,1);
  assert.equal(risk.missingBaseCount,0);
  assert.ok(risk.detailEnvelopeFields.includes('buOrderData'));
  assert.ok(risk.detailBotDataFields.includes('trend'));
  assert.equal(risk.typePassCount,1);
  assert.equal(risk.statusPassCount,1);
  assert.equal(risk.symbolPassCount,1);
  assert.equal(risk.sidePassCount,1);
  assert.equal(risk.allStagePassCount,1);
  assert.deepEqual(risk.baseClassCounts,{asset:1});
  assert.deepEqual(risk.quoteClassCounts,{asset:1});
});


test('wallet inverse cateType survives into Coin-M symbol normalization',()=>{
  const risk=buildWalletBotRisk({
    candidateCount:1,
    buOrderTypeCounts:{futures_grid:1},
    successBuOrderTypeCounts:{futures_grid:1},
    details:[{
      wallet:{buOrderId:'inverse-1',buOrderType:'futures_grid',cateType:'inverse',baseList:['USD'],investmentToken:'BTC'},
      detail:{base:'USD',quote:'BTC',status:'running',buOrderData:{status:'running',trend:'short',leverage:'5',bottom:'50000',top:'100000'}}
    }]
  },'2026-09-28T15:00:00.000Z');
  assert.equal(risk.normalizedRows,1);
  assert.equal(risk.detailsComplete,true);
  assert.equal(risk.symbolPassCount,1);
  assert.equal(risk.allStagePassCount,1);
  assert.equal(risk.bots[0].symbol,'BTC');
  assert.equal(risk.bots[0].side,'LONG');
  assert.equal(risk.bots[0].declaredSide,'SHORT');
  assert.equal(risk.bots[0].assetDeclaredSide,'LONG');
});

test('wallet bot risk fails closed when any supported detail cannot normalize',()=>{
  const risk=buildWalletBotRisk({
    candidateCount:1,
    buOrderTypeCounts:{futures_grid:1},
    successBuOrderTypeCounts:{futures_grid:1},
    details:[{wallet:{buOrderId:'grid-1',buOrderType:'futures_grid'},detail:{status:'running',buOrderData:{status:'running'}}}]
  });
  assert.equal(risk.botCount,0);
  assert.equal(risk.detailsComplete,false);
  assert.equal(risk.rejectedCount,1);
  assert.deepEqual(risk.rejectReasonCounts,{missing_base:1});
  assert.deepEqual(risk.statusCounts,{running:1});
  assert.deepEqual(risk.trendCounts,{unknown:1});
  assert.equal(risk.missingBaseCount,1);
  assert.equal(risk.typePassCount,1);
  assert.equal(risk.statusPassCount,1);
  assert.equal(risk.symbolPassCount,0);
  assert.equal(risk.sidePassCount,0);
  assert.equal(risk.allStagePassCount,0);
  assert.deepEqual(risk.baseClassCounts,{missing:1});
});

test('wallet overview keeps structural bot-account metadata without inventing entry values',()=>{
  const x=normalizeWalletOverview({
    totalInUsdt:'500',
    botAccount:{totalInUsdt:'400',detail:[
      {type:'futures_grid',title:'Grid',count:34,hasMore:true,list:[{buOrderId:'x',symbol:'BTC',leverage:'5'}]}
    ]},
    traderAccount:{totalInUsdt:'100',detail:[]}
  });
  assert.equal(x.botCategoryCount,1);
  assert.equal(x.botReportedCount,34);
  assert.equal(x.botListCount,1);
  assert.deepEqual(x.botCategories[0].entryFields,['buOrderId','leverage','symbol']);
  assert.equal(Object.hasOwn(x.botCategories[0],'entries'),false);
});

test('wallet read fails soft without invalidating futures position snapshot',async()=>{
  const fetchImpl=async url=>{
    if(url.includes('/api/v1/wallet/balancesFull'))return {ok:false,status:403,text:async()=>JSON.stringify({result:false,code:'NO_PERMISSION',message:'denied'})};
    let data={};
    if(url.includes('/api/v1/account/balances'))data={balances:[]};
    else if(url.includes('/uapi/v1/account/balances'))data={balances:[],isolates:[]};
    else if(url.includes('/uapi/v1/account/positions'))data={positions:[{symbol:'XRP_USDT_PERP',positionSide:'LONG',markPrice:'1.5',liquidationPrice:'1.2'}]};
    return {ok:true,status:200,text:async()=>JSON.stringify({result:true,data})};
  };
  const snap=await fetchPionexReadSnapshot({apiKey:'k',apiSecret:'s',fetchImpl,now:()=>1700000000000});
  assert.equal(snap.futuresPositionCount,1);
  assert.equal(snap.walletStatus,'ERROR');
  assert.equal(snap.wallet,null);
  assert.ok(snap.walletError);
});

test('normalizers preserve missing values as null',()=>{
  assert.equal(normalizeSpotBalances({balances:[{coin:'ETH'}]})[0].free,null);
  assert.equal(normalizeFuturesBalances({balances:[{coin:'USDT'}]}).balances[0].debts,null);
  assert.equal(normalizeFuturesPositions({positions:[{symbol:'ETH_USDT_PERP',positionSide:'SHORT'}]})[0].avgPrice,null);
});

test('credential resolver accepts dedicated read credentials and generic read fallback',()=>{
  assert.equal(readCredentials({PIONEX_READ_API_KEY:'k',PIONEX_READ_API_SECRET:'s'}).ok,true);
  assert.equal(readCredentials({PIONEX_API_KEY:'k',PIONEX_API_SECRET:'s'}).ok,true);
  assert.equal(readCredentials({PIONEX_READ_API_KEY:'k'}).ok,false);
});

test('failed account read diagnostics do not refresh the previous snapshot',()=>{
  const current={privateRevision:7,pionexAccount:{updatedAt:'old',futuresPositions:[{positionId:'old'}]},pionexAccountSync:{lastSuccessAt:'old'}};
  const next=mergePionexAccountState(current,{status:'ERROR',error:'boom',attemptAt:'2026-09-28T12:00:00Z',configured:true});
  assert.equal(next.pionexAccount.updatedAt,'old');
  assert.deepEqual(next.pionexAccount.futuresPositions,[{positionId:'old'}]);
  assert.equal(next.pionexAccountSync.status,'ERROR');
  assert.equal(next.privateRevision,8);
});

test('Pionex account runtime contains no mutation HTTP paths',()=>{
  const client=fs.readFileSync(new URL('../pionex-read-client.js',import.meta.url),'utf8');
  const sync=fs.readFileSync(new URL('../pionex-account-read-sync.js',import.meta.url),'utf8');
  assert.match(sync,/\/api\/v1\/account\/balances/);
  assert.match(sync,/\/uapi\/v1\/account\/balances/);
  assert.match(sync,/\/uapi\/v1\/account\/positions/);
  assert.match(sync,/\/api\/v1\/wallet\/balancesFull/);
  assert.doesNotMatch(client,/method:'POST'|method:'DELETE'|method:'PUT'|method:'PATCH'/);
  assert.doesNotMatch(sync,/trade\/order|assets\/transfer|account\/leverage.*post|isolatedMode.*post/);
});
