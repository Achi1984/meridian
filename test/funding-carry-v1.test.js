import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFundingCarry,FUNDING_CARRY_V1_RULESET} from '../funding-carry-v1.js';

test('delta-neutral carry combines funding, basis and four execution legs',()=>{
  const x=evaluateFundingCarry({symbol:'BTCUSDT',notional:10000,feeBps:5,slippageBps:3,start:0,end:100,
    spot:[{ts:0,close:100},{ts:100,close:110}],perp:[{ts:0,close:101},{ts:100,close:110}],
    funding:[{ts:50,markPrice:105,fundingRate:.001},{ts:100,markPrice:110,fundingRate:.001}]});
  assert.equal(x.fundingIncome,21.5);
  assert.equal(x.basisPnl,100);
  assert.equal(x.costs,33.68);
  assert.equal(x.netPnl,87.82);
  assert.equal(x.eligible,true);
  assert.equal(x.ruleset,FUNDING_CARRY_V1_RULESET);
});

test('negative net carry is rejected and missing overlap is not fabricated',()=>{
  const x=evaluateFundingCarry({notional:10000,feeBps:5,slippageBps:3,start:0,end:100,
    spot:[{ts:0,close:100},{ts:100,close:100}],perp:[{ts:0,close:100},{ts:100,close:100}],funding:[{ts:100,markPrice:100,fundingRate:-.001}]});
  assert.equal(x.decision,'REJECT');
  assert.equal(x.netPnl,-42);
  assert.equal(evaluateFundingCarry({spot:[],perp:[],funding:[]}).reasons[0],'INSUFFICIENT_COMMON_HISTORY');
});
