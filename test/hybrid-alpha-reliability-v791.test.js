import test from 'node:test';
import assert from 'node:assert/strict';
import {runReliabilityRouterBacktest} from '../hybrid-alpha-reliability-v791.js';

const row=(day,forwardR,features,symbol='BTCUSDT')=>({timestamp:`2026-01-${String(day).padStart(2,'0')}T00:00:00Z`,symbol,forwardR,features});
const long={regime:'BULL',trend:.9,momentum:.8,relativeStrength:.6,volatilityRatio:1,liquidityQuality:1};

test('router remains research-only and never exceeds base V1 risk',()=>{
  const xs=Array.from({length:12},(_,i)=>row(i+1,i<10?-1:1,long));
  const out=runReliabilityRouterBacktest(xs,{horizonMs:24*3600000,minSamples:3,priorStrength:1,costR:0});
  assert.equal(out.researchOnly,true);
  assert.equal(out.executionImpact,false);
  assert.equal(out.schemaVersion,'7.91-HYBRID-RELIABILITY-V1');
  assert.ok(out.rows.every(r=>r.riskMultiplier<=r.baseRisk));
  assert.ok(out.rows.some(r=>r.reliability<1));
});

test('unmatured outcomes are not used for current reliability',()=>{
  const xs=[row(1,-2,long),row(2,-2,long),row(3,-2,long),row(4,1,long)];
  const out=runReliabilityRouterBacktest(xs,{horizonMs:10*24*3600000,minSamples:1,priorStrength:1});
  assert.ok(out.rows.every(r=>r.reliability===1));
});

test('poor historical cohort attenuates rather than hard-blocks trades',()=>{
  const xs=Array.from({length:10},(_,i)=>row(i+1,-1,long,'ETHUSDT'));
  const out=runReliabilityRouterBacktest(xs,{horizonMs:24*3600000,minSamples:2,priorStrength:1});
  assert.equal(out.executedResearchTrades,10);
  assert.ok(out.rows.at(-1).riskMultiplier>0);
  assert.ok(out.rows.at(-1).riskMultiplier<out.rows.at(-1).baseRisk);
});
