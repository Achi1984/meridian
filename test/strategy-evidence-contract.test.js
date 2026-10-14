import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvidenceContract} from '../docs/strategy-lab/validate-evidence-contract.mjs';

const stages=[
  'IDEA','RESEARCH','BACKTEST','OUT_OF_SAMPLE_HOLDOUT',
  'PAPER_BOT','FORWARD_VALIDATION','ROBUSTNESS_REVIEW'
];
const names=[
  'NET_EXPECTANCY','PROFIT_FACTOR','DRAWDOWN','SHARPE','SORTINO',
  'TAIL_RISK','COST_SENSITIVITY','REGIME_STABILITY','TIME_STABILITY',
  'ASSET_STABILITY','OOS_HOLDOUT','UNCERTAINTY','SAMPLE_DEPENDENCE','SELECTION_RISK'
];
const flags=[
  'canonicalExecutionAuthorized','strategyPnlAuthorized','discoveryAuthorized',
  'validationAuthorized','holdoutAuthorized','paperAuthorized','liveAuthorized'
];
const hash=char=>char.repeat(64);

function metricsFor(stage){
  const holdoutAssessed=stages.indexOf(stage)>=stages.indexOf('OUT_OF_SAMPLE_HOLDOUT');
  return names.map(name=>{
    if(name==='OOS_HOLDOUT'&&!holdoutAssessed){
      return{name,status:'NOT_ASSESSED',value:null,unit:null,denominator:null,reason:'Holdout stage has not been assessed yet.',threshold:null};
    }
    if(name==='SHARPE'||name==='SORTINO'){
      return{name,status:'NOT_APPLICABLE',value:null,unit:null,denominator:null,reason:'Synthetic fixture does not claim this metric is appropriate.',threshold:null};
    }
    const value=name==='DRAWDOWN'?5:1.2;
    return{
      name,status:'ASSESSED',value,unit:name==='DRAWDOWN'?'percent':'ratio',
      denominator:{value:50,unit:'trades'},reason:null,
      threshold:{
        operator:name==='DRAWDOWN'?'LTE':'GTE',value:name==='DRAWDOWN'?20:0,
        unit:name==='DRAWDOWN'?'percent':'ratio',source:`synthetic-predeclared-${name}`,
        predeclaredAt:'2024-12-30T00:00:00Z'
      }
    };
  });
}

function packet(){
  const checkpointFlags=Object.fromEntries(flags.map(flag=>[flag,false]));
  const cost=()=>({status:'ASSUMED',value:0.01,unit:'percent',source:'synthetic assumption',reason:null});
  const receipts=stages.map((stage,index)=>{
    const day=1+index*3;
    const start=`2025-0${Math.floor((day-1)/28)+1}-${String((day-1)%28+1).padStart(2,'0')}T00:00:00Z`;
    const end=`2025-0${Math.floor((day+1-1)/28)+1}-${String((day+1-1)%28+1).padStart(2,'0')}T00:00:00Z`;
    const available=`2025-0${Math.floor((day+2-1)/28)+1}-${String((day+2-1)%28+1).padStart(2,'0')}T00:00:00Z`;
    const completed=`2025-0${Math.floor((day+2-1)/28)+1}-${String((day+2-1)%28+1).padStart(2,'0')}T12:00:00Z`;
    const forward=['PAPER_BOT','FORWARD_VALIDATION'].includes(stage);
    return{
      stage,status:'PASS',resultReason:'Synthetic contract fixture only.',
      receiptId:`receipt-${stage.toLowerCase()}`,receiptSha256:hash(String(index+1)),
      strategyId:'hypothesis-alpha',strategyVersion:'v1',
      source:{id:'source-v1',sha256:hash('a')},
      data:{
        id:`data-receipt-${index}`,datasetId:`dataset-${stage.toLowerCase()}`,
        sha256:hash(String(index+2)),windowStart:start,windowEnd:end,
        availableAt:available,
        validThrough:'2026-12-31T00:00:00Z',freshnessSource:'synthetic freshness assertion'
      },
      temporalMode:forward?'FORWARD':'RETROSPECTIVE',completedAt:completed,
      holdoutTuning:false,metrics:index<2?[]:metricsFor(stage)
    };
  });
  return{
    schemaVersion:'MERIDIAN_PAPER_FIRST_EVIDENCE_V1',
    assessmentAt:'2026-10-14T21:00:00Z',
    checkpoint:{
      id:'MERIDIAN_LIVE_CHECKPOINT',mainSha:'efec133f4ff8a809722b79fa7c5fe8007667c1ea',
      stage:'SOURCE_AUDIT',sourceOnly:true,flags:checkpointFlags
    },
    strategy:{
      id:'hypothesis-alpha',version:'v1',
      hypothesis:'Synthetic hypothesis used only to test the contract.',
      entry:'Explicit synthetic entry definition.',exit:'Explicit synthetic exit definition.',
      risk:{type:'STOP_BASED',policy:'Synthetic bounded risk policy.',stopDefinition:'Explicit stop rule.',justification:'Synthetic test only.'},
      positionSizing:{method:'Fixed fractional',unit:'account risk',policy:'Explicit synthetic sizing policy.'},
      costAssumptions:{fee:cost(),spread:cost(),slippage:cost(),funding:cost(),borrow:cost()},
      marketConditions:['Synthetic range and trend conditions.'],
      telemetry:['entry','exit','risk','costs','data version'],
      invalidationConditions:['Synthetic thesis invalidation condition.'],
      frozenAt:'2025-01-01T00:00:00Z',disposition:'NEW_HYPOTHESIS'
    },
    lifecycle:{
      currentStage:'ROBUSTNESS_REVIEW',proposedNextStage:'LIVE_CANDIDATE',receipts
    }
  };
}

test('complete synthetic evidence is structurally complete but never authentic or executable',()=>{
  const input=packet(),before=JSON.stringify(input);
  const first=validateEvidenceContract(input);
  assert.deepEqual(first,validateEvidenceContract(input));
  assert.equal(first.evidenceCompleteness,'COMPLETE');
  assert.equal(first.proposedNextStageReadiness,'READY_UNVERIFIED');
  assert.equal(first.provenance,'ASSERTED_UNVERIFIED');
  assert.equal(first.operationalReadiness,'NOT_ASSESSED');
  assert.equal(first.authorityStatus,'NOT_GRANTED');
  assert.equal(first.executionAuthorized,false);
  assert.equal(first.autoPromotion,false);
  assert.equal(input.lifecycle.receipts.at(-1).stage,'ROBUSTNESS_REVIEW');
  assert.equal(JSON.stringify(input),before);
});

test('LIVE_CANDIDATE is terminal candidacy, not a further stage or execution state',()=>{
  const input=packet();
  const finalReceipt=structuredClone(input.lifecycle.receipts.at(-1));
  finalReceipt.stage='LIVE_CANDIDATE';
  finalReceipt.receiptId='receipt-live-candidate';
  finalReceipt.receiptSha256=hash('9');
  input.lifecycle.receipts.push(finalReceipt);
  input.lifecycle.currentStage='LIVE_CANDIDATE';
  input.lifecycle.proposedNextStage=null;
  const result=validateEvidenceContract(input);
  assert.equal(result.evidenceCompleteness,'COMPLETE');
  assert.equal(result.proposedNextStageReadiness,'NO_NEXT_STAGE');
  assert.equal(result.authorityStatus,'NOT_GRANTED');
  assert.equal(result.executionAuthorized,false);
});

test('missing, unknown, or contradictory checkpoint authority blocks readiness',()=>{
  const missing=packet();delete missing.checkpoint;
  assert.equal(validateEvidenceContract(missing).proposedNextStageReadiness,'BLOCKED');
  assert.ok(validateEvidenceContract(missing).missing.some(item=>item.path==='checkpoint'));
  const unknown=packet();unknown.checkpoint.id='some-other-checkpoint';
  assert.ok(validateEvidenceContract(unknown).invalid.some(item=>item.reason==='UNKNOWN_CHECKPOINT'));
  for(const values of [flags.map(()=>true),flags.map((_,index)=>index===0?true:false)]){
    const contradictory=packet();
    contradictory.checkpoint.flags=Object.fromEntries(flags.map((flag,index)=>[flag,values[index]]));
    const result=validateEvidenceContract(contradictory);
    assert.equal(result.proposedNextStageReadiness,'BLOCKED');
    assert.equal(result.executionAuthorized,false);
    assert.equal(result.autoPromotion,false);
  }
});

test('lifecycle receipts must be contiguous, ordered, and propose only the immediate stage',()=>{
  const skipped=packet();skipped.lifecycle.receipts.splice(2,1);
  const skippedResult=validateEvidenceContract(skipped);
  assert.equal(skippedResult.proposedNextStageReadiness,'BLOCKED');
  assert.ok(skippedResult.invalid.some(item=>item.reason==='STAGE_ORDER_OR_SKIP'));
  const jumped=packet();jumped.lifecycle.proposedNextStage='PAPER_BOT';
  assert.ok(validateEvidenceContract(jumped).invalid.some(item=>item.reason==='LIFECYCLE_MUST_NOT_SKIP'));
  const mislabeled=packet();mislabeled.lifecycle.receipts[2].stage='OUT_OF_SAMPLE_HOLDOUT';
  assert.ok(validateEvidenceContract(mislabeled).invalid.some(item=>item.reason==='STAGE_ORDER_OR_SKIP'));
});

test('failed, inconclusive, and not-assessed evidence remain distinct blockers',()=>{
  for(const status of ['FAILED','INCONCLUSIVE']){
    const input=packet();input.lifecycle.receipts.at(-1).status=status;
    assert.equal(validateEvidenceContract(input).proposedNextStageReadiness,'BLOCKED');
  }
  const notAssessed=packet();notAssessed.lifecycle.receipts.at(-1).status='NOT_ASSESSED';
  assert.equal(validateEvidenceContract(notAssessed).proposedNextStageReadiness,'NOT_ASSESSED');
  const awaitingHoldout=packet();
  awaitingHoldout.lifecycle.currentStage='BACKTEST';
  awaitingHoldout.lifecycle.proposedNextStage='OUT_OF_SAMPLE_HOLDOUT';
  awaitingHoldout.lifecycle.receipts=awaitingHoldout.lifecycle.receipts.slice(0,3);
  assert.equal(validateEvidenceContract(awaitingHoldout).proposedNextStageReadiness,'NOT_ASSESSED');
});

test('receipts cannot change strategy identity, source digest, or reuse development data as holdout',()=>{
  const version=packet();version.lifecycle.receipts[3].strategyVersion='v2';
  assert.ok(validateEvidenceContract(version).invalid.some(item=>item.reason==='STRATEGY_IDENTITY_MISMATCH'));
  const source=packet();source.lifecycle.receipts[3].source.sha256=hash('b');
  assert.ok(validateEvidenceContract(source).invalid.some(item=>item.reason==='IMMUTABLE_SOURCE_REFERENCE_MISMATCH'));
  const dataset=packet();dataset.lifecycle.receipts[3].data.datasetId=dataset.lifecycle.receipts[2].data.datasetId;
  assert.ok(validateEvidenceContract(dataset).invalid.some(item=>item.reason==='HOLDOUT_DATASET_REUSED'));
  const dataReceipt=packet();dataReceipt.lifecycle.receipts[3].data.id=dataReceipt.lifecycle.receipts[2].data.id;
  assert.ok(validateEvidenceContract(dataReceipt).invalid.some(item=>item.reason==='IMMUTABLE_DATA_RECEIPT_MISMATCH'));
  const receipt=packet();receipt.lifecycle.receipts[3].receiptId=receipt.lifecycle.receipts[2].receiptId;
  assert.ok(validateEvidenceContract(receipt).invalid.some(item=>item.reason==='DUPLICATE_RECEIPT'));
});

test('forward stages require forward-only windows after strategy freeze; stale data blocks',()=>{
  const mode=packet();mode.lifecycle.receipts[4].temporalMode='RETROSPECTIVE';
  assert.ok(validateEvidenceContract(mode).invalid.some(item=>item.reason==='STAGE_TEMPORAL_MODE_MISMATCH'));
  const old=packet();old.lifecycle.receipts[5].data.windowStart='2024-12-31T00:00:00Z';
  assert.ok(validateEvidenceContract(old).invalid.some(item=>item.reason==='RETROSPECTIVE_DATA_MISLABELED_FORWARD'));
  const stale=packet();stale.lifecycle.receipts[6].data.validThrough='2026-10-13T00:00:00Z';
  assert.ok(validateEvidenceContract(stale).invalid.some(item=>item.reason==='STALE_DATA_RECEIPT'));
  const missingTime=packet();missingTime.lifecycle.receipts[6].data.availableAt=null;
  assert.ok(validateEvidenceContract(missingTime).invalid.some(item=>item.reason==='INVALID_TIMESTAMP'));
  const overlap=packet();
  overlap.lifecycle.receipts[3].data.windowStart=overlap.lifecycle.receipts[2].data.windowStart;
  overlap.lifecycle.receipts[3].data.windowEnd=overlap.lifecycle.receipts[2].data.windowEnd;
  overlap.lifecycle.receipts[3].data.availableAt=overlap.lifecycle.receipts[2].data.availableAt;
  assert.ok(validateEvidenceContract(overlap).invalid.some(item=>item.reason==='HOLDOUT_WINDOW_OVERLAP'));
  const forwardOverlap=packet();
  forwardOverlap.lifecycle.receipts[5].data.windowStart=forwardOverlap.lifecycle.receipts[4].data.windowStart;
  assert.ok(validateEvidenceContract(forwardOverlap).invalid.some(item=>item.reason==='NON_MONOTONIC_FORWARD_WINDOW'));
});

test('holdout cannot be tuned or assessed before its lifecycle stage',()=>{
  const tuned=packet();tuned.lifecycle.receipts[3].holdoutTuning=true;
  assert.ok(validateEvidenceContract(tuned).invalid.some(item=>item.reason==='HOLDOUT_MUST_NOT_BE_TUNED'));
  const premature=packet();premature.lifecycle.receipts[2].metrics.find(item=>item.name==='OOS_HOLDOUT').status='ASSESSED';
  assert.ok(validateEvidenceContract(premature).invalid.some(item=>item.reason==='HOLDOUT_EVIDENCE_CANNOT_PRECEDE_HOLDOUT_STAGE'));
});

test('complete metric dimensions, denominators, and predeclared sourced thresholds are required',()=>{
  const missingNet=packet();missingNet.lifecycle.receipts[6].metrics[0].name='WIN_RATE';
  const missingResult=validateEvidenceContract(missingNet);
  assert.ok(missingResult.invalid.some(item=>item.reason==='UNKNOWN_METRIC'));
  assert.ok(missingResult.missing.some(item=>item.path.endsWith('.NET_EXPECTANCY')));
  const noDenominator=packet();noDenominator.lifecycle.receipts[6].metrics[0].denominator.value=0;
  assert.ok(validateEvidenceContract(noDenominator).invalid.some(item=>item.reason==='POSITIVE_FINITE_DENOMINATOR_REQUIRED'));
  const lateThreshold=packet();lateThreshold.lifecycle.receipts[6].metrics[0].threshold.predeclaredAt='2025-06-01T00:00:00Z';
  assert.ok(validateEvidenceContract(lateThreshold).invalid.some(item=>item.reason==='THRESHOLD_NOT_PREDECLARED'));
  const failedThreshold=packet();failedThreshold.lifecycle.receipts[6].metrics[0].value=-1;
  assert.ok(validateEvidenceContract(failedThreshold).invalid.some(item=>item.reason==='PREDECLARED_THRESHOLD_NOT_MET'));
  const unexplained=packet();const sharpe=unexplained.lifecycle.receipts[6].metrics.find(item=>item.name==='SHARPE');sharpe.reason='';
  assert.ok(validateEvidenceContract(unexplained).missing.some(item=>item.path.endsWith('.reason')));
});

test('win rate alone, missing costs, and an invented stop cannot qualify a strategy',()=>{
  const winOnly=packet();winOnly.lifecycle.receipts[6].metrics=winOnly.lifecycle.receipts[6].metrics.filter(item=>item.name==='NET_EXPECTANCY');
  const winResult=validateEvidenceContract(winOnly);
  assert.equal(winResult.proposedNextStageReadiness,'BLOCKED');
  assert.ok(winResult.missing.some(item=>item.reason==='COMPLETE_METRIC_SET_REQUIRED'));
  const costs=packet();delete costs.strategy.costAssumptions.slippage;
  assert.ok(validateEvidenceContract(costs).missing.some(item=>item.path.endsWith('.slippage')));
  const noStop=packet();noStop.strategy.risk.stopDefinition='';
  assert.ok(validateEvidenceContract(noStop).missing.some(item=>item.path==='strategy.risk.stopDefinition'));
});

test('non-stop portfolio risk must be explicit and must not fabricate a stop',()=>{
  const valid=packet();valid.strategy.risk={
    type:'PORTFOLIO_NON_STOP',policy:'Portfolio-level exposure and loss policy.',
    stopDefinition:null,justification:'A stop is not applicable to this explicitly specified allocator.'
  };
  assert.equal(validateEvidenceContract(valid).proposedNextStageReadiness,'READY_UNVERIFIED');
  valid.strategy.risk.stopDefinition='Invented stop';
  assert.ok(validateEvidenceContract(valid).invalid.some(item=>item.reason==='NON_STOP_POLICY_MUST_NOT_INVENT_STOP'));
});

test('known frozen failures and frozen references cannot be revived by synthetic receipts',()=>{
  for(const id of ['Baseline 6.2','Shadow V1','Regime V1','Breakout V1','Taker Flow V1','Regime Grid V2','LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN']){
    const input=packet();input.strategy.id=id;
    input.lifecycle.receipts.forEach(receipt=>{receipt.strategyId=id;});
    const result=validateEvidenceContract(input);
    assert.equal(result.proposedNextStageReadiness,'BLOCKED',id);
    assert.ok(result.invalid.some(item=>item.reason==='KNOWN_FROZEN_OR_REFERENCE_ID'),id);
  }
  const migration=packet();migration.strategy.disposition='MIGRATION_RECONCILIATION_REQUIRED';
  assert.ok(validateEvidenceContract(migration).invalid.some(item=>item.reason==='MIGRATION_OR_FROZEN_EVIDENCE_REQUIRED'));
});

test('unsafe shapes, unknown enums, and nonfinite metrics fail closed',()=>{
  const nonfinite=packet();nonfinite.lifecycle.receipts[6].metrics[0].value=Infinity;
  assert.equal(validateEvidenceContract(nonfinite).evidenceCompleteness,'INVALID');
  const badEnum=packet();badEnum.lifecycle.receipts[6].status='MAYBE';
  assert.ok(validateEvidenceContract(badEnum).invalid.some(item=>item.reason==='UNKNOWN_ENUM'));
  const accessor={};Object.defineProperty(accessor,'schemaVersion',{enumerable:true,get(){throw new Error('must not execute');}});
  const unsafe=validateEvidenceContract(accessor);
  assert.equal(unsafe.evidenceCompleteness,'INVALID');
  assert.equal(unsafe.executionAuthorized,false);
  const sparse=packet();sparse.strategy.telemetry=new Array(1);
  assert.equal(validateEvidenceContract(sparse).evidenceCompleteness,'INVALID');
  const coercion=packet();coercion.lifecycle.proposedNextStage={toString:'unsafe',valueOf:'unsafe'};
  assert.equal(validateEvidenceContract(coercion).proposedNextStageReadiness,'BLOCKED');
});
