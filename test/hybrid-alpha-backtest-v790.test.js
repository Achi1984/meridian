import test from 'node:test';
import assert from 'node:assert/strict';
import {runHybridAlphaBacktest,walkForwardSlices} from '../hybrid-alpha-backtest-v790.js';

const s=(timestamp,symbol,forwardR,features)=>({timestamp,symbol,forwardR,features});

test('backtest is research-only and applies side, risk and costs',()=>{
  const out=runHybridAlphaBacktest([
    s('2026-01-01T00:00:00Z','ETHUSDT',1,{regime:'BULL',trend:.8,momentum:.8,relativeStrength:.6,orderFlow:.4,volatilityRatio:1,liquidityQuality:1}),
    s('2026-01-02T00:00:00Z','BTCUSDT',-1,{regime:'BEAR',trend:-.9,momentum:-.7,relativeStrength:-.4,orderFlow:-.5,volatilityRatio:1,liquidityQuality:1})
  ],{costR:.05});
  assert.equal(out.researchOnly,true);
  assert.equal(out.executionImpact,false);
  assert.equal(out.executedResearchTrades,2);
  assert.ok(out.summary.netR>0);
  assert.equal(out.bySide.LONG.trades,1);
  assert.equal(out.bySide.SHORT.trades,1);
});

test('transaction cost scales down with research risk multiplier',()=>{
  const out=runHybridAlphaBacktest([
    s('2026-01-01T00:00:00Z','ETHUSDT',1,{regime:'BULL',trend:.8,momentum:.8,relativeStrength:.6,orderFlow:.4,volatilityRatio:2,liquidityQuality:.5,reversalRisk:.4})
  ],{costR:.10});
  assert.equal(out.executedResearchTrades,1);
  assert.ok(out.rows[0].riskMultiplier<1);
  assert.ok(out.rows[0].costR<.10);
  assert.equal(out.schemaVersion,'7.90-HYBRID-BACKTEST-V2');
});

test('observe samples do not become trades',()=>{
  const out=runHybridAlphaBacktest([s('2026-01-01T00:00:00Z','SOLUSDT',1,{regime:'BULL',trend:.1,momentum:.1})]);
  assert.equal(out.executedResearchTrades,0);
  assert.equal(out.observedSamples,1);
});

test('walk-forward slices preserve chronological folds',()=>{
  const rows=Array.from({length:9},(_,i)=>s(`2026-01-${String(i+1).padStart(2,'0')}T00:00:00Z`,'ETHUSDT',1,{regime:'BULL',trend:.8,momentum:.7,relativeStrength:.5,orderFlow:.4}));
  const folds=walkForwardSlices(rows,{folds:3});
  assert.equal(folds.length,3);
  assert.equal(folds[0].result.researchOnly,true);
  assert.ok(Date.parse(folds[0].end)<Date.parse(folds[1].start));
});
