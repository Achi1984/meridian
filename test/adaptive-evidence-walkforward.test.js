import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreOutOfSample, expandingWalkForward } from '../adaptive-evidence-walkforward.js';

const row=(ts,realizedR,extra={})=>({
  ts,realizedR,side:'LONG',symbol:'AAAUSDT',
  observations:{side:'LONG',regime:'BULL',mtfAlignment:'3',momentum:'STRONG',volume:'HIGH',volatility:'NORMAL',asset:'AAAUSDT',baselineStatus:'READY'},
  ...extra
});

test('out-of-sample scoring rejects overlapping training data',()=>{
  assert.throws(()=>scoreOutOfSample({
    trainRows:[row(10,1),row(30,1)],
    testRows:[row(20,1)]
  }),/leakage/i);
});

test('positive mature training evidence selects later matching opportunities',()=>{
  const train=[];
  for(let i=0;i<80;i++)train.push(row(i+1,.4));
  const testRows=[row(100,.5),row(101,-1)];
  const r=scoreOutOfSample({trainRows:train,testRows,evidenceOptions:{
    shrinkageSamples:20,minReliableSamples:20,minStableWindows:2,tradeEdgeR:.10,cautionEdgeR:.02,skipEdgeR:-.08,maxAbsEdgeR:1.5
  }});
  assert.equal(r.scored[0].evaluation.decision,'TRADE');
  assert.equal(r.marketCapture.traded,2);
  assert.equal(r.marketCapture.coveragePct,100);
});

test('negative mature training evidence can avoid later losers and exposes avoided R',()=>{
  const train=[];
  for(let i=0;i<80;i++)train.push(row(i+1,-.4));
  const testRows=[row(100,-1),row(101,-.5)];
  const r=scoreOutOfSample({trainRows:train,testRows,evidenceOptions:{
    shrinkageSamples:20,minReliableSamples:20,minStableWindows:2,tradeEdgeR:.10,cautionEdgeR:.02,skipEdgeR:-.05,maxAbsEdgeR:1.5
  }});
  assert.equal(r.scored[0].evaluation.decision,'SKIP');
  assert.equal(r.marketCapture.traded,0);
  assert.equal(r.marketCapture.avoidedLoserR,1.5);
  assert.equal(r.marketCapture.opportunityCostR,-1.5);
});

test('expanding walk-forward trains only on observations before each test slice',()=>{
  const rows=[];
  for(let i=0;i<100;i++)rows.push(row(i*1000,i%3===0?1:-.2));
  const r=expandingWalkForward(rows,{slices:5});
  assert.equal(r.method,'EXPANDING_TRAIN_STRICTLY_BEFORE_TEST');
  assert.ok(r.slices.length>=3);
  for(const s of r.slices)assert.ok(s.trainEnd<s.testStart);
  assert.equal(r.aggregate.marketCapture.opportunities,r.slices.reduce((a,s)=>a+s.marketCapture.opportunities,0));
});
