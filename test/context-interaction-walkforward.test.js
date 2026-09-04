import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreInteractionOutOfSample, expandingInteractionWalkForward } from '../context-interaction-walkforward.js';

const DAY=86400000;
const obs=(extra={})=>({side:'LONG',regime:'RANGE',mtfAlignment:'2',momentum:'NEUTRAL',volume:'NORMAL',volatility:'NORMAL',asset:'AAAUSDT',baselineStatus:'READY',...extra});
const row=(ts,realizedR,extra={})=>({ts,realizedR,observations:obs(extra)});

test('interaction OOS scorer rejects train/test overlap',()=>{
  const t=Date.UTC(2026,0,1);
  assert.throws(()=>scoreInteractionOutOfSample({trainRows:[row(t,1),row(t+DAY,-1)],testRows:[row(t+DAY,1)]}),/leakage/i);
});

test('interaction OOS scorer can select a later context learned only from prior rows',()=>{
  const t=Date.UTC(2026,0,1),train=[];
  for(let i=0;i<480;i++){
    const good=i%2===0;
    train.push(row(t+i*3*60*60000,good?.45:-.6,{mtfAlignment:good?'3':'1',momentum:good?'STRONG':'WEAK',volatility:good?'NORMAL':'COMPRESSION'}));
  }
  const testStart=train.at(-1).ts+DAY,test=[];
  for(let i=0;i<20;i++)test.push(row(testStart+i*3*60*60000,.35,{mtfAlignment:'3',momentum:'STRONG',volatility:'NORMAL'}));
  const r=scoreInteractionOutOfSample({trainRows:train,testRows:test});
  assert.ok(r.scored.every(x=>x.evaluation.components.length>0));
  assert.ok(r.scored.some(x=>x.traded));
  assert.ok(r.marketCapture.coveragePct>0);
});

test('expanding interaction walk-forward preserves strict train-before-test order',()=>{
  const t=Date.UTC(2026,0,1),rows=[];
  for(let i=0;i<800;i++){
    const good=i%2===0;
    rows.push(row(t+i*3*60*60000,good?.4:-.5,{mtfAlignment:good?'3':'1',momentum:good?'STRONG':'WEAK',volatility:good?'NORMAL':'COMPRESSION'}));
  }
  const r=expandingInteractionWalkForward(rows,{slices:5});
  assert.ok(r.slices.length>=3);
  for(const s of r.slices)assert.ok(s.trainEnd<s.testStart);
  assert.ok(Number.isFinite(r.aggregate.marketCapture.coveragePct));
});
