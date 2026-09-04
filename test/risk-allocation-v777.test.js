import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveChronologicalRiskPolicy, riskAllocationForRow, V777_CONFIG } from '../risk-allocation-v777.js';

function row({r=1.2,vol=1.3,side='LONG',regime='BULL'}={}){
  const f={price:100,ema20:99,ema50:98,rsi:60,macdHist:1,atr:1.2,adx:24,volumeRatio:vol};
  return {side,regime,baselineStatus:'READY',candidate:76,technical:75,outcomeR:r,entry:100,frames:{'15m':f,'1h':f,'4h':f}};
}

function trainingPeriod(){
  const rows=[];
  for(let i=0;i<24;i++)rows.push(row({r:1.2,vol:1.3}));
  for(let i=0;i<24;i++)rows.push(row({r:-1,vol:.9}));
  return rows;
}

test('v7.77 policy only keeps contexts positive in every training period with positive capture efficiency',()=>{
  const policy=deriveChronologicalRiskPolicy({P3:trainingPeriod(),P2:trainingPeriod()},{minSamples:20});
  assert.ok(policy.cells.some(c=>c.key==='LONG×BULL|VOLUME_HIGH'));
  assert.ok(!policy.cells.some(c=>c.key==='LONG×BULL|VOLUME_NORMAL'));
  assert.equal(policy.researchOnly,true);
  assert.equal(policy.executionImpact,false);
});

test('risk allocation boosts only matching reliable contexts and remains bounded',()=>{
  const policy={config:{...V777_CONFIG},cells:[{key:'LONG×BULL|VOLUME_HIGH'}]};
  const boosted=riskAllocationForRow(row({vol:1.3}),policy);
  const base=riskAllocationForRow(row({vol:.9}),policy);
  assert.equal(boosted.riskPct,0.275);
  assert.equal(boosted.matchCount,1);
  assert.equal(base.riskPct,0.25);
  const many={config:{...V777_CONFIG},cells:['EVIDENCE_HIGH','MTF_3/3','VOLUME_HIGH','MOMENTUM_SUPPORTIVE','VOLATILITY_HIGH'].map(bucket=>({key:`LONG×BULL|${bucket}`}))};
  assert.ok(riskAllocationForRow(row({vol:1.3}),many).riskPct<=0.35);
});
