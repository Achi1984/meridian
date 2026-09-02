import test from 'node:test';
import assert from 'node:assert/strict';
import { runRiskSensitivity } from '../risk-sensitivity-v768.js';

const row=(i,r,status='READY')=>({sampledAt:new Date(1700000000000+i*14400000).toISOString(),exitAt:new Date(1700000000000+i*14400000+3600000).toISOString(),symbol:`S${i}USDT`,side:'LONG',baselineStatus:status,technical:80,candidate:80,outcomeR:r,frames:{'15m':{volumeRatio:2,adx:14,rsi:54},'1h':{},'4h':{}},regime:'RANGE'});

test('v7.68 varies only risk and keeps scorer frozen',()=>{
  const rows=[row(0,1),row(1,-1),row(2,1),row(3,1),row(4,-1),row(5,1)];
  const r=runRiskSensitivity(rows);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.scorerFrozen,true);
  assert.deepEqual(Object.keys(r.variants),['risk_0.25','risk_0.50','risk_0.75','risk_1.00']);
  assert.equal(r.variants['risk_0.25'].riskPerTradePct,0.25);
  assert.equal(r.variants['risk_1.00'].riskPerTradePct,1);
  assert.equal(r.diagnosticNoDrawdown.riskPerTradePct,1);
});

test('lower risk reduces equity amplitude for identical simple path',()=>{
  const rows=[row(0,1),row(1,1),row(2,-1),row(3,1)];
  const r=runRiskSensitivity(rows);
  const low=Math.abs(r.variants['risk_0.25'].challengerV32.endEquity-10000);
  const high=Math.abs(r.variants['risk_1.00'].challengerV32.endEquity-10000);
  assert.ok(high>=low);
});

test('no-drawdown diagnostic does not introduce a stricter DD gate',()=>{
  const rows=Array.from({length:12},(_,i)=>row(i,-1));
  const r=runRiskSensitivity(rows);
  assert.ok(r.diagnosticNoDrawdown.challengerV32.trades>=r.variants['risk_1.00'].challengerV32.trades);
});
