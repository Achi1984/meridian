import test from 'node:test';import assert from 'node:assert/strict';import {ELLIOTT_WAVE_V1 as C} from '../elliott-wave-bot-v1.js';
test('V2 imports the exact frozen V1 contract',()=>{assert.equal(C.pivotBars,3);assert.equal(C.noiseLookbackDays,30);assert.equal(C.noiseMultiple,2);assert.equal(C.wave2Min,.382);assert.equal(C.wave2Max,.786);assert.equal(C.target1,1);assert.equal(C.target2,1.618);assert.equal(C.costR,.05)});
test('replication period is disjoint from V1 primary',()=>{const end=Date.parse('2023-09-06T16:00:00Z');assert.equal(end,Date.parse(C.primaryStart))});
