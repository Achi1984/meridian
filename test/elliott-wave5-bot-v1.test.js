import test from 'node:test';import assert from 'node:assert/strict';import {ELLIOTT_WAVE5_V1 as C,runElliottWave5V1} from '../elliott-wave5-bot-v1.js';
const H4=14400000,bar=(p,i)=>({t:i*H4,o:p,h:p+.1,l:p-.1,c:p});
test('Wave-5 contract is frozen independently',()=>{assert.equal(C.pivotBars,3);assert.deepEqual(C.wave2,[.382,.786]);assert.equal(C.wave3MinWave1,1);assert.deepEqual(C.wave4,[.236,.5]);assert.deepEqual(C.targets,[.618,1]);assert.equal(C.costR,.05)});
test('engine is research only',()=>{const x=runElliottWave5V1([]);assert.equal(x.researchOnly,true);assert.equal(x.executionImpact,false)});
test('pivots need three right bars',()=>{const p=[10,9,8,7,8,9,10];assert.equal(runElliottWave5V1(p.slice(0,6).map(bar)).pivots,0);assert.equal(runElliottWave5V1(p.map(bar)).pivots,1)});
test('universe and periods are locked',()=>{assert.equal(C.symbols.length,7);assert.ok(Date.parse(C.primaryStart)<Date.parse(C.secondaryStart));assert.ok(Date.parse(C.secondaryYear2)<Date.parse(C.holdoutStart))});
test('invalid data cannot create a setup',()=>{assert.equal(runElliottWave5V1([{t:0,o:null,h:1,l:0,c:1}]).setups.length,0)});
