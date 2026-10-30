import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssetWatchApiSnapshot} from '../asset-watch-bridge.js';

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
  assert.equal(x.bots[0].limits.takeProfit,0.15);
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
      walletBotRisk:{
        snapshotAt:'2026-09-28T20:41:00.000Z',
        updatedAt:'2026-09-28T20:41:00.000Z',
        detailsComplete:true,
        bots:[bot({symbol:'SUI',source:'PIONEX_WALLET_BOT_DETAIL'})]
      }
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
