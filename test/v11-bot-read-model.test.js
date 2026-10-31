import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBotReadModel} from '../v11/bot-read-model.js';
const now = Date.parse('2026-10-12T20:00:00Z');
const fixture = () => ({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
  source:'PIONEX_WALLET_BOT_DETAIL',sourceSnapshotAt:'2026-10-12T19:59:00Z',
  freshnessLimitMs:900000,readOnly:true,executionImpact:false,detailsComplete:true,
  sourceStatusOk:true,fresh:true,usableForOverwrite:true,botCount:1,
  bots:[{botRef:'a'.repeat(20),symbol:'BTC',side:'SHORT',cateType:'inverse',
    botType:'futures_grid',sideSource:'economic_inverse_asset',apiKey:'SECRET'}]});
test('fresh expiry preserves the validated source limit rather than assuming fifteen minutes',()=>{
  const input=fixture();input.freshnessLimitMs=120000;
  const model=buildBotReadModel(input,{now});
  assert.equal(model.status,'FRESH_SNAPSHOT');assert.equal(model.expiresAt,Date.parse(input.sourceSnapshotAt)+120000);
  assert.equal(buildBotReadModel(input,{now:model.expiresAt+1}).status,'STALE');
});
test('fresh projection preserves explicit inverse side and drops arbitrary fields',()=>{
  const input=fixture(),before=structuredClone(input),out=buildBotReadModel(input,{now});
  assert.equal(out.status,'FRESH_SNAPSHOT');assert.equal(out.ageMs,60000);
  assert.equal(out.bots[0].side,'SHORT');assert.equal(out.bots[0].category,'inverse');
  assert.equal(out.executionAllowed,false);assert.equal(out.readOnly,true);
  assert.doesNotMatch(JSON.stringify(out),/SECRET|apiKey/);assert.deepEqual(input,before);
});
test('freshness is recomputed and stale rows are withheld despite asserted flags',()=>{
  const input=fixture();input.sourceAgeMs=0;
  const out=buildBotReadModel(input,{now:now+900000});
  assert.equal(out.status,'STALE');assert.deepEqual(out.bots,[]);
  input.sourceSnapshotAt='2026-10-12T20:01:00Z';
  assert.equal(buildBotReadModel(input,{now}).status,'UNKNOWN');
});
test('invalid envelope, bounds, completeness and duplicates fail closed',()=>{
  for(const [key,value] of [['schemaVersion','bad'],['source','SECRET'],['readOnly',false],
    ['executionImpact',true],['detailsComplete',false],['sourceStatusOk',false],['fresh',false],
    ['usableForOverwrite',false],['freshnessLimitMs',Infinity],['freshnessLimitMs',900001],
    ['freshnessLimitMs',0],['sourceSnapshotAt',null],['botCount',2],['bots',null]]){
    const input=fixture();input[key]=value;
    assert.equal(buildBotReadModel(input,{now}).status,'UNKNOWN',key);
  }
  const input=fixture();input.bots.push({...input.bots[0]});input.botCount=2;
  assert.equal(buildBotReadModel(input,{now}).status,'UNKNOWN');
  input.bots=Array(101).fill(input.bots[0]);input.botCount=101;
  assert.equal(buildBotReadModel(input,{now}).status,'UNKNOWN');
});
test('unsupported provenance remains unknown and cannot infer type from symbol',()=>{
  const input=fixture();Object.assign(input.bots[0],{side:'SECRET',cateType:null,botType:'SECRET',sideSource:{}});
  const out=buildBotReadModel(input,{now});
  assert.equal(out.status,'FRESH_SNAPSHOT');
  for(const key of ['side','category','type','sideSource'])assert.equal(out.bots[0][key],null);
  assert.doesNotMatch(JSON.stringify(out),/SECRET/);
});
test('documented Futures Moon category is distinct from Futures Grid type and neutral direction',()=>{
  const input=fixture();input.bots[0].cateType='FUTURES_MOON';input.bots[0].side='NEUTRAL';
  input.coverage={status:'DOCUMENTED',providerContractStatus:'DOCUMENTED',
    liveAccountVerification:'NOT_PERFORMED',listRows:1,recognizedRows:1,representedRows:1,
    unsupportedRows:0,unhydratedRows:0,paginationComplete:true,pages:1,pageLimit:20};
  const model=buildBotReadModel(input,{now});
  assert.equal(model.status,'FRESH_SNAPSHOT');
  assert.equal(model.bots[0].type,'futures_grid');
  assert.equal(model.bots[0].productCategory,'FUTURES_MOON');
  assert.equal(model.bots[0].category,null);
  assert.equal(model.bots[0].side,'NEUTRAL');
  assert.deepEqual(model.coverage,{status:'DOCUMENTED',providerContractStatus:'DOCUMENTED',
    liveAccountVerification:'NOT_PERFORMED',listRows:1,recognizedRows:1,representedRows:1,
    unsupportedRows:0,unhydratedRows:0,paginationComplete:true,pages:1,pageLimit:20});
});
test('malformed identities and symbols fail closed without partial rows',()=>{
  for(const [key,value] of [['botRef','SECRET'],['symbol','<script>'],['symbol','A'.repeat(33)]]){
    const input=fixture();input.bots[0][key]=value;
    const out=buildBotReadModel(input,{now});assert.equal(out.status,'UNKNOWN');assert.deepEqual(out.bots,[]);
  }
});
test('calendar normalization cannot make an invalid timestamp fresh',()=>{
  for(const [stamp,clock] of [['2026-02-30T19:59:00Z','2026-03-02T20:00:00Z'],
    ['2026-04-31T19:59:00.000Z','2026-05-01T20:00:00Z'],
    ['2026-10-11T24:00:00Z','2026-10-12T00:01:00Z']]){
    const input=fixture();input.sourceSnapshotAt=stamp;
    assert.equal(buildBotReadModel(input,{now:Date.parse(clock)}).status,'UNKNOWN');
  }
  const input=fixture();input.sourceSnapshotAt='2028-02-29T19:59:00.123Z';
  assert.equal(buildBotReadModel(input,{now:Date.parse('2028-02-29T20:00:00Z')}).status,'FRESH_SNAPSHOT');
});

test('source metric projection preserves nonzero finite numeric values without coercion or derived risk',()=>{
  const input=fixture();Object.assign(input.bots[0],{leverage:5,investment:{usd:120},pnl:{usd:-2.5},
    limits:{lower:0.000001,upper:100,liquidationPrice:90,takeProfit:110,stopLoss:95},grid:{profitUsd:999},riskBufferPct:99});
  assert.deepEqual(buildBotReadModel(input,{now}).bots[0].metrics,{leverage:5,investmentUsd:120,investmentAmount:null,investmentCurrency:null,pnlUsd:-2.5,pnlUnavailableReason:null,
    lower:0.000001,upper:100,liquidationPrice:90,liquidationLowerBound:null,liquidationUpperBound:null,
    takeProfit:110,stopLoss:95,gridProfitUsd:null,riskBufferPct:null});
});
test('missing, coerced zero, invalid and negative positive-only metrics remain unavailable',()=>{
  for(const value of [undefined,null,'',0,-0,'12',true,Infinity,NaN,{},[]]) {
    const input=fixture();Object.assign(input.bots[0],{leverage:value,investment:{usd:value},pnl:{usd:value},
      limits:{lower:value,upper:value,liquidationPrice:value,takeProfit:value,stopLoss:value}});
    const {pnlUnavailableReason,...numericMetrics}=buildBotReadModel(input,{now}).bots[0].metrics;
    assert.equal(pnlUnavailableReason,'USD_VALUE_MISSING');
    assert.ok(Object.values(numericMetrics).every(item=>item===null));
  }
  const input=fixture();Object.assign(input.bots[0],{leverage:-2,investment:{usd:-2},limits:{lower:-2}});
  assert.equal(buildBotReadModel(input,{now}).bots[0].metrics.leverage,null);
  assert.equal(buildBotReadModel(input,{now}).bots[0].metrics.investmentUsd,null);
  assert.equal(buildBotReadModel(input,{now}).bots[0].metrics.lower,null);
});

test('TP comparison is exact, uses the upper grid boundary for short bots, and fails closed on unknown evidence',()=>{
  const withLimits=(takeProfit,upper,evidence='PRICE_SET')=>{const input=fixture();input.bots[0].side='SHORT';
    input.bots[0].limits={takeProfit,upper,takeProfitEvidence:evidence};
    return buildBotReadModel(input,{now}).bots[0].takeProfitCheck;};
  assert.deepEqual(withLimits(1e2,100),{set:true,matchesUpper:true,reason:null});
  assert.deepEqual(withLimits(90,100),{set:true,matchesUpper:false,reason:null},
    'short bots are still compared to the actual upper grid boundary');
  for(const absentOrInvalid of [undefined,null,0,-1,'100',NaN,Infinity,{}]){
    const check=withLimits(absentOrInvalid,100,'UNKNOWN');
    assert.equal(check.set,null);assert.equal(check.matchesUpper,null);
    assert.match(check.reason,/belegen kein ungesetztes TP/);
  }
  assert.equal(withLimits(100,undefined).matchesUpper,null);
  assert.match(withLimits(100,undefined).reason,/obere Range fehlt/);
  assert.equal(withLimits(100,100,'CONFIRMED_UNSET').set,null,
    'the bridge/model reject unsupported absence claims without a source contract');
});

test('TP comparison normalizes decimal notation without display rounding or tolerance',()=>{
  const withLimits=(takeProfit,upper)=>{const input=fixture();
    input.bots[0].limits={takeProfit,upper,takeProfitEvidence:'PRICE_SET'};
    return buildBotReadModel(input,{now}).bots[0].takeProfitCheck;};
  assert.equal(withLimits(1e-7,0.0000001).matchesUpper,true);
  assert.equal(withLimits(0.1+0.2,0.3).matchesUpper,false);
});

test('neutral liquidation bounds and unverified provider coverage remain independent and explicit',()=>{
  const input=fixture();
  input.coverage={status:'PARTIAL',providerContractStatus:'DOCUMENTED',
    liveAccountVerification:'NOT_PERFORMED',listRows:3,
    recognizedRows:2,representedRows:1,unsupportedRows:1,unhydratedRows:1};
  input.bots[0].side='NEUTRAL';
  input.bots[0].limits={liquidationLowerBound:50000,liquidationUpperBound:null};
  const model=buildBotReadModel(input,{now});
  assert.equal(model.status,'FRESH_SNAPSHOT');
  assert.equal(model.bots[0].side,'NEUTRAL');
  assert.equal(model.bots[0].metrics.liquidationLowerBound,50000);
  assert.equal(model.bots[0].metrics.liquidationUpperBound,null);
  assert.deepEqual(model.coverage,{status:'PARTIAL',providerContractStatus:'DOCUMENTED',
    liveAccountVerification:'NOT_PERFORMED',listRows:3,recognizedRows:2,representedRows:1,
    unsupportedRows:1,unhydratedRows:1,paginationComplete:null,pages:null,pageLimit:null});
  const unknown=buildBotReadModel(fixture(),{now});
  assert.equal(unknown.coverage.status,'UNKNOWN','legacy snapshots cannot assert full provider coverage');
});

test('capital fallback preserves only an explicit bounded source currency and positive amount',()=>{
  const input=fixture();input.bots[0].investment={usd:null,quoteAmount:0.25,currency:'BTC'};
  const metrics=buildBotReadModel(input,{now}).bots[0].metrics;
  assert.equal(metrics.investmentUsd,null);assert.equal(metrics.investmentAmount,0.25);assert.equal(metrics.investmentCurrency,'BTC');
  input.bots[0].investment.currency='<script>';
  assert.equal(buildBotReadModel(input,{now}).bots[0].metrics.investmentCurrency,null);
});

const scopedFixture=()=>({...fixture(),usableForDisplay:true,overwriteScope:'WALLET_FUTURES_GRID',
  excludedScope:'KNOWN_EXCLUDED_PRODUCTS',overwriteRejectionReasons:[],
  coverage:{status:'PARTIAL',listRows:2,recognizedRows:1,representedRows:1,
    unsupportedRows:1,unhydratedRows:0,paginationComplete:true}});
test('wallet scope evidence is projected independently of unchanged global partial coverage',()=>{
  const input=scopedFixture(),before=structuredClone(input),model=buildBotReadModel(input,{now});
  assert.equal(model.status,'FRESH_SNAPSHOT');assert.equal(model.coverage.status,'PARTIAL');
  assert.equal(model.overwriteScope,'WALLET_FUTURES_GRID');
  assert.equal(model.excludedScope,'KNOWN_EXCLUDED_PRODUCTS');
  assert.equal(model.usableForOverwrite,true);assert.deepEqual(model.overwriteRejectionReasons,[]);
  assert.notEqual(model.overwriteRejectionReasons,input.overwriteRejectionReasons);
  assert.deepEqual(input,before);assert.equal(model.executionAllowed,false);
});
test('rejection evidence is bounded and validated atomically, never filtered into an empty array',()=>{
  for(const reasons of [undefined,null,'',{},['PRIVATE<script>'],[null],[{}],[false],
    [undefined],Array(1),['SOURCE_STALE','PRIVATE'],Array(11).fill('SOURCE_STALE')]){
    const input=scopedFixture();input.overwriteRejectionReasons=reasons;
    const model=buildBotReadModel(input,{now});
    assert.equal(model.status,'FRESH_SNAPSHOT');
    assert.equal(model.overwriteRejectionReasons,null);
    assert.doesNotMatch(JSON.stringify(model),/PRIVATE|script/);
  }
  const reasons=['UNSUPPORTED_SCOPE','SUPPORTED_HYDRATION_MISSING','SANITIZATION_LOSS_OR_DUPLICATE',
    'PAGINATION_INCOMPLETE','EXPLICIT_PARTIAL','SYNC_PARTIAL','DETAILS_INCOMPLETE',
    'SOURCE_STATUS_NOT_OK','SOURCE_STALE','SOURCE_UNAVAILABLE'];
  const input=scopedFixture();input.overwriteRejectionReasons=reasons;
  assert.deepEqual(buildBotReadModel(input,{now}).overwriteRejectionReasons,reasons);
});
test('scope fields allow only exact enums and booleans while legacy display remains compatible',()=>{
  for(const value of [undefined,null,{},[],true,'PRIVATE<script>','constructor',' WALLET_FUTURES_GRID ']){
    const input=scopedFixture();input.overwriteScope=value;input.excludedScope=value;
    input.usableForOverwrite=value;
    const model=buildBotReadModel(input,{now});
    assert.equal(model.status,'FRESH_SNAPSHOT');
    assert.equal(model.overwriteScope,null);assert.equal(model.excludedScope,null);
    assert.equal(model.usableForOverwrite,value===true?true:null);
    assert.doesNotMatch(JSON.stringify(model),/PRIVATE|script|constructor/);
  }
  const input=scopedFixture();input.usableForOverwrite=false;
  assert.equal(buildBotReadModel(input,{now}).usableForOverwrite,false);
  const legacy=buildBotReadModel(fixture(),{now});
  assert.equal(legacy.status,'FRESH_SNAPSHOT');assert.equal(legacy.overwriteScope,null);
  assert.equal(legacy.excludedScope,null);assert.equal(legacy.overwriteRejectionReasons,null);
});
test('invalid and stale snapshots withhold scope evidence along with rows',()=>{
  for(const mutate of [input=>input.schemaVersion='bad',input=>input.botCount=2,
    input=>input.bots[0].symbol='<script>',input=>input.sourceSnapshotAt='2026-10-12T19:00:00Z']){
    const input=scopedFixture();mutate(input);
    const model=buildBotReadModel(input,{now});
    assert.notEqual(model.status,'FRESH_SNAPSHOT');assert.deepEqual(model.bots,[]);
    for(const key of ['overwriteScope','excludedScope','usableForOverwrite','overwriteRejectionReasons'])
      assert.equal(model[key],null,key);
  }
});
