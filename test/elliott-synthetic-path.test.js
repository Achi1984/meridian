import test from 'node:test';
import assert from 'node:assert/strict';
import {replayAlreadyOpenSyntheticPath as replay} from '../docs/strategy-lab/elliott-synthetic-path.mjs';
const FLAGS={researchOnly:true,executionAuthorized:false,empiricalRunAuthorized:false,historicalAvailabilityVerified:false,revisionHistoryVerified:false,receiptAuthenticated:false};
const SCHEMA='ELLIOTT_ALREADY_OPEN_PATH_DRAFT_V1';
function fixture(rows=[[125,129,120,128]],side='LONG',timeframe='4H'){
 const step=timeframe==='4H'?14400000:86400000,m=x=>side==='LONG'?x:242-x;
 return {schemaVersion:SCHEMA,fixtureId:'synthetic',timeframe,asOfMs:(rows.length+1)*step,mode:'NEXT_BAR_BREAK_EVEN',
 initialPosition:{side,entryAtMs:1,entryPrice:121,originalStopPrice:m(110),initialQuantity:2,targets:[m(130),m(140)]},
 quoteCurrency:'SYNTH_QUOTE',stopSlippagePrice:0,costs:{entryCostQuote:0,target1CostQuote:0,target2CostQuote:0,fullStopCostQuote:0,residualStopCostQuote:0},
 bars:rows.map(([o,h,l,c],i)=>({openTimeMs:(i+1)*step,closeTimeMs:(i+2)*step,open:m(o),high:m(side==='LONG'?h:l),low:m(side==='LONG'?l:h),close:m(c),volume:1}))};
}
const E=[125,131,120,128];
// Hand-derived exits: kind, index, phase, LONG fill, initial PPM, ambiguity.
const vectors=[
 {rows:[[90,95,89,92]],events:[['STOP',0,'OPEN',90,1000000]],r:-31/11},
 {rows:[[90,95,89,92]],slip:1,events:[['STOP',0,'OPEN',89,1000000]],r:-32/11},
 {rows:[[125,141,109,125]],events:[['STOP',0,'RANGE_PROXY',110,1000000,'AMBIGUOUS_STOP_FIRST']],r:-1},
 {rows:[[135,139,109,125]],events:[['TP1',0,'OPEN',130,500000],['STOP',0,'RANGE_PROXY',110,500000]],r:-1/11},
 {rows:[[145,146,109,125]],events:[['TP1',0,'OPEN',130,500000],['TP2',0,'OPEN',140,500000]],r:14/11},
 {rows:[E],events:[['TP1',0,'RANGE_PROXY',130,500000]],r:4.5/11,pending:true},
 {rows:[E,[120,125,119,122]],events:[['TP1',0,'RANGE_PROXY',130,500000],['STOP',1,'OPEN',120,500000]],r:4/11,be:true},
 {rows:[E,[120,125,119,122]],slip:1,events:[['TP1',0,'RANGE_PROXY',130,500000],['STOP',1,'OPEN',119,500000]],r:3.5/11,be:true},
 {rows:[E,[125,129,121,122]],events:[['TP1',0,'RANGE_PROXY',130,500000],['STOP',1,'RANGE_PROXY',121,500000]],r:4.5/11,be:true},
 {rows:[E,[115,120,109,112]],mode:'NO_RELOCATION',events:[['TP1',0,'RANGE_PROXY',130,500000],['STOP',1,'RANGE_PROXY',110,500000]],r:-1/11},
 {rows:[[125,129,120,128]],events:[],r:0},
 {rows:[[125,141,120,135]],events:[['TP1',0,'RANGE_PROXY',130,500000],['TP2',0,'RANGE_PROXY',140,500000]],r:14/11},
 {rows:[[135,141,109,125]],events:[['TP1',0,'OPEN',130,500000],['STOP',0,'RANGE_PROXY',110,500000,'AMBIGUOUS_STOP_FIRST']],r:-1/11},
 {rows:[[135,139,120,125]],events:[['TP1',0,'OPEN',130,500000]],r:4.5/11,pending:true},
 {rows:[[135,139,120,125],[120,125,119,122]],events:[['TP1',0,'OPEN',130,500000],['STOP',1,'OPEN',120,500000]],r:4/11,be:true},
 {rows:[E,[135,141,125,140]],events:[['TP1',0,'RANGE_PROXY',130,500000],['TP2',1,'RANGE_PROXY',140,500000]],r:14/11,be:true},
 {rows:[E,[125,129,122,128]],events:[['TP1',0,'RANGE_PROXY',130,500000]],r:4.5/11,be:true},
 {rows:[E,[125,129,122,128],[121,125,120,123]],events:[['TP1',0,'RANGE_PROXY',130,500000],['STOP',2,'OPEN',121,500000]],r:4.5/11,be:true},
 {rows:[[125,126,109,120]],slip:2,events:[['STOP',0,'RANGE_PROXY',108,1000000]],r:-13/11}
];
for(const side of ['LONG','SHORT'])for(const tf of ['4H','1D'])test(`full hand-vector outputs ${side} ${tf}`,()=>{
 for(const v of vectors){
  const x=fixture(v.rows,side,tf),m=n=>side==='LONG'?n:242-n;
  x.stopSlippagePrice=v.slip??0;x.mode=v.mode??x.mode;
  const before=structuredClone(x),actual=replay(x);
  const events=v.events.map(([kind,i,phase,fill,portion,ambiguity='NONE'])=>({eventId:`synthetic.${i}.${kind}`,kind,barIndex:i,
   barOpenTimeMs:x.bars[i].openTimeMs,barCloseTimeMs:x.bars[i].closeTimeMs,phase,modeledFillTimeMs:phase==='OPEN'?x.bars[i].openTimeMs:null,
   portionPpm:portion,fillPrice:m(fill),costQuote:0,ambiguity}));
  const exited=events.reduce((n,e)=>n+e.portionPpm,0),closed=exited===1000000;
  const expected={valid:true,schemaVersion:SCHEMA,fixtureId:'synthetic',mode:x.mode,
   finalState:{originalRiskDistance:11,effectiveStopPrice:v.be?121:m(110),remainingPortionPpm:1000000-exited,
    target1Filled:events.some(e=>e.kind==='TP1'),target2Filled:events.some(e=>e.kind==='TP2'),pendingBreakEvenAtMs:v.pending?x.bars.at(-1).closeTimeMs:null,closed},events,
   accounting:{grossRealizedR:v.r,netRealizedR:v.r,knownCostQuote:0,costStatus:'SYNTHETIC_ZERO_COSTS',exitedPortionPpm:exited,remainingPortionPpm:1000000-exited,closed},...FLAGS};
  assert.equal(actual.valid,true);assert.ok(Math.abs(actual.accounting.grossRealizedR-v.r)<1e-12);assert.ok(Math.abs(actual.accounting.netRealizedR-v.r)<1e-12);
  actual.accounting.grossRealizedR=v.r;actual.accounting.netRealizedR=v.r;assert.deepEqual(actual,expected);assert.deepEqual(x,before);
  const repeat=replay(x);actual.events.push({fake:true});actual.finalState.remainingPortionPpm=7;assert.deepEqual(replay(x),repeat);
 }
});
function rejected(x,error){const before=structuredClone(x);assert.deepEqual(replay(x),{valid:false,error,...FLAGS});assert.deepEqual(x,before);}
test('used costs only, quote totals, unknown net, full entry charge for open position',()=>{
 for(const side of ['LONG','SHORT']){
  const x=fixture([E,[120,125,119,122]],side);x.costs={entryCostQuote:1,target1CostQuote:.5,target2CostQuote:null,fullStopCostQuote:null,residualStopCostQuote:.5};
  let r=replay(x);assert.ok(Math.abs(r.accounting.netRealizedR-3/11)<1e-12);assert.equal(r.accounting.knownCostQuote,2);assert.equal(r.accounting.costStatus,'EXPLICIT_QUOTE_COSTS');assert.equal(r.events[1].costQuote,.5);
  x.costs.residualStopCostQuote=null;r=replay(x);assert.equal(r.accounting.netRealizedR,null);assert.equal(r.accounting.knownCostQuote,1.5);assert.equal(r.accounting.costStatus,'COSTS_UNRESOLVED');assert.ok(Math.abs(r.accounting.grossRealizedR-4/11)<1e-12);
 }
 const x=fixture();x.costs.entryCostQuote=1;assert.equal(replay(x).accounting.netRealizedR,-1/22);assert.equal(replay(x).accounting.closed,false);
 x.costs.entryCostQuote=null;assert.equal(replay(x).accounting.netRealizedR,null);
});
test('exact malformed input errors with immutable rejection',()=>{
 const cases=[
 [x=>{x.extra=1},'INPUT_SCHEMA'],[x=>{delete x.mode},'INPUT_SCHEMA'],[x=>{x.schemaVersion='wrong'},'INPUT_SCHEMA'],[x=>{x.fixtureId='bad\n'},'INPUT_SCHEMA'],
 [x=>{x.initialPosition.extra=1},'INPUT_SCHEMA'],[x=>{delete x.costs.entryCostQuote},'INPUT_SCHEMA'],[x=>{x.mode='ACTUAL'},'UNSUPPORTED_MODE'],[x=>{x.quoteCurrency='usd'},'QUOTE_CURRENCY'],
 [x=>{x.timeframe='1H'},'TIME_CONTRACT'],[x=>{x.asOfMs=Infinity},'TIME_CONTRACT'],[x=>{x.bars=[]},'BARS_LENGTH'],[x=>{x.bars=new Array(1)},'BARS_LENGTH'],[x=>{x.bars.foo=1},'BARS_LENGTH'],
 [x=>{x.bars[0].extra=1},'BAR_SCHEMA'],[x=>{x.bars[0].openTimeMs++},'BAR_TIME'],[x=>{x.bars[0].closeTimeMs=Number.MAX_SAFE_INTEGER+1},'BAR_TIME'],[x=>{x.asOfMs--},'FUTURE_OR_INCOMPLETE_BAR'],
 [x=>{x.bars[0].high=NaN},'OHLCV'],[x=>{x.bars[0].volume=-1},'OHLCV'],[x=>{x.bars[0].low=126},'OHLCV'],
 [x=>{x.initialPosition.entryAtMs=x.bars[0].openTimeMs},'INITIAL_POSITION_TIME'],[x=>{x.initialPosition.entryAtMs='1'},'INITIAL_POSITION_TIME'],[x=>{x.initialPosition.side='BUY'},'INVALID_INITIAL_RISK'],
 [x=>{x.initialPosition.originalStopPrice=121},'INVALID_INITIAL_RISK'],[x=>{x.initialPosition.initialQuantity=0},'INVALID_INITIAL_RISK'],
 [x=>{x.initialPosition.targets=[140,130]},'INVALID_TARGET_GEOMETRY'],[x=>{x.initialPosition.targets=[121,140]},'INVALID_TARGET_GEOMETRY'],[x=>{x.initialPosition.targets=[130]},'INVALID_TARGET_GEOMETRY'],[x=>{x.initialPosition.targets=new Array(2)},'INVALID_TARGET_GEOMETRY'],
 [x=>{x.stopSlippagePrice=-1},'INVALID_SLIPPAGE'],[x=>{x.stopSlippagePrice='0'},'INVALID_SLIPPAGE'],[x=>{x.costs.target2CostQuote='0'},'INVALID_COST'],[x=>{x.costs.fullStopCostQuote=-1},'INVALID_COST'],
 [x=>{x.initialPosition.initialQuantity=Number.MAX_VALUE},'NUMERIC_RANGE']];
 for(const [mutate,error] of cases){const x=fixture();mutate(x);rejected(x,error);}
});
test('256 cap, rejected tail after closure, sequence before OHLC',()=>{
 for(const side of ['LONG','SHORT'])for(const tf of ['4H','1D']){
  const rows=Array.from({length:256},()=>[125,129,120,128]);assert.equal(replay(fixture(rows,side,tf)).valid,true);rejected(fixture([...rows,rows[0]],side,tf),'BARS_LENGTH');
  const x=fixture([[145,146,109,125],[125,129,120,128]],side,tf);assert.equal(replay(x).events.length,2);x.asOfMs--;rejected(x,'FUTURE_OR_INCOMPLETE_BAR');
  const step=tf==='4H'?14400000:86400000;x.asOfMs+=1+step;x.bars[1].openTimeMs+=step;x.bars[1].closeTimeMs+=step;x.bars[1].high=NaN;rejected(x,'BAR_SEQUENCE');
 }
});
test('atomic fill rejection, numeric underflow/overflow and cost-first normalization',()=>{
 for(const rows of [[[125,126,109,120]],[[135,139,109,125]]]){const x=fixture(rows);x.stopSlippagePrice=110;rejected(x,'FILL_PRICE');}
 const x=fixture();Object.assign(x.initialPosition,{entryPrice:.5,originalStopPrice:.25,targets:[.75,1],initialQuantity:Number.MIN_VALUE});rejected(x,'NUMERIC_RANGE');x.costs.entryCostQuote=-1;rejected(x,'INVALID_COST');
 const y=fixture([[1,2,1,1]]);Object.assign(y.initialPosition,{entryPrice:2*Number.MIN_VALUE,originalStopPrice:Number.MIN_VALUE,targets:[1,2],initialQuantity:1});rejected(y,'NUMERIC_RANGE');
 const z=fixture(undefined,'SHORT');Object.assign(z.bars[0],{open:Number.MAX_VALUE,high:Number.MAX_VALUE,low:Number.MAX_VALUE,close:Number.MAX_VALUE});z.stopSlippagePrice=Number.MAX_VALUE;rejected(z,'FILL_PRICE');
});
test('pending end not activated by later horizon; equality stop at opening',()=>{
 const x=fixture([E]);x.asOfMs+=86400000;assert.equal(replay(x).finalState.pendingBreakEvenAtMs,x.bars[0].closeTimeMs);
 for(const side of ['LONG','SHORT']){const r=replay(fixture([[110,115,109,112]],side));assert.equal(r.events[0].phase,'OPEN');assert.equal(r.accounting.grossRealizedR,-1);}
});

test('native SHORT price geometry and range-stop slippage outside observed OHLC',()=>{
 for(const timeframe of ['4H','1D']){
  // Independent native SHORT: D=20; half at180 then half at160 gives 1.5R.
  const x=fixture([[175,190,170,185],[165,175,155,160]],'LONG',timeframe);
  Object.assign(x.initialPosition,{side:'SHORT',entryPrice:200,originalStopPrice:220,targets:[180,160]});
  const before=structuredClone(x),r=replay(x);
  assert.equal(r.valid,true);assert.deepEqual(x,before);
  assert.deepEqual(r.events.map(e=>[e.kind,e.phase,e.fillPrice,e.portionPpm]),
   [['TP1','OPEN',180,500000],['TP2','RANGE_PROXY',160,500000]]);
  assert.deepEqual(r.finalState,{originalRiskDistance:20,effectiveStopPrice:200,remainingPortionPpm:0,
   target1Filled:true,target2Filled:true,pendingBreakEvenAtMs:null,closed:true});
  assert.equal(r.accounting.grossRealizedR,1.5);assert.equal(r.accounting.netRealizedR,1.5);
  for(const side of ['LONG','SHORT']){
   const gap=fixture([[125,126,109,120]],side,timeframe);gap.stopSlippagePrice=2;
   const out=replay(gap),event=out.events[0];assert.equal(event.phase,'RANGE_PROXY');
   assert.equal(event.modeledFillTimeMs,null);assert.equal(event.ambiguity,'NONE');
   assert.equal(event.fillPrice,side==='LONG'?108:134);
   assert.ok(side==='LONG'?event.fillPrice<gap.bars[0].low:event.fillPrice>gap.bars[0].high);
   assert.ok(Math.abs(out.accounting.grossRealizedR-(-13/11))<1e-12);
  }
 }
});
