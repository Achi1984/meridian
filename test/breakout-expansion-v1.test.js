import test from 'node:test';
import assert from 'node:assert/strict';
import { breakoutExpansionDecision, breakoutFeatures, BREAKOUT_EXPANSION_VERSION } from '../breakout-expansion-v1.js';

function series({n=70,start=100,step=.04,range=.35,volume=1000}={}){
  const out=[];let p=start;
  for(let i=0;i<n;i++){
    const open=p,close=p+step,high=Math.max(open,close)+range/2,low=Math.min(open,close)-range/2;
    out.push({open,high,low,close,volume});p=close;
  }
  return out;
}
function longBreakout(){
  const xs=series({step:.025,range:.22});
  const priorHigh=Math.max(...xs.slice(-20).map(x=>x.high));
  const open=xs.at(-1).close;
  xs.push({open,high:priorHigh+2.4,low:open-.15,close:priorHigh+2.1,volume:2600});
  return xs;
}
function shortBreakout(){
  const xs=series({step:-.025,range:.22});
  const priorLow=Math.min(...xs.slice(-20).map(x=>x.low));
  const open=xs.at(-1).close;
  xs.push({open,high:open+.15,low:priorLow-2.4,close:priorLow-2.1,volume:2700});
  return xs;
}

test('waits when 15m history is insufficient',()=>{
  const d=breakoutExpansionDecision({symbol:'BTC',candles15m:series({n:10})});
  assert.equal(d.version,BREAKOUT_EXPANSION_VERSION);
  assert.equal(d.researchOnly,true);
  assert.equal(d.executionImpact,false);
  assert.equal(d.decision,'WAIT');
  assert.equal(d.side,'NONE');
});

test('detects a confirmed long structure break without Baseline dependency',()=>{
  const candles15m=longBreakout();
  const candles1h=series({n:70,step:.18,range:.7,volume:5000});
  const f=breakoutFeatures(candles15m,candles1h);
  assert.equal(f.ready,true);
  assert.equal(f.side,'LONG');
  const d=breakoutExpansionDecision({symbol:'SOL',candles15m,candles1h});
  assert.equal(d.side,'LONG');
  assert.ok(['TRADE','OBSERVE'].includes(d.decision));
  assert.ok(d.score>=60);
  assert.ok(d.sl<d.entry);
  assert.ok(d.tp1>d.entry);
  assert.ok(d.tp2>d.tp1);
  assert.ok(d.riskPct<=1);
  assert.ok(d.reasons.includes('RANGE_EXPANSION'));
});

test('detects a confirmed short structure break independently',()=>{
  const candles15m=shortBreakout();
  const candles1h=series({n:70,step:-.18,range:.7,volume:5000});
  const d=breakoutExpansionDecision({symbol:'ETH',candles15m,candles1h});
  assert.equal(d.side,'SHORT');
  assert.ok(['TRADE','OBSERVE'].includes(d.decision));
  assert.ok(d.sl>d.entry);
  assert.ok(d.tp1<d.entry);
  assert.ok(d.tp2<d.tp1);
});

test('does not create a trade when price has not broken prior structure',()=>{
  const candles15m=series({n:72,step:.01,range:.3});
  const candles1h=series({n:70,step:.08,range:.7});
  const d=breakoutExpansionDecision({symbol:'XRP',candles15m,candles1h});
  assert.equal(d.side,'NONE');
  assert.equal(d.decision,'SKIP');
  assert.equal(d.riskPct,0);
  assert.ok(d.reasons.includes('NO_CONFIRMED_STRUCTURE_BREAK'));
});

test('risk suggestion stays bounded and never implies leverage increase',()=>{
  const d=breakoutExpansionDecision({symbol:'AVAX',candles15m:longBreakout(),candles1h:series({n:70,step:.2,range:.5,volume:5000})});
  assert.ok(d.riskPct>=0&&d.riskPct<=1);
  assert.equal(d.executionImpact,false);
});
