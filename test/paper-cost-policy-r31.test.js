import test from 'node:test';
import assert from 'node:assert/strict';
import {costAwareSize} from '../paper-cost-policy.js';
for(const side of ['LONG','SHORT'])test(`${side}: fees and expected stop slippage fit the net risk budget`,()=>{
 const x=costAwareSize({entry:100,sl:side==='LONG'?99:101,side,equity:10000,riskPct:.25,feeBps:5,slippageBps:3,tp1:side==='LONG'?102:98});
 assert.equal(x.plannedRiskBudgetUsd,25);assert.ok(Math.abs(x.plannedStopLossUsd+x.plannedFeesAtStopUsd-25)<1e-9);assert.ok(x.qty<25);assert.ok(x.expectedTargetNetUsd>0);
});
test('higher costs reduce size instead of raising risk',()=>{
 const p={entry:100,sl:99,side:'LONG',equity:10000,riskPct:.25};
 assert.ok(costAwareSize({...p,feeBps:10}).qty<costAwareSize({...p,feeBps:5}).qty);
});
test('zero cost equals price-only sizing and bad inputs are rejected',()=>{
 const p={entry:100,sl:90,side:'LONG',equity:10000,riskPct:.25,feeBps:0,slippageBps:0};
 assert.equal(costAwareSize(p).qty,2.5);
 for(const bad of [{sl:110},{equity:0},{riskPct:NaN},{feeBps:-1},{slippageBps:10000}])assert.throws(()=>costAwareSize({...p,...bad}));
});
test('tiny target is reported net-negative; risk budget does not guarantee gap fills',()=>{
 const x=costAwareSize({entry:100,sl:99,side:'LONG',equity:10000,riskPct:.25,tp1:100.01});
 assert.ok(x.expectedTargetNetUsd<0);
 const gapPriceLoss=x.qty*(100-98);assert.ok(gapPriceLoss>x.plannedRiskBudgetUsd);
});
