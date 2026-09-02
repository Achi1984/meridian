import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPortfolioPath, sliceRecentWindow } from '../portfolio-path-v767.js';

function row({symbol='BTCUSDT',sample='2026-01-01T00:00:00Z',exit='2026-01-01T01:00:00Z',outcomeR=1.4,status='READY',volume=1.7,adx=16,rsi=54,candidate=70,technical=70,side='LONG',regime='RANGE'}={}){
  return {symbol,sampledAt:sample,exitAt:exit,outcomeR,baselineStatus:status,candidate,technical,side,regime,frames:{'15m':{price:100,ema20:99,ema50:98,atr:1,adx,rsi,volumeRatio:volume,macdHist:1},'1h':{price:100,ema20:99,ema50:98,atr:2,adx:20,rsi:55,volumeRatio:1,macdHist:1},'4h':{price:100,ema20:99,ema50:98,atr:4,adx:20,rsi:55,volumeRatio:1,macdHist:1}}};
}

test('portfolio replay is research-only and uses identical portfolio config',()=>{
  const rows=[row({symbol:'A',outcomeR:-1,status:'READY',volume:.5,adx:30}),row({symbol:'B',outcomeR:1.4,status:'NO_SETUP',volume:1.7,adx:16})];
  const x=replayPortfolioPath(rows,{config:{maxOpenPositions:1,maxPortfolioRiskPct:1,maxTradesPerDay:8}});
  assert.equal(x.researchOnly,true);
  assert.equal(x.executionImpact,false);
  assert.equal(x.config.riskPerTradePct,1);
  assert.equal(x.baseline.trades,1);
  assert.equal(x.challengerV32.trades,1);
  assert.ok(x.challengerV32.avgR>x.baseline.avgR);
});

test('chronological slot competition blocks overlapping positions without future selection',()=>{
  const rows=[
    row({symbol:'A',sample:'2026-01-01T00:00:00Z',exit:'2026-01-01T08:00:00Z',outcomeR:1.4,status:'READY'}),
    row({symbol:'B',sample:'2026-01-01T04:00:00Z',exit:'2026-01-01T05:00:00Z',outcomeR:1.4,status:'READY'}),
    row({symbol:'C',sample:'2026-01-01T08:00:00Z',exit:'2026-01-01T09:00:00Z',outcomeR:-1,status:'READY'})
  ];
  const x=replayPortfolioPath(rows,{config:{maxOpenPositions:1,maxPortfolioRiskPct:1,maxTradesPerDay:8}});
  assert.equal(x.baseline.trades,2);
  assert.ok(x.baseline.skips.maxOpen>=1);
});

test('realized-equity compounding updates end equity and drawdown',()=>{
  const rows=[
    row({symbol:'A',sample:'2026-01-01T00:00:00Z',exit:'2026-01-01T01:00:00Z',outcomeR:-1}),
    row({symbol:'B',sample:'2026-01-01T04:00:00Z',exit:'2026-01-01T05:00:00Z',outcomeR:1.4})
  ];
  const x=replayPortfolioPath(rows,{config:{maxOpenPositions:1,maxPortfolioRiskPct:1,maxDrawdownPct:50}});
  assert.ok(x.baseline.endEquity>10000);
  assert.ok(x.baseline.maxDrawdownPct>=1);
  assert.equal(x.markToMarket,false);
});

test('sliceRecentWindow keeps only recent cohort rows',()=>{
  const rows=[row({sample:'2026-01-01T00:00:00Z'}),row({sample:'2026-02-15T00:00:00Z'}),row({sample:'2026-03-31T00:00:00Z'})];
  assert.equal(sliceRecentWindow(rows,30).length,1);
  assert.equal(sliceRecentWindow(rows,60).length,2);
});
