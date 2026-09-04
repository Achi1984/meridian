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
  // Enough wall-clock coverage for all three frames at the same evaluation time.
  return {AAAUSDT:{'15m':candles(1200,M15),'1h':candles(300,H1),'4h':candles(80,H4)}};
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
  const data=market().AAAUSDT,t=data['4h'].at(-1).closeTime;
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

test('prepared events contain canonical signal and matching 15m candle after multi-timeframe warmup',()=>{
  const m=market(),rows=m.AAAUSDT['15m'];
  const warmupTime=m.AAAUSDT['4h'][60].closeTime;
  const first=rows.findIndex(x=>x.closeTime>=warmupTime);
  const start=rows[first].closeTime,end=rows[Math.min(rows.length-1,first+120)].closeTime;
  const events=prepareAdaptiveEventsFromMarket(m,start,end,CLOUD_BT_CONFIG);
  assert.ok(events.length>0);
  assert.equal(events[0].t,start);
  assert.ok(events.some(e=>e.signals.AAAUSDT));
  for(const ev of events){
    assert.equal(ev.candles.AAAUSDT.closeTime,ev.t);
  }
});

test('market source falls back to Binance public data endpoint when primary is geo-blocked',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(url);
    if(url.startsWith('https://api.binance.com'))return{ok:false,status:451,json:async()=>({})};
    return{ok:true,status:200,json:async()=>[[0,'100','101','99','100.5','10',M15-1]]};
  };
  const page=await sourceTest.fetchPage('BTCUSDT','15m',0,M15,{fetchImpl,onRetry:()=>{}});
  assert.equal(page.endpoint,'https://data-api.binance.vision');
  assert.equal(page.json.length,1);
  assert.ok(calls.some(x=>x.startsWith('https://api.binance.com')));
  assert.ok(calls.some(x=>x.startsWith('https://data-api.binance.vision')));
});
