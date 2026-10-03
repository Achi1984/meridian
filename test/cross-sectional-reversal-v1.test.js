'use strict';
const assert=require('assert');
const r=require('../research/cross-sectional-reversal-v1');

assert.deepStrictEqual(r.ranks([30,10,20]),[3,1,2]);
assert.deepStrictEqual(r.ranks([10,10,20]),[1.5,1.5,3]);
assert(Math.abs(r.spearman([1,2,3],[3,2,1])+1)<1e-12);

const anchor=Date.UTC(2026,0,3), m={};
r.ASSETS.forEach((asset,i)=>{
  const s=new Map(), base=100+i;
  s.set(anchor-8*r.WEEK_MS,base);
  s.set(anchor,base*(1+(i-6)*0.01));
  // make prior losers become forward winners
  s.set(anchor+r.WEEK_MS,s.get(anchor)*(1-(i-6)*0.01));
  m[asset]=s;
});
const w=r.validateAnchor(m,anchor);
assert(w.ic>0.99,'reversal IC should be strongly positive');
assert(w.spread>0,'loser-minus-winner spread should be positive');

const broken={...m,[r.ASSETS[0]]:new Map(m[r.ASSETS[0]])};
broken[r.ASSETS[0]].delete(anchor+r.WEEK_MS);
assert.throws(()=>r.validateAnchor(broken,anchor),/INCOMPLETE_ANCHOR/);

const good=Array.from({length:25},(_,i)=>({anchorMs:i,ic:0.1+i*0.0001,spread:0.01+i*0.00001}));
const summary=r.summarize(good);
assert.strictEqual(summary.decision,'REVERSAL_V1_FEATURE_PASS_STRATEGY_DESIGN_ALLOWED');
assert.strictEqual(summary.metrics.positiveIcBlocks,5);
assert.strictEqual(summary.metrics.positiveSpreadBlocks,5);

const mixed=Array.from({length:25},(_,i)=>({anchorMs:i,ic:i%2?0.1:-0.2,spread:i%2?0.01:-0.02}));
assert.strictEqual(r.summarize(mixed).decision,'REVERSAL_V1_FEATURE_FAIL_RESEARCH_STOP');

console.log('Cross-Sectional Reversal V1 synthetic invariants: PASS');
