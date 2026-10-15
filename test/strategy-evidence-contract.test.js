import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateEvidenceContract} from '../docs/strategy-lab/validate-evidence-contract.mjs';

const stages=[
  'IDEA','RESEARCH','BACKTEST','OUT_OF_SAMPLE_HOLDOUT',
  'PAPER_BOT','FORWARD_VALIDATION','ROBUSTNESS_REVIEW'
];
const names=[
  'NET_EXPECTANCY','PROFIT_FACTOR','DRAWDOWN','SHARPE','SORTINO',
  'TAIL_RISK','COST_SENSITIVITY','REGIME_STABILITY','TIME_STABILITY',
  'ASSET_STABILITY','UNCERTAINTY','SAMPLE_DEPENDENCE','SELECTION_RISK'
];
const flags=[
  'canonicalExecutionAuthorized','strategyPnlAuthorized','discoveryAuthorized',
  'validationAuthorized','holdoutAuthorized','paperAuthorized','liveAuthorized'
];
const hash=char=>char.repeat(64);
const rulesRef={id:'rules-alpha-v1',sha256:hash('a')};
const time=(day,hour='00')=>`2025-01-${String(day).padStart(2,'0')}T${hour}:00:00Z`;

function metrics(){
  return names.map(name=>({
    name,applicability:'APPLICABLE',value:name==='DRAWDOWN'?5:1.2,
    unit:name==='DRAWDOWN'?'percent':'ratio',
    denominator:{value:50,unit:'trades'},reason:null,threshold:null
  }));
}

function reference(stage,index,disjointFrom=[]){
  return{
    id:`data-ref-${stage.toLowerCase()}`,datasetId:`dataset-${stage.toLowerCase()}`,
    sha256:hash(String(index+1)),role:{
      BACKTEST:'DEVELOPMENT',OUT_OF_SAMPLE_HOLDOUT:'HOLDOUT',
      FORWARD_VALIDATION:'FORWARD',ROBUSTNESS_REVIEW:'ROBUSTNESS'
    }[stage],
    disjointFrom,asKnownAt:time([12,22,34,44][index]??50)
  };
}

function outcome(stage,index,{status='PRESENT_ASSERTED',kind='OUTCOME',windowStart,windowEnd,availableAt,recordedAt,disjointFrom=[]}={}){
  const dataRef=reference(stage,index,disjointFrom);
  if(availableAt)dataRef.asKnownAt=availableAt;
  return{
    stage,kind,status,receiptRef:`receipt-${stage.toLowerCase()}`,
    recordedAt:recordedAt??time([12,22,34,44][index]??50,'12'),
    strategyId:'hypothesis-alpha',strategyVersion:'v1',rulesRef:structuredClone(rulesRef),
    dataRef,
    dataWindow:{
      start:windowStart??time([2,13,25,35][index]??40),
      end:windowEnd??time([10,20,30,40][index]??45),
      availableAt:availableAt??time([11,21,31,41][index]??46)
    },
    plannedWindow:null,
    preregistration:{
      id:`predeclared-${stage.toLowerCase()}`,sha256:hash(String(index+5)),
      declaredAt:time(1),declaredBy:'synthetic fixture author',source:'synthetic preregistration'
    },
    sample:{n:50,unit:'trades',dependenceApproach:'Chronological blocks declared.',uncertaintyApproach:'Uncertainty method declared; not computed.'},
    metrics:metrics(),holdoutAccess:null,resultReason:'Synthetic evidence assertion only.'
  };
}

function setupReceipt(){
  return{
    stage:'PAPER_BOT',kind:'PAPER_SETUP',status:'SETUP_RECORDED',
    receiptRef:'receipt-paper-setup',recordedAt:'2025-01-23T12:00:00Z',
    strategyId:'hypothesis-alpha',strategyVersion:'v1',rulesRef:structuredClone(rulesRef),
    dataRef:null,dataWindow:null,
    plannedWindow:{start:'2025-02-01T00:00:00Z',end:'2025-03-01T00:00:00Z'},
    preregistration:null,sample:null,metrics:null,holdoutAccess:null,
    resultReason:'Paper setup claim only; observation is planned, not completed.'
  };
}

function packet(){
  const receipts=[
    {
      stage:'IDEA',kind:'DESIGN',status:'PRESENT_ASSERTED',receiptRef:'receipt-idea',
      recordedAt:'2024-12-01T00:00:00Z',strategyId:'hypothesis-alpha',strategyVersion:'v1',
      rulesRef:structuredClone(rulesRef),dataRef:null,dataWindow:null,plannedWindow:null,
      preregistration:null,sample:null,metrics:null,holdoutAccess:null,resultReason:'Synthetic idea.'
    },
    {
      stage:'RESEARCH',kind:'DESIGN',status:'PRESENT_ASSERTED',receiptRef:'receipt-research',
      recordedAt:'2024-12-15T00:00:00Z',strategyId:'hypothesis-alpha',strategyVersion:'v1',
      rulesRef:structuredClone(rulesRef),dataRef:null,dataWindow:null,plannedWindow:null,
      preregistration:null,sample:null,metrics:null,holdoutAccess:null,resultReason:'Synthetic research.'
    },
    outcome('BACKTEST',0,{windowStart:time(2),windowEnd:time(10),availableAt:time(11),recordedAt:time(12,'12')}),
    outcome('OUT_OF_SAMPLE_HOLDOUT',1,{
      windowStart:time(13),windowEnd:time(20),availableAt:time(21),recordedAt:time(22,'12'),
      disjointFrom:['dataset-backtest']
    }),
    setupReceipt(),
    outcome('FORWARD_VALIDATION',2,{
      windowStart:'2025-02-01T00:00:00Z',windowEnd:'2025-02-28T00:00:00Z',
      availableAt:'2025-03-01T00:00:00Z',recordedAt:'2025-03-02T12:00:00Z',
      disjointFrom:['dataset-out_of_sample_holdout']
    }),
    outcome('ROBUSTNESS_REVIEW',3,{
      windowStart:'2025-03-03T00:00:00Z',windowEnd:'2025-03-10T00:00:00Z',
      availableAt:'2025-03-11T00:00:00Z',recordedAt:'2025-03-12T12:00:00Z'
    })
  ];
  receipts[3].holdoutAccess={
    history:'KNOWN',
    exposures:[{role:'FIRST_EXPOSURE',at:'2025-01-22T12:00:00Z',purpose:'First declared holdout inspection.'}]
  };
  return{
    schemaVersion:'MERIDIAN_PAPER_FIRST_EVIDENCE_V2',asOf:'2026-10-14T21:00:00Z',
    syntheticFixture:true,
    checkpoint:{
      id:'MERIDIAN_LIVE_CHECKPOINT',mainSha:'efec133f4ff8a809722b79fa7c5fe8007667c1ea',
      stage:'SOURCE_AUDIT',sourceOnly:true,flags:Object.fromEntries(flags.map(flag=>[flag,false]))
    },
    strategy:{
      id:'hypothesis-alpha',version:'v1',
      hypothesis:'Synthetic hypothesis used only to exercise the evidence schema.',
      entry:'Declared synthetic entry.',exit:'Declared synthetic exit.',
      riskPolicy:{
        type:'STOP_BASED',policy:'Declared bounded risk policy.',
        stopDefinition:'Declared stop rule.',justification:'Synthetic fixture.',
        maxLossBound:'Declared in the strategy policy.',source:'Synthetic risk policy.'
      },
      positionSizing:{method:'Declared method',unit:'account risk',policy:'Declared sizing',source:'Synthetic policy.'},
      costAssumptions:Object.fromEntries(['fee','spread','slippage','funding','borrow'].map(key=>[
        key,{status:'ASSUMED',value:0.01,unit:'percent',source:'Synthetic assumption.',reason:null}
      ])),
      marketConditions:['Synthetic market conditions.'],
      telemetry:['Entry, exit, risk, costs and data version.'],
      invalidationConditions:['Declared thesis invalidation.'],
      frozenAt:'2025-01-01T00:00:00Z',disposition:'NEW_HYPOTHESIS',
      rulesRef:structuredClone(rulesRef),
      tradePlanPolicy:{
        policyId:'PLANNED_NET_CRV_MIN_3_V1',source:'docs/strategy-lab/TRADE_PLAN_CRV.md',
        applicability:'APPLICABLE_FINITE_TRADE_PAYOFF',status:'ASSERTED_UNVERIFIED',reason:null
      }
    },
    lifecycle:{currentStage:'ROBUSTNESS_REVIEW',receipts},
    trialLedger:{declaredTrials:4,reportedTrials:4,source:'Synthetic ledger fixture.'},
    edgeHealth:{classification:'EXPERIMENTAL',source:'Synthetic edge classification.',measuredAt:'2025-03-12T12:00:00Z',metricRef:'synthetic-ref'}
  };
}

function issue(result,reason){return result.evidenceCompleteness.issues.some(item=>item.reason===reason);}

test('complete synthetic assertions are well-formed, preserve axes, and never grant authority',()=>{
  const input=packet(),before=JSON.stringify(input);
  const first=validateEvidenceContract(input);
  assert.deepEqual(first,validateEvidenceContract(input));
  assert.equal(first.evidenceCompleteness.status,'ASSERTED_WELL_FORMED');
  assert.equal(first.lifecycle.claimedStage,'ROBUSTNESS_REVIEW');
  assert.equal(first.lifecycle.provenance,'UNVERIFIED_CALLER_SUPPLIED');
  assert.equal(first.edgeHealth.classification,'EXPERIMENTAL');
  assert.equal(first.edgeHealth.provenance,'ASSERTED_UNVERIFIED');
  assert.equal(first.operationalReadiness,'NOT_ASSESSED');
  assert.equal(first.authority.executionAuthorized,false);
  assert.equal(first.authority.autoPromotion,false);
  assert.equal(first.provenanceVerified,false);
  assert.equal(first.syntheticFixture,true);
  assert.equal(first.tradePlanPolicy.status,'NOT_ASSESSED');
  assert.equal(first.evidenceCompleteness.issues.some(item=>item.reason.includes('PASS')),false);
  assert.equal(JSON.stringify(input),before);
  assert.doesNotThrow(()=>JSON.stringify(first));
});

test('a prospective Paper setup can precede its planned window without claiming outcome metrics',()=>{
  const input=packet();
  input.lifecycle.currentStage='PAPER_BOT';
  input.lifecycle.receipts=input.lifecycle.receipts.slice(0,5);
  const result=validateEvidenceContract(input);
  assert.equal(result.lifecycle.claimedStage,'PAPER_BOT');
  assert.equal(result.evidenceCompleteness.status,'ASSERTED_WELL_FORMED');
  assert.equal(result.lifecycle.receipts.at(-1).kind,'PAPER_SETUP');
  assert.equal(result.lifecycle.receipts.at(-1).metrics.length,0);
  assert.equal(issue(result,'OUTCOME_NOT_AVAILABLE_AT_RECORDING'),false);
  const beforeFreeze=packet();
  beforeFreeze.lifecycle.receipts[4].recordedAt='2024-12-31T00:00:00Z';
  assert.ok(issue(validateEvidenceContract(beforeFreeze),'PAPER_SETUP_PRECEDES_RULES_FREEZE'));
});

test('completed results cannot be recorded before the observed window or after as-of',()=>{
  const early=packet();
  early.lifecycle.receipts[5].recordedAt='2025-02-20T00:00:00Z';
  assert.ok(issue(validateEvidenceContract(early),'OUTCOME_NOT_AVAILABLE_AT_RECORDING'));
  const future=packet();
  future.lifecycle.receipts[6].recordedAt='2030-03-12T12:00:00Z';
  assert.ok(issue(validateEvidenceContract(future),'FUTURE_RECORDING'));
  const futureData=packet();
  futureData.lifecycle.receipts[6].dataWindow.availableAt='2030-03-11T00:00:00Z';
  assert.ok(issue(validateEvidenceContract(futureData),'OUTCOME_NOT_AVAILABLE_AT_RECORDING'));
});

test('historical Backtest data may predate rules freeze when evaluation is declared after freeze',()=>{
  const input=packet();
  input.strategy.frozenAt='2025-01-11T00:00:00Z';
  input.lifecycle.receipts[2].dataWindow.start='2025-01-02T00:00:00Z';
  input.lifecycle.receipts[2].dataWindow.end='2025-01-10T00:00:00Z';
  input.lifecycle.receipts[2].dataWindow.availableAt='2025-01-11T11:00:00Z';
  input.lifecycle.receipts[2].dataRef.asKnownAt='2025-01-11T11:00:00Z';
  input.lifecycle.receipts[2].preregistration.declaredAt='2025-01-11T00:00:00Z';
  input.lifecycle.receipts[3].preregistration.declaredAt='2025-01-11T00:00:00Z';
  input.lifecycle.receipts[5].preregistration.declaredAt='2025-01-11T00:00:00Z';
  input.lifecycle.receipts[6].preregistration.declaredAt='2025-01-11T00:00:00Z';
  assert.equal(validateEvidenceContract(input).evidenceCompleteness.status,'ASSERTED_WELL_FORMED');

  const forward=packet();
  forward.strategy.frozenAt='2025-02-02T00:00:00Z';
  assert.ok(issue(validateEvidenceContract(forward),'PROSPECTIVE_WINDOW_PRECEDES_RULES_FREEZE'));
});

test('rules source identity is bound across receipt IDs and version changes require a new lineage',()=>{
  const rules=packet();
  rules.lifecycle.receipts[5].rulesRef={id:'different-source-id',sha256:hash('b')};
  const rulesResult=validateEvidenceContract(rules);
  assert.ok(issue(rulesResult,'STRATEGY_RULES_IDENTITY_MISMATCH'));
  const version=packet();version.lifecycle.receipts[5].strategyVersion='v2';
  assert.ok(issue(validateEvidenceContract(version),'STRATEGY_IDENTITY_MISMATCH'));
});

test('stage-specific data digests may differ when their references and roles are correctly declared',()=>{
  const input=packet();
  assert.notEqual(input.lifecycle.receipts[2].dataRef.sha256,input.lifecycle.receipts[3].dataRef.sha256);
  assert.notEqual(input.lifecycle.receipts[3].dataRef.sha256,input.lifecycle.receipts[5].dataRef.sha256);
  assert.equal(validateEvidenceContract(input).evidenceCompleteness.status,'ASSERTED_WELL_FORMED');
  const wrongRole=packet();wrongRole.lifecycle.receipts[5].dataRef.role='HOLDOUT';
  assert.ok(issue(validateEvidenceContract(wrongRole),'DATA_REFERENCE_WRONG_STAGE'));
  const conflictingIdentity=packet();
  conflictingIdentity.lifecycle.receipts[3].dataRef.id=conflictingIdentity.lifecycle.receipts[2].dataRef.id;
  assert.ok(issue(validateEvidenceContract(conflictingIdentity),'DATA_REFERENCE_IDENTITY_CONFLICT'));
  const conflictingDataset=packet();
  conflictingDataset.lifecycle.receipts[3].dataRef.datasetId=conflictingDataset.lifecycle.receipts[2].dataRef.datasetId;
  assert.ok(issue(validateEvidenceContract(conflictingDataset),'DATASET_DIGEST_CONFLICT'));
});

test('holdout and forward evidence must be disjoint in both declared identity and observed windows',()=>{
  const overlap=packet();
  overlap.lifecycle.receipts[3].dataWindow.start='2025-01-08T00:00:00Z';
  assert.ok(issue(validateEvidenceContract(overlap),'HOLDOUT_WINDOW_OVERLAP'));
  const reused=packet();
  reused.lifecycle.receipts[5].dataRef.datasetId=reused.lifecycle.receipts[3].dataRef.datasetId;
  assert.ok(issue(validateEvidenceContract(reused),'FORWARD_DATASET_REUSED'));
  const undeclared=packet();
  undeclared.lifecycle.receipts[5].dataRef.disjointFrom=[];
  assert.ok(issue(validateEvidenceContract(undeclared),'HOLDOUT_FORWARD_DISJOINTNESS_NOT_DECLARED'));
  const forwardOverlap=packet();
  forwardOverlap.lifecycle.receipts[5].dataWindow.start='2025-01-20T00:00:00Z';
  assert.ok(issue(validateEvidenceContract(forwardOverlap),'FORWARD_WINDOW_PRECEDES_HOLDOUT_END'));
});

test('Holdout audit and exact reproduction remain diagnostic, not contaminated or fresh confirmation',()=>{
  const input=packet();
  input.lifecycle.receipts[3].holdoutAccess.exposures.push(
    {role:'EXACT_REPRODUCTION',at:'2025-02-01T00:00:00Z',purpose:'Faithful reproduction.'},
    {role:'AUDIT',at:'2025-02-02T00:00:00Z',purpose:'Historical audit.'},
    {role:'HASH_INSPECTION',at:'2025-02-03T00:00:00Z',purpose:'Receipt hash inspection.'}
  );
  const result=validateEvidenceContract(input);
  assert.equal(result.holdoutIndependence.status,'DIAGNOSTIC_ONLY');
  assert.equal(result.holdoutIndependence.freshConfirmation,'NOT_ASSESSED');
  assert.equal(result.evidenceCompleteness.issues.some(item=>item.reason==='HOLDOUT_NOT_INDEPENDENT_FOR_CONFIRMATION'),false);
});

test('unknown holdout exposure history blocks an independence claim; access count alone is not contamination',()=>{
  const unknown=packet();
  unknown.lifecycle.receipts[3].holdoutAccess={history:'UNKNOWN',exposures:[]};
  const unknownResult=validateEvidenceContract(unknown);
  assert.equal(unknownResult.holdoutIndependence.status,'UNKNOWN');
  assert.equal(unknownResult.holdoutIndependence.freshConfirmation,'NOT_ASSESSED');
  const manyAudits=packet();
  manyAudits.lifecycle.receipts[3].holdoutAccess.exposures=[
    {role:'FIRST_EXPOSURE',at:'2025-01-22T12:00:00Z',purpose:'First inspection.'},
    {role:'AUDIT',at:'2025-02-01T00:00:00Z',purpose:'Audit.'},
    {role:'HASH_INSPECTION',at:'2025-02-02T00:00:00Z',purpose:'Hash inspection.'}
  ];
  const auditResult=validateEvidenceContract(manyAudits);
  assert.equal(auditResult.holdoutIndependence.status,'DIAGNOSTIC_ONLY');
  assert.equal(auditResult.evidenceCompleteness.issues.some(item=>item.reason==='HOLDOUT_NOT_INDEPENDENT_FOR_CONFIRMATION'),false);
});

test('inconsistent first Holdout exposure timing cannot assert fresh confirmation',()=>{
  const afterResult=packet();
  afterResult.lifecycle.receipts[3].holdoutAccess.exposures[0].at='2025-01-23T00:00:00Z';
  const lateResult=validateEvidenceContract(afterResult);
  assert.ok(issue(lateResult,'HOLDOUT_FIRST_EXPOSURE_AFTER_RESULT'));
  assert.equal(lateResult.holdoutIndependence.status,'UNKNOWN');
  assert.equal(lateResult.holdoutIndependence.freshConfirmation,'NOT_ASSESSED');

  const beforeFreeze=packet();
  beforeFreeze.strategy.frozenAt='2025-01-23T00:00:00Z';
  const early=validateEvidenceContract(beforeFreeze);
  assert.ok(issue(early,'HOLDOUT_EXPOSURE_PRECEDES_RULES_FREEZE'));
  assert.equal(early.holdoutIndependence.status,'UNKNOWN');

  const beforeFirst=packet();
  beforeFirst.lifecycle.receipts[3].holdoutAccess.exposures.push(
    {role:'AUDIT',at:'2025-01-21T00:00:00Z',purpose:'Inconsistent earlier access.'}
  );
  const inconsistent=validateEvidenceContract(beforeFirst);
  assert.ok(issue(inconsistent,'HOLDOUT_ACCESS_PRECEDES_FIRST_EXPOSURE'));
  assert.equal(inconsistent.holdoutIndependence.status,'UNKNOWN');
});

test('selection exposure or reuse for another hypothesis blocks holdout independence',()=>{
  for(const role of ['SELECTION_OR_TUNING','REUSED_FOR_NEW_HYPOTHESIS']){
    const input=packet();
    input.lifecycle.receipts[3].holdoutAccess.exposures.push(
      {role,at:'2025-02-01T00:00:00Z',purpose:'Synthetic adverse exposure.'}
    );
    const result=validateEvidenceContract(input);
    assert.equal(result.holdoutIndependence.status,'CONTAMINATED_FOR_CONFIRMATION');
    assert.ok(issue(result,'HOLDOUT_NOT_INDEPENDENT_FOR_CONFIRMATION'));
  }
});

test('missing, failed, inconclusive, and not-assessed evidence retain distinct states',()=>{
  const missing=packet();missing.lifecycle.receipts[6].sample=null;
  assert.equal(validateEvidenceContract(missing).evidenceCompleteness.status,'INCOMPLETE');
  const failed=packet();failed.lifecycle.receipts[6].status='FAILED';
  assert.equal(validateEvidenceContract(failed).evidenceCompleteness.status,'FAILED');
  const inconclusive=packet();inconclusive.trialLedger.reportedTrials=5;
  assert.equal(validateEvidenceContract(inconclusive).evidenceCompleteness.status,'INCONCLUSIVE');
  const notAssessed=packet();notAssessed.lifecycle.receipts[6].metrics[0]={
    name:'NET_EXPECTANCY',applicability:'UNDEFINED',value:null,unit:null,denominator:null,
    reason:'Insufficient independent observations.',threshold:null
  };
  assert.equal(validateEvidenceContract(notAssessed).evidenceCompleteness.status,'NOT_ASSESSED');
});

test('undefined or inapplicable core expectancy, risk, cost, and uncertainty cannot be counted as present evidence',()=>{
  for(const name of ['NET_EXPECTANCY','DRAWDOWN','COST_SENSITIVITY','UNCERTAINTY','SAMPLE_DEPENDENCE']){
    const input=packet();
    input.lifecycle.receipts[6].metrics.find(metric=>metric.name===name).applicability='NOT_APPLICABLE';
    const result=validateEvidenceContract(input);
    assert.notEqual(result.evidenceCompleteness.status,'ASSERTED_WELL_FORMED',name);
    assert.ok(issue(result,'CORE_EVIDENCE_NOT_ESTABLISHED'),name);
  }
  const undefinedPf=packet();
  undefinedPf.lifecycle.receipts[6].metrics.find(metric=>metric.name==='PROFIT_FACTOR').applicability='UNDEFINED';
  undefinedPf.lifecycle.receipts[6].metrics.find(metric=>metric.name==='PROFIT_FACTOR').value=null;
  undefinedPf.lifecycle.receipts[6].metrics.find(metric=>metric.name==='PROFIT_FACTOR').unit=null;
  undefinedPf.lifecycle.receipts[6].metrics.find(metric=>metric.name==='PROFIT_FACTOR').denominator=null;
  undefinedPf.lifecycle.receipts[6].metrics.find(metric=>metric.name==='PROFIT_FACTOR').reason='No losing trades; PF undefined.';
  assert.equal(validateEvidenceContract(undefinedPf).evidenceCompleteness.status,'NOT_ASSESSED');
});

test('optional Sharpe and Sortino can be explicitly inapplicable without zero defaults',()=>{
  const input=packet();
  for(const name of ['SHARPE','SORTINO']){
    Object.assign(input.lifecycle.receipts[6].metrics.find(metric=>metric.name===name),{
      applicability:'NOT_APPLICABLE',value:null,unit:null,denominator:null,
      reason:'Metric is not appropriate for this observation design.'
    });
  }
  const result=validateEvidenceContract(input);
  assert.equal(result.evidenceCompleteness.status,'NOT_ASSESSED');
  const claimed=result.lifecycle.receipts.at(-1).metrics.filter(metric=>['SHARPE','SORTINO'].includes(metric.name));
  assert.ok(claimed.every(metric=>metric.value===null));
});

test('sample size, dependence and uncertainty approach are explicit and never calculated',()=>{
  const input=packet();input.lifecycle.receipts[6].sample={n:-1,unit:'trades',dependenceApproach:'',uncertaintyApproach:''};
  const result=validateEvidenceContract(input);
  assert.ok(issue(result,'NONNEGATIVE_INTEGER_SAMPLE_REQUIRED'));
  assert.ok(result.evidenceCompleteness.issues.some(item=>item.path.endsWith('.dependenceApproach')));
  assert.ok(result.evidenceCompleteness.issues.some(item=>item.path.endsWith('.uncertaintyApproach')));
});

test('no-stop portfolio risk reports CRV not applicable and never claims policy satisfaction',()=>{
  const input=packet();
  input.strategy.riskPolicy={
    type:'PORTFOLIO_LEVEL_NO_STOP',policy:'Portfolio maximum exposure boundary.',
    stopDefinition:null,justification:'Portfolio-level risk rather than a fabricated trade stop.',
    maxLossBound:'Declared portfolio exposure limit.',source:'Synthetic policy.'
  };
  input.strategy.tradePlanPolicy.applicability='NOT_APPLICABLE_NO_FINITE_TRADE_PAYOFF';
  input.strategy.tradePlanPolicy.reason='No finite trade payoff is declared.';
  const result=validateEvidenceContract(input);
  assert.equal(result.tradePlanPolicy.applicability,'NOT_APPLICABLE_NO_FINITE_TRADE_PAYOFF');
  assert.equal(result.tradePlanPolicy.status,'NOT_ASSESSED');
  assert.equal(result.tradePlanPolicy.researchOnly,true);
  assert.equal(result.authority.executionAuthorized,false);
  input.strategy.riskPolicy.stopDefinition='Fabricated stop.';
  assert.ok(issue(validateEvidenceContract(input),'NO_STOP_POLICY_MUST_NOT_INVENT_STOP'));
});

test('policy applicability remains unresolved for unsupported payoff models',()=>{
  const input=packet();
  input.strategy.tradePlanPolicy.applicability='UNRESOLVED_POLICY_APPLICABILITY';
  input.strategy.tradePlanPolicy.reason='Payoff model applicability requires separate review.';
  const result=validateEvidenceContract(input);
  assert.equal(result.tradePlanPolicy.applicability,'UNRESOLVED_POLICY_APPLICABILITY');
  assert.equal(result.tradePlanPolicy.status,'NOT_ASSESSED');
  assert.equal(result.tradePlanPolicy.researchOnly,true);
});

test('retrospective migration annotations document gaps but cannot supply lifecycle receipts',()=>{
  const input=packet();
  input.strategy.disposition='EXISTING_RETROSPECTIVE';
  input.migrationAnnotation={
    kind:'RETROSPECTIVE_RECONCILIATION',strategyId:input.strategy.id,
    reconciledStages:['IDEA','RESEARCH'],gaps:['Original backtest receipt unavailable.'],
    source:'Historical inventory source.'
  };
  input.lifecycle.receipts=input.lifecycle.receipts.slice(0,2);
  input.lifecycle.currentStage='BACKTEST';
  const result=validateEvidenceContract(input);
  assert.equal(result.lifecycle.receipts.length,2);
  assert.ok(issue(result,'CONTIGUOUS_STAGE_RECEIPTS_REQUIRED'));
  assert.ok(issue(result,'HISTORICAL_RECONCILIATION_ONLY'));
});

test('known failed strategies and frozen LowVol remain unchanged and are not made eligible by fixtures',()=>{
  for(const id of ['Baseline 6.2','Shadow V1','Regime V1','Elliott Wave 5','Breakout V1','Taker Flow V1','Regime Grid V2','LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN']){
    const input=packet();input.strategy.id=id;
    input.lifecycle.receipts.forEach(receipt=>{receipt.strategyId=id;});
    const result=validateEvidenceContract(input);
    assert.ok(issue(result,'KNOWN_FROZEN_OR_REFERENCE_ID'),id);
    assert.equal(result.syntheticFixture,true);
    assert.equal(result.authority.executionAuthorized,false);
  }
});

test('checkpoint conflicts and caller-supplied true flags never appear as grants',()=>{
  const input=packet();input.checkpoint.flags=Object.fromEntries(flags.map(flag=>[flag,true]));
  const result=validateEvidenceContract(input);
  assert.equal(result.checkpointBinding,'BLOCKED');
  assert.equal(result.authority.executionAuthorized,false);
  assert.equal(result.authority.autoPromotion,false);
  assert.equal(JSON.stringify(result).includes('"paperAuthorized":true'),false);
  const absent=packet();delete absent.checkpoint;
  const absentResult=validateEvidenceContract(absent);
  assert.equal(absentResult.checkpointBinding,'BLOCKED');
  assert.equal(absentResult.authority.executionAuthorized,false);
});

test('malformed, cyclic, accessor, and bounded inputs return structured denials without side effects',()=>{
  const accessor={};Object.defineProperty(accessor,'asOf',{enumerable:true,get(){throw Error('unexpected execution');}});
  const cycle=packet();cycle.loop=cycle;
  const large=packet();large.extra=Array(129).fill('x');
  const deep=packet();let nested={};
  for(let i=0;i<14;i++)nested={child:nested};
  deep.nested=nested;
  for(const input of [null,accessor,cycle,large,deep]){
    const result=validateEvidenceContract(input);
    assert.equal(result.evidenceCompleteness.status,'INVALID');
    assert.equal(result.authority.executionAuthorized,false);
    assert.doesNotThrow(()=>JSON.stringify(result));
  }
  const nonfinite=packet();nonfinite.lifecycle.receipts[6].metrics[0].value=Infinity;
  assert.equal(validateEvidenceContract(nonfinite).evidenceCompleteness.status,'INVALID');
  const jsonPollution=JSON.parse('{"__proto__":{"polluted":true}}');
  assert.equal(validateEvidenceContract(jsonPollution).authority.executionAuthorized,false);
  assert.equal({}.polluted,undefined);
});

test('reason fields are stable neutral codes and validator contains no runtime or network hooks',()=>{
  const result=validateEvidenceContract(packet());
  for(const item of result.evidenceCompleteness.issues) {
    assert.equal(typeof item.reason,'string');
    assert.doesNotMatch(item.reason,/winner|best|ready to trade|approved|promote/i);
  }
  const source=readFileSync(new URL('../docs/strategy-lab/validate-evidence-contract.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|process\.env|Date\.now|Math\.random)\b|from\s+['"](?:node:)?(?:fs|https?)['"]/);
  assert.doesNotMatch(source,/paper-learning-policy|paper-cost-policy|server\.js/);
});
