import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_VENUE_FUNDING_EDGE_V2_SOURCE as PROD,
  canonicalFundingTime,normalizeFunding,normalizeMarks,usableFundingMap,
  fundingIntegrityEvents,markIntegrityEvents,integrityEventsForSource,
  commonFundingTimes,splitCommonTimes,decisionWithinCoverage,
  marksCompleteBetween,recoveryAt,entryInputsReady,entryFillIntegrityOutcome,validateCrossVenueV2Source
} from '../research/cross-venue-funding-edge-v2-data-contract.js';

const H=60*60*1000;
const START=Date.parse('2026-01-01T00:00:00.000Z');
const healthy=Object.freeze({activeDegradation:false});
const contract={
  ...PROD,
  rawStart:new Date(START).toISOString(),
  fundingCoverageEnd:new Date(START+48*H).toISOString(),
  markCoverageEnd:new Date(START+60*H).toISOString(),
  coverageEnd:new Date(START+48*H).toISOString(),
  decisionWindowEnd:new Date(START+16*H).toISOString(),
  minCommonFundingDecisions:3
};

function funding(){
  return Array.from({length:7},(_,i)=>({fundingTime:START+i*8*H,fundingRate:.0001+i*.00001}));
}
function marks(){
  return Array.from({length:61},(_,i)=>({
    openTime:START+i*H,open:100+i,high:101+i,low:99+i,close:100.5+i,confirmed:true
  }));
}
function pack(){
  return{
    binanceFunding:funding(),
    okxFunding:funding(),
    binanceMarks:marks(),
    okxMarks:marks(),
    provenance:{
      binanceChecksumsVerified:true,
      okxFundingArchivesHashed:true,
      okxMarkPagesHashed:true,
      deterministicParsing:true
    }
  };
}

test('production source boundaries are frozen from the successful pre-contract probe',()=>{
  assert.equal(PROD.rawStart,'2022-03-01T00:00:00.000Z');
  assert.equal(PROD.fundingCoverageEnd,'2026-09-30T08:00:00.000Z');
  assert.equal(PROD.markCoverageEnd,'2026-10-03T23:00:00.000Z');
  assert.equal(PROD.coverageEnd,'2026-09-30T08:00:00.000Z');
  assert.equal(PROD.decisionWindowEnd,'2026-09-29T00:00:00.000Z');
  assert.equal(PROD.decisionReserveHours,26);
  assert.deepEqual(PROD.scheduleUtcHours,[0,8,16]);
  assert.equal(PROD.coverageEvidence.workflowRunId,37280311203);
  assert.equal(PROD.coverageEvidence.probeHeadSha,'80e7afddc7849197b608875bf6d6abec4f1b9bce');
  assert.match(PROD.coverageEvidence.okxFundingSha256,/^[a-f0-9]{64}$/);
});

test('funding canonicalization accepts ±1s only on the frozen 00/08/16 UTC grid',()=>{
  assert.equal(canonicalFundingTime(START+999,contract),START);
  assert.equal(canonicalFundingTime(START+1000,contract),START);
  assert.equal(canonicalFundingTime(START+1001,contract),null);
  assert.equal(canonicalFundingTime(START+4*H,contract),null);
  assert.equal(canonicalFundingTime(null,contract),null);
  assert.equal(canonicalFundingTime(false,contract),null);
});

test('normalizers require explicit provider fields and never fall back to ts aliases',()=>{
  const f=normalizeFunding([{ts:START,rate:.001}],'OKX',contract)[0];
  assert.equal(f.rawTime,null);
  assert.ok(Number.isNaN(f.rate));
  const m=normalizeMarks([{ts:START,o:1,h:1,l:1,c:1,confirmed:true}],'OKX')[0];
  assert.equal(m.openTime,null);
  assert.ok(Number.isNaN(m.open));
});

test('duplicate authoritative funding creates DATA_DEGRADED evidence and no value is chosen',()=>{
  const rows=funding();
  rows.push({...rows[1]});
  const n=normalizeFunding(rows,'OKX',contract);
  const events=fundingIntegrityEvents(n,'OKX',contract);
  assert.ok(events.some(x=>x.kind==='DUPLICATE_FUNDING'||x.kind==='DUPLICATE_CANONICAL_FUNDING'));
  assert.equal(usableFundingMap(n).has(START+8*H),false);
});

test('duplicate with a different rate is also rejected without choosing either value',()=>{
  const rows=funding();
  rows.push({fundingTime:START+8*H,fundingRate:.009});
  const n=normalizeFunding(rows,'OKX',contract);
  assert.equal(usableFundingMap(n).has(START+8*H),false);
  assert.ok(fundingIntegrityEvents(n,'OKX',contract).some(x=>x.kind.startsWith('DUPLICATE')));
});

test('synthetic 4h provider interval event is off-grid DATA_DEGRADED and never a common decision',()=>{
  const b=normalizeFunding(funding(),'BINANCE',contract);
  const oRows=funding();
  oRows.push({fundingTime:START+4*H,fundingRate:.002});
  const o=normalizeFunding(oRows,'OKX',contract);
  assert.ok(fundingIntegrityEvents(o,'OKX',contract).some(x=>x.kind==='OFF_GRID_FUNDING'&&x.rawTime===START+4*H));
  assert.equal(commonFundingTimes(b,o,contract).includes(START+4*H),false);
});

test('missing scheduled funding is detected immediately after the ±1s tolerance',()=>{
  const rows=funding();rows.splice(2,1);
  const n=normalizeFunding(rows,'BINANCE',contract);
  const e=fundingIntegrityEvents(n,'BINANCE',contract).find(x=>x.kind==='MISSING_SCHEDULED_FUNDING'&&x.scheduledTime===START+16*H);
  assert.ok(e);
  assert.equal(e.detectionTime,START+16*H+1001);
});

test('common decisions exclude duplicate invalid values but otherwise remain chronological',()=>{
  const b=normalizeFunding(funding(),'BINANCE',contract);
  const orows=funding();orows.push({...orows[1]});
  const o=normalizeFunding(orows,'OKX',contract);
  const common=commonFundingTimes(b,o,contract);
  assert.deepEqual(common,[START,START+16*H]);
});

test('60/20/20 split preserves the frozen V1 floor-60 / floor-80 rounding rule',()=>{
  const times=Array.from({length:10},(_,i)=>START+i*8*H);
  const s=splitCommonTimes(times);
  assert.equal(s.discovery.count,6);
  assert.equal(s.validation.count,2);
  assert.equal(s.holdout.count,2);

  const eight=splitCommonTimes(Array.from({length:8},(_,i)=>START+i*8*H));
  assert.equal(eight.discovery.count,4);
  assert.equal(eight.validation.count,2);
  assert.equal(eight.holdout.count,2);
});

test('decision window enforces the frozen 26h reserve',()=>{
  const end=Date.parse(PROD.decisionWindowEnd);
  assert.equal(decisionWithinCoverage(end,PROD),true);
  assert.equal(decisionWithinCoverage(end+8*H,PROD),false);
  assert.ok(end+26*H<=Date.parse(PROD.coverageEnd));
});

test('mark completeness requires unique confirmed hourly rows',()=>{
  const m=normalizeMarks(marks(),'BINANCE');
  assert.equal(marksCompleteBetween(m,START+8*H,START+24*H,contract),true);
  const gap=marks();gap.splice(12,1);
  assert.equal(marksCompleteBetween(normalizeMarks(gap,'BINANCE'),START+8*H,START+24*H,contract),false);
  const dup=marks();dup.push({...dup[12]});
  assert.ok(markIntegrityEvents(normalizeMarks(dup,'BINANCE'),'BINANCE',contract).some(x=>x.kind==='DUPLICATE_MARK'));
});

test('Recovery at T uses only marks closed by T, through openTime T-1h',()=>{
  const common=[START+8*H,START+16*H,START+24*H,START+32*H];
  const bm=normalizeMarks(marks(),'BINANCE'),om=normalizeMarks(marks(),'OKX');
  const withoutCandleAtT=normalizeMarks(marks().filter(x=>x.openTime!==START+24*H),'OKX');
  assert.equal(recoveryAt({episodeStart:START+1,commonTimes:common,integrityEvents:[],binanceMarks:bm,okxMarks:withoutCandleAtT},contract),START+24*H);

  const missingLastClosed=normalizeMarks(marks().filter(x=>x.openTime!==START+23*H),'OKX');
  assert.equal(recoveryAt({episodeStart:START+1,commonTimes:common,integrityEvents:[],binanceMarks:bm,okxMarks:missingLastClosed},contract),null);
});

test('new integrity event before or inside a recovery sequence resets the episode clock',()=>{
  const common=[START+8*H,START+16*H,START+24*H,START+32*H,START+40*H,START+48*H];
  const m=normalizeMarks(marks(),'BINANCE');
  const events=[{kind:'OFF_GRID_FUNDING',venue:'OKX',detectionTime:START+10*H}];
  assert.equal(recoveryAt({episodeStart:START+1,commonTimes:common,integrityEvents:events,binanceMarks:m,okxMarks:m},contract),START+32*H);
  const later=[{kind:'OFF_GRID_FUNDING',venue:'OKX',detectionTime:START+18*H}];
  assert.equal(recoveryAt({episodeStart:START+1,commonTimes:common,integrityEvents:later,binanceMarks:m,okxMarks:m},contract),START+40*H);
});

test('entry readiness at t uses only completed data available by t',()=>{
  const t=START+16*H;
  const b=normalizeFunding(funding(),'BINANCE',contract),o=normalizeFunding(funding(),'OKX',contract);
  const bm=normalizeMarks(marks(),'BINANCE'),om=normalizeMarks(marks(),'OKX');
  const ready=entryInputsReady({...healthy,decisionTime:t,binanceFunding:b,okxFunding:o,binanceMarks:bm,okxMarks:om},contract);
  assert.equal(ready.ready,true);
  assert.equal(ready.entryOpenTime,t+H);
  assert.equal(ready.lastClosedMarkTime,t-H);

  const noFutureMarks=entryInputsReady({...healthy,
    decisionTime:t,
    binanceFunding:b,
    okxFunding:o,
    binanceMarks:bm.filter(x=>x.openTime<t),
    okxMarks:om.filter(x=>x.openTime<t)
  },contract);
  assert.deepEqual(noFutureMarks,ready);

  const futureMutated=om.map(x=>x.openTime>=t?{...x,confirmed:false}:x);
  assert.deepEqual(entryInputsReady({...healthy,
    decisionTime:t,
    binanceFunding:b,
    okxFunding:o,
    binanceMarks:bm,
    okxMarks:futureMutated
  },contract),ready);

  const stale=entryInputsReady({...healthy,decisionTime:t,binanceFunding:b.slice(1),okxFunding:o,binanceMarks:bm,okxMarks:om},contract);
  assert.equal(stale.reason,'FUNDING_INPUTS_INCOMPLETE_OR_STALE');

  const lastClosedMissing=entryInputsReady({...healthy,
    decisionTime:t,binanceFunding:b,okxFunding:o,
    binanceMarks:bm.filter(x=>x.openTime!==t-H),okxMarks:om
  },contract);
  assert.equal(lastClosedMissing.reason,'MARK_INPUTS_INCOMPLETE_OR_STALE');

  const lastClosedUnconfirmed=entryInputsReady({...healthy,
    decisionTime:t,binanceFunding:b,okxFunding:o,
    binanceMarks:bm,okxMarks:om.map(x=>x.openTime===t-H?{...x,confirmed:false}:x)
  },contract);
  assert.equal(lastClosedUnconfirmed.reason,'MARK_INPUTS_INCOMPLETE_OR_STALE');

  assert.equal(entryInputsReady({...healthy,decisionTime:t,binanceFunding:b,okxFunding:o,binanceMarks:bm,okxMarks:om,activeDegradation:true},contract).reason,'DATA_DEGRADED');
});

test('an invalid entry candle after an active ENTRY becomes terminal INCONCLUSIVE at its causal detection time',()=>{
  const t=START+16*H,entryOpen=t+H,detection=entryOpen+H;
  const bm=normalizeMarks(marks(),'BINANCE');
  const baseOkx=marks();

  const pending=entryFillIntegrityOutcome({
    decisionTime:t,entryActive:true,asOfTime:detection-1,
    binanceMarks:bm,okxMarks:normalizeMarks(baseOkx,'OKX')
  },contract);
  assert.equal(pending.status,'PENDING');

  const missing=entryFillIntegrityOutcome({
    decisionTime:t,entryActive:true,asOfTime:detection,
    binanceMarks:bm,okxMarks:normalizeMarks(baseOkx.filter(x=>x.openTime!==entryOpen),'OKX')
  },contract);
  assert.equal(missing.status,'INCONCLUSIVE');
  assert.equal(missing.okxStatus,'MISSING_MARK');

  const duplicateRows=[...baseOkx,{...baseOkx.find(x=>x.openTime===entryOpen)}];
  const duplicate=entryFillIntegrityOutcome({
    decisionTime:t,entryActive:true,asOfTime:detection,
    binanceMarks:bm,okxMarks:normalizeMarks(duplicateRows,'OKX')
  },contract);
  assert.equal(duplicate.status,'INCONCLUSIVE');
  assert.equal(duplicate.okxStatus,'DUPLICATE_MARK');

  const unconfirmed=entryFillIntegrityOutcome({
    decisionTime:t,entryActive:true,asOfTime:detection,
    binanceMarks:bm,
    okxMarks:normalizeMarks(baseOkx.map(x=>x.openTime===entryOpen?{...x,confirmed:false}:x),'OKX')
  },contract);
  assert.equal(unconfirmed.status,'INCONCLUSIVE');
  assert.equal(unconfirmed.okxStatus,'UNCONFIRMED_MARK');

  const valid=entryFillIntegrityOutcome({
    decisionTime:t,entryActive:true,asOfTime:detection,
    binanceMarks:bm,okxMarks:normalizeMarks(baseOkx,'OKX')
  },contract);
  assert.equal(valid.status,'EXECUTED');
});

test('source validation may pass provenance with historical integrity episodes but never hides them',()=>{
  const p=pack();
  p.okxFunding.push({fundingTime:START+4*H,fundingRate:.002});
  const r=validateCrossVenueV2Source(p,contract);
  assert.equal(r.ok,true);
  assert.equal(r.state,'VALID_WITH_INTEGRITY_EPISODES');
  assert.ok(r.integrityEvents.some(x=>x.kind==='OFF_GRID_FUNDING'));
  assert.match(r.receipt.digest,/^[a-f0-9]{64}$/);
  assert.equal(r.receipt.commonFundingDecisions,3);
});

test('source validation fails closed on invalid explicit fields and provenance',()=>{
  const p=pack();p.okxFunding[0].fundingRate='';
  assert.equal(validateCrossVenueV2Source(p,contract).reason,'OKX_INVALID_FUNDING');
  const q=pack();q.binanceMarks[0].low=false;
  assert.equal(validateCrossVenueV2Source(q,contract).reason,'BINANCE_INVALID_MARK');
  const z=pack();z.provenance.deterministicParsing=false;
  assert.equal(validateCrossVenueV2Source(z,contract).reason,'DETERMINISTIC_PARSING_NOT_VERIFIED');
});

test('combined integrity ledger is deterministic across venues',()=>{
  const p=pack();p.okxFunding.splice(2,1);p.binanceMarks.splice(5,1);
  const n={
    binanceFunding:normalizeFunding(p.binanceFunding,'BINANCE',contract),
    okxFunding:normalizeFunding(p.okxFunding,'OKX',contract),
    binanceMarks:normalizeMarks(p.binanceMarks,'BINANCE'),
    okxMarks:normalizeMarks(p.okxMarks,'OKX')
  };
  const e=integrityEventsForSource(n,contract);
  assert.ok(e.some(x=>x.kind==='MISSING_SCHEDULED_FUNDING'));
  assert.ok(e.some(x=>x.kind==='MISSING_MARK'));
  assert.deepEqual(e,[...e].sort((a,b)=>a.detectionTime-b.detectionTime||String(a.venue).localeCompare(String(b.venue))||String(a.kind).localeCompare(String(b.kind))||Number(a.scheduledTime??a.rawTime??0)-Number(b.scheduledTime??b.rawTime??0)));
});


test('normalized mark confirmation is type-strict and does not accept provider string aliases',()=>{
  const row={openTime:START,open:100,high:101,low:99,close:100,confirmed:'1'};
  const n=normalizeMarks([row],'OKX')[0];
  assert.equal(n.confirmed,false);
  assert.ok(markIntegrityEvents([n],'OKX',{...contract,markCoverageEnd:new Date(START).toISOString()}).some(x=>x.kind==='UNCONFIRMED_MARK'));
});

test('source validation refuses any package that claims strategy PnL was calculated',()=>{
  const p=pack();
  p.provenance.strategyPnlCalculated=true;
  assert.equal(validateCrossVenueV2Source(p,contract).reason,'SOURCE_COLLECTOR_MUST_NOT_CALCULATE_PNL');
});

test('mark validation rejects impossible OHLC relationships',()=>{
  const p=pack();
  p.okxMarks[5]={...p.okxMarks[5],high:98};
  assert.equal(validateCrossVenueV2Source(p,contract).reason,'OKX_INVALID_MARK');
});


test('source validation rejects rows outside the frozen funding and mark coverage',()=>{
  const fundingOut=pack();
  fundingOut.okxFunding.push({fundingTime:Date.parse(contract.fundingCoverageEnd)+8*H,fundingRate:.0001});
  assert.equal(validateCrossVenueV2Source(fundingOut,contract).reason,'OKX_FUNDING_OUT_OF_RANGE');

  const markOut=pack();
  markOut.binanceMarks.push({
    openTime:Date.parse(contract.markCoverageEnd)+H,
    open:100,high:101,low:99,close:100,confirmed:true
  });
  assert.equal(validateCrossVenueV2Source(markOut,contract).reason,'BINANCE_MARK_OUT_OF_RANGE');
});


test('future integrity events cannot alter a recovery decision at an earlier timestamp',()=>{
  const recoveryTime=START+24*H;
  const common=[START+8*H,START+16*H,recoveryTime,START+32*H];
  const m=normalizeMarks(marks(),'BINANCE');
  const kinds=[
    'MISSING_SCHEDULED_FUNDING','FUNDING_GAP','DUPLICATE_FUNDING',
    'DUPLICATE_CANONICAL_FUNDING','OFF_GRID_FUNDING',
    'MISSING_MARK','DUPLICATE_MARK','UNCONFIRMED_MARK'
  ];
  for(const kind of kinds){
    const events=[{kind,venue:'OKX',detectionTime:recoveryTime+1}];
    assert.equal(
      recoveryAt({episodeStart:START+1,commonTimes:common,integrityEvents:events,binanceMarks:m,okxMarks:m},contract),
      recoveryTime,
      kind
    );
  }
});


test('entry readiness and entry-fill activation flags are strict booleans',()=>{
  const t=START+16*H;
  const b=normalizeFunding(funding(),'BINANCE',contract),o=normalizeFunding(funding(),'OKX',contract);
  const bm=normalizeMarks(marks(),'BINANCE'),om=normalizeMarks(marks(),'OKX');
  for(const bad of ['true',1,undefined,null]){
    assert.throws(()=>entryInputsReady({decisionTime:t,binanceFunding:b,okxFunding:o,binanceMarks:bm,okxMarks:om,activeDegradation:bad},contract),/INVALID_DEGRADATION_FLAG/);
    assert.throws(()=>entryFillIntegrityOutcome({decisionTime:t,entryActive:bad,asOfTime:t+2*H,binanceMarks:bm,okxMarks:om},contract),/INVALID_ENTRY_ACTIVE_FLAG/);
  }
  assert.equal(entryFillIntegrityOutcome({decisionTime:t,entryActive:false,asOfTime:t+2*H,binanceMarks:bm,okxMarks:om},contract).status,'NOT_APPLICABLE');
});

test('recovery reset at candidate T is causal and a one-venue settlement never becomes common',()=>{
  const common=[START+8*H,START+16*H,START+24*H,START+32*H];
  const m=normalizeMarks(marks(),'BINANCE');
  const exact=[{kind:'OFF_GRID_FUNDING',venue:'OKX',detectionTime:START+24*H}];
  assert.equal(recoveryAt({episodeStart:START+1,commonTimes:common,integrityEvents:exact,binanceMarks:m,okxMarks:m},contract),null);

  const b=normalizeFunding(funding(),'BINANCE',contract);
  const onlyOne=normalizeFunding(funding().filter(x=>x.fundingTime!==START+16*H),'OKX',contract);
  assert.equal(commonFundingTimes(b,onlyOne,contract).includes(START+16*H),false);
});
