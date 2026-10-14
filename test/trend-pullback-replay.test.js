import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTrendPullback} from '../docs/strategy-lab/trend-pullback.mjs';
import {evaluateTrendPullbackCore} from '../docs/strategy-lab/trend-pullback-core.mjs';
import {evaluateTrendPullbackReplay} from '../docs/strategy-lab/trend-pullback-replay.mjs';
const DAY=86400000;
function fixture(){
  const start=Date.UTC(2024,0,1);
  const bars=Array.from({length:201},(_,i)=>({openTimeMs:start+i*DAY,closeTimeMs:start+(i+1)*DAY,
    open:100,high:i>=190?110:101,low:i>=190?90:99,close:i===199?92:i===200?104:100,volume:10}));
  return {schemaVersion:'MERIDIAN_P1_ASSUMED_HISTORY_V1',mode:'ASSUMED_PUBLICATION_V1',
    assumptionId:'SYNTHETIC_FIXTURE_1',publicationDelayMs:1000,decisionAtMs:bars.at(-1).closeTimeMs+1000,
    archiveRetrievedAtMs:bars.at(-1).closeTimeMs+100*DAY,bars,position:null};
}
const replay=evaluateTrendPullbackReplay;
test('synthetic equality across entry, hold, trend, oscillator, time and zero-range cases',()=>{
  const changes=[()=>{},x=>x.bars[200].close=108,
    x=>{x.position={entryAtMs:x.bars[199].closeTimeMs};},
    x=>{x.position={entryAtMs:x.bars[199].closeTimeMs};x.bars[200].close=95;},
    x=>{x.position={entryAtMs:x.bars[199].closeTimeMs};x.bars[200].close=108;},
    x=>x.position={entryAtMs:x.bars[190].closeTimeMs},
    x=>{for(const b of x.bars)b.open=b.high=b.low=b.close=100.1;}];
  for(const change of changes){
    const x=fixture();change(x);
    const historical=replay(x);assert.equal(historical.valid,true);
    const live=evaluateTrendPullback({bars:x.bars.map(b=>({...b,availableAtMs:b.closeTimeMs+x.publicationDelayMs})),asOfMs:x.decisionAtMs,position:x.position});
    const {signalAvailableAtMs,...actual}=live;
    const {timeAdmissionPerformed,...assumed}=historical.signal;
    assert.deepEqual(assumed,actual);assert.equal(timeAdmissionPerformed,false);
    assert.equal(signalAvailableAtMs,x.decisionAtMs);
    for(const flag of ['historicalAvailabilityVerified','revisionHistoryVerified','executionAuthorized'])assert.equal(historical[flag],false);
    assert.equal(historical.researchOnly,true);
  }
});
test('observed archive receipt and raw bars remain unchanged; assumptions are separate',()=>{
  const x=fixture(),before=structuredClone(x),r=replay(x);
  assert.deepEqual(x,before);assert.equal(r.timing.archiveRetrievedAtMs,x.archiveRetrievedAtMs);
  assert.equal(r.timing.assumedPublicationTimesMs.at(-1),x.decisionAtMs);
  assert.ok(r.timing.archiveRetrievedAtMs>r.timing.assumedPublicationTimesMs.at(-1));
  assert.equal(Object.hasOwn(r,'bars'),false);assert.equal(Object.hasOwn(r.signal,'signalAvailableAtMs'),false);
  r.timing.assumedPublicationTimesMs[0]=0;assert.deepEqual(x,before);
});
test('raw history and adapter results cannot silently enter actual-receipt admission',()=>{
  const x=fixture(),r=replay(x);
  assert.equal(evaluateTrendPullback({bars:x.bars,asOfMs:x.decisionAtMs,position:null}).error,'BAR_SCHEMA');
  assert.equal(evaluateTrendPullback(r).error,'INPUT_SCHEMA');
  const observed=x.bars.map(b=>({...b,availableAtMs:x.archiveRetrievedAtMs}));
  assert.equal(evaluateTrendPullback({bars:observed,asOfMs:x.decisionAtMs,position:null}).error,'BAR_TIME');
  // A caller-provided availability field, even equal to the assumption, is rejected.
  const injected=fixture();injected.bars[0].availableAtMs=injected.bars[0].closeTimeMs+1000;
  assert.equal(replay(injected).error,'BAR_SCHEMA');
});
test('exact schemas reject absent fields, extras and evidence claims',()=>{
  for(const key of Object.keys(fixture())){const x=fixture();delete x[key];assert.equal(replay(x).valid,false,key);}
  for(const [key,value] of [['schemaVersion','WRONG'],['mode','EVIDENCE_BACKED'],['historicalAvailabilityVerified',true],['revisionHistoryVerified',true],['evidence',{}]]){
    const x=fixture();x[key]=value;assert.equal(replay(x).valid,false,key);
  }
  for(const value of ['',null,'invalid id',5]){const x=fixture();x.assumptionId=value;assert.equal(replay(x).valid,false);}
  for(const value of [-1,null,1.5,Infinity]){const x=fixture();x.publicationDelayMs=value;assert.equal(replay(x).valid,false);}
});
test('explicit publication delays reject future and stale decisions with exact boundary',()=>{
  let x=fixture();x.decisionAtMs--;assert.equal(replay(x).error,'NOT_YET_ASSUMED_PUBLISHED');
  x=fixture();x.decisionAtMs=x.bars.at(-1).closeTimeMs+DAY;assert.equal(replay(x).error,'STALE_WINDOW');
  x=fixture();x.decisionAtMs=x.bars.at(-1).closeTimeMs-1;assert.equal(replay(x).valid,false);
  x=fixture();x.publicationDelayMs=0;x.decisionAtMs=x.bars.at(-1).closeTimeMs;assert.equal(replay(x).valid,true);
  x=fixture();x.archiveRetrievedAtMs=x.bars.at(-1).closeTimeMs-1;assert.equal(replay(x).error,'ARCHIVE_PRECEDES_CLOSE');
});
test('malformed OHLCV, sequences and position state reject without implicit slicing',()=>{
  const changes=[x=>x.bars[0].high=Infinity,x=>x.bars[0].low=101,x=>x.bars[0].volume=-1,
    x=>x.bars[0].close='100',x=>delete x.bars[0].open,x=>x.bars[0].extra=1,
    x=>x.bars.push({...x.bars.at(-1)}),x=>x.bars[100]=null,
    x=>{x.bars[100].openTimeMs+=DAY;x.bars[100].closeTimeMs+=DAY;},
    x=>x.position={entryAtMs:x.decisionAtMs+1},x=>x.position={entryAtMs:x.bars[0].closeTimeMs-1},
    x=>x.position={entryAtMs:x.decisionAtMs,quantity:1}];
  for(const change of changes){const x=fixture();change(x);const r=replay(x);assert.equal(r.valid,false);assert.equal(r.action,'NONE');assert.equal(r.executionAuthorized,false);assert.equal(r.historicalAvailabilityVerified,false);}
});
test('core has no time admission claim and independently rejects invalid raw input',()=>{
  const x=fixture(),input={bars:x.bars,decisionAtMs:x.decisionAtMs,position:x.position};
  const r=evaluateTrendPullbackCore(input);assert.equal(r.valid,true);assert.equal(r.timeAdmissionPerformed,false);assert.equal(r.executionAuthorized,false);
  assert.equal(evaluateTrendPullbackCore({...input,availableAtMs:0}).valid,false);
  input.bars[0].high=0;assert.equal(evaluateTrendPullbackCore(input).valid,false);
});
