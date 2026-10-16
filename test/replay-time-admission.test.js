import test from 'node:test';
import assert from 'node:assert/strict';
import {planReplayTimeAdmission as run} from '../docs/strategy-lab/replay-time-admission.mjs';
const DAY=86400000;
function fixture(){
  const closes=Array.from({length:201},(_,i)=>Date.UTC(2024,0,2)+i*DAY);
  return {mode:'ASSUMED_PUBLICATION_V1',assumptionId:'synthetic-delay-v1',publicationDelayMs:1000,
    decisionAtMs:closes.at(-1)+1000,archiveRetrievedAtMs:Date.UTC(2026,9,13),candleCloseTimesMs:closes};
}
test('assumed timing is separate from actual archive receipt and cannot authorize a run',()=>{
  const x=fixture(), before=structuredClone(x),r=run(x);
  assert.equal(r.valid,true);assert.equal(r.archiveRetrievedAtMs,x.archiveRetrievedAtMs);
  assert.equal(r.assumedPublicationTimesMs.at(-1),x.decisionAtMs);
  assert.equal(r.historicalAvailabilityVerified,false);assert.equal(r.revisionHistoryVerified,false);
  assert.equal(r.strategyExecutionAuthorized,false);assert.equal(r.executionAuthorized,false);
  assert.deepEqual(x,before);assert.equal('availableAtMs' in r,false);
});
test('a claimed evidence mode is not accepted as authenticated evidence',()=>{
  for(const mode of ['EVIDENCE_BACKED','LIVE','',null]) assert.equal(run({...fixture(),mode}).error,'UNSUPPORTED_MODE');
});
test('one millisecond before assumed release fails; equality passes',()=>{
  const x=fixture();assert.equal(run({...x,decisionAtMs:x.decisionAtMs-1}).error,'NOT_YET_ASSUMED_PUBLISHED');
  assert.equal(run(x).valid,true);
});
test('future/incomplete final candle and 24-hour stale boundary fail',()=>{
  const x=fixture(),close=x.candleCloseTimesMs.at(-1);
  assert.equal(run({...x,decisionAtMs:close-1}).valid,false);
  assert.equal(run({...x,decisionAtMs:close+DAY-1}).valid,true);
  assert.equal(run({...x,decisionAtMs:close+DAY}).error,'STALE_WINDOW');
});
test('duplicate, gap, unordered and non-UTC close rejected',()=>{
  for(const delta of [-DAY,DAY,1]){const x=fixture();x.candleCloseTimesMs[100]+=delta;assert.equal(run(x).error,'DAILY_SEQUENCE');}
});
test('receipt before final close rejected; equal receipt is possible',()=>{
  const x=fixture(),close=x.candleCloseTimesMs.at(-1);
  assert.equal(run({...x,archiveRetrievedAtMs:close-1}).error,'ARCHIVE_PRECEDES_CLOSE');
  assert.equal(run({...x,archiveRetrievedAtMs:close}).valid,true);
});
test('unsafe, negative, fractional and nonfinite timing rejected',()=>{
  for(const field of ['publicationDelayMs','decisionAtMs','archiveRetrievedAtMs'])
    for(const value of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1000'])
      assert.equal(run({...fixture(),[field]:value}).valid,false);
  assert.equal(run({...fixture(),publicationDelayMs:Number.MAX_SAFE_INTEGER}).error,'TIME_OVERFLOW');
});
test('zero delay is explicit assumption; full-day delay never fresh',()=>{
  const x=fixture(),close=x.candleCloseTimesMs.at(-1);
  assert.equal(run({...x,publicationDelayMs:0,decisionAtMs:close}).valid,true);
  assert.equal(run({...x,publicationDelayMs:DAY,decisionAtMs:close+DAY}).error,'STALE_WINDOW');
});
test('missing assumption identity, newline and extra metadata rejected',()=>{
  for(const assumptionId of ['', 'id\n', 'a'.repeat(81),null]) assert.equal(run({...fixture(),assumptionId}).error,'ASSUMPTION_ID');
  assert.equal(run({...fixture(),historicalAvailabilityVerified:true}).error,'INPUT_SCHEMA');
  assert.equal(run(null).error,'INPUT_SCHEMA');
});
test('extra bars and sparse arrays are not silently filled or sliced',()=>{
  const x=fixture();x.candleCloseTimesMs.push(x.candleCloseTimesMs.at(-1)+DAY);assert.equal(run(x).error,'WINDOW');
  const y=fixture();delete y.candleCloseTimesMs[30];assert.equal(run(y).error,'DAILY_SEQUENCE');
});
