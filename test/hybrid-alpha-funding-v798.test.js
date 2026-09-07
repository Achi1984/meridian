import test from 'node:test';
import assert from 'node:assert/strict';
import {fundingStateAt,fundingCrowdingFactor,applyFundingCrowding} from '../hybrid-alpha-funding-v798.js';

const series=Array.from({length:30},(_,i)=>({time:i*1000,rate:i===29?.02:0}));
test('funding state uses no observation after decision time',()=>{const withFuture=[...series,{time:31000,rate:-99}],x=fundingStateAt(withFuture,29000);assert.equal(x.latestTime,29000);assert.ok(x.z>=2)});
test('only direction-aligned extreme crowding attenuates',()=>{const positive={available:true,z:3};assert.equal(fundingCrowdingFactor('LONG',positive),.6);assert.equal(fundingCrowdingFactor('SHORT',positive),1);assert.equal(fundingCrowdingFactor('LONG',{available:true,z:1.99}),1)});
test('missing history leaves incoming risk and opportunity intact',()=>{const row={timestamp:new Date(10000).toISOString(),side:'LONG',riskMultiplier:.5,grossR:1,costR:.03,netR:.97},x=applyFundingCrowding(row,series.slice(0,10));assert.equal(x.riskMultiplier,.5);assert.equal(x.netR,.97);assert.equal(x.fundingRiskFactor,1)});
test('attenuation never increases incoming risk',()=>{const row={timestamp:new Date(29000).toISOString(),side:'LONG',riskMultiplier:.5,grossR:1,costR:.03,netR:.97},x=applyFundingCrowding(row,series);assert.equal(x.riskMultiplier,.3);assert.ok(x.riskMultiplier<=row.riskMultiplier)});
