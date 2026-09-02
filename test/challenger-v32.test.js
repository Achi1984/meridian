import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreChallengerV32, compareV32ToBaseline } from '../challenger-v32.js';

function row({outcomeR=1.4,side='LONG',regime='RANGE',baselineStatus='NO_SETUP',volume=1.7,adx=16,rsi=54,candidate=60,technical=60,symbol='BTCUSDT',sampledAt='2026-01-01T00:00:00Z'}={}){return{outcomeR,side,regime,baselineStatus,candidate,technical,symbol,sampledAt,frames:{'15m':{price:100,ema20:99,ema50:98,atr:1,adx,rsi,volumeRatio:volume,macdHist:1},'1h':{price:100,ema20:99,ema50:98,atr:2,adx:20,rsi:55,volumeRatio:1,macdHist:1},'4h':{price:100,ema20:99,ema50:98,atr:4,adx:20,rsi:55,volumeRatio:1,macdHist:1}}};}

test('V3.2 uses additive soft evidence and no READY requirement',()=>{
  const x=scoreChallengerV32(row({baselineStatus:'NO_SETUP',volume:1.7,adx:16}));
  assert.equal(x.executionImpact,false);
  assert.ok(x.evidenceScore>=3);
  assert.ok(x.hits.includes('VOL_GE15_ADX_LT18'));
});

test('SHORT transition volume interaction receives robust evidence weight',()=>{
  const x=scoreChallengerV32(row({side:'SHORT',regime:'TRANSITION',volume:.8,adx:30}));
  assert.ok(x.hits.includes('SHORT_TRANSITION_VOL_065_1'));
  assert.ok(x.evidenceScore>=3);
});

test('comparison matches Baseline READY coverage and tracks opportunity cost',()=>{
  const rows=[
    row({baselineStatus:'READY',outcomeR:-1,symbol:'A'}),
    row({baselineStatus:'READY',outcomeR:1.4,volume:.5,adx:30,symbol:'B'}),
    row({baselineStatus:'NO_SETUP',outcomeR:1.4,volume:1.7,adx:16,symbol:'C'}),
    row({baselineStatus:'NO_SETUP',outcomeR:1.4,side:'SHORT',regime:'TRANSITION',volume:.8,adx:30,symbol:'D'})
  ];
  const x=compareV32ToBaseline(rows);
  assert.equal(x.baseline.samples,2);
  assert.equal(x.challengerV32.samples,2);
  assert.equal(x.opportunity.coverageMatched,true);
  assert.equal(x.opportunity.discovered,2);
  assert.equal(x.opportunity.displaced,2);
  assert.ok(x.challengerV32.avgR>x.baseline.avgR);
});
