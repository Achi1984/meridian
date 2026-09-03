import test from 'node:test';
import assert from 'node:assert/strict';
import { replayCandlePath, compareCandlePath } from '../candle-path-v769.js';

test('adverse intrabar MTM is at least as conservative as close MTM',()=>{
  const trades=[{symbol:'BTCUSDT',side:'LONG',sampledAt:'2026-01-01T00:00:00Z',exitAt:Date.parse('2026-01-01T00:30:00Z'),entry:100,atr:10,riskPct:1,equityAtRiskAtOpen:10000,outcomeR:1}];
  const candles={BTCUSDT:[{closeTime:Date.parse('2026-01-01T00:15:00Z'),close:102,low:90,high:103},{closeTime:Date.parse('2026-01-01T00:30:00Z'),close:116,low:101,high:118}]};
  const close=replayCandlePath(trades,candles,{mode:'close'}), adverse=replayCandlePath(trades,candles,{mode:'adverse'});
  assert.ok(adverse.maxDrawdownPct>=close.maxDrawdownPct);
  assert.equal(adverse.endEquity,10100);
});

test('comparison reports challenger drawdown direction',()=>{
  const b=[{symbol:'BTCUSDT',side:'LONG',sampledAt:'2026-01-01T00:00:00Z',exitAt:Date.parse('2026-01-01T00:30:00Z'),entry:100,atr:10,riskPct:1,equityAtRiskAtOpen:10000,outcomeR:-1}];
  const c=[{...b[0],riskPct:.5,outcomeR:-1}];
  const candles={BTCUSDT:[{closeTime:Date.parse('2026-01-01T00:15:00Z'),close:96,low:90,high:101},{closeTime:Date.parse('2026-01-01T00:30:00Z'),close:84,low:83,high:96}]};
  const x=compareCandlePath(b,c,candles);
  assert.equal(x.comparison.v32LowerAdverseDd,true);
});
