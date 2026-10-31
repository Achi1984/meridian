import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssetWatchApiSnapshot} from '../asset-watch-bridge.js';
import {mergePionexSyncState} from '../pionex-bot-auto-sync.js';
import {buildWalletBotRisk} from '../pionex-account-read-sync.js';

const NOW=Date.parse('2026-09-28T20:45:00.000Z');
function bot(overrides={}){
  return {
    id:'raw-secret-bot-id',
    botOrderId:'987654321',
    symbol:'HBAR',
    side:'LONG',
    leverage:4,
    lower:0.05,
    upper:0.15,
    liquidationPrice:0.06089,
    liquidationLowerBound:null,
    liquidationUpperBound:null,
    takeProfit:0.15,
    stopLoss:null,
    grids:287,
    position:35829.92,
    positionOpenPrice:0.11576,
    extraMargin:0,
    investmentUsd:null,
    investCurrency:'HBAR',
    quoteInvestment:35829.92,
    pnlUsd:-33.75,
    totalProfitPct:-0.82,
    source:'PIONEX_BOT_API',
    ...overrides
  };
}
function state(overrides={}){
  return {
    pionexRisk:{
      snapshotAt:'2026-09-28T20:40:00.000Z',
      detailsComplete:true,
      bots:[bot()]
    },
    pionexBotSync:{status:'OK',lastSuccessAt:'2026-09-28T20:40:00.000Z'},
    pionexAccountSync:{status:'OK',lastSuccessAt:'2026-09-28T20:39:00.000Z'},
    ...overrides
  };
}
function walletRisk(row){
  return buildWalletBotRisk({candidateCount:1,paginationComplete:true,categoriesVerified:true,
    buOrderTypeCounts:{futures_grid:1},successBuOrderTypeCounts:{futures_grid:1},
    details:[{wallet:{buOrderId:row.botOrderId,buOrderType:'futures_grid'},
      detail:{base:row.symbol,quote:'USDT',status:'running',buOrderData:{status:'running',trend:'long'}}}]
  },'2026-09-28T20:41:00.000Z');
}

test('asset-watch bridge exports only a fresh complete read-only Pionex bot snapshot',()=>{
  const x=buildAssetWatchApiSnapshot(state(),{now:NOW});
  assert.equal(x.usableForOverwrite,true);
  assert.equal(x.source,'PIONEX_BOT_API');
  assert.equal(x.botCount,1);
  assert.equal(x.bots[0].symbol,'HBAR');
  assert.equal(x.bots[0].side,'LONG');
  assert.equal(x.bots[0].limits.lower,0.05);
  assert.equal(x.bots[0].limits.upper,0.15);
  assert.equal(x.bots[0].limits.liquidationPrice,0.06089);
  assert.equal(x.bots[0].limits.liquidationLowerBound,null);
  assert.equal(x.bots[0].limits.liquidationUpperBound,null);
  assert.equal(x.bots[0].limits.takeProfit,null);
  assert.equal(x.bots[0].limits.takeProfitEvidence,'UNKNOWN');
  assert.equal(x.bots[0].grid.grids,287);
  assert.equal(x.bots[0].position.positionOpenPrice,0.11576);
  assert.equal(x.bots[0].position.breakEvenPrice,null);
  assert.equal(x.readOnly,true);
  assert.equal(x.executionImpact,false);
});

test('asset-watch bridge never leaks raw Pionex bot IDs',()=>{
  const x=buildAssetWatchApiSnapshot(state(),{now:NOW});
  const raw=JSON.stringify(x);
  assert.doesNotMatch(raw,/987654321/);
  assert.doesNotMatch(raw,/raw-secret-bot-id/);
  assert.match(x.bots[0].botRef,/^[a-f0-9]{20}$/);
});

test('stale bot data fails closed and must not overwrite the watch snapshot',()=>{
  const x=buildAssetWatchApiSnapshot(state({
    pionexRisk:{snapshotAt:'2026-09-28T19:00:00.000Z',detailsComplete:true,bots:[bot()]},
    pionexBotSync:{status:'OK',lastSuccessAt:'2026-09-28T19:00:00.000Z'}
  }),{now:NOW});
  assert.equal(x.fresh,false);
  assert.equal(x.usableForOverwrite,false);
  assert.equal(x.overwriteRule,'ONLY_WHEN_usableForOverwrite_IS_TRUE');
});

test('wallet bot detail is an authenticated failover when primary bot sync is stale',()=>{
  const x=buildAssetWatchApiSnapshot(state({
    pionexRisk:{snapshotAt:'2026-09-28T19:00:00.000Z',detailsComplete:true,bots:[bot({symbol:'BTC'})]},
    pionexBotSync:{status:'ERROR',lastSuccessAt:'2026-09-28T19:00:00.000Z'},
    pionexAccount:{
      walletBotRisk:walletRisk(bot({symbol:'SUI'}))
    },
    pionexAccountSync:{status:'OK',lastSuccessAt:'2026-09-28T20:41:00.000Z'}
  }),{now:NOW});
  assert.equal(x.source,'PIONEX_WALLET_BOT_DETAIL');
  assert.equal(x.usableForOverwrite,true);
  assert.equal(x.bots[0].symbol,'SUI');
});

test('snapshot fingerprint is stable across bot order and changes when a limit changes',()=>{
  const a=bot({botOrderId:'a',symbol:'BTC',lower:55000});
  const b=bot({botOrderId:'b',symbol:'ETH',lower:1500});
  const s1=state({pionexRisk:{snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,bots:[a,b]}});
  const s2=state({pionexRisk:{snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,bots:[b,a]}});
  const s3=state({pionexRisk:{snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,bots:[b,{...a,lower:54000}]}});
  const x1=buildAssetWatchApiSnapshot(s1,{now:NOW});
  const x2=buildAssetWatchApiSnapshot(s2,{now:NOW});
  const x3=buildAssetWatchApiSnapshot(s3,{now:NOW});
  assert.equal(x1.snapshotFingerprint,x2.snapshotFingerprint);
  assert.notEqual(x1.snapshotFingerprint,x3.snapshotFingerprint);
});


test('explicit COIN-M provenance is preserved without reversing the existing side',()=>{
  const input=state();input.pionexRisk.bots=[bot({cateType:'inverse',botType:'futures_grid',side:'SHORT',sideSource:'economic_inverse_asset'})];
  const before=structuredClone(input),x=buildAssetWatchApiSnapshot(input,{now:NOW});
  assert.equal(x.bots[0].cateType,'inverse');assert.equal(x.bots[0].botType,'futures_grid');
  assert.equal(x.bots[0].sideSource,'economic_inverse_asset');assert.equal(x.bots[0].side,'SHORT');
  assert.equal(x.source,'PIONEX_BOT_API');assert.equal(x.usableForOverwrite,true);assert.deepEqual(input,before);
});
test('documented Futures Moon category crosses the sanitized bridge independently of bot type and side',()=>{
  const input=state({pionexRisk:{snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,
    coverage:{status:'DOCUMENTED',providerContractStatus:'DOCUMENTED',liveAccountVerification:'NOT_PERFORMED',
      listRows:2,recognizedRows:2,representedRows:2,unsupportedRows:0,unhydratedRows:0,
      paginationComplete:true,pages:2,pageLimit:20},
    bots:[bot({botOrderId:'synthetic-standard',symbol:'BTC',cateType:'linear',botType:'futures_grid'}),
      bot({botOrderId:'synthetic-moon',symbol:'BTC',side:'NEUTRAL',cateType:' FUTURES_MOON ',
        botType:'futures_grid',liquidationLowerBound:50000,liquidationUpperBound:60000})]}});
  const x=buildAssetWatchApiSnapshot(input,{now:NOW});
  assert.equal(x.bots.length,2);
  assert.deepEqual(x.bots.map(row=>[row.botType,row.cateType,row.side]),[
    ['futures_grid','linear','LONG'],['futures_grid','FUTURES_MOON','NEUTRAL']
  ]);
  assert.equal(x.coverage.status,'DOCUMENTED');
  assert.equal(x.coverage.providerContractStatus,'DOCUMENTED');
  assert.equal(x.coverage.liveAccountVerification,'NOT_PERFORMED');
  assert.equal(x.usableForOverwrite,true);
});
test('missing or arbitrary provenance stays null and cannot leak caller text',()=>{
  const x=buildAssetWatchApiSnapshot(state(),{now:NOW});
  for(const key of ['cateType','botType','sideSource'])assert.equal(x.bots[0][key],null);
  for(const value of [true,1,{},[],null,'secret-marker','INVERSE',' '.repeat(129)+'inverse']){
    const input=state();input.pionexRisk.bots=[bot({cateType:value,botType:value,sideSource:value})];
    const result=buildAssetWatchApiSnapshot(input,{now:NOW});
    for(const key of ['cateType','botType','sideSource'])assert.equal(result.bots[0][key],null);
    assert.ok(!JSON.stringify(result).includes('secret-marker'));
    assert.equal(result.bots[0].symbol,'HBAR'); // Symbol/currency never implies inverse.
  }
});
test('existing wallet selection and stale protection preserve typed provenance',()=>{
  const input=state({pionexBotSync:{status:'ERROR'},pionexAccount:{walletBotRisk:{snapshotAt:'2026-09-28T20:41:00.000Z',detailsComplete:true,bots:[bot({source:'PIONEX_WALLET_BOT_DETAIL',cateType:'inverse',botType:'future_hedge_grid',sideSource:'trend_inverse_asset'})]}}});
  const x=buildAssetWatchApiSnapshot(input,{now:NOW});assert.equal(x.source,'PIONEX_WALLET_BOT_DETAIL');
  assert.equal(x.bots[0].cateType,'inverse');assert.equal(x.bots[0].botType,'future_hedge_grid');assert.equal(x.bots[0].sideSource,'trend_inverse_asset');
  const stale=buildAssetWatchApiSnapshot(input,{now:NOW+3600000});assert.equal(stale.usableForOverwrite,false);assert.equal(stale.fresh,false);
});

test('bridge retains only bounded comparable TP evidence and never promotes null or zero to absence',()=>{
  for(const [takeProfit,takeProfitEvidence,expectedPrice,expectedEvidence] of [
    [0.15,'PRICE_SET',0.15,'PRICE_SET'],
    [null,'PRICE_SET',null,'UNKNOWN'],
    [0,'PRICE_SET',null,'UNKNOWN'],
    [0.15,'CONFIRMED_UNSET',null,'UNKNOWN'],
    [0.15,'OTHER_TP_TYPE',null,'UNKNOWN'],
    [null,null,null,'UNKNOWN']
  ]){
    const input=state();input.pionexRisk.bots=[bot({takeProfit,takeProfitEvidence})];
    const result=buildAssetWatchApiSnapshot(input,{now:NOW});
    assert.equal(result.bots[0].limits.takeProfit,expectedPrice);
    assert.equal(result.bots[0].limits.takeProfitEvidence,expectedEvidence);
  }
});

test('wallet detail normalization carries explicit price evidence through its existing projection',()=>{
  const risk=buildWalletBotRisk({candidateCount:1,paginationComplete:true,categoriesVerified:true,
    buOrderTypeCounts:{futures_grid:1},successBuOrderTypeCounts:{futures_grid:1},
    details:[{wallet:{buOrderId:'synthetic-wallet-tp',buOrderType:'futures_grid',cateType:'linear'},
      detail:{base:'BTC.PERP',quote:'USDT',status:'running',buOrderData:{status:'running',trend:'long',
        bottom:'50000',top:'100000',profitStopType:'price',profitStop:'100000'}}}]
  },'2026-09-28T20:41:00.000Z');
  assert.equal(risk.bots[0].takeProfit,100000);
  assert.equal(risk.bots[0].takeProfitEvidence,'PRICE_SET');
  const input=state({pionexRisk:{snapshotAt:'2026-09-28T19:00:00.000Z',detailsComplete:true,bots:[]},
    pionexBotSync:{status:'ERROR'},pionexAccount:{walletBotRisk:risk},
    pionexAccountSync:{status:'OK',lastSuccessAt:'2026-09-28T20:41:00.000Z'}});
  const projected=buildAssetWatchApiSnapshot(input,{now:NOW});
  assert.equal(projected.source,'PIONEX_WALLET_BOT_DETAIL');
  assert.equal(projected.bots[0].limits.takeProfitEvidence,'PRICE_SET');
});
test('fingerprint detects provenance changes while raw IDs remain absent',()=>{
  const input=state();input.pionexRisk.bots=[bot({cateType:'linear',botType:'futures_grid',sideSource:'trend'})];
  const first=buildAssetWatchApiSnapshot(input,{now:NOW});
  input.pionexRisk.bots[0].cateType='inverse';const second=buildAssetWatchApiSnapshot(input,{now:NOW});
  assert.notEqual(first.snapshotFingerprint,second.snapshotFingerprint);
  assert.doesNotMatch(JSON.stringify(second),/987654321|raw-secret-bot-id/);
  assert.equal(second.readOnly,true);assert.equal(second.executionImpact,false);
});

test('whitespace-padded supported provenance follows existing upstream type validation',()=>{
  for(const botType of ['futures_grid','future_hedge_grid']){
    const input=state();input.pionexRisk.bots=[bot({botType:' \t'+botType+'\n ',cateType:' inverse ',sideSource:' trend_inverse_asset '})];
    const x=buildAssetWatchApiSnapshot(input,{now:NOW});
    assert.equal(x.bots[0].botType,botType);assert.equal(x.bots[0].cateType,'inverse');assert.equal(x.bots[0].sideSource,'trend_inverse_asset');
    assert.equal(x.bots[0].side,'LONG');assert.equal(x.usableForOverwrite,true);
  }
  const input=state();input.pionexRisk.bots=[bot({botType:' arbitrary-secret ',cateType:1,sideSource:{value:'trend'}})];
  const x=buildAssetWatchApiSnapshot(input,{now:NOW});
  for(const key of ['botType','cateType','sideSource'])assert.equal(x.bots[0][key],null);
});

test('partial provider coverage and duplicate identities preserve valid rows without claiming completeness',()=>{
  const first=bot({botOrderId:'synthetic-id-1',symbol:'BTC',side:'NEUTRAL',
    liquidationLowerBound:50000,liquidationUpperBound:60000});
  const input=state({pionexRisk:{snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,
    apiRows:3,supportedRows:2,botCount:2,
    coverage:{status:'PARTIAL',providerContractStatus:'UNVERIFIED',listRows:3,
      recognizedRows:2,representedRows:2,unsupportedRows:1,unhydratedRows:0},
    bots:[first,structuredClone(first)]}});
  const x=buildAssetWatchApiSnapshot(input,{now:NOW});
  assert.equal(x.botCount,1);assert.equal(x.bots.length,1);
  assert.equal(x.bots[0].limits.liquidationLowerBound,50000);
  assert.equal(x.bots[0].limits.liquidationUpperBound,60000);
  assert.equal(x.coverage.status,'PARTIAL');assert.equal(x.coverage.unsupportedRows,1);
  assert.equal(x.coverage.representedRows,1);assert.equal(x.coverage.unhydratedRows,1);
  assert.equal(x.usableForDisplay,true);assert.equal(x.usableForOverwrite,false);
  assert.doesNotMatch(JSON.stringify(x),/synthetic-id-1|raw-secret-bot-id/);
});

test('a remaining continuation token keeps page-limited bridge coverage partial and non-overwritable',()=>{
  const input=state({pionexRisk:{snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,
    coverage:{status:'PARTIAL',providerContractStatus:'DOCUMENTED',liveAccountVerification:'NOT_PERFORMED',
      listRows:1,recognizedRows:1,representedRows:1,unsupportedRows:0,unhydratedRows:0,
      paginationComplete:false,pages:20,pageLimit:20},
    bots:[bot({botOrderId:'synthetic-page-row',cateType:'FUTURES_MOON',botType:'futures_grid'})]}});
  const x=buildAssetWatchApiSnapshot(input,{now:NOW});
  assert.equal(x.botCount,1);assert.equal(x.bots[0].cateType,'FUTURES_MOON');
  assert.equal(x.coverage.paginationComplete,false);assert.equal(x.coverage.pages,20);
  assert.equal(x.coverage.pageLimit,20);assert.equal(x.coverage.status,'PARTIAL');
  assert.equal(x.usableForDisplay,true);assert.equal(x.usableForOverwrite,false);
});

test('latest incomplete diagnostic rows remain displayable without replacing the complete snapshot',()=>{
  const complete={snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,
    coverage:{status:'DOCUMENTED',paginationComplete:true},
    bots:[bot({botOrderId:'synthetic-complete',symbol:'ADA'})]};
  const partial={snapshotAt:'2026-09-28T20:44:00.000Z',detailsComplete:true,paginationComplete:false,
    coverage:{status:'PARTIAL',paginationComplete:false,pages:20,pageLimit:20},
    bots:[bot({botOrderId:'synthetic-partial',symbol:'BTC',cateType:'FUTURES_MOON'})]};
  const input=state({pionexRisk:complete,pionexRiskPartial:partial,
    pionexBotSync:{status:'PARTIAL',truncated:true,lastSuccessAt:'2026-09-28T20:40:00.000Z'}});
  const x=buildAssetWatchApiSnapshot(input,{now:NOW});
  assert.equal(input.pionexRisk.bots[0].symbol,'ADA');
  assert.equal(x.bots.length,1);assert.equal(x.bots[0].symbol,'BTC');
  assert.equal(x.bots[0].cateType,'FUTURES_MOON');
  assert.equal(x.coverage.paginationComplete,false);assert.equal(x.coverage.status,'PARTIAL');
  assert.equal(x.sourceStatusOk,true);assert.equal(x.usableForDisplay,true);
  assert.equal(x.usableForOverwrite,false);
});

test('a partial sync cannot relabel its preserved complete snapshot as a current candidate',()=>{
  const input=state({pionexBotSync:{status:'PARTIAL',truncated:true}});
  const x=buildAssetWatchApiSnapshot(input,{now:NOW});
  assert.equal(x.source,'PIONEX_BOT_API');
  assert.equal(x.coverage.status,'PARTIAL');
  assert.equal(x.sourceStatusOk,true);
  assert.equal(x.usableForDisplay,true);
  assert.equal(x.usableForOverwrite,false);
});

test('merge-to-bridge preserves every independent incomplete signal as display-only coverage',()=>{
  const cases=[
    {name:'top-level pagination false',riskFlags:{paginationComplete:false},
      coverage:{status:'DOCUMENTED',paginationComplete:true}},
    {name:'nested pagination false',riskFlags:{paginationComplete:true},
      coverage:{status:'DOCUMENTED',paginationComplete:false}},
    {name:'raw partial status',riskFlags:{paginationComplete:true},
      coverage:{status:'PARTIAL',paginationComplete:true}},
    {name:'truncated-only sync argument',riskFlags:{paginationComplete:true},
      coverage:{status:'DOCUMENTED',paginationComplete:true},truncated:true}
  ];
  for(const [index,entry] of cases.entries()){
    const complete={snapshotAt:'2026-09-28T20:40:00.000Z',updatedAt:'2026-09-28T20:40:00.000Z',
      detailsComplete:true,paginationComplete:true,coverage:{status:'DOCUMENTED',paginationComplete:true},
      bots:[bot({botOrderId:`synthetic-complete-${index}`,symbol:'ADA'})],botCount:1};
    const partial={...complete,snapshotAt:'2026-09-28T20:44:00.000Z',updatedAt:'2026-09-28T20:44:00.000Z',
      ...entry.riskFlags,coverage:{...entry.coverage},bots:[bot({botOrderId:`synthetic-partial-${index}`,symbol:'BTC'})]};
    const merged=mergePionexSyncState({
      pionexRisk:complete,pionexBotSync:{status:'OK',lastSuccessAt:complete.updatedAt}
    },{risk:partial,status:'OK',attemptAt:partial.updatedAt,successAt:partial.updatedAt,
      configured:true,pages:20,truncated:entry.truncated||false});
    const x=buildAssetWatchApiSnapshot(merged,{now:NOW});
    assert.deepEqual(merged.pionexRisk.bots,complete.bots,entry.name+' preserves complete rows');
    assert.equal(merged.pionexBotSync.lastSuccessAt,complete.updatedAt,entry.name+' preserves last success');
    assert.equal(x.coverage.status,'PARTIAL',entry.name+' remains partial');
    assert.equal(x.usableForDisplay,true,entry.name+' remains displayable');
    assert.equal(x.usableForOverwrite,false,entry.name+' cannot overwrite');
    if(entry.name!=='raw partial status')assert.equal(x.coverage.paginationComplete,false,entry.name);
  }
});

function partialWithWallet(){
  const input=state();
  input.pionexRiskPartial={...input.pionexRisk,paginationComplete:false,
    coverage:{status:'PARTIAL',paginationComplete:false}};
  input.pionexBotSync={status:'PARTIAL',truncated:true};
  input.pionexAccount={walletBotRisk:{...walletRisk(bot({botOrderId:'synthetic-wallet',symbol:'SUI'})),
    coverage:{status:'DOCUMENTED',paginationComplete:true,unsupportedRows:0,unhydratedRows:0},
  }};
  return input;
}

test('strict mirror can select a complete wallet without changing private partial display or state',()=>{
  const input=partialWithWallet(),before=structuredClone(input);
  const display=buildAssetWatchApiSnapshot(input,{now:NOW});
  const strict=buildAssetWatchApiSnapshot(input,{now:NOW,preferOverwrite:true});
  assert.equal(display.source,'PIONEX_BOT_API');
  assert.equal(display.usableForDisplay,true);
  assert.equal(display.usableForOverwrite,false);
  assert.equal(strict.source,'PIONEX_WALLET_BOT_DETAIL');
  assert.equal(strict.usableForOverwrite,true);
  assert.equal(strict.coverage.status,'DOCUMENTED');
  assert.equal(strict.coverage.unhydratedRows,0);
  assert.deepEqual(input,before);
});

test('strict selection never promotes a stale, incomplete, unhydrated, unsupported or dropped-row wallet',()=>{
  const cases=[
    input=>{delete input.pionexAccount},
    input=>{input.pionexAccount.walletBotRisk.snapshotAt='2026-09-28T19:00:00.000Z'},
    input=>{input.pionexAccount.walletBotRisk.detailsComplete=false},
    input=>{input.pionexAccountSync.status='ERROR'},
    input=>{input.pionexAccountSync.status='PARTIAL'},
    input=>{input.pionexAccountSync.truncated=true},
    input=>{input.pionexAccount.walletBotRisk.coverage.paginationComplete=false},
    input=>{input.pionexAccount.walletBotRisk.coverage.unsupportedRows=1},
    input=>{input.pionexAccount.walletBotRisk.coverage.unhydratedRows=1},
    input=>{input.pionexAccount.walletBotRisk.bots.push(bot({botOrderId:'synthetic-wallet'}))},
    input=>{input.pionexAccount.walletBotRisk.bots.push(bot({botOrderId:'synthetic-invalid',side:null}))}
  ];
  for(const [index,mutate] of cases.entries()){
    const input=partialWithWallet();mutate(input);
    const before=structuredClone(input);
    const x=buildAssetWatchApiSnapshot(input,{now:NOW,preferOverwrite:true});
    assert.equal(x.usableForOverwrite,false,`case ${index}`);
    assert.equal(x.coverage.status,'PARTIAL',`case ${index}`);
    assert.deepEqual(input,before);
  }
});

test('strict selection preserves complete primary precedence and qualifies after dropped-row checks',()=>{
  const input=partialWithWallet();
  delete input.pionexRiskPartial;
  input.pionexBotSync={status:'OK'};
  assert.equal(buildAssetWatchApiSnapshot(input,{now:NOW,preferOverwrite:true}).source,'PIONEX_BOT_API');
  input.pionexRisk.bots.push(structuredClone(input.pionexRisk.bots[0]));
  const display=buildAssetWatchApiSnapshot(input,{now:NOW});
  assert.equal(display.coverage.unhydratedRows,1);
  assert.equal(display.usableForOverwrite,false);
  const strict=buildAssetWatchApiSnapshot(input,{now:NOW,preferOverwrite:true});
  assert.equal(strict.source,'PIONEX_WALLET_BOT_DETAIL');
  assert.equal(strict.usableForOverwrite,true);
  delete input.pionexAccount;
  const unsafe=buildAssetWatchApiSnapshot(input,{now:NOW,preferOverwrite:true});
  assert.equal(unsafe.usableForOverwrite,false);
  assert.equal(unsafe.coverage.unhydratedRows,1);
});

test('complete to partial to complete keeps canonical state intact through strict mirror selection',()=>{
  let input=partialWithWallet();
  delete input.pionexRiskPartial;
  input.pionexBotSync={status:'OK',lastSuccessAt:input.pionexRisk.snapshotAt};
  const canonical=structuredClone(input.pionexRisk);
  assert.equal(buildAssetWatchApiSnapshot(input,{now:NOW,preferOverwrite:true}).source,'PIONEX_BOT_API');
  const partial={...canonical,paginationComplete:false,coverage:{status:'PARTIAL',paginationComplete:false}};
  input=mergePionexSyncState(input,{risk:partial,status:'PARTIAL',configured:true,truncated:true,
    attemptAt:'2026-09-28T20:43:00.000Z'});
  const before=structuredClone(input);
  assert.equal(buildAssetWatchApiSnapshot(input,{now:NOW,preferOverwrite:true}).source,'PIONEX_WALLET_BOT_DETAIL');
  assert.deepEqual(input,before);
  assert.deepEqual(input.pionexRisk,canonical);
  assert.equal(buildAssetWatchApiSnapshot(input,{now:NOW}).usableForOverwrite,false);
  const recovered={...canonical,snapshotAt:'2026-09-28T20:44:00.000Z',updatedAt:'2026-09-28T20:44:00.000Z'};
  input=mergePionexSyncState(input,{risk:recovered,status:'OK',configured:true,truncated:false,
    attemptAt:recovered.updatedAt,successAt:recovered.updatedAt});
  assert.equal(Object.hasOwn(input,'pionexRiskPartial'),false);
  const strict=buildAssetWatchApiSnapshot(input,{now:NOW,preferOverwrite:true});
  assert.equal(strict.source,'PIONEX_BOT_API');
  assert.equal(strict.usableForOverwrite,true);
  assert.deepEqual(input.pionexRisk.bots,canonical.bots);
});
