import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window={MERIDIAN_V8_CONFIG:{}};
const {tradeRiskDetails}=await import('../v8-clean/data.js');
test('risk decomposition distinguishes fees from price loss',()=>{
 const r=tradeRiskDetails({entry:100,sl:90,qty:2.5,realized:-32,feeOpen:1,feeClose:1,riskPct:.25});
 assert.equal(r.plannedRiskUsd,25);assert.equal(r.netR,-1.28);assert.equal(r.grossR,-1.2);assert.equal(r.feesUsd,2);
});
test('missing fields remain unknown and zero-distance stop has no R',()=>{
 const r=tradeRiskDetails({entry:100,sl:100,qty:1,realized:-32});
 assert.equal(r.plannedRiskUsd,null);assert.equal(r.netR,null);assert.equal(r.feesUsd,null);
 assert.equal(tradeRiskDetails({}).entry,null);
});
test('SHORT risk uses initial stop and actual size',()=>{
 assert.equal(tradeRiskDetails({entry:100,initialSl:110,sl:98,qty:3}).plannedRiskUsd,30);
});
