import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEthFundingHoldout,classifyEthFundingHoldout,ETH_FUNDING_HOLDOUT_CONFIG} from '../funding-carry-eth-holdout.js';

const start=ETH_FUNDING_HOLDOUT_CONFIG.start,end=start+2*86400000;
const spot=[{ts:start,close:2000},{ts:end,close:2100}],perp=[{ts:start,close:2002},{ts:end,close:2102}];

test('ETH holdout charges separate spot/perp fees plus four-leg slippage',()=>{
  const funding=[{ts:start+8*3600000,rate:.001,markPrice:2050},{ts:start+16*3600000,rate:.001,markPrice:2050}];
  const x=evaluateEthFundingHoldout({spot,perp,funding,start,end,notionalPerLeg:10000,spotFeeBps:10,perpFeeBps:5,slippageBps:3});
  assert.equal(x.periods,2);
  assert.ok(x.costs>0);
  assert.ok(x.fundingIncome>0);
  assert.equal(x.researchOnly,true);
  assert.equal(x.executionImpact,false);
});

test('positive full holdout cannot pass when a frozen calendar block loses',()=>{
  const c=classifyEthFundingHoldout(
    {netPnl:100,decision:'POSITIVE_HOLDOUT'},
    [{label:'2024',netPnl:20,decision:'POSITIVE_HOLDOUT'},{label:'2025',netPnl:-1,decision:'REJECT'}]
  );
  assert.equal(c.paperCandidate,false);
  assert.equal(c.decision,'WATCH');
});

test('paper candidacy requires full holdout and every frozen block positive',()=>{
  const c=classifyEthFundingHoldout(
    {netPnl:100,decision:'POSITIVE_HOLDOUT'},
    [{label:'2024',netPnl:20,decision:'POSITIVE_HOLDOUT'},{label:'2025',netPnl:30,decision:'POSITIVE_HOLDOUT'}]
  );
  assert.equal(c.paperCandidate,true);
  assert.equal(c.decision,'PAPER_CANDIDATE');
});
