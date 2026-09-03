import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeSideRegime } from '../side-regime-v771.js';

function row(i,{side='LONG',regime='TREND',ready=false,r=0,volume15='>=1.5',adx15='<18'}={}){
  return {sampledAt:`2026-01-01T00:${String(i).padStart(2,'0')}:00Z`,symbol:`X${i}`,side,regime,baselineStatus:ready?'READY':'NO_SETUP',outcomeR:r,volume15,adx15,candidate:50+i,technical:40+i};
}

test('v7.71 preserves equal coverage and emits side/regime cells',()=>{
  const rows=[
    row(1,{side:'LONG',regime:'TREND',ready:true,r:-1}),
    row(2,{side:'SHORT',regime:'TRANSITION',ready:true,r:-1,volume15:'0.65-1',adx15:'18-25'}),
    row(3,{side:'LONG',regime:'TREND',r:1}),
    row(4,{side:'SHORT',regime:'TRANSITION',r:1,volume15:'0.65-1',adx15:'18-25'}),
  ];
  const out=attributeSideRegime(rows);
  assert.equal(out.baselineCount,2);
  assert.equal(out.challengerCount,2);
  assert.equal(out.equalCoverage,true);
  assert.ok(Object.keys(out.cells).length>=1);
  assert.equal(out.researchOnly,true);
  assert.equal(out.executionImpact,false);
});
