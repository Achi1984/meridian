import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIndependentCells } from '../independent-cell-v772.js';

const mk=(side,regime,r,status='READY')=>({sampledAt:Math.random().toString(),symbol:'BTC',side,regime,outcomeR:r,baselineStatus:status,candidate:50,technical:50});

test('v7.72 remains research-only and does not promote',()=>{
  const periods={};
  for(const p of ['Q0','Q1','Q2','Q3']){
    const rows=[];
    for(let i=0;i<40;i++) rows.push(mk('SHORT','RANGE',i%2?1:-0.7));
    for(let i=0;i<40;i++) rows.push(mk('LONG','RANGE',i%2?0.8:-0.8));
    periods[p]=rows;
  }
  const out=validateIndependentCells(periods,{cells:['SHORT__RANGE'],minSamples:10,minPositivePeriods:3});
  assert.equal(out.researchOnly,true);
  assert.equal(out.executionImpact,false);
  assert.equal(out.promotionAllowed,false);
  assert.deepEqual(out.sourceCandidates,['SHORT__RANGE']);
  assert.equal(Array.isArray(out.validation.SHORT__RANGE.observations),true);
});
