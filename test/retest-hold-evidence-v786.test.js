import test from 'node:test';
import assert from 'node:assert/strict';
import {outcomeR,stats,retestHoldEvidenceReport} from '../retest-hold-evidence-v786.js';

test('fixed TP1 produces positive normalized R after costs',()=>{
  const sig={side:'LONG',entry:100,sl:99,tp1:101.5};
  const r=outcomeR(sig,[{high:101.6,low:99.5,close:101.5}],{feeBps:5,slippageBps:3});
  assert.equal(r.reason,'TP1');
  assert.ok(r.r>1.3&&r.r<1.5);
});

test('same candle SL and TP1 resolves conservatively to SL',()=>{
  const sig={side:'LONG',entry:100,sl:99,tp1:101.5};
  const r=outcomeR(sig,[{high:101.6,low:98.9,close:100.5}],{feeBps:0,slippageBps:0});
  assert.equal(r.reason,'SL');
  assert.equal(r.r,-1);
});

test('stats and report preserve research-only no-promotion guard',()=>{
  const rows=[
    {ts:100,symbol:'A',decision:'TRADE',side:'LONG',outcomeR:1.5},
    {ts:200,symbol:'B',decision:'TRADE',side:'SHORT',outcomeR:-1}
  ];
  const s=stats(rows);assert.equal(s.n,2);assert.equal(s.totalR,.5);assert.equal(s.pf,1.5);
  const r=retestHoldEvidenceReport(rows,{windowsDays:[1],dataEnd:1000});
  assert.equal(r.promotion.allowed,false);
  assert.equal(r.executionImpact,false);
});
