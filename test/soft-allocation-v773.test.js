import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreV773, compareSignalSelection } from '../soft-allocation-v773.js';

test('LONG RANGE receives only a soft +0.5 bonus',()=>{
  const row={side:'LONG',regime:'RANGE',baselineStatus:'READY',frames:{'15m':{volumeRatio:1.2,adx:20,rsi:54}}};
  const s=scoreV773(row);
  assert.equal(s.allocationBonus,0.5);
  assert.equal(s.evidenceScore,s.baseEvidenceScore+0.5);
});

test('non LONG RANGE receives no allocation bonus',()=>{
  const row={side:'SHORT',regime:'RANGE',baselineStatus:'READY',frames:{'15m':{volumeRatio:1.2,adx:20,rsi:54}}};
  const s=scoreV773(row);
  assert.equal(s.allocationBonus,0);
});

test('selection comparison preserves equal coverage',()=>{
  const rows=[];
  for(let i=0;i<20;i++)rows.push({sampledAt:`2026-01-${String(i+1).padStart(2,'0')}T00:00:00Z`,symbol:`X${i}`,side:i%2?'LONG':'SHORT',regime:i%3?'RANGE':'BEAR',baselineStatus:i<10?'READY':'NO_SETUP',outcomeR:i%4===0?-1:1,frames:{'15m':{volumeRatio:1.2,adx:20,rsi:54}}});
  const x=compareSignalSelection(rows);
  assert.equal(x.equalCoverage,true);
  assert.equal(x.v32.samples,x.v773.samples);
});
