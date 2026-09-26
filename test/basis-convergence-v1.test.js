import test from 'node:test';
import assert from 'node:assert/strict';
import {BASIS_CONVERGENCE_V1 as C,entryExecution,exitExecution,selectBasisCandidate} from '../basis-convergence-v1.js';

test('frozen Basis Convergence V1 contract stays fixed',()=>{
  assert.deepEqual(C.symbols,['BTCUSDT','ETHUSDT','SOLUSDT']);
  assert.equal(C.entryBasisPct,.75);
  assert.equal(C.exitBasisPct,.10);
  assert.equal(C.maxBasisWideningPct,1);
  assert.equal(C.maxMarkedLossUsd,200);
  assert.equal(C.maxHoldMs,14*24*3600000);
  assert.equal(C.spotFeeRate,.001);
  assert.equal(C.perpFeeRate,.0005);
  assert.equal(C.slippageRate,.0003);
});
test('basis uses adverse executable slippage references',()=>{
  const e=entryExecution(100,101);
  assert.ok(e.spotAsk>100);
  assert.ok(e.perpBid<101);
  const x=exitExecution(100,101);
  assert.ok(x.spotBid<100);
  assert.ok(x.perpAsk>101);
});
test('selector takes highest qualifying basis with deterministic tie break',()=>{
  const x=selectBasisCandidate([
    {symbol:'SOLUSDT',basisPct:.9},{symbol:'ETHUSDT',basisPct:1.1},{symbol:'BTCUSDT',basisPct:1.1}
  ]);
  assert.equal(x.symbol,'BTCUSDT');
  assert.equal(selectBasisCandidate([{symbol:'ETHUSDT',basisPct:.7}]),null);
});
