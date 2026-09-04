import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdaptiveEvidenceReport, renderAdaptiveEvidenceMarkdown } from '../adaptive-evidence-report.js';

const H=3600000,DAY=86400000;
const signal=()=>({
  symbol:'AAAUSDT',side:'LONG',regime:'BULL',status:'READY',entry:100,sl:90,tp1:110,tp2:120,
  frames:{
    '15m':{price:100,ema20:99,ema50:98,rsi:60,macd:{hist:1},atr:1.5,volumeRatio:1.5},
    '1h':{price:100,ema20:99,ema50:98,macd:{hist:1}},
    '4h':{price:100,ema20:99,ema50:98,macd:{hist:1}}
  }
});

function syntheticEvents(){
  const start=Date.UTC(2026,0,1),events=[];
  for(let t=start;t<=start+50*DAY;t+=4*H){
    events.push({t,candles:{AAAUSDT:{low:100,high:111,close:110,closeTime:t}},signals:{AAAUSDT:signal()}});
  }
  return events;
}

test('multi-window report excludes censored recent signals and never promotes automatically',()=>{
  const events=syntheticEvents(),dataEnd=events.at(-1).t;
  const report=buildAdaptiveEvidenceReport(events,{dataEnd,horizonDays:14,windowsDays:[30],feeBps:0,slippageBps:0});
  const w=report.windows['30d'];
  assert.ok(w.cohort.n>100);
  assert.ok(w.cohort.avgR>0);
  assert.ok(w.signalEnd<=dataEnd-14*DAY);
  assert.equal(report.promotion.allowed,false);
  assert.equal(report.executionImpact,false);
  assert.ok(w.walkForward.slices.every(s=>s.trainEnd<s.testStart));
});

test('markdown report surfaces market capture and explicit no-promotion status',()=>{
  const events=syntheticEvents(),report=buildAdaptiveEvidenceReport(events,{dataEnd:events.at(-1).t,horizonDays:14,windowsDays:[30],feeBps:0,slippageBps:0});
  const md=renderAdaptiveEvidenceMarkdown(report);
  assert.match(md,/Market capture/i);
  assert.match(md,/NO PROMOTION/);
  assert.match(md,/30d/);
});
