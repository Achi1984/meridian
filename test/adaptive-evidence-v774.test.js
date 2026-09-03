import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreV774, comparePolicy } from '../adaptive-evidence-v774.js';

const frame={price:101,ema20:100,ema50:99,macdHist:1,volumeRatio:1.2,adx:24,rsi:54,atr:1};
const row={side:'LONG',regime:'RANGE',baselineStatus:'READY',frames:{'15m':frame,'1h':frame,'4h':frame}};

test('LONG RANGE with full MTF alignment gets adaptive bonus',()=>{
  const s=scoreV774(row,{policy:'LR_MTF3'});
  assert.equal(s.adaptiveBonus,0.5);
  assert.equal(s.evidenceScore,s.baseEvidenceScore+0.5);
});

test('volume-conditioned policy requires elevated 15m volume',()=>{
  const s=scoreV774(row,{policy:'LR_VOLUME'});
  assert.equal(s.adaptiveBonus,0.5);
  const low={...row,frames:{...row.frames,'15m':{...frame,volumeRatio:0.9}}};
  assert.equal(scoreV774(low,{policy:'LR_VOLUME'}).adaptiveBonus,0);
});

test('non LONG RANGE gets no adaptive bonus',()=>{
  const x={...row,side:'SHORT'};
  assert.equal(scoreV774(x,{policy:'LR_MTF3_VOLUME'}).adaptiveBonus,0);
});

test('policy comparison preserves equal signal coverage',()=>{
  const rows=[];
  for(let i=0;i<20;i++)rows.push({...row,sampledAt:`2026-01-${String(i+1).padStart(2,'0')}T00:00:00Z`,symbol:`X${i}`,baselineStatus:i<10?'READY':'NO_SETUP',outcomeR:i%4===0?-1:1});
  const x=comparePolicy(rows,'LR_MTF3_VOLUME');
  assert.equal(x.equalCoverage,true);
  assert.equal(x.base.samples,x.adaptive.samples);
});
