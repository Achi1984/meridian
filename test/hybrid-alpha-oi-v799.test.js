import test from 'node:test';
import assert from 'node:assert/strict';
import {oiChangeAt,relativeOiState,applyRelativeOiExpansion} from '../hybrid-alpha-oi-v799.js';
const H=3600000,symbols=['A','B','C','D','E','F','G'];
const make=(mult=1)=>Array.from({length:26},(_,i)=>({time:i*H,oiUsd:100*(i===25?mult:1)}));
test('hourly OI is unavailable until its interval closes',()=>{const x=oiChangeAt(make(2),25*H+H-1);assert.equal(x.change,0);const y=oiChangeAt(make(2),26*H);assert.equal(y.change,1)});
test('cross-sectional expansion uses all seven assets',()=>{const by=Object.fromEntries(symbols.map((s,i)=>[s,make(i===0?2:1)])),x=relativeOiState('A',by,26*H,symbols);assert.equal(x.available,true);assert.ok(x.z>=1.5)});
test('missing peer evidence causes no attenuation',()=>{const by=Object.fromEntries(symbols.slice(0,6).map(s=>[s,make(1)])),row={timestamp:new Date(26*H).toISOString(),symbol:'A',riskMultiplier:.5,grossR:1,costR:.03,netR:.97},x=applyRelativeOiExpansion(row,by,symbols);assert.equal(x.oiEvidenceAvailable,false);assert.equal(x.riskMultiplier,.5)});
test('relative expansion only reduces risk and keeps row',()=>{const by=Object.fromEntries(symbols.map((s,i)=>[s,make(i===0?2:1)])),row={timestamp:new Date(26*H).toISOString(),symbol:'A',riskMultiplier:.5,grossR:1,costR:.03,netR:.97},x=applyRelativeOiExpansion(row,by,symbols);assert.equal(x.riskMultiplier,.3);assert.equal(x.oiRiskFactor,.6);assert.ok(x.riskMultiplier<=row.riskMultiplier)});
