import test from 'node:test';
import assert from 'node:assert/strict';
import {pullbackCandidate,triggerFromPullback,initialStop,newPosition,exitEvents,applyEvent,atrTrail,aggregateRisk,canOpen} from '../research/paper-edge-v1-state-machine.js';

test('pullback requires aligned EMA and does not trigger same bar',()=>{const p={warm:true,ema20:105,ema50:100,low:104,close:106,high:108};assert.equal(pullbackCandidate(p,'LONG'),true);assert.equal(triggerFromPullback(p,{close:109},'LONG',0),false);assert.equal(triggerFromPullback(p,{close:109},'LONG',1),true)});
test('trigger expires after three completed bars',()=>assert.equal(triggerFromPullback({high:100},{close:101},'LONG',4),false));
test('stop uses farther swing or 1.5 ATR',()=>{assert.equal(initialStop({side:'LONG',entry:100,pullback:{low:97},atr14:4}),94);assert.equal(initialStop({side:'SHORT',entry:100,pullback:{high:103},atr14:4}),106)});
test('position risks exactly half percent',()=>{const p=newPosition({side:'LONG',entry:100,stop:95,equity:10000});assert.equal(p.qty,10);assert.equal(p.tp1,105);assert.equal(p.tp2,110)});
test('same bar stop wins before targets',()=>{const p=newPosition({side:'LONG',entry:100,stop:95,equity:10000});assert.equal(exitEvents(p,{low:94,high:111})[0].type,'STOP')});
test('TP1-activated break-even stop wins over same-bar TP2 ambiguity',()=>{
 const long=newPosition({side:'LONG',entry:100,stop:95,equity:10000});
 assert.deepEqual(exitEvents(long,{open:101,low:99,high:111}),[{type:'TP1',fraction:.33},{type:'BREAKEVEN_STOP',fraction:.67}]);
 const short=newPosition({side:'SHORT',entry:100,stop:105,equity:10000});
 assert.deepEqual(exitEvents(short,{open:99,low:89,high:101}),[{type:'TP1',fraction:.33},{type:'BREAKEVEN_STOP',fraction:.67}]);
});
test('TP2 remains valid in the TP1 bar when the new break-even stop is not touched',()=>{
 const p=newPosition({side:'LONG',entry:100,stop:95,equity:10000});
 assert.deepEqual(exitEvents(p,{open:101,low:101,high:111}),[{type:'TP1',fraction:.33},{type:'TP2',fraction:.33}]);
});
test('TP1 moves stop to break even',()=>{let p=newPosition({side:'LONG',entry:100,stop:95,equity:10000});p=applyEvent(p,{type:'TP1',fraction:.33});assert.equal(p.stop,100);assert.ok(Math.abs(p.remaining-.67)<1e-12)});
test('ATR trail only tightens after TP2',()=>{let p=newPosition({side:'LONG',entry:100,stop:95,equity:10000});assert.equal(atrTrail(p,{close:120},5).stop,95);p={...p,tp2Done:true};assert.equal(atrTrail(p,{close:120},5).stop,110)});
test('aggregate risk cap blocks fourth half-percent slot',()=>{const p=newPosition({side:'LONG',entry:100,stop:95,equity:10000});assert.equal(canOpen([p,p],10000),true);assert.equal(canOpen([p,p,p],10000),false)});
test('break-even and profitable trailing stops do not count as loss risk',()=>{
 const long={symbol:'BTCUSDT',side:'LONG',entry:100,stop:110,qty:10,remaining:.34};
 const short={symbol:'ETHUSDT',side:'SHORT',entry:100,stop:90,qty:10,remaining:.34};
 assert.equal(aggregateRisk([long,short]),0);
 assert.equal(canOpen([long,short],10000,'SOLUSDT'),true);
});
test('aggregate risk scales with remaining position quantity',()=>{
 const long={symbol:'BTCUSDT',side:'LONG',entry:100,stop:95,qty:10,remaining:.5};
 assert.equal(aggregateRisk([long]),25);
});
