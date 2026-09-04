import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInteractionEvidence } from '../context-interaction-evidence.js';
import { evaluateInteractionFamily, expandingFamilyWalkForward, runInteractionFamilyAblation } from '../interaction-family-ablation.js';

const DAY=86400000;
const obs=(extra={})=>({side:'LONG',regime:'BULL',mtfAlignment:'2',momentum:'NEUTRAL',volume:'NORMAL',volatility:'COMPRESSION',asset:'AAAUSDT',baselineStatus:'READY',...extra});
const row=(ts,realizedR,extra={})=>({ts,realizedR,observations:obs(extra)});

function training(start,n=720){
  const rows=[];
  for(let i=0;i<n;i++){
    const normal=i%3===0;
    rows.push(row(start+i*3*60*60000,normal?.35:-.5,{volatility:normal?'NORMAL':'COMPRESSION',mtfAlignment:i%2?'2':'1',momentum:i%4===0?'STRONG':'NEUTRAL'}));
  }
  return rows;
}

test('family evaluator only reads the requested interaction family',()=>{
  const start=Date.UTC(2026,0,1),rows=training(start),windows=[{id:'W1',start,end:start+30*DAY-1},{id:'W2',start:start+30*DAY,end:start+60*DAY-1},{id:'W3',start:start+60*DAY,end:start+90*DAY-1}];
  const map=buildInteractionEvidence(rows,windows);
  const e=evaluateInteractionFamily(obs({volatility:'NORMAL'}),map,'SIDE_REGIME_VOLATILITY');
  assert.equal(e.specId,'SIDE_REGIME_VOLATILITY');
  assert.ok(e.component);
  assert.ok(e.residualR>0);
});

test('unknown family is rejected instead of silently searching combinations',()=>{
  assert.throws(()=>evaluateInteractionFamily(obs(),{},'MADE_UP_FAMILY'),/Unknown interaction family/);
});

test('family walk-forward keeps train strictly before test and exposes coverage',()=>{
  const start=Date.UTC(2026,0,1),rows=training(start,900);
  const r=expandingFamilyWalkForward(rows,'SIDE_REGIME_VOLATILITY',{slices:5});
  assert.ok(r.slices.length>=3);
  for(const s of r.slices)assert.ok(s.trainEnd<s.testStart);
  assert.ok(Number.isFinite(r.aggregate.marketCapture.coveragePct));
});

test('ablation returns exactly the predefined six families',()=>{
  const start=Date.UTC(2026,0,1),r=runInteractionFamilyAblation(training(start,900),{slices:5});
  assert.equal(Object.keys(r.families).length,6);
  assert.equal(r.ranking.length,6);
  assert.ok(r.ranking.some(x=>x.specId==='SIDE_REGIME_VOLATILITY'));
});
