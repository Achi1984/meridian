import test from 'node:test';
import assert from 'node:assert/strict';
import {bindSinglePivotAdmission as bind} from '../docs/strategy-lab/elliott-pivot-admission.mjs';
const VERSION = 'ELLIOTT_SINGLE_PIVOT_ADMISSION_DRAFT_V1';
const FLAGS = {researchOnly:true,executionAuthorized:false,empiricalRunAuthorized:false,
 historicalAvailabilityVerified:false,revisionHistoryVerified:false,receiptAuthenticated:false,
 dataSourceAuthenticated:false,tradingSignal:false,entryFillEstablished:false};
function fixture(timeframe='4H',kind='HIGH',width=1) {
 const T=timeframe==='4H'?14400000:86400000;
 const rows=[...Array.from({length:width},()=>[8,10,7,9]),[10,12,8,11],
  ...Array.from({length:width},()=>[10,11,9,10])];
 const bars=rows.map(([o,h,l,c],i)=>({openTimeMs:i*T,closeTimeMs:(i+1)*T,
  open:kind==='HIGH'?o:20-o,high:kind==='HIGH'?h:20-l,
  low:kind==='HIGH'?l:20-h,close:kind==='HIGH'?c:20-c,volume:1}));
 return {schemaVersion:VERSION,assetId:'SYNTH_ASSET',timeframe,decisionMs:bars.length*T,
  leftBars:width,rightBars:width,bars,admission:{mode:'ACTUAL_RECEIPT',receipts:bars.map((b,i)=>
   ({barIndex:i,openTimeMs:b.openTimeMs,receivedAtMs:b.closeTimeMs}))}};
}
function assumed(x,delay=5) {
 const T=x.timeframe==='4H'?14400000:86400000;
 x.decisionMs+=delay;
 x.admission={mode:'ASSUMED_PUBLICATION',assumptionId:'synthetic-delay',publicationDelayMs:delay,
  archiveReceipts:x.bars.map((b,i)=>({barIndex:i,openTimeMs:b.openTimeMs,archiveRetrievedAtMs:4*T}))};
 return x;
}
function rejected(x,error) {
 const before=structuredClone(x);
 assert.deepEqual(bind(x),{valid:false,error,...FLAGS});assert.deepEqual(x,before);
}
for(const tf of ['4H','1D'])for(const kind of ['HIGH','LOW'])test(`complete output ${kind} ${tf}: actual and assumed`,()=>{
 const T=tf==='4H'?14400000:86400000;
 for(const mode of ['ACTUAL_RECEIPT','ASSUMED_PUBLICATION']) {
  const x=fixture(tf,kind);if(mode==='ASSUMED_PUBLICATION')assumed(x);
  const before=structuredClone(x),r=bind(x),delay=mode==='ACTUAL_RECEIPT'?0:5;
  const admission=structuredClone(x.admission);
  if(delay)admission.assumedPublications=x.bars.map((b,i)=>({barIndex:i,openTimeMs:b.openTimeMs,assumedPublicationAtMs:b.closeTimeMs+delay}));
  assert.deepEqual(r,{valid:true,schemaVersion:VERSION,assetId:'SYNTH_ASSET',timeframe:tf,mode,
   pivot:{kind,price:kind==='HIGH'?12:8,barIndex:1,openTimeMs:T,closeTimeMs:2*T},
   geometricConfirmationAtMs:3*T,admittedAtMs:3*T+delay,decisionMs:3*T+delay,earliestHypotheticalEntryOpenMs:4*T,
   evidence:{assetId:'SYNTH_ASSET',timeframe:tf,leftBars:1,rightBars:1,bars:before.bars,admission},...FLAGS});
  assert.deepEqual(x,before);const repeat=bind(x);
  r.evidence.bars[0].high=999;r.pivot.price=999;
  if(delay){r.evidence.admission.archiveReceipts[0].archiveRetrievedAtMs=0;r.evidence.admission.assumedPublications[0].assumedPublicationAtMs=0;}
  else r.evidence.admission.receipts[0].receivedAtMs=0;
  assert.deepEqual(x,before);assert.deepEqual(bind(x),repeat);
 }
});
test('actual maximum includes late left receipt; timing precedes nonpivot/ambiguity diagnostics',()=>{
 for(const tf of ['4H','1D']) {
  const x=fixture(tf),g=x.decisionMs;x.admission.receipts[0].receivedAtMs=g+5;x.decisionMs+=5;
  assert.equal(bind(x).admittedAtMs,g+5);assert.equal(bind(x).geometricConfirmationAtMs,g);
  x.decisionMs=g;rejected(x,'NOT_YET_RECEIVED');
  x.bars[0].high=12;rejected(x,'NOT_YET_RECEIVED');
  x.bars[0].high=10;x.bars[1].low=6;rejected(x,'NOT_YET_RECEIVED');
  x.admission.receipts[0].receivedAtMs=g;x.admission.receipts[2].receivedAtMs=g+1;
  rejected(x,'NOT_YET_RECEIVED'); // Even the final receipt precedes a both-extremes verdict.
 }
});
test('legacy asymmetric high/low ties and both/neither outcomes after admission',()=>{
 for(const tf of ['4H','1D'])for(const kind of ['HIGH','LOW']) {
  const key=kind==='HIGH'?'high':'low';
  const left=fixture(tf,kind);left.bars[0][key]=left.bars[1][key];rejected(left,'NOT_A_PIVOT');
  const right=fixture(tf,kind);right.bars[2][key]=right.bars[1][key];assert.equal(bind(right).pivot.kind,kind);
 }
 const both=fixture();both.bars[1].low=6;rejected(both,'AMBIGUOUS_PIVOT');
 const changed=fixture();changed.bars[1].high=11;changed.bars[0].high=11;rejected(changed,'NOT_A_PIVOT');
});
test('full metadata binding precedes receipt scalars; wrong index/open/order reject',()=>{
 for(const make of [()=>fixture(),()=>assumed(fixture())]) {
  for(const change of [a=>{a[0].barIndex=1},a=>{a[0].openTimeMs++},a=>{[a[0],a[1]]=[a[1],a[0]]},a=>{a.pop()},a=>{a[2].extra=true}]) {
   const x=make(),a=x.admission.receipts??x.admission.archiveReceipts;change(a);rejected(x,'RECEIPT_BINDING');
  }
 }
 const x=fixture();x.admission.receipts[0].receivedAtMs=0;x.admission.receipts[2].openTimeMs=0;
 rejected(x,'RECEIPT_BINDING');
});
test('receipt and assumption scalar failures; late archives preserved without backdating',()=>{
 const x=fixture();x.admission.receipts[0].receivedAtMs=x.bars[0].closeTimeMs-1;rejected(x,'RECEIPT_TIME');
 const y=assumed(fixture());y.decisionMs-=5;rejected(y,'NOT_YET_ASSUMED_PUBLISHED');
 y.decisionMs+=5;y.admission.archiveReceipts[0].archiveRetrievedAtMs=0;rejected(y,'ASSUMPTION_TIME');
 const z=assumed(fixture());z.admission.assumptionId='bad\n';rejected(z,'ASSUMPTION_ID');
 z.admission.assumptionId='ok';z.admission.publicationDelayMs=-1;rejected(z,'ASSUMPTION_TIME');
});
test('width bounds and exact minimal window: 1/32 admitted, 0/33 rejected',()=>{
 for(const tf of ['4H','1D'])for(const kind of ['HIGH','LOW'])for(const width of [1,32]) {
  const x=fixture(tf,kind,width);assert.equal(bind(x).valid,true);assert.equal(x.bars.length,2*width+1);
 }
 for(const width of [0,33,1.5,'1']){const x=fixture();x.leftBars=width;rejected(x,'PIVOT_WINDOW');}
 for(const mutate of [x=>{x.bars.pop()},x=>{x.bars.push({...x.bars[2]})},x=>{delete x.bars[0]},x=>{x.bars.extra=1}]) {
  const x=fixture();mutate(x);rejected(x,'PIVOT_WINDOW');
 }
});
test('strict next aligned boundary and safe arithmetic overflow',()=>{
 for(const tf of ['4H','1D']) {
  const T=tf==='4H'?14400000:86400000,x=fixture(tf);x.decisionMs=4*T;
  assert.equal(bind(x).earliestHypotheticalEntryOpenMs,5*T);
  const end=Math.floor(Number.MAX_SAFE_INTEGER/T)*T,offset=end-3*T;
  const y=fixture(tf);for(const b of y.bars){b.openTimeMs+=offset;b.closeTimeMs+=offset;}
  y.admission.receipts=y.bars.map((b,i)=>({barIndex:i,openTimeMs:b.openTimeMs,receivedAtMs:b.closeTimeMs}));
  y.decisionMs=Number.MAX_SAFE_INTEGER;rejected(y,'TIME_OVERFLOW');
  y.admission={mode:'ASSUMED_PUBLICATION',assumptionId:'near-limit',publicationDelayMs:T,
   archiveReceipts:y.bars.map((b,i)=>({barIndex:i,openTimeMs:b.openTimeMs,archiveRetrievedAtMs:b.closeTimeMs}))};
  rejected(y,'TIME_OVERFLOW');
 }
});
test('schema/time/OHLC mutations and no external geometric-result laundering',()=>{
 const cases=[
 [x=>{x.schemaVersion='wrong'},'INPUT_SCHEMA'],[x=>{x.geometricConfirmationAtMs=0},'INPUT_SCHEMA'],
 [x=>{x.pivot={kind:'HIGH'}},'INPUT_SCHEMA'],[x=>{x.assetId='bad\n'},'INPUT_SCHEMA'],
 [x=>{x.admission.mode='VERIFIED'},'UNSUPPORTED_MODE'],[x=>{x.admission.extra=1},'INPUT_SCHEMA'],
 [x=>{x.timeframe='1H'},'TIME_CONTRACT'],[x=>{x.decisionMs='1'},'TIME_CONTRACT'],
 [x=>{x.bars[0].extra=1},'BAR_SCHEMA'],[x=>{x.bars[0].openTimeMs++},'BAR_TIME'],
 [x=>{x.bars[0].closeTimeMs=Infinity},'BAR_TIME'],[x=>{x.decisionMs--},'FUTURE_OR_INCOMPLETE_BAR'],
 [x=>{x.bars[1].openTimeMs=0;x.bars[1].closeTimeMs=14400000},'BAR_SEQUENCE'],
 [x=>{x.bars[0].high=NaN},'OHLCV'],[x=>{x.bars[0].volume=-1},'OHLCV']];
 for(const [change,error] of cases){const x=fixture();change(x);rejected(x,error);}
});
