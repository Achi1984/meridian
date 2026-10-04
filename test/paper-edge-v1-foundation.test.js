import test from 'node:test';import assert from 'node:assert/strict';
import {aggregateDaily,dailyContextForTrigger,splitEdgeV1,fundingCoverage,executionCost,conservativeFill,sameBarDecision} from '../research/paper-edge-v1-foundation.js';
const h=(t,o=100,hi=110,l=90,c=105)=>({openTime:t,open:o,high:hi,low:l,close:c,closeTime:t+14399999,volume:1});
test('daily context never leaks current trigger day',()=>{const rows=[h(0),h(14400000),h(28800000),h(43200000),h(57600000),h(72000000),h(86400000)];const d=aggregateDaily(rows);assert.equal(d.length,2);assert.equal(dailyContextForTrigger(d,86400000).openTime,0)});
test('split is frozen 60 20 20',()=>{const s=splitEdgeV1([...Array(100)].map((_,i)=>i));assert.equal(s.discovery.count,60);assert.equal(s.validation.count,20);assert.equal(s.holdout.count,20)});
test('funding fails closed when absent',()=>assert.equal(fundingCoverage([],0,10).ok,false));
test('cost is charged exactly as declared',()=>assert.equal(executionCost(10000,{feeBps:5,slippageBps:3}),8));
test('gap stop uses worse open both sides',()=>{assert.equal(conservativeFill({side:'LONG',stop:95},{open:90}),90);assert.equal(conservativeFill({side:'SHORT',stop:105},{open:110}),110)});
test('same bar ambiguity is stop first',()=>assert.equal(sameBarDecision({stopTouched:true,targetTouched:true}),'STOP'));
