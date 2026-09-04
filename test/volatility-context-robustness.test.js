import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedContextRows, temporalBuckets, leaveOneAssetOut, robustnessSummary } from '../volatility-context-robustness.js';

const row=(ts,asset,r,key='LONG|TRANSITION|NORMAL')=>{const [side,regime,volatility]=key.split('|');return{ts,asset,realizedR:r,observations:{side,regime,volatility,asset}}};

test('fixed context isolates only the predeclared hypothesis',()=>{
  const rows=[row(1,'BTC',1),row(2,'ETH',-1,'SHORT|BEAR|NORMAL')];
  assert.equal(fixedContextRows(rows).length,1);
});

test('temporal buckets and leave-one-asset-out preserve attribution',()=>{
  const rows=[row(1,'BTC',1),row(2,'ETH',.5),row(3,'BTC',-.2),row(4,'SOL',.4)];
  assert.equal(temporalBuckets(rows,2).length,2);
  assert.equal(leaveOneAssetOut(rows).length,3);
});

test('robustness summary never enables promotion',()=>{
  const rows=Array.from({length:30},(_,i)=>row(i+1,['BTC','ETH','SOL'][i%3],i%5===0?-.2:.4));
  const r=robustnessSummary(rows,{temporalBuckets:5});
  assert.equal(r.promotion.allowed,false);
  assert.equal(r.context,'LONG|TRANSITION|NORMAL');
});
