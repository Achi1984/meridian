import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateH5Signal, evaluateH7Selection} from '../docs/strategy-lab/signal-prototypes.mjs';

const FIVE_MINUTES = 300000, DAY = 86400000;
function h5(count = 25) {
  const bars = Array.from({length:count}, (_,i) => ({closeTimeMs:(i+1)*FIVE_MINUTES,open:100,high:101,low:99,close:100,volume:10}));
  bars[21] = {...bars[21],open:100,high:101,low:93,close:94,volume:30};
  for (let i=22;i<count;i++) bars[i] = {...bars[i],open:94,high:99,low:93,close:i===count-1?98:95,volume:10};
  return {asOfMs:count*FIVE_MINUTES,bars};
}
function daily(symbol, amplitude = 0) {
  const bars = Array.from({length:201}, (_,i) => ({closeTimeMs:(i+1)*DAY,close:100}));
  for(let i=171;i<=200;i++) bars[i].close=bars[i-1].close*Math.exp(.002+(i%2?amplitude:-amplitude));
  return {symbol,bars};
}
const h7 = (assets = [daily('BTC')]) => ({asOfMs:201*DAY,assets});
function invalid(fn, input) {
  const result = fn(input);
  assert.equal(result.valid,false);
  assert.equal(result.status,'INVALID');
  assert.ok(result.errors.length > 0);
  assert.equal(result.executionAuthorized,false);
  return result;
}
function valid(fn,input,status) {
  const result=fn(input);
  assert.equal(result.valid,true,JSON.stringify(result.errors));
  assert.deepEqual(result.errors,[]);
  assert.equal(result.status,status);
  assert.equal(result.executionAuthorized,false);
  assert.equal(result.requiresTradePlan,true);
  return result;
}

test('H5 causal reference ATR2/median10 identifies a downside shock reclaim LONG', () => {
  const input=h5(), r=valid(evaluateH5Signal,input,'DRAFT_SIGNAL');
  assert.equal(r.signal.familyId,'H5');
  assert.equal(r.signal.direction,'LONG');
  assert.equal(r.signal.priorATR14,2);
  assert.equal(r.signal.priorMedianVolume,10);
  assert.equal(r.signal.shockMidpoint,97);
  assert.equal(r.signal.shockCloseTimeMs,22*FIVE_MINUTES);
  assert.equal(r.signal.observedAtMs,input.bars.at(-1).closeTimeMs);
});

test('H5 mirrored upside shock reclaim generates SHORT', () => {
  const input=h5();
  input.bars=input.bars.map(b=>({...b,open:200-b.open,close:200-b.close,high:200-b.low,low:200-b.high}));
  const r=valid(evaluateH5Signal,input,'DRAFT_SIGNAL');
  assert.equal(r.signal.direction,'SHORT');
  assert.equal(r.signal.shockMidpoint,103);
  assert.equal(r.signal.priorATR14,2);
});

test('H5 accepts a first reclaim on each of the three allowed confirmation bars', () => {
  for(const count of [23,24,25]) {
    const input=h5(count);
    if(count===24) input.bars.at(-1).close=97; // Midpoint equality is a reclaim.
    const r=valid(evaluateH5Signal,input,'DRAFT_SIGNAL');
    assert.equal(r.signal.observedAtMs,count*FIVE_MINUTES);
  }
});

test('H5 no midpoint reclaim gives NONE without a fabricated signal', () => {
  const input=h5();input.bars.at(-1).close=96;
  const r=valid(evaluateH5Signal,input,'NONE');
  assert.equal(r.signal,null);
});

test('H5 an earlier first reclaim suppresses a repeated late signal', () => {
  const input=h5();input.bars[22].close=98;
  const r=valid(evaluateH5Signal,input,'NONE');
  assert.equal(r.signal,null);
});

test('H5 exact shock thresholds pass; weaker body or volume does not', () => {
  valid(evaluateH5Signal,h5(),'DRAFT_SIGNAL'); // body6=3*ATR2; vol30=3*median10.
  const body=h5();body.bars[21].close=94.01;
  valid(evaluateH5Signal,body,'NONE');
  const volume=h5();volume.bars[21].volume=29.99;
  valid(evaluateH5Signal,volume,'NONE');
});

test('H5 closed boundary is usable, future or stale latest bars are rejected', () => {
  valid(evaluateH5Signal,h5(),'DRAFT_SIGNAL');
  const future=h5();future.asOfMs--;
  invalid(evaluateH5Signal,future);
  const stale=h5();stale.asOfMs+=FIVE_MINUTES;
  invalid(evaluateH5Signal,stale);
});

test('H5 gaps, reversed order and unaligned timestamps are invalid', () => {
  const gap=h5();gap.bars[10].closeTimeMs+=FIVE_MINUTES;
  invalid(evaluateH5Signal,gap);
  const reversed=h5();reversed.bars.reverse();invalid(evaluateH5Signal,reversed);
  const misaligned=h5();misaligned.bars.forEach(b=>b.closeTimeMs++);misaligned.asOfMs++;
  invalid(evaluateH5Signal,misaligned);
});

test('H5 inconsistent OHLC, nonfinite price and negative volume fail closed', () => {
  for(const patch of [{high:99},{low:101},{close:NaN},{volume:-1}]) {
    const input=h5();Object.assign(input.bars[10],patch);invalid(evaluateH5Signal,input);
  }
  for(const length of [22,26]) {
    const input=h5();input.bars=Array.from({length},(_,i)=>({...input.bars[Math.min(i,24)],closeTimeMs:(i+1)*FIVE_MINUTES}));input.asOfMs=length*FIVE_MINUTES;
    invalid(evaluateH5Signal,input);
  }
});

test('H7 increasing asset qualifies above current SMA200 with one quarter weight', () => {
  const input=h7(),r=valid(evaluateH7Selection,input,'DRAFT_SELECTION');
  assert.equal(r.selection.length,1);assert.equal(r.selection[0].symbol,'BTC');
  assert.equal(r.selection[0].weight,.25);assert.equal(r.cashWeight,.75);
  assert.ok(r.selection[0].lastClose>r.selection[0].sma200);
  assert.ok(r.selection[0].realizedVolatility<1e-12);
});

test('H7 stable-to-volatile ranking selects only three quarters, retaining cash floor', () => {
  const r=valid(evaluateH7Selection,h7([daily('HIGH',.003),daily('LOW',.001),daily('EXTRA',.004),daily('MID',.002)]),'DRAFT_SELECTION');
  assert.deepEqual(r.selection.map(x=>x.symbol),['LOW','MID','HIGH']);
  assert.deepEqual(r.selection.map(x=>x.weight),[.25,.25,.25]);
  assert.equal(r.cashWeight,.25);
});

test('H7 identical volatility ties use ASCII symbol order independent of input order', () => {
  const r=valid(evaluateH7Selection,h7([daily('ZZZ'),daily('AAA'),daily('BBB'),daily('CCC')]),'DRAFT_SELECTION');
  assert.deepEqual(r.selection.map(x=>x.symbol),['AAA','BBB','CCC']);
});

test('H7 equal-to-SMA and declining assets stay in cash with no forced allocation', () => {
  const flat=daily('FLAT');flat.bars.forEach(b=>b.close=100);
  const down=daily('DOWN');down.bars.forEach((b,i)=>b.close=200-i*.1);
  const r=valid(evaluateH7Selection,h7([flat,down]),'DRAFT_SELECTION');
  assert.deepEqual(r.selection,[]);assert.equal(r.cashWeight,1);
  const mixed=valid(evaluateH7Selection,h7([flat,down,daily('GOOD')]),'DRAFT_SELECTION');
  assert.deepEqual(mixed.selection.map(x=>x.symbol),['GOOD']);assert.equal(mixed.cashWeight,.75);
});

test('H7 uses precisely the latest30 returns and current SMA200', () => {
  const asset=daily('BTC',.001);
  // Thirty log returns alternate .003/.001: population standard deviation .001.
  asset.bars[0].close=10000; // Not in either the latest30 returns or SMA200.
  const r=valid(evaluateH7Selection,h7([asset]),'DRAFT_SELECTION');
  assert.equal(r.selection.length,1);
  assert.ok(Math.abs(r.selection[0].realizedVolatility-.001)<1e-12);
  const expectedSMA=asset.bars.slice(1).reduce((sum,b)=>sum+b.close,0)/200;
  assert.ok(Math.abs(r.selection[0].sma200-expectedSMA)<1e-10);
});

test('H7 requires exactly201 closed daily bars without future data, gaps or staleness', () => {
  const future=h7();future.asOfMs--;invalid(evaluateH7Selection,future);
  const stale=h7();stale.asOfMs+=DAY;invalid(evaluateH7Selection,stale);
  const short=h7();short.assets[0].bars.shift();invalid(evaluateH7Selection,short);
  const gap=h7();gap.assets[0].bars[80].closeTimeMs+=DAY;invalid(evaluateH7Selection,gap);
});

test('H7 mismatched endpoint rejects the entire basket rather than comparing different days', () => {
  const a=daily('AAA'),b=daily('BBB');b.bars.forEach(x=>x.closeTimeMs-=DAY);
  const r=invalid(evaluateH7Selection,h7([a,b]));
  assert.deepEqual(r.selection,[]);assert.equal(r.cashWeight,1);
});

test('H7 invalid symbol, duplicate asset or bad asset price invalidates the whole selection', () => {
  for(const assets of [[],[daily('btc')],[daily('A/B')],[daily('BTC'),daily('BTC')]]) invalid(evaluateH7Selection,h7(assets));
  for(const badPrice of [0,-1,Infinity,NaN,'100']) {
    const assets=[daily('GOOD'),daily('BAD')];assets[1].bars[50].close=badPrice;
    const r=invalid(evaluateH7Selection,h7(assets));assert.deepEqual(r.selection,[]);assert.equal(r.cashWeight,1);
  }
});

test('both prototypes reject malformed inputs and unknown authority or cost fields', () => {
  for(const input of [null,{},[],{asOfMs:'123',bars:[]}]) invalid(evaluateH5Signal,input);
  for(const input of [null,{},[],{asOfMs:'123',assets:[]}]) invalid(evaluateH7Selection,input);
  invalid(evaluateH5Signal,{...h5(),executionAuthorized:true});
  invalid(evaluateH7Selection,{...h7(),feeBps:5});
});

test('outputs provide no computed CRV, fees or performance and never authorize execution', () => {
  for(const result of [evaluateH5Signal(h5()),evaluateH7Selection(h7())]) {
    assert.equal(result.executionAuthorized,false);assert.equal(result.requiresTradePlan,true);
    assert.doesNotMatch(JSON.stringify(result),/"(?:fee|fees|feeBps|pnl|profit|crv|plannedNetRewardRisk|qualifiesPlannedCRV)"/i);
  }
});

test('both evaluators preserve deeply frozen inputs', () => {
  function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
  for(const [fn,input] of [[evaluateH5Signal,h5()],[evaluateH7Selection,h7()]]) {
    const before=structuredClone(input);freeze(input);const result=fn(input);
    assert.equal(result.valid,true);assert.deepEqual(input,before);
  }
});
