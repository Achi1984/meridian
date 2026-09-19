import test from 'node:test';import assert from 'node:assert/strict';import {ELLIOTT_WAVE_V1,runElliottWaveV1} from '../elliott-wave-bot-v1.js';
const H4=4*3600000;const bars=prices=>prices.map((p,i)=>({t:i*H4,o:p,h:p+.1,l:p-.1,c:p}));
test('contract freezes the single Wave-3 hypothesis',()=>{assert.equal(ELLIOTT_WAVE_V1.pivotBars,3);assert.equal(ELLIOTT_WAVE_V1.wave2Min,.382);assert.equal(ELLIOTT_WAVE_V1.wave2Max,.786);assert.equal(ELLIOTT_WAVE_V1.target2,1.618);assert.equal(ELLIOTT_WAVE_V1.costR,.05)});
test('engine remains research-only',()=>{const x=runElliottWaveV1([]);assert.equal(x.researchOnly,true);assert.equal(x.executionImpact,false)});
test('a pivot cannot exist before three right bars close',()=>{const p=[10,9,8,7,8,9,10],a=runElliottWaveV1(bars(p.slice(0,6))),b=runElliottWaveV1(bars(p));assert.equal(a.pivots,0);assert.equal(b.pivots,1)});
test('locked universe has seven assets and disjoint periods',()=>{assert.equal(ELLIOTT_WAVE_V1.symbols.length,7);assert.ok(Date.parse(ELLIOTT_WAVE_V1.primaryStart)<Date.parse(ELLIOTT_WAVE_V1.secondaryStart));assert.ok(Date.parse(ELLIOTT_WAVE_V1.secondaryYear2)<Date.parse(ELLIOTT_WAVE_V1.holdoutStart))});
test('empty or invalid input cannot fabricate trades',()=>{const x=runElliottWaveV1([{t:0,o:null,h:1,l:0,c:1}]);assert.equal(x.closed.length,0);assert.equal(x.setups.length,0)});
