import test from 'node:test';
import assert from 'node:assert/strict';
import {takerImbalanceAt,relativeTakerState,applyTakerOpposition} from '../hybrid-alpha-taker-v7100.js';
const H=3600000,symbols=['A','B','C','D','E','F','G'],make=(bias=0)=>Array.from({length:24},(_,i)=>({time:i*H,buy:100+bias,sell:100-bias}));
test('hourly flow is unavailable before the current interval closes',()=>{assert.equal(takerImbalanceAt(make(20),24*H-1),null);assert.ok(takerImbalanceAt(make(20),24*H).imbalance>0)});
test('cross-section identifies relative sell pressure',()=>{const by=Object.fromEntries(symbols.map((s,i)=>[s,make(i===0?-80:0)])),x=relativeTakerState('A',by,24*H,symbols);assert.equal(x.available,true);assert.ok(x.z<=-1.5)});
test('opposition is direction-aware',()=>{const by=Object.fromEntries(symbols.map((s,i)=>[s,make(i===0?-80:0)])),base={timestamp:new Date(24*H).toISOString(),symbol:'A',riskMultiplier:.5,grossR:1,costR:.03,netR:.97},long=applyTakerOpposition({...base,side:'LONG'},by,symbols),short=applyTakerOpposition({...base,side:'SHORT'},by,symbols);assert.equal(long.riskMultiplier,.3);assert.equal(short.riskMultiplier,.5)});
test('missing peer flow leaves risk unchanged',()=>{const by=Object.fromEntries(symbols.slice(0,6).map(s=>[s,make()])),row={timestamp:new Date(24*H).toISOString(),symbol:'A',side:'LONG',riskMultiplier:.5,grossR:1,costR:.03,netR:.97},x=applyTakerOpposition(row,by,symbols);assert.equal(x.takerEvidenceAvailable,false);assert.equal(x.riskMultiplier,.5)});
