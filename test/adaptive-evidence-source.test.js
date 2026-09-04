import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_BT_CONFIG, __test as cloudResearch } from '../cloud-backtest.js';
import { adaptiveSignalAt, prepareAdaptiveEventsFromMarket, __test as sourceTest } from '../adaptive-evidence-source.js';

const M15=15*60000,H1=60*60000,H4=4*60*60000;

function candles(count,step,start=Date.UTC(2026,0,1),base=100,drift=.08){
  const out=[];
  for(let i=0;i<count;i++){
    const open=base+i*drift,close=open+drift*.6;
    out.push({openTime:start+i*step,open,high:close+.6,low:open-.6,close,volume:100+i%9,closeTime:start+(i+1)*step-1});
  }
  return out;
}

function market(){
  return {AAAUSDT:{'15m':candles(220,M15),'1h':candles(220,H1),'4h':candles(220,H4)}};
}

test('source metrics preserve cloud-backtest frame shape',()=>{
  const rows=candles(180,M15),m=sourceTest.metrics(rows);
  assert.ok(m.price>0);
  assert.ok(m.ema20>0);
  assert.ok(m.ema50>0);
  assert.ok(Number.isFinite(m.rsi));
  assert.ok(Number.isFinite(m.macd.hist));
  assert.ok(Number.isFinite(m.atr));
  assert.ok(Number.isFinite(m.adx));
  assert.ok(Number.isFinite(m.volumeRatio));
});

test('adaptive source delegates final candidate construction to canonical cloud candidate',()=>{
  const data=market().AAAUSDT,t=data['15m'].at(-1).closeTime;
  const sig=adaptiveSignalAt('AAAUSDT',data,t,CLOUD_BT_CONFIG);
  assert.ok(sig);
  const frames={
    '15m':sourceTest.windowMetrics(data['15m'],t),
    '1h':sourceTest.windowMetrics(data['1h'],t),
    '4h':sourceTest.windowMetrics(data['4h'],t)
  };
  const canonical=cloudResearch.candidate('AAAUSDT',frames,CLOUD_BT_CONFIG);
  assert.deepEqual(sig,canonical);
});

test('prepared events contain canonical signal and matching 15m candle only after warmup',()=>{
  const m=market(),rows=m.AAAUSDT['15m'];
  const start=rows[100].closeTime,end=rows.at(-1).closeTime;
  const events=prepareAdaptiveEventsFromMarket(m,start,end,CLOUD_BT_CONFIG);
  assert.ok(events.length>0);
  assert.equal(events[0].t,start);
  assert.ok(events.some(e=>e.signals.AAAUSDT));
  for(const ev of events){
    assert.equal(ev.candles.AAAUSDT.closeTime,ev.t);
  }
});
