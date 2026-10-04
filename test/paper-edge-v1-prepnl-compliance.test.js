import test from 'node:test';import assert from 'node:assert/strict';
import {canOpen,fundingCashflow,nextBarEntry,oppositeRegimeExit,pullbackCandidate,triggerFromPullback} from '../research/paper-edge-v1-state-machine.js';
test('ADX gate is required at pullback and trigger',()=>{const row={warm:true,adx14:19,ema20:2,ema50:1,low:1.5,close:2};assert.equal(pullbackCandidate(row,'LONG'),false);assert.equal(triggerFromPullback({high:2},{close:3,adx14:19},'LONG',1),false)});
test('one position per asset and exact aggregate 1.5 percent cap',()=>{const p=[{symbol:'BTCUSDT',entry:100,stop:99,qty:50,remaining:1},{symbol:'ETHUSDT',entry:100,stop:99,qty:50,remaining:1}];assert.equal(canOpen(p,10000,'BTCUSDT'),false);assert.equal(canOpen(p,10000,'SOLUSDT'),true)});
test('entry is next bar open',()=>assert.deepEqual(nextBarEntry(0,[{open:10},{open:11}]),{index:1,open:11}));
test('funding signs follow frozen contract',()=>{assert.equal(fundingCashflow({side:'LONG',qty:2,entryPrice:100,rate:.001}),-.2);assert.equal(fundingCashflow({side:'SHORT',qty:2,entryPrice:100,rate:.001}),.2)});
test('opposite completed regime requests exit',()=>assert.equal(oppositeRegimeExit({side:'LONG',remaining:.34},'LONG','SHORT'),true));
