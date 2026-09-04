import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignalCohort, buildEvidenceMap, rollingWindows, cohortSummary } from '../adaptive-evidence-cohorts.js';

const H=3600000;
const sig=(symbol='AAAUSDT',extra={})=>({
  symbol,side:'LONG',regime:'BULL',status:'READY',entry:100,sl:90,tp1:110,tp2:120,
  frames:{
    '15m':{price:100,ema20:99,ema50:98,rsi:60,macd:{hist:1},atr:1.5,volumeRatio:1.2},
    '1h':{price:100,ema20:99,ema50:98,macd:{hist:1}},
    '4h':{price:100,ema20:99,ema50:98,macd:{hist:1}}
  },
  ...extra
});

function event(t,{signal=null,low=99,high=101,close=100}={}){
  return {t,candles:{AAAUSDT:{low,high,close,closeTime:t}},signals:signal?{AAAUSDT:signal}:{}};
}

test('cohort replay uses candles strictly after the signal timestamp',()=>{
  const t0=Date.UTC(2026,0,1),events=[
    event(t0,{signal:sig(),low:89,high:111,close:100}),
    event(t0+15*60000,{low:100,high:111,close:110})
  ];
  const rows=buildSignalCohort(events,{sampleEveryMs:4*H,horizonDays:1,feeBps:0,slippageBps:0,requireFullHorizon:false});
  assert.equal(rows.length,1);
  assert.equal(rows[0].realizedR,1);
  assert.equal(rows[0].exitReason,'TP1_FULL');
});

test('full-horizon guard rejects right-censored signals by default',()=>{
  const t0=Date.UTC(2026,0,1),events=[
    event(t0,{signal:sig()}),
    event(t0+15*60000,{low:100,high:101,close:100})
  ];
  const rows=buildSignalCohort(events,{horizonDays:1,feeBps:0,slippageBps:0});
  assert.equal(rows.length,0);
});

test('sampling cadence prevents repeated near-identical candidates',()=>{
  const t0=Date.UTC(2026,0,1),events=[];
  for(let i=0;i<20;i++)events.push(event(t0+i*15*60000,{signal:sig(),low:100,high:101,close:100}));
  events.push(event(t0+6*H,{low:100,high:111,close:110}));
  const rows=buildSignalCohort(events,{sampleEveryMs:4*H,horizonDays:1,feeBps:0,slippageBps:0,requireFullHorizon:false});
  assert.equal(rows.length,2);
  assert.ok(rows[1].ts-rows[0].ts>=4*H);
});

test('evidence map exposes the exact adaptive-evidence dimensions',()=>{
  const t0=Date.UTC(2026,0,1),t1=t0+15*60000;
  const rows=buildSignalCohort([
    event(t0,{signal:sig()}),
    event(t1,{low:100,high:111,close:110})
  ],{sampleEveryMs:4*H,horizonDays:1,feeBps:0,slippageBps:0,requireFullHorizon:false});
  const map=buildEvidenceMap(rows,[{id:'ALL',start:t0,end:t1}]);
  assert.equal(map.side.LONG.n,1);
  assert.equal(map.regime['LONG|BULL'].avgR,1);
  assert.equal(map.mtfAlignment['LONG|3'].n,1);
  assert.equal(map.asset['AAAUSDT|LONG'].windows[0].id,'ALL');
});

test('rolling windows cover the full interval without changing cohort data',()=>{
  const start=0,end=1000,w=rollingWindows({start,end,count:5});
  assert.equal(w.length,5);
  assert.equal(w[0].start,start);
  assert.equal(w.at(-1).end,end);
});

test('cohort summary keeps LONG and SHORT counts separate',()=>{
  const s=cohortSummary([
    {side:'LONG',realizedR:1},{side:'LONG',realizedR:-1},{side:'SHORT',realizedR:.5}
  ]);
  assert.equal(s.n,3);
  assert.equal(s.bySide.LONG.n,2);
  assert.equal(s.bySide.SHORT.n,1);
});
