import test from 'node:test';import assert from 'node:assert/strict';import {validateReplayTrade,conservativeStopFill,replayClosedTrade,summarizeReplay} from '../research/paper-execution-v2-replay.js';
const base={id:'x',side:'LONG',entry:100,qty:2,sl:90,tp1:110,openedAt:'2026-01-01T00:00:00Z',closedAt:'2026-01-01T01:00:00Z',exit:90};
test('validates stop geometry',()=>assert.deepEqual(validateReplayTrade({...base,sl:101}),['STOP_WRONG_SIDE']));
test('fills LONG gap through stop at worse open',()=>assert.equal(conservativeStopFill(base,{open:85,high:92,low:80}),85));
test('fills SHORT gap through stop at worse open',()=>assert.equal(conservativeStopFill({...base,side:'SHORT',sl:110},{open:115,high:120,low:108}),115));
test('same-bar SL/TP is conservative stop-first and flagged',()=>{const r=replayClosedTrade(base,[{openTime:'2026-01-01T00:00:00Z',open:100,high:112,low:88}],{feeBps:0,slippageBps:0});assert.equal(r.replayExit,90);assert.equal(r.sameBarAmbiguous,true);assert.equal(r.netR,-1)});
test('costs worsen normalized R exactly once',()=>{const r=replayClosedTrade(base,[{openTime:'2026-01-01T00:30:00Z',open:100,high:101,low:89}],{feeBps:5,slippageBps:3});assert.ok(r.netR<-1);assert.ok(r.costR>0)});
test('summary reports coverage and stop overruns',()=>{const s=summarizeReplay([{eligible:true,netR:-1.3,sameBarAmbiguous:true,gapThrough:true},{eligible:false}]);assert.equal(s.coveragePct,50);assert.equal(s.stopWorseThan1_25R,1);assert.equal(s.gapThrough,1)});
