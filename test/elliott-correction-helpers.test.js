import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClosedBars,aggregateUtcDay,pivotConfirmationTime,admitObservationTime,admitTargetGeometry,accountExplicitFills} from '../docs/strategy-lab/elliott-correction-helpers.mjs';
const H4=14400000,DAY=86400000;
const bars=(n=6,step=H4)=>Array.from({length:n},(_,i)=>({openTimeMs:i*step,closeTimeMs:(i+1)*step,open:100+i,high:102+i,low:99+i,close:101+i,volume:10}));
const barInput=()=>({schemaVersion:'ELLIOTT_CLOSED_BARS_V1',timeframe:'4H',asOfMs:DAY,bars:bars()});
const geo=(side='LONG')=>({schemaVersion:'ELLIOTT_TARGET_GEOMETRY_V1',side,entryPrice:121,originalStopPrice:side==='LONG'?110:132,targets:side==='LONG'?[130,140]:[112,102]});
const book=(side='LONG')=>({schemaVersion:'ELLIOTT_EXPLICIT_FILL_ACCOUNTING_V1',quoteCurrency:'SYNTH_QUOTE',side,entryPrice:121,originalStopPrice:side==='LONG'?110:132,initialQuantity:1,entryCostQuote:0,exits:[]});
const exit=(eventId,portionPpm,fillPrice,costQuote=0)=>({eventId,portionPpm,fillPrice,costQuote});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
function flags(r){for(const k of ['executionAuthorized','empiricalRunAuthorized','historicalAvailabilityVerified','revisionHistoryVerified','receiptAuthenticated'])assert.equal(r[k],false,k);assert.equal(r.researchOnly,true);}
function rejected(fn,input){const before=structuredClone(input),r=fn(input);assert.equal(r.valid,false);assert.deepEqual(input,before);flags(r);return r;}
test('strict closed contiguous 4h and day raw bars admit no publication claim',()=>{
  for(const [timeframe,step] of [['4H',H4],['1D',DAY]]){const x={...barInput(),timeframe,asOfMs:6*step,bars:bars(6,step)},before=structuredClone(x),r=validateClosedBars(x);assert.equal(r.valid,true);assert.equal(r.publicationAdmitted,false);flags(r);assert.deepEqual(x,before);}
});
test('bar schema, type, sparse, OHLC, time, sequence and future faults reject without mutation',()=>{
  const mutations=[x=>delete x.asOfMs,x=>x.extra=true,x=>x.schemaVersion='OLD',x=>x.asOfMs='86400000',x=>x.timeframe='1H',x=>delete x.bars[1],x=>x.bars.foo=1,x=>x.bars[0].availableAtMs=0,x=>x.bars[0].high=Infinity,x=>x.bars[0].open=-1,x=>x.bars[0].open='100',x=>x.bars[0].volume=-1,x=>x.bars[0].low=110,x=>x.bars[0].high=99,x=>x.bars[0].openTimeMs=.5,x=>x.bars[0].closeTimeMs++,x=>x.bars[1]={...x.bars[0]},x=>x.bars.reverse(),x=>x.bars.splice(2,1),x=>x.asOfMs--,x=>x.bars.push({...bars(7)[6]})];
  for(const m of mutations){const x=barInput();m(x);rejected(validateClosedBars,x);}
});
test('six exact UTC 4h intervals aggregate to one copied closed daily bar',()=>{
  const x={schemaVersion:'ELLIOTT_UTC_DAY_V1',asOfMs:DAY,bars:bars()},before=structuredClone(x),r=aggregateUtcDay(x);
  assert.equal(r.valid,true);assert.deepEqual(r.bar,{openTimeMs:0,closeTimeMs:DAY,open:100,high:107,low:99,close:106,volume:60});flags(r);r.bar.open=1;assert.deepEqual(x,before);
  for(const m of [x=>x.bars.pop(),x=>x.bars[5]={...x.bars[4]},x=>{for(const b of x.bars){b.openTimeMs+=H4;b.closeTimeMs+=H4;}x.asOfMs+=H4;},x=>x.bars[0].volume=Number.MAX_VALUE,x=>x.extra=1]){
    const y=structuredClone(before);m(y);if(y.bars[0].volume===Number.MAX_VALUE)y.bars[1].volume=Number.MAX_VALUE;rejected(aggregateUtcDay,y);
  }
});
test('daily pivot confirmation uses true daily exclusive close, not four-hour offset',()=>{
  const x={schemaVersion:'ELLIOTT_PIVOT_TIME_V1',timeframe:'1D',asOfMs:5*DAY,bars:bars(5,DAY),pivotIndex:2,leftBars:2,rightBars:2};
  const r=pivotConfirmationTime(x);assert.equal(r.valid,true);assert.equal(r.geometricConfirmationAtMs,5*DAY);assert.equal(r.pricePatternValidated,false);assert.equal(r.publicationAdmitted,false);flags(r);
  const early={...x,asOfMs:4*DAY+H4};assert.equal(rejected(pivotConfirmationTime,early).error,'FUTURE_OR_INCOMPLETE_BAR');
  const four={...x,timeframe:'4H',asOfMs:5*H4,bars:bars(5,H4)};assert.equal(pivotConfirmationTime(four).geometricConfirmationAtMs,5*H4);
  // Appending still-unavailable future data at original decision must reject.
  rejected(pivotConfirmationTime,{...x,bars:bars(6,DAY)});
  // Later admission of appended data cannot change the earlier pivot geometry.
  assert.equal(pivotConfirmationTime({...x,bars:bars(6,DAY),asOfMs:6*DAY}).geometricConfirmationAtMs,r.geometricConfirmationAtMs);
  for(const m of [x=>x.leftBars=0,x=>x.rightBars=0,x=>x.pivotIndex=1,x=>x.rightBars=3,x=>x.pivotIndex='2',x=>x.extra=true]){const y=structuredClone(x);m(y);rejected(pivotConfirmationTime,y);}
});
test('actual receipt and explicit assumptions remain distinct, neither authenticated',()=>{
  const actual={schemaVersion:'ELLIOTT_OBSERVATION_ADMISSION_V1',mode:'ACTUAL_RECEIPT',geometricConfirmationAtMs:DAY,decisionAtMs:DAY+2000,receivedAtMs:DAY+2000};
  const a=admitObservationTime(actual);assert.equal(a.valid,true);assert.equal(a.eligibleUnderSuppliedReceipt,true);assert.equal(Object.hasOwn(a,'assumedPublicationAtMs'),false);flags(a);
  rejected(admitObservationTime,{...actual,decisionAtMs:DAY+1999});rejected(admitObservationTime,{...actual,receivedAtMs:DAY-1});
  const assumed={schemaVersion:'ELLIOTT_OBSERVATION_ADMISSION_V1',mode:'ASSUMED_PUBLICATION',geometricConfirmationAtMs:DAY,decisionAtMs:DAY+1000,publicationDelayMs:1000,archiveRetrievedAtMs:10*DAY,assumptionId:'SYNTH_ONLY'};
  const before=structuredClone(assumed),r=admitObservationTime(assumed);assert.equal(r.valid,true);assert.equal(r.assumedPublicationAtMs,DAY+1000);assert.equal(r.archiveRetrievedAtMs,10*DAY);assert.equal(Object.hasOwn(r,'receivedAtMs'),false);assert.deepEqual(assumed,before);flags(r);
  for(const m of [x=>x.decisionAtMs--,x=>x.mode='EVIDENCE_BACKED',x=>x.receivedAtMs=x.decisionAtMs,x=>delete x.publicationDelayMs,x=>x.publicationDelayMs=-1,x=>x.publicationDelayMs='0',x=>x.archiveRetrievedAtMs=0,x=>x.assumptionId='x\n',x=>x.historicalAvailabilityVerified=true,x=>{x.geometricConfirmationAtMs=Number.MAX_SAFE_INTEGER;x.archiveRetrievedAtMs=Number.MAX_SAFE_INTEGER;x.decisionAtMs=Number.MAX_SAFE_INTEGER;}]){const x=structuredClone(assumed);m(x);rejected(admitObservationTime,x);}
  assert.equal(admitObservationTime({...assumed,publicationDelayMs:0,decisionAtMs:DAY}).valid,true);
});
test('target admission mirrors long/short and rejects equality, behind-fill and reversed targets',()=>{
  for(const side of ['LONG','SHORT']){
    const x=geo(side),r=admitTargetGeometry(x);assert.equal(r.valid,true);assert.equal(r.originalRiskPerUnit,11);assert.equal(r.fillEstablished,false);flags(r);r.targets[0]=1;assert.notEqual(r.targets[0],x.targets[0]);
    for(const m of [x=>x.targets.reverse(),x=>x.targets[1]=x.targets[0],x=>x.targets[0]=x.entryPrice,x=>x.targets[0]=x.originalStopPrice,x=>x.targets[0]='130',x=>delete x.targets[0],x=>x.targets.foo=1,x=>x.originalStopPrice=x.entryPrice,x=>x.side='BUY',x=>x.extra=true]){const y=geo(side);m(y);rejected(admitTargetGeometry,y);}
  }
  rejected(admitTargetGeometry,{...geo(),entryPrice:136,originalStopPrice:120,targets:[126.18,130]});
});
test('signed fills preserve behind-entry losses, independently of target rejection',()=>{
  for(const side of ['LONG','SHORT']){
    const x=book(side);x.entryPrice=136;x.originalStopPrice=side==='LONG'?120:152;
    x.exits=side==='LONG'?[exit('a',500000,126.18),exit('b',500000,130)]:[exit('a',500000,145.82),exit('b',500000,142)];
    const r=accountExplicitFills(x);assert.equal(r.valid,true);near(r.grossRealizedR,-.494375);near(r.netRealizedR,-.494375);assert.equal(r.closed,true);flags(r);
  }
});
test('gap, original stop, break-even and next-open gap use signed immutable risk, mirrored',()=>{
  for(const side of ['LONG','SHORT'])for(const [prices,portions,expected] of [
    [[90],[1000000],-31/11],[[130,110],[500000,500000],-1/11],[[130,121],[500000,500000],4.5/11],[[130,120],[500000,500000],4/11]]){
    const x=book(side);x.exits=prices.map((p,i)=>exit(`e${i}`,portions[i],side==='LONG'?p:242-p));
    const r=accountExplicitFills(x);assert.equal(r.valid,true);assert.equal(r.originalRiskPerUnit,11);near(r.grossRealizedR,expected);assert.equal(r.remainingPortionPpm,0);
  }
});
test('entry cost once and executed-event whole cost normalize by initial quantity times D',()=>{
  const x=book();x.initialQuantity=2;x.entryCostQuote=1;x.exits=[exit('a',500000,130,.5),exit('b',500000,110,.5)];
  const r=accountExplicitFills(x);assert.equal(r.valid,true);assert.equal(r.initialRiskQuote,22);assert.equal(r.knownCostQuote,2);near(r.netRealizedR,-1/11-2/22);
  const b=book();b.entryCostQuote=.2;b.exits=[exit('be',1000000,121,.1)];assert.ok(accountExplicitFills(b).netRealizedR<0);
  const open=book();open.entryCostQuote=.2;const first=accountExplicitFills(open);assert.equal(first.closed,false);near(first.netRealizedR,-.2/11);assert.equal(first.grossRealizedR,0);
});
test('unknown costs preserve gross and null net; known zero is explicitly synthetic',()=>{
  const x=book();x.exits=[exit('a',500000,130)];const before=structuredClone(x),zero=accountExplicitFills(x);assert.equal(zero.costStatus,'SYNTHETIC_ZERO_COSTS');assert.equal(zero.remainingPortionPpm,500000);assert.equal(zero.closed,false);
  for(const m of [x=>x.entryCostQuote=null,x=>x.exits[0].costQuote=null]){const y=structuredClone(x);m(y);const r=accountExplicitFills(y);assert.equal(r.valid,true);assert.equal(r.costStatus,'COSTS_UNRESOLVED');assert.equal(r.netRealizedR,null);near(r.grossRealizedR,zero.grossRealizedR);}
  assert.deepEqual(x,before);
});
test('integer PPM prevents over-exit tolerance and accidental partial closure',()=>{
  const x=book();x.exits=[exit('a',333333,130),exit('b',333333,130),exit('c',333333,130)];let r=accountExplicitFills(x);assert.equal(r.valid,true);assert.equal(r.remainingPortionPpm,1);assert.equal(r.closed,false);
  x.exits.push(exit('d',1,121));r=accountExplicitFills(x);assert.equal(r.valid,true);assert.equal(r.closed,true);
  x.exits.push(exit('e',1,121));assert.equal(rejected(accountExplicitFills,x).error,'OVER_EXIT');
});
test('duplicate events, unsupported shapes, nonfinite quantities/costs and overflow fail atomically',()=>{
  const mutations=[x=>x.exits=[exit('a',500000,130),exit('a',500000,130)],x=>x.exits=[exit('a',0,130)],x=>x.exits=[exit('a',.5,130)],x=>x.exits=[exit('a',1000001,130)],x=>x.exits=[exit('a',1,0)],x=>x.exits=[exit('a',1,Infinity)],x=>x.exits=[exit('a',1,130,-1)],x=>{x.exits=[exit('a',1,130)];x.exits[0].costQuote=undefined;},x=>x.exits=[exit('a',1,130,'0')],x=>{x.exits=[exit('a',1,130)];delete x.exits[0];},x=>x.initialQuantity=0,x=>x.initialQuantity='1',x=>x.initialQuantity=Infinity,x=>x.initialQuantity=Number.MAX_VALUE,x=>x.entryCostQuote=NaN,x=>x.originalStopPrice=121,x=>x.side='short',x=>x.quoteCurrency='usd',x=>x.extra=true,x=>{x.exits=[exit('a',1,130)];x.exits[0].effectiveStopPrice=121;},x=>{x.entryCostQuote=Number.MAX_VALUE;x.exits=[exit('a',1,130,Number.MAX_VALUE)];}];
  for(const m of mutations){const x=book();m(x);rejected(accountExplicitFills,x);}
});
test('all APIs reject nonrecords and wrong schemas with authority denied',()=>{
  for(const fn of [validateClosedBars,aggregateUtcDay,pivotConfirmationTime,admitObservationTime,admitTargetGeometry,accountExplicitFills])for(const x of [null,[],true,{},'x']){const r=fn(x);assert.equal(r.valid,false);flags(r);}
});
