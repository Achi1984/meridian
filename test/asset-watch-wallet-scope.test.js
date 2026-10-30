import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPionexReadSnapshot,mergePionexAccountState,buildWalletBotRisk} from '../pionex-account-read-sync.js';
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
  missingDetail=false,badDetail=false,extraCategories=[],missingCategories=false}={}){
  const snapshot=await fetchPionexReadSnapshot({
    apiKey:'synthetic-key',apiSecret:'synthetic-secret',now:()=>Date.parse(AT),
    fetchImpl:async(raw,options)=>{
      assert.equal(options.method,'GET');
      const url=new URL(raw);
      let data={};
      if(url.pathname==='/api/v1/wallet/balancesFull'){
        data={botAccount:{detail:missingCategories?undefined:
          [{type:'TRADING_BOT',count,hasMore,list:rows},...extraCategories]}};
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
  const persisted=JSON.parse(JSON.stringify(state));
  const snapshot=buildAssetWatchApiSnapshot(persisted,{now:NOW,preferOverwrite:true,...options});
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
  assert.doesNotMatch(publicDiagnostic,/synthetic-private|BTC|USDT|ciphertext|synthetic-key|synthetic-secret/);
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

const VALID_SCOPE_DIAGNOSTICS={
  scopePresent:true,schemaOk:true,botTypeOk:true,exclusionsVerified:true,
  excludedRowsEqualsUnsupported:true,categoriesVerified:true,countsVerified:true,
  candidateCount:2,unsupportedCount:1,unrecognizedNonemptyCategoryCount:0,
  unverifiedCategoryShape:null,
  scopeFailureCount:0,paginationFailureCount:0,firstScopeFailure:null,firstPaginationFailure:null,
  typeCounts:{futures_grid:1,futures_lite:1,OTHER:0}
};
function categoryFailure(categoryClass,reason,shape,countMatchesList){
  return {categoryClass,reason,...shape,countMatchesList};
}
function scopeSummary(state,expectedEligible){
  const result=chain(state);
  assert.equal(result.snapshot.usableForOverwrite,expectedEligible);
  assert.equal(result.validation.ok,expectedEligible);
  const raw=assetWatchStrictGateDiagnostics(result.envelope,null);
  const diagnostic=JSON.parse(raw).scopeDiagnostics;
  assert.deepEqual(diagnostic,result.snapshot.scopeDiagnostics);
  assert.deepEqual(Object.keys(diagnostic).sort(),Object.keys(VALID_SCOPE_DIAGNOSTICS).sort());
  assert.deepEqual(Object.keys(diagnostic.typeCounts),['futures_grid','futures_lite','OTHER']);
  assert.doesNotMatch(raw,/synthetic-private|BTC|USDT|synthetic-key|synthetic-secret|PRIVATE_CANARY|https:|123456789/);
  assert.ok(raw.length<2560,'normal postdeploy failure summary remains bounded');
  const withoutDiagnostics=structuredClone(state);
  delete withoutDiagnostics.pionexAccount.walletBotRisk.scopeDiagnostics;
  const old=chain(withoutDiagnostics);
  const {scopeDiagnostics:currentDiag,...currentSnapshot}=result.snapshot;
  const {scopeDiagnostics:oldDiag,...oldSnapshot}=old.snapshot;
  assert.deepEqual(currentSnapshot,oldSnapshot,'diagnostic metadata cannot affect selection or eligibility');
  const oldEnvelope=structuredClone(result.envelope);
  delete oldEnvelope.receipt.scopeDiagnostics;
  assert.deepEqual(validateAssetWatchMirrorEnvelope(oldEnvelope,{nowMs:NOW}),result.validation,
    'receipt diagnostics cannot affect strict acceptance');
  return diagnostic;
}

test('bounded scope summary survives actual producer, JSON persistence, bridge and public receipt',async()=>{
  assert.deepEqual(scopeSummary(await produce(),true),VALID_SCOPE_DIAGNOSTICS);
});

test('missing scope is distinct from missing producer diagnostic evidence',async()=>{
  const state=await produce();
  delete state.pionexAccount.walletBotRisk.supportedScope;
  assert.deepEqual(scopeSummary(state,false),{
    ...VALID_SCOPE_DIAGNOSTICS,scopePresent:false,schemaOk:null,botTypeOk:null,
    exclusionsVerified:null,excludedRowsEqualsUnsupported:null
  });
  delete state.pionexAccount.walletBotRisk.scopeDiagnostics;
  assert.deepEqual(scopeSummary(state,false),{
    scopePresent:false,schemaOk:null,botTypeOk:null,exclusionsVerified:null,
    excludedRowsEqualsUnsupported:null,categoriesVerified:null,countsVerified:null,
    candidateCount:null,unsupportedCount:null,unrecognizedNonemptyCategoryCount:null,
    unverifiedCategoryShape:null,
    scopeFailureCount:null,paginationFailureCount:null,firstScopeFailure:null,firstPaginationFailure:null,
    typeCounts:{futures_grid:null,futures_lite:null,OTHER:null}
  });
  const empty=buildWalletBotRisk();
  assert.equal(empty.scopeDiagnostics.categoriesVerified,null);
  assert.equal(empty.scopeDiagnostics.countsVerified,null);
  assert.equal(empty.scopeDiagnostics.candidateCount,null);
  assert.equal(empty.scopeDiagnostics.unsupportedCount,null);
  assert.deepEqual(empty.scopeDiagnostics.typeCounts,{futures_grid:null,futures_lite:null,OTHER:null});
  const absentCategories=await produce({missingCategories:true});
  const diagnostic=scopeSummary(absentCategories,false);
  assert.equal(diagnostic.categoriesVerified,null);
  assert.equal(diagnostic.unrecognizedNonemptyCategoryCount,null);
  assert.equal(diagnostic.scopeFailureCount,null);
  assert.equal(diagnostic.paginationFailureCount,null);
  assert.equal(diagnostic.firstScopeFailure,null);
  assert.equal(diagnostic.firstPaginationFailure,null);
  assert.equal(absentCategories.pionexAccount.walletBotRisk.supportedScope.exclusionsVerified,false);
});

test('unknown products are aggregated into OTHER without exposing private type strings',async()=>{
  for(const buOrderType of ['PRIVATE_CANARY_PRODUCT',null]){
    const state=await produce({rows:[grid(),{...lite(),buOrderType}]});
    assert.deepEqual(scopeSummary(state,false),{
      ...VALID_SCOPE_DIAGNOSTICS,exclusionsVerified:false,excludedRowsEqualsUnsupported:false,
      typeCounts:{futures_grid:1,futures_lite:0,OTHER:1}
    });
  }
});

test('nonempty unrecognized categories are distinguished without exposing category payloads',async()=>{
  const state=await produce({extraCategories:[{
    type:'PRIVATE_CANARY_CATEGORY',title:'PRIVATE_CANARY_TITLE',count:1,hasMore:false,
    totalInUsdt:123456789,list:[{...grid('PRIVATE_CANARY_ID'),symbol:'PRIVATE_CANARY_SYMBOL',
      amount:123456789,url:'https://PRIVATE_CANARY.invalid',credential:'PRIVATE_CANARY_CREDENTIAL'}]
  }]});
  const shape={countKind:'NUMBER',zeroVerified:false,listKind:'ARRAY',listEmpty:false,hasMoreFalse:true};
  assert.deepEqual(scopeSummary(state,false),{
    ...VALID_SCOPE_DIAGNOSTICS,exclusionsVerified:false,categoriesVerified:false,
    unrecognizedNonemptyCategoryCount:1,
    unverifiedCategoryShape:shape,scopeFailureCount:1,
    firstScopeFailure:categoryFailure('OTHER','UNRECOGNIZED_NONEMPTY',shape,true)
  });
});

test('unverified category shape remains unknown rather than claiming no unrecognized nonempty categories',async()=>{
  const empty=await produce({extraCategories:[{
    type:'PRIVATE_CANARY_EMPTY',count:0,hasMore:false,list:[]
  }]});
  assert.deepEqual(scopeSummary(empty,true),VALID_SCOPE_DIAGNOSTICS);
  for(const [category,shape] of [
    [{type:'PRIVATE_CANARY_MISSING',hasMore:false},
      {countKind:'MISSING',zeroVerified:null,listKind:'MISSING',listEmpty:null,hasMoreFalse:true}],
    [{type:'PRIVATE_CANARY_NULL',count:null,hasMore:false,list:[]},
      {countKind:'NULL',zeroVerified:null,listKind:'ARRAY',listEmpty:true,hasMoreFalse:true}],
    [{type:'PRIVATE_CANARY_MORE',count:0,hasMore:true,list:[]},
      {countKind:'NUMBER',zeroVerified:true,listKind:'ARRAY',listEmpty:true,hasMoreFalse:false}]
  ]){
    const state=await produce({extraCategories:[category]});
    assert.deepEqual(scopeSummary(state,false),{
      ...VALID_SCOPE_DIAGNOSTICS,exclusionsVerified:false,categoriesVerified:false,
      unrecognizedNonemptyCategoryCount:null,unverifiedCategoryShape:shape,
      scopeFailureCount:1,paginationFailureCount:1,
      firstScopeFailure:categoryFailure('OTHER','UNRECOGNIZED_UNVERIFIED',shape,
        category.count===0?true:null),
      firstPaginationFailure:categoryFailure('OTHER',category.count===0?'HAS_MORE':'COUNT_INVALID',
        shape,category.count===0?true:null)
    });
  }
});

test('explicit numeric and canonical string empty categories preserve grid/lite authority through the real chain',async()=>{
  const baseline=(await produce()).pionexAccount.walletBotRisk.bots;
  for(const count of [0,'0']){
    const category={type:'PRIVATE_CANARY_EMPTY',count,hasMore:false,list:[]};
    const state=await produce({extraCategories:[category]});
    const wallet=state.pionexAccount.wallet,risk=state.pionexAccount.walletBotRisk;
    assert.equal(wallet.botCategories[1].count,0);
    assert.equal(wallet.botCategories[1].listCount,0);
    assert.equal(risk.paginationComplete,true);
    assert.equal(risk.supportedScope.exclusionsVerified,true);
    assert.equal(risk.supportedRows,1);assert.equal(risk.unsupportedRows,1);
    assert.deepEqual(scopeSummary(state,true),VALID_SCOPE_DIAGNOSTICS);
    assert.deepEqual(risk.bots,baseline);
  }
  const stringCounts=await produce({count:'2',extraCategories:[
    {type:'FUTURES_LITE',count:'0',hasMore:false,list:[]}
  ]});
  assert.deepEqual(scopeSummary(stringCounts,true),VALID_SCOPE_DIAGNOSTICS);
});

test('unknown, coercion-only and invalid empty-category counts remain unknown and fail closed',async()=>{
  for(const [count,countKind] of [
    [undefined,'MISSING'],[null,'NULL'],['','STRING'],[' ','STRING'],['\t\n','STRING'],
    [false,'BOOLEAN'],[true,'BOOLEAN'],[-1,'NUMBER'],[0.5,'NUMBER'],
    [Number.MAX_SAFE_INTEGER+1,'NUMBER'],['9007199254740992','STRING'],
    ['-1','STRING'],['0.5','STRING'],    ['0.0','STRING'],['00','STRING'],[' 0 ','STRING'],['0\n','STRING'],['0\r','STRING'],['0\u2028','STRING'],
    ['+0','STRING'],['-0','STRING'],['0e0','STRING'],['0x0','STRING'],['PRIVATE_CANARY_COUNT','STRING'],
    [[], 'OTHER'],[{},'OTHER']
  ]){
    const category={type:'PRIVATE_CANARY_EMPTY',count,hasMore:false,list:[]};
    const state=await produce({extraCategories:[category]});
    assert.equal(state.pionexAccount.wallet.botCategories[1].count,null);
    assert.equal(state.pionexAccount.walletBotRisk.paginationComplete,false);
    const result=chain(state);
    rejected(result,'UNSUPPORTED_SCOPE');rejected(result,'PAGINATION_INCOMPLETE');
    const shape={countKind,zeroVerified:null,listKind:'ARRAY',listEmpty:true,hasMoreFalse:true};
    assert.deepEqual(scopeSummary(state,false),{
      ...VALID_SCOPE_DIAGNOSTICS,exclusionsVerified:false,categoriesVerified:false,
      unrecognizedNonemptyCategoryCount:null,
      unverifiedCategoryShape:shape,scopeFailureCount:1,paginationFailureCount:1,
      firstScopeFailure:categoryFailure('OTHER','UNRECOGNIZED_UNVERIFIED',shape,null),
      firstPaginationFailure:categoryFailure('OTHER','COUNT_INVALID',shape,null)
    });
  }
});

test('empty-category exclusions require an explicit empty array and explicit no-more-pages',async()=>{
  for(const [list,listKind] of [[undefined,'MISSING'],[null,'NULL'],[{},'OTHER'],['','OTHER']]){
    const state=await produce({extraCategories:[
      {type:'PRIVATE_CANARY_EMPTY',count:'0',hasMore:false,list}
    ]});
    rejected(chain(state),'UNSUPPORTED_SCOPE');rejected(chain(state),'PAGINATION_INCOMPLETE');
    const shape={countKind:'STRING',zeroVerified:true,listKind,listEmpty:null,hasMoreFalse:true};
    assert.deepEqual(scopeSummary(state,false),{
      ...VALID_SCOPE_DIAGNOSTICS,exclusionsVerified:false,categoriesVerified:false,
      unrecognizedNonemptyCategoryCount:null,
      unverifiedCategoryShape:shape,scopeFailureCount:1,paginationFailureCount:1,
      firstScopeFailure:categoryFailure('OTHER','UNRECOGNIZED_UNVERIFIED',shape,null),
      firstPaginationFailure:categoryFailure('OTHER','LIST_MISSING_OR_INVALID',shape,null)
    });
  }
  for(const hasMore of [undefined,null,true,'false',0]){
    const state=await produce({extraCategories:[
      {type:'PRIVATE_CANARY_EMPTY',count:'0',hasMore,list:[]}
    ]});
    rejected(chain(state),'UNSUPPORTED_SCOPE');rejected(chain(state),'PAGINATION_INCOMPLETE');
    const diagnostic=scopeSummary(state,false);
    assert.equal(diagnostic.unverifiedCategoryShape.hasMoreFalse,hasMore===true?false:null);
  }
});

test('zero counts cannot hide nonempty unknown categories and positive string counts remain nonempty evidence',async()=>{
  for(const count of [0,'0',1,'1']){
    const state=await produce({extraCategories:[
      {type:'PRIVATE_CANARY_NONEMPTY',count,hasMore:false,list:[grid('PRIVATE_CANARY_ID')]}
    ]});
    rejected(chain(state),'UNSUPPORTED_SCOPE');
    const diagnostic=scopeSummary(state,false);
    assert.equal(diagnostic.categoriesVerified,false);
    assert.equal(diagnostic.unrecognizedNonemptyCategoryCount,1);
    assert.equal(diagnostic.unverifiedCategoryShape.listEmpty,false);
    assert.equal(diagnostic.unverifiedCategoryShape.zeroVerified,count===0||count==='0');
  }
  const state=await produce({extraCategories:[
    {type:'PRIVATE_CANARY_NONEMPTY',count:'1',hasMore:false,list:[]}
  ]});
  assert.equal(scopeSummary(state,false).unrecognizedNonemptyCategoryCount,1);
});

test('recognized categories cannot bypass missing-count or missing-list pagination checks',async()=>{
  for(const count of [null,'',false,-1,0.5,'PRIVATE_CANARY_COUNT']){
    const state=await produce({count});
    assert.equal(state.pionexAccount.wallet.botCategories[0].count,null);
    rejected(chain(state),'PAGINATION_INCOMPLETE');
  }
  for(const category of [
    {type:'TRADING_BOT',hasMore:false,list:[]},
    {type:'FUTURES_LITE',count:0,hasMore:false},
    {hasMore:false}
  ]){
    const state=await produce({extraCategories:[category]});
    rejected(chain(state),'PAGINATION_INCOMPLETE');
  }
});

test('count mismatches use actual producer and bridge verification predicates',async()=>{
  const state=await produce(),account=state.pionexAccount;
  account.walletBotProbe.buOrderTypeCounts.futures_lite=0;
  account.walletBotRisk=buildWalletBotRisk(account.walletBotProbe,AT);
  assert.deepEqual(scopeSummary(state,false),{
    ...VALID_SCOPE_DIAGNOSTICS,exclusionsVerified:false,excludedRowsEqualsUnsupported:false,
    countsVerified:false,typeCounts:{futures_grid:1,futures_lite:0,OTHER:0}
  });
  const mismatch=await produce();
  mismatch.pionexAccount.walletBotRisk.supportedScope.excludedRows=0;
  assert.deepEqual(scopeSummary(mismatch,false),{
    ...VALID_SCOPE_DIAGNOSTICS,excludedRowsEqualsUnsupported:false
  });
  account.walletBotProbe.buOrderTypeCounts.futures_lite=null;
  account.walletBotRisk=buildWalletBotRisk(account.walletBotProbe,AT);
  assert.deepEqual(scopeSummary(state,false),{
    ...VALID_SCOPE_DIAGNOSTICS,exclusionsVerified:false,excludedRowsEqualsUnsupported:false,
    countsVerified:false,typeCounts:{futures_grid:1,futures_lite:null,OTHER:0}
  });
});

test('invalid schema, bot type and missing boolean evidence do not change strict scope gates',async()=>{
  for(const [field,value,expected] of [
    ['schemaVersion','PRIVATE_CANARY_SCHEMA',{schemaOk:false}],
    ['botType','PRIVATE_CANARY_TYPE',{botTypeOk:false}],
    ['exclusionsVerified',undefined,{exclusionsVerified:null}],
    ['exclusionsVerified','PRIVATE_CANARY_BOOLEAN',{exclusionsVerified:null}],
    ['excludedRows',undefined,{excludedRowsEqualsUnsupported:null}]
  ]){
    const state=await produce();state.pionexAccount.walletBotRisk.supportedScope[field]=value;
    assert.deepEqual(scopeSummary(state,false),{...VALID_SCOPE_DIAGNOSTICS,...expected});
  }
});

test('fabricated diagnostic flags cannot authorize an absent wallet scope',async()=>{
  const state=await produce();
  delete state.pionexAccount.walletBotRisk.supportedScope;
  state.pionexAccount.walletBotRisk.scopeDiagnostics=structuredClone(VALID_SCOPE_DIAGNOSTICS);
  const diagnostic=scopeSummary(state,false);
  assert.equal(diagnostic.scopePresent,false);
  assert.equal(diagnostic.schemaOk,null);
  assert.equal(diagnostic.botTypeOk,null);
  assert.equal(diagnostic.exclusionsVerified,null);
  assert.equal(diagnostic.excludedRowsEqualsUnsupported,null);
});

test('independent category failures survive producer, JSON, bridge and receipt regardless of ordering',async()=>{
  const spot={type:'SPOT',count:1,hasMore:false,list:[{id:'PRIVATE_CANARY_SPOT'}]};
  const spotShape={countKind:'NUMBER',zeroVerified:false,listKind:'ARRAY',
    listEmpty:false,hasMoreFalse:true};
  for(const [category,categoryClass,reason,shape,matches,scopeFailures] of [
    [{type:'ARBITRAGE',count:null,hasMore:false,list:[]},'ARBITRAGE','COUNT_INVALID',
      {countKind:'NULL',zeroVerified:null,listKind:'ARRAY',listEmpty:true,hasMoreFalse:true},null,2],
    [{type:'PRIVATE_CANARY_CATEGORY',count:0,hasMore:false},'OTHER','LIST_MISSING_OR_INVALID',
      {countKind:'NUMBER',zeroVerified:true,listKind:'MISSING',listEmpty:null,hasMoreFalse:true},null,2],
    [{type:'ARBITRAGE',count:1,hasMore:false,list:[]},'ARBITRAGE','COUNT_LIST_MISMATCH',
      {countKind:'NUMBER',zeroVerified:false,listKind:'ARRAY',listEmpty:true,hasMoreFalse:true},false,2],
    [{type:'FUTURES_LITE',count:0,hasMore:true,list:[]},'FUTURES_LITE','HAS_MORE',
      {countKind:'NUMBER',zeroVerified:true,listKind:'ARRAY',listEmpty:true,hasMoreFalse:false},true,1],
    [{type:'TRADING_BOT',count:0,list:[]},'TRADING_BOT','HAS_MORE_UNKNOWN',
      {countKind:'NUMBER',zeroVerified:true,listKind:'ARRAY',listEmpty:true,hasMoreFalse:null},true,1],
    [{count:0,hasMore:null,list:[]},'MISSING','HAS_MORE_UNKNOWN',
      {countKind:'NUMBER',zeroVerified:true,listKind:'ARRAY',listEmpty:true,hasMoreFalse:null},true,2]
  ]){
    for(const extraCategories of [[spot,category],[category,spot]]){
      const state=await produce({extraCategories});
      const account=state.pionexAccount;
      const diagnostic=scopeSummary(state,false);
      const producer=account.wallet.botCategoryDiagnostics;
      assert.deepEqual(account.walletBotProbe.categoryDiagnostics,producer);
      for(const key of Object.keys(producer)){
        assert.deepEqual(account.walletBotRisk.scopeDiagnostics[key],producer[key]);
        assert.deepEqual(diagnostic[key],producer[key]);
      }
      assert.equal(diagnostic.scopeFailureCount,scopeFailures);
      assert.equal(diagnostic.paginationFailureCount,1);
      assert.deepEqual(diagnostic.firstPaginationFailure,categoryFailure(categoryClass,reason,shape,matches));
      const spotFirst=extraCategories[0]===spot||scopeFailures===1;
      assert.deepEqual(diagnostic.firstScopeFailure,spotFirst
        ?categoryFailure('SPOT','UNRECOGNIZED_NONEMPTY',spotShape,true)
        :categoryFailure(categoryClass,category.count===1?'UNRECOGNIZED_NONEMPTY':
          'UNRECOGNIZED_UNVERIFIED',shape,matches));
      assert.equal(account.walletBotRisk.apiRows,2,'unrecognized categories are not candidates');
      assert.deepEqual(diagnostic.typeCounts,{futures_grid:1,futures_lite:1,OTHER:0});
      rejected(chain(state),'UNSUPPORTED_SCOPE');
      rejected(chain(state),'PAGINATION_INCOMPLETE');
    }
  }
  const state=await produce({extraCategories:[spot]});
  const diagnostic=scopeSummary(state,false);
  assert.equal(diagnostic.scopeFailureCount,1);
  assert.equal(diagnostic.paginationFailureCount,0);
  assert.equal(diagnostic.firstPaginationFailure,null);
  assert.equal(state.pionexAccount.walletBotRisk.paginationComplete,true);
  const multiple=scopeSummary(await produce({extraCategories:[
    spot,{type:'ARBITRAGE',count:null},{type:'PRIVATE_CANARY_CATEGORY',count:0,list:[]}
  ]}),false);
  assert.equal(multiple.scopeFailureCount,3);
  assert.equal(multiple.paginationFailureCount,2);
  assert.equal(multiple.unrecognizedNonemptyCategoryCount,null);
  assert.equal(multiple.firstScopeFailure.categoryClass,'SPOT');
  assert.equal(multiple.firstPaginationFailure.categoryClass,'ARBITRAGE');
});

test('recognized-only pagination failures never fabricate a category scope failure',async()=>{
  for(const [options,reason,matches] of [
    [{hasMore:true},'HAS_MORE',true],
    [{hasMore:null},'HAS_MORE_UNKNOWN',true],
    [{count:3},'COUNT_LIST_MISMATCH',false],
    [{count:null},'COUNT_INVALID',null]
  ]){
    const state=await produce(options);
    const diagnostic=scopeSummary(state,false);
    assert.equal(diagnostic.scopeFailureCount,0);
    assert.equal(diagnostic.firstScopeFailure,null);
    assert.equal(diagnostic.paginationFailureCount,1);
    assert.equal(diagnostic.firstPaginationFailure.categoryClass,'TRADING_BOT');
    assert.equal(diagnostic.firstPaginationFailure.reason,reason);
    assert.equal(diagnostic.firstPaginationFailure.countMatchesList,matches);
    assert.equal(state.pionexAccount.walletBotRisk.supportedScope.exclusionsVerified,true);
    assert.deepEqual(chain(state).snapshot.overwriteRejectionReasons,['PAGINATION_INCOMPLETE']);
  }
});
