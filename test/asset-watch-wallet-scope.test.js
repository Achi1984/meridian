import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPionexReadSnapshot,mergePionexAccountState} from '../pionex-account-read-sync.js';
import {buildPionexRiskSnapshot,buildPionexBotCoverage,mergePionexSyncState} from '../pionex-bot-auto-sync.js';
import {buildAssetWatchApiSnapshot} from '../asset-watch-bridge.js';
import {assetWatchMirrorKeyHashFromShareToken,encryptAssetWatchMirror,
  decryptAssetWatchMirror,validateAssetWatchMirrorEnvelope} from '../asset-watch-mirror-crypto.js';
import {assetWatchStrictGateDiagnostics} from '../scripts/runtime-smoke-diagnostics.mjs';
import {buildBotReadModel} from '../v11/bot-read-model.js';

const AT='2026-10-30T13:24:40.000Z',NOW=Date.parse(AT)+16000;
const TOKEN='synthetic-wallet-scope-test';
const grid=(id='synthetic-private-grid')=>({buOrderId:id,buOrderType:'futures_grid'});
const lite=()=>({buOrderId:'synthetic-private-lite',buOrderType:'futures_lite'});
const detail=()=>({base:'BTC.PERP',quote:'USDT',status:'running',
  buOrderData:{status:'running',trend:'long'}});
function primaryRisk(unknown=false){
  const orders=[{...grid('synthetic-primary'),...detail()}];
  if(unknown)orders.push({buOrderId:'synthetic-primary-unknown',buOrderType:'futures_lite'});
  return {...buildPionexRiskSnapshot(orders,AT),detailsComplete:true,paginationComplete:true,
    coverage:buildPionexBotCoverage(orders,{detailRows:1,paginationComplete:true,pages:1})};
}

async function produce({rows=[grid(),lite()],hasMore=false,count=rows.length,
  missingDetail=false,badDetail=false,extraCategories=[]}={}){
  const snapshot=await fetchPionexReadSnapshot({
    apiKey:'synthetic-key',apiSecret:'synthetic-secret',now:()=>Date.parse(AT),
    fetchImpl:async(raw,options)=>{
      assert.equal(options.method,'GET');
      const url=new URL(raw);
      let data={};
      if(url.pathname==='/api/v1/wallet/balancesFull'){
        data={botAccount:{detail:[{type:'TRADING_BOT',count,hasMore,list:rows},...extraCategories]}};
      }else if(url.pathname==='/api/v1/bot/orders/futuresGrid/order'){
        if(missingDetail&&url.searchParams.get('buOrderId')===rows[0].buOrderId)
          return Response.json({result:false,code:'SYNTHETIC_DETAIL_MISSING'});
        data=badDetail?{status:'running',buOrderData:{status:'running'}}:detail();
      }else assert.ok(['/api/v1/account/balances','/uapi/v1/account/balances',
        '/uapi/v1/account/positions'].includes(url.pathname),'no unexpected provider operation');
      return Response.json({result:true,data});
    }
  });
  return mergePionexAccountState({},{
    snapshot,status:'OK',attemptAt:AT,successAt:AT,configured:true
  });
}
function chain(state,options={}){
  const before=structuredClone(state);
  const snapshot=buildAssetWatchApiSnapshot(state,{now:NOW,preferOverwrite:true,...options});
  const envelope=encryptAssetWatchMirror(snapshot,assetWatchMirrorKeyHashFromShareToken(TOKEN),
    {now:new Date(NOW).toISOString()});
  assert.deepEqual(decryptAssetWatchMirror(envelope,TOKEN),snapshot);
  assert.deepEqual(state,before,'source state and timestamps must not change');
  assert.equal(snapshot.readOnly,true);assert.equal(snapshot.executionImpact,false);
  return {snapshot,envelope,validation:validateAssetWatchMirrorEnvelope(envelope,{nowMs:NOW})};
}
function rejected(result,reason){
  assert.equal(result.snapshot.usableForOverwrite,false);
  assert.equal(result.validation.ok,false);
  assert.ok(result.snapshot.overwriteRejectionReasons.includes(reason),reason);
  assert.ok(result.envelope.receipt.overwriteRejectionReasons.includes(reason),reason);
  const diagnostic=JSON.parse(assetWatchStrictGateDiagnostics(result.envelope,null));
  assert.ok(diagnostic.overwriteRejectionReasons.includes(reason));
}

test('actual mixed wallet producer authorizes only complete grids through the encrypted validator',async()=>{
  const state=await produce(),risk=state.pionexAccount.walletBotRisk;
  assert.equal(risk.detailsComplete,true);assert.equal(risk.unsupportedRows,1);
  assert.equal(risk.apiRows,2);assert.equal(risk.supportedRows,1);
  assert.equal(risk.supportedScope.exclusionsVerified,true);
  const {snapshot,envelope,validation}=chain(state);
  assert.equal(snapshot.usableForOverwrite,true);assert.equal(validation.ok,true);
  assert.equal(snapshot.overwriteScope,'WALLET_FUTURES_GRID');
  assert.equal(snapshot.excludedScope,'KNOWN_EXCLUDED_PRODUCTS');
  assert.equal(snapshot.coverage.status,'PARTIAL');
  assert.equal(snapshot.coverage.unsupportedRows,1);
  assert.equal(snapshot.coverage.listRows,2);assert.equal(snapshot.coverage.representedRows,1);
  assert.equal(snapshot.sourceSnapshotAt,AT);assert.equal(snapshot.sourceAgeMs,16000);
  assert.deepEqual(snapshot.overwriteRejectionReasons,[]);
  assert.equal(snapshot.bots[0].botType,'futures_grid');
  const model=buildBotReadModel(snapshot,{now:NOW});
  assert.equal(model.coverage.status,'PARTIAL');assert.equal(model.coverage.unsupportedRows,1);
  assert.equal(model.bots.length,1);
  const publicDiagnostic=JSON.stringify(envelope.receipt);
  assert.doesNotMatch(publicDiagnostic,/synthetic-private|BTC|USDT|Rows|Count|ciphertext|synthetic-key|synthetic-secret/);
  const unscoped=structuredClone(envelope);delete unscoped.receipt.overwriteScope;
  assert.equal(validateAssetWatchMirrorEnvelope(unscoped,{nowMs:NOW}).reason,'wallet_scope_invalid');
});

test('missing supported hydration remains rejected in the actual wallet chain',async()=>{
  rejected(chain(await produce({missingDetail:true})),'SUPPORTED_HYDRATION_MISSING');
});
test('failed supported normalization remains rejected in the actual wallet chain',async()=>{
  rejected(chain(await produce({badDetail:true})),'SANITIZATION_LOSS_OR_DUPLICATE');
});
test('duplicate supported input is not hidden by hydration deduplication',async()=>{
  rejected(chain(await produce({rows:[grid(),grid(),lite()]})),'SUPPORTED_HYDRATION_MISSING');
});
test('missing supported identity is accounted for rather than dropped before hydration',async()=>{
  const state=await produce({rows:[grid(),{buOrderType:'futures_grid'},lite()]});
  assert.equal(state.pionexAccount.walletBotRisk.supportedRows,2);
  rejected(chain(state),'SUPPORTED_HYDRATION_MISSING');
});
test('post-producer duplicate or sanitization loss cannot authorize a mirror',async()=>{
  const state=await produce();
  for(const mutate of [
    risk=>risk.bots.push(structuredClone(risk.bots[0])),
    risk=>{risk.bots[0].symbol='INVALID PRIVATE SYMBOL'},
    risk=>{risk.bots[0].side=null},
    risk=>{risk.bots[0].botType='future_hedge_grid'}
  ]){
    const changed=structuredClone(state);mutate(changed.pionexAccount.walletBotRisk);
    rejected(chain(changed),'SANITIZATION_LOSS_OR_DUPLICATE');
  }
});
test('wallet hasMore and reported-list gaps remain incomplete through the producer',async()=>{
  for(const options of [{hasMore:true},{count:3}]){
    const state=await produce(options);
    assert.equal(state.pionexAccount.walletBotRisk.paginationComplete,false);
    rejected(chain(state),'PAGINATION_INCOMPLETE');
  }
});
test('each explicit partial and truncation signal independently rejects scoped wallet authority',async()=>{
  const state=await produce();
  for(const [mutate,reason] of [
    [risk=>{risk.coverage={status:'PARTIAL'}},'EXPLICIT_PARTIAL'],
    [risk=>{risk.coverage={paginationComplete:false}},'PAGINATION_INCOMPLETE'],
    [risk=>{risk.paginationComplete=false},'PAGINATION_INCOMPLETE']
  ]){
    const changed=structuredClone(state);mutate(changed.pionexAccount.walletBotRisk);
    rejected(chain(changed),reason);
  }
  const partial=structuredClone(state);partial.pionexAccountSync.status='PARTIAL';
  rejected(chain(partial),'SYNC_PARTIAL');
  const truncated=structuredClone(state);truncated.pionexAccountSync.truncated=true;
  rejected(chain(truncated),'PAGINATION_INCOMPLETE');
});
test('unknown products and absent scope or pagination evidence remain fail-closed',async()=>{
  for(const type of ['unknown-private-product','future_hedge_grid',null]){
    const state=await produce({rows:[grid(),{...lite(),buOrderType:type}]});
    assert.equal(state.pionexAccount.walletBotRisk.unsupportedRows,1);
    rejected(chain(state),'UNSUPPORTED_SCOPE');
  }
  const state=await produce();
  delete state.pionexAccount.walletBotRisk.supportedScope;
  rejected(chain(state),'UNSUPPORTED_SCOPE');
  const unknownPages=await produce();delete unknownPages.pionexAccount.walletBotRisk.paginationComplete;
  rejected(chain(unknownPages),'PAGINATION_INCOMPLETE');
});
test('unknown wallet categories cannot hide grids or unverified product exclusions',async()=>{
  for(const rows of [[grid('synthetic-hidden-grid')],[{...lite(),buOrderType:'unknown-product'}]]){
    const state=await produce({extraCategories:[{type:'UNKNOWN_CATEGORY',count:1,hasMore:false,list:rows}]});
    assert.equal(state.pionexAccount.walletBotRisk.supportedScope.exclusionsVerified,false);
    const result=chain(state);
    rejected(result,'UNSUPPORTED_SCOPE');
    assert.equal(result.snapshot.excludedScope,'UNVERIFIED');
    assert.equal(result.snapshot.coverage.status,'PARTIAL');
  }
});
test('scope accounting discrepancies and stale wallet snapshots remain rejected',async()=>{
  const state=await produce();
  const mismatch=structuredClone(state);mismatch.pionexAccount.walletBotRisk.supportedScope.excludedRows=0;
  rejected(chain(mismatch),'UNSUPPORTED_SCOPE');
  const stale=structuredClone(state);
  stale.pionexAccount.walletBotRisk.snapshotAt='2026-10-30T12:00:00.000Z';
  rejected(chain(stale),'SOURCE_STALE');
  const gridsOnly=chain(await produce({rows:[grid()]}));
  assert.equal(gridsOnly.validation.ok,true);
  assert.equal(gridsOnly.snapshot.excludedScope,'NONE');
});
test('both strict mirror selections differ from both display-first selections without promoting canonical state',async()=>{
  let state=await produce();
  const primary=primaryRisk();
  state=mergePionexSyncState(state,{risk:primary,status:'OK',configured:true,
    attemptAt:AT,successAt:AT});
  const canonical=structuredClone(state.pionexRisk);
  const complete=chain(state);
  assert.equal(complete.snapshot.source,'PIONEX_BOT_API');
  assert.equal(complete.validation.ok,true);
  const partial={...primary,paginationComplete:false,coverage:{status:'PARTIAL',paginationComplete:false}};
  state=mergePionexSyncState(state,{risk:partial,status:'PARTIAL',truncated:true,attemptAt:AT});
  for(const route of ['live-mirror','github-oidc-mirror']){
    const result=chain(state);
    assert.equal(result.snapshot.source,'PIONEX_WALLET_BOT_DETAIL',route);
    assert.equal(result.validation.ok,true,route);
  }
  for(const route of ['private-authenticated','private-share']){
    const result=chain(state,{preferOverwrite:false});
    assert.equal(result.snapshot.source,'PIONEX_BOT_API',route);
    rejected(result,'SYNC_PARTIAL');
  }
  assert.deepEqual(state.pionexRisk,canonical);
  assert.equal(state.pionexBotSync.lastSuccessAt,AT);
});
test('primary API unknown products receive no wallet exclusion exemption',async()=>{
  const state=await produce();
  const primary=primaryRisk(true);
  state.pionexRisk=primary;state.pionexBotSync={status:'OK'};
  const display=chain(state,{preferOverwrite:false});
  assert.equal(display.snapshot.source,'PIONEX_BOT_API');
  rejected(display,'UNSUPPORTED_SCOPE');
  assert.equal(chain(state).snapshot.source,'PIONEX_WALLET_BOT_DETAIL');
});
test('public reason diagnostics discard arbitrary caller data and remain bounded',()=>{
  const diagnostic=JSON.parse(assetWatchStrictGateDiagnostics({receipt:{
    overwriteScope:'PRIVATE_MARKER',excludedScope:'PRIVATE_MARKER',
    overwriteRejectionReasons:['UNSUPPORTED_SCOPE','PRIVATE_MARKER',...Array(100).fill('SYNC_PARTIAL')],
    bots:[{id:'PRIVATE_MARKER'}],unsupportedRows:123,ciphertext:'PRIVATE_MARKER'
  }},null));
  assert.deepEqual(diagnostic.overwriteRejectionReasons,['UNSUPPORTED_SCOPE','SYNC_PARTIAL']);
  assert.equal(diagnostic.overwriteScope,null);assert.equal(diagnostic.excludedScope,null);
  assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_MARKER|123|bots|ciphertext|unsupportedRows/);
  assert.ok(JSON.stringify(diagnostic).length<1024);
});
