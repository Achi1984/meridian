import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_VENUE_FUNDING_EDGE_V2_SOURCE as PROD,
  canonicalFundingTime,normalizeFunding,normalizeMarks,usableFundingMap,
  fundingIntegrityEvents,markIntegrityEvents,integrityEventsForSource,
  commonFundingTimes,splitCommonTimes,decisionWithinCoverage,
  marksCompleteBetween,recoveryAt,entryInputsReady,validateCrossVenueV2Source
} from '../research/cross-venue-funding-edge-v2-data-contract.js';

const H=60*60*1000;
const START=Date.parse('2026-01-01T00:00:00.000Z');
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

test('60/20/20 split is deterministic and independent of entry eligibility',()=>{
  const times=Array.from({length:10},(_,i)=>START+i*8*H);
  const s=splitCommonTimes(times);
  assert.equal(s.discovery.count,6);
  assert.equal(s.validation.count,2);
  assert.equal(s.holdout.count,2);
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

test('Recovery requires three consecutive common settlements and complete marks on both venues',()=>{
  const common=[START+8*H,START+16*H,START+24*H,START+32*H];
  const bm=normalizeMarks(marks(),'BINANCE'),om=normalizeMarks(marks(),'OKX');
  assert.equal(recoveryAt({episodeStart:START+1,commonTimes:common,integrityEvents:[],binanceMarks:bm,okxMarks:om},contract),START+24*H);
  const gap=normalizeMarks(marks().filter(x=>x.openTime!==START+12*H),'OKX');
  assert.equal(recoveryAt({episodeStart:START+1,commonTimes:common,integrityEvents:[],binanceMarks:bm,okxMarks:gap},contract),null);
});

test('new integrity event inside a recovery sequence resets recovery',()=>{
  const common=[START+8*H,START+16*H,START+24*H,START+32*H,START+40*H];
  const m=normalizeMarks(marks(),'BINANCE');
  const events=[{kind:'OFF_GRID_FUNDING',venue:'OKX',detectionTime:START+18*H}];
  assert.equal(recoveryAt({episodeStart:START+1,commonTimes:common,integrityEvents:events,binanceMarks:m,okxMarks:m},contract),START+40*H);
});

test('entry requires three fresh common funding inputs and the next confirmed mark on both venues',()=>{
  const b=normalizeFunding(funding(),'BINANCE',contract),o=normalizeFunding(funding(),'OKX',contract);
  const bm=normalizeMarks(marks(),'BINANCE'),om=normalizeMarks(marks(),'OKX');
  const ready=entryInputsReady({decisionTime:START+16*H,binanceFunding:b,okxFunding:o,binanceMarks:bm,okxMarks:om},contract);
  assert.equal(ready.ready,true);
  assert.equal(ready.entryOpenTime,START+17*H);
  const stale=entryInputsReady({decisionTime:START+16*H,binanceFunding:b.slice(1),okxFunding:o,binanceMarks:bm,okxMarks:om},contract);
  assert.equal(stale.reason,'FUNDING_INPUTS_INCOMPLETE_OR_STALE');
  const markGap=entryInputsReady({decisionTime:START+16*H,binanceFunding:b,okxFunding:o,binanceMarks:bm.filter(x=>x.openTime!==START+17*H),okxMarks:om},contract);
  assert.equal(markGap.reason,'MARK_INPUTS_INCOMPLETE_OR_STALE');
  assert.equal(entryInputsReady({decisionTime:START+16*H,binanceFunding:b,okxFunding:o,binanceMarks:bm,okxMarks:om,activeDegradation:true},contract).reason,'DATA_DEGRADED');
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
