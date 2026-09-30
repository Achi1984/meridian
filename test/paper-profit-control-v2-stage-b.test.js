import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPER_PROFIT_CONTROL_V2_STAGE_B,evaluateStageBGate} from '../research/paperbot-profit-control-v2-stage-b.js';

test('Stage B freezes the approved Profit-first Balanced numeric gates',()=>{
  const x=PAPER_PROFIT_CONTROL_V2_STAGE_B;
  assert.equal(x.profile,'PROFIT_FIRST_BALANCED_V1');
  assert.equal(x.gate.maxDrawdownPct,20);
  assert.equal(x.gate.minProfitFactor,1.15);
  assert.equal(x.gate.maxPositivePnlConcentrationPct,35);
  assert.equal(x.gate.minEvaluationPeriods,30);
  assert.equal(x.gate.minPositiveWindows,4);
  assert.equal(x.gate.chronologicalWindows,5);
  assert.equal(x.gate.minPositiveAssets,5);
  assert.equal(x.gate.universeSize,8);
  assert.equal(x.gate.baselineCostBps,8);
  assert.equal(x.gate.stressCostBps,16);
  assert.equal(x.gate.requireStressNetPositive,true);
  assert.equal(x.gate.maxResearchLeverage,2);
  assert.deepEqual(x.universe,['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);
  assert.equal(x.executionImpact,false);
  assert.equal(x.autoPromotion,false);
});

test('Stage B passes only when every approved hard gate passes',()=>{
  const ok=evaluateStageBGate({
    evaluationPeriods:30,
    netCompoundedReturnPct:12,
    profitFactor:1.2,
    maxDrawdownPct:19.9,
    positiveWindows:4,
    positiveAssets:5,
    positivePnlConcentrationPct:35,
    stressNetCompoundedReturnPct:1,
    provenanceOk:true,
    holdoutUntouched:true
  });
  assert.equal(ok.pass,true);

  for(const patch of [
    {evaluationPeriods:29},
    {netCompoundedReturnPct:0},
    {profitFactor:1.14},
    {maxDrawdownPct:20.01},
    {positiveWindows:3},
    {positiveAssets:4},
    {positivePnlConcentrationPct:35.01},
    {stressNetCompoundedReturnPct:0},
    {provenanceOk:false},
    {holdoutUntouched:false}
  ]){
    const r=evaluateStageBGate({
      evaluationPeriods:30,
      netCompoundedReturnPct:12,
      profitFactor:1.2,
      maxDrawdownPct:19.9,
      positiveWindows:4,
      positiveAssets:5,
      positivePnlConcentrationPct:35,
      stressNetCompoundedReturnPct:1,
      provenanceOk:true,
      holdoutUntouched:true,
      ...patch
    });
    assert.equal(r.pass,false,JSON.stringify(patch));
  }
});

test('Stage B documentation forbids result-driven rescue and live promotion',async()=>{
  const fs=await import('node:fs');
  const doc=fs.readFileSync('research/PAPERBOT-PROFIT-CONTROL-V2-STAGE-B.md','utf8');
  for(const marker of [
    'No asset may be removed after results are viewed.',
    'may never be reduced below the frozen baseline to rescue a result',
    'No threshold may be relaxed after discovery or holdout results.',
    'No Stage-B result authorizes live execution.',
    'PAPER_PROFIT_CONTROL_V2_STAGE_B_GATES_FROZEN'
  ]) assert.ok(doc.includes(marker),marker);
});
