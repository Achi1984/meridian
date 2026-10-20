import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MAX_HISTORICAL_FIXTURE_BYTES,parseArenaHistoricalResultFixture} from '../v11/arena-historical-result.js';
import {createStrategyArenaView} from '../v11/strategy-arena.js';

const digest = character=>character.repeat(64);
const timestamp = second=>`2026-01-01T00:00:${String(second).padStart(2,'0')}Z`;
const parse = value=>parseArenaHistoricalResultFixture(JSON.stringify(value));

function fixture({state='queued',resultStatus=null,screenStatus=null,descriptorOrder=null,computationOrder=null}={}) {
  const pathIds=descriptorOrder || Array.from({length:44},(_,index)=>
    (index+1).toString(16).padStart(64,'0'));
  const computationPathIds=computationOrder || [...pathIds].reverse();
  const completedCount=state==='completed'?44:resultStatus==='INSUFFICIENT_EVIDENCE'?19:0;
  const unresolved=state==='unknown';
  const attempted=!['queued','rejected'].includes(state);
  const paths=Array.from({length:completedCount},(_,index)=>({
    pathId:computationPathIds[index],ordinal:index+1,phase:index<19?'DEVELOPMENT':'DIAGNOSTIC',
    state:'completed',startedAt:timestamp(index%50),payloadSha256:digest('a'),completedAt:timestamp(index%50+1)
  }));
  if(state==='partial'||unresolved) {
    const index=paths.length;
    paths.push({pathId:computationPathIds[index],ordinal:index+1,
      phase:index<19?'DEVELOPMENT':'DIAGNOSTIC',state:'started',startedAt:timestamp(1)});
  }
  const controls=completedCount>=19?resultStatus==='INSUFFICIENT_EVIDENCE'&&completedCount===19
    ?{ok:false,status:'INSUFFICIENT_EVIDENCE',reason:'INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR',
      primarySd:null,benchmarkSd:null}
    :{status:'FROZEN_DEVELOPMENT_ONLY',meanExposure:0.5,riskExposure:0.25,
      primaryDevelopmentSd:0.02,fullBasketDevelopmentSd:0.08,
      calibration:'DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS'}
    :null;
  const screen=resultStatus==='INSUFFICIENT_EVIDENCE'?{status:'INSUFFICIENT_EVIDENCE'}
    :screenStatus==='INSUFFICIENT_EVIDENCE'
      ?{status:'INSUFFICIENT_EVIDENCE',checks:{fullBasketDrawdownDenominator:false},
        relativeDrawdownReduction:null}
      :{status:screenStatus || 'PASS',interpretation:'HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT',
        comparisonSegment:'diagnostic',neighbourStressScenario:'stress-30bp-non-delayed',
        checks:{primaryDiagnosticNetPositive:true,primaryDiagnosticDrawdownAtMost25Percent:true,
          primaryReturnAtLeastBothFrozenControls:true,primaryDrawdownAtMostBothFrozenControls:true,
          relativeDrawdownReductionAtLeast20Percent:true,primaryNetPositiveAt30bpNonDelayed:true,
          primaryNetPositiveAt30bpPlusDelay:true,atLeastThreeOfFourNeighboursPositiveAt15bp:true,
          atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed:true},
        relativeDrawdownReduction:null,neighbourPositiveCounts:{base15bp:3,stress30bp:3},
        stopPolicy:'NO_FINITE_TRADE_STOP',tradeCRV:{status:'UNDEFINED_NO_FINITE_STOP',value:null}};
  const completedPathIds=new Set(computationPathIds.slice(0,completedCount));
  const result= resultStatus ? {
    attemptedPaths:completedCount,authority:{researchOnly:true,executionAuthorized:false,
      strategyPnlAuthorized:false,discoveryAuthorized:false,validationAuthorized:false,
      holdoutAuthorized:false,paperAuthorized:false,liveAuthorized:false},
    budget:{},completedPaths:completedCount,computedPaths:completedCount,controlRealization:[],
    evidence:{syntheticFixture:false,priceSource:'PINNED_KRAKEN_SPOT_USD_CANDLES',
      sourceAuthenticity:'NOT_ESTABLISHED',historyLabel:'DEVELOPMENT_AND_HISTORICAL_DIAGNOSTIC',
      candidateInterpretation:'HISTORICAL_CANDIDATE_ONLY_IF_PROPOSED_REAL_SCREEN_PASSES',
      costModel:'OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE',
      executionEvidence:'NOT_OKX_EXECUTION_EVIDENCE',holdoutClaim:false,trialLedger:'UNKNOWN',
      diagnosticRescaling:'NONE',stoppedPolicy:'NO_FINITE_TRADE_STOP',
      crv:{status:'UNDEFINED_NO_FINITE_STOP',value:null,researchOnly:true},
      survivorship:'generated-fixture'},
    executionId:digest('b'),failure:null,
    identity:{datasetKind:'FROZEN_RESEARCH_INPUT',sourceCommit:'generated-fixture',
      sourceProvenance:{normalizedFileSha256:{}},canonicalSeriesSha256:{},inputSha256:digest('b')},
    implementationId:'generated',implementationSha256:digest('c'),plannedPaths:44,protocolId:'generated',
    protocolReview:{},protocolSha256:digest('f'),schema:'MERIDIAN_B1_7_ENGINE_RESULT_R3',
    screen,status:resultStatus,
    controlDefinitions:controls,
    paths:pathIds.map(pathId=>completedPathIds.has(pathId)
      ?{pathId,status:'COMPLETED',computed:true,attempts:1}
      :{pathId,kind:'CANDIDATE',variantId:'primary-n30-f25',scenarioId:'base-15bp',
        segmentId:'diagnostic',status:'NOT_RUN_INSUFFICIENT_EVIDENCE',computed:false,attempts:0,failure:null})
  } : null;
  const job={
    trialId:digest('e'),trialKey:'trial-generated-ui-fixture',state,attempts:attempted?1:0,
    owner:attempted?'generated-fixture-owner':null,fence:attempted?7:0,
    profile:'MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1',
    protocolSha256:digest('f'),sourceSha256:digest('a'),dataSha256:digest('b'),manifestSha256:digest('c'),
    pathIds,computationPathIds,
    timestamps:{createdAt:timestamp(0),startedAt:attempted?timestamp(1):null,
      finishedAt:state==='queued'||unresolved?null:timestamp(2)},
    paths,controls:controls===null?null:JSON.stringify(controls),
    controlBindings:controls===null?null:{primaryDevelopmentSha256:digest('a'),fullBasketDevelopmentSha256:digest('a')},
    result:result===null?null:JSON.stringify(result),
    resultSha256:result===null?null:digest('f'),summarySha256:result===null?null:digest('0'),
    reason:resultStatus==='INSUFFICIENT_EVIDENCE'?'INSUFFICIENT_EVIDENCE':null,
    unresolved,executionAuthorized:false,promotionAuthorized:false,profitabilityInferred:false
  };
  return {schema:'MERIDIAN_B1_HISTORICAL_UI_FIXTURE_V1',evidenceClass:'SYNTHETIC_ONLY',
    purpose:'UI_FIXTURE_NOT_PRODUCER_EXPORT',job};
}

function rootFixture() {
  const listeners=new Map();
  return {
    innerHTML:'',
    contains:()=>true,
    addEventListener:(name,handler)=>listeners.set(name,handler),
    removeEventListener:name=>listeners.delete(name),
    replaceChildren(){this.innerHTML='';},
    importHistorical(file){return listeners.get('change')({type:'change',target:{
      closest:selector=>selector==='[data-arena-historical-fixture]'?{files:[file]}:null
    }});},
    listeners
  };
}
const file = text=>({size:new TextEncoder().encode(text).length,text:async()=>text});
const deferred = ()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

test('generated lifecycle fixtures keep lifecycle separate from result status',()=>{
  for(const state of ['queued','rejected','failed','timed_out','partial','unknown']){
    const projection=parse(fixture({state}));
    assert.equal(projection.status,'PRESENT_UNVERIFIED',state);
    assert.equal(projection.job.state,state);
    assert.equal(projection.result,null);
  }
  const unknown=parse(fixture({state:'unknown'}));
  assert.equal(unknown.job.unresolved,true);
  assert.equal(unknown.job.paths[0].state,'started');
  const settledUnknown=fixture({state:'unknown'});
  settledUnknown.job.unresolved=false;
  settledUnknown.job.timestamps.finishedAt=timestamp(2);
  assert.equal(parse(settledUnknown).status,'PRESENT_UNVERIFIED');
  const insufficient=parse(fixture({state:'failed',resultStatus:'INSUFFICIENT_EVIDENCE'}));
  assert.equal(insufficient.status,'PRESENT_UNVERIFIED',JSON.stringify(insufficient));
  assert.equal(insufficient.job.state,'failed');
  assert.equal(insufficient.result.status,'INSUFFICIENT_EVIDENCE');
  assert.equal(insufficient.result.completedPaths,19);
});

test('complete descriptor and computation identities retain their independent order',()=>{
  const descriptorOrder=Array.from({length:44},(_,index)=>
    (index+1).toString(16).padStart(64,'0'));
  const computationOrder=[...descriptorOrder].reverse();
  const queued=parse(fixture({descriptorOrder,computationOrder}));
  assert.equal(queued.status,'PRESENT_UNVERIFIED');
  assert.deepEqual(queued.job.pathIds,descriptorOrder);
  assert.deepEqual(queued.job.computationPathIds,computationOrder);
  const completed=parse(fixture({state:'completed',resultStatus:'COMPLETED',
    descriptorOrder,computationOrder}));
  assert.equal(completed.status,'PRESENT_UNVERIFIED',JSON.stringify(completed));
  assert.equal(completed.job.paths.length,44);
  assert.equal(completed.result.paths.length,44);
  assert.equal(completed.result.status,'COMPLETED');
});

test('all 44 completed paths may have an insufficient screen result',()=>{
  const projection=parse(fixture({state:'completed',resultStatus:'COMPLETED',
    screenStatus:'INSUFFICIENT_EVIDENCE'}));
  assert.equal(projection.status,'PRESENT_UNVERIFIED',JSON.stringify(projection));
  assert.equal(projection.job.state,'completed');
  assert.equal(projection.result.status,'COMPLETED');
  assert.equal(projection.result.screen.status,'INSUFFICIENT_EVIDENCE');
  assert.equal(projection.result.completedPaths,44);
});

test('duplicate, conflicting, outside-inventory and contradictory identities fail closed',()=>{
  const mutations=[
    value=>value.job.pathIds[1]=value.job.pathIds[0],
    value=>value.job.computationPathIds[1]=value.job.computationPathIds[0],
    value=>value.job.computationPathIds[0]=digest('f'),
    value=>value.job.paths[0].pathId=digest('f'),
    value=>value.job.paths[1].pathId=value.job.paths[0].pathId,
    value=>value.job.controlBindings.primaryDevelopmentSha256=digest('9'),
    value=>value.job.result=JSON.stringify({...JSON.parse(value.job.result),
      paths:JSON.parse(value.job.result).paths.map((path,index)=>index===0?{...path,pathId:digest('f')}:path)}),
    value=>value.job.result=JSON.stringify({...JSON.parse(value.job.result),
      paths:JSON.parse(value.job.result).paths.map((path,index)=>index===1?{...path,pathId:digest('0')}:path)}),
    value=>value.job.paths.pop(),
    value=>value.job.state='failed',
    value=>{
      const result=JSON.parse(value.job.result);
      value.job.result=JSON.stringify({...result,status:'INSUFFICIENT_EVIDENCE',
        attemptedPaths:19,completedPaths:19,computedPaths:19});
    },
    value=>{
      const result=JSON.parse(value.job.result);
      value.job.result=JSON.stringify({...result,protocolSha256:digest('9')});
    },
    value=>{
      const result=JSON.parse(value.job.result);
      value.job.result=JSON.stringify({...result,identity:{...result.identity,inputSha256:digest('9')}});
    },
    value=>{
      const result=JSON.parse(value.job.result);
      value.job.result=JSON.stringify({...result,paths:result.paths.map((path,index)=>
        index===0?{...path,attempts:999}:path)});
    }
  ];
  for(const [index,mutate] of mutations.entries()){
    const value=fixture({state:'completed',resultStatus:'COMPLETED'});
    mutate(value);
    assert.equal(parse(value).status,'INVALID',`mutation ${index}`);
  }
});

test('strict envelopes, nested JSON, bounded depth, finite values and authority escalation are rejected',()=>{
  const malformed=fixture({state:'failed',resultStatus:'INSUFFICIENT_EVIDENCE'});
  assert.equal(parse({...malformed,extra:true}).status,'INVALID');
  assert.equal(parse({...malformed,job:{...malformed.job,extra:true}}).status,'INVALID');
  const duplicateEnvelope=JSON.stringify(malformed).replace('"schema":"MERIDIAN_B1_HISTORICAL_UI_FIXTURE_V1"',
    '"schema":"MERIDIAN_B1_HISTORICAL_UI_FIXTURE_V1","schema":"MERIDIAN_B1_HISTORICAL_UI_FIXTURE_V1"');
  assert.equal(parseArenaHistoricalResultFixture(duplicateEnvelope).status,'INVALID');
  const duplicateResult=fixture({state:'failed',resultStatus:'INSUFFICIENT_EVIDENCE'});
  duplicateResult.job.result=duplicateResult.job.result.replace('"status":"INSUFFICIENT_EVIDENCE"',
    '"status":"INSUFFICIENT_EVIDENCE","status":"INSUFFICIENT_EVIDENCE"');
  assert.equal(parse(duplicateResult).status,'INVALID');
  for(const invalidValue of [
    {...malformed,job:{...malformed.job,controls:'{'}},
    {...malformed,job:{...malformed.job,result:'{'}},
    {...malformed,job:{...malformed.job,executionAuthorized:true}},
    {...malformed,job:{...malformed.job,result:JSON.stringify({...JSON.parse(malformed.job.result),
      authority:{...JSON.parse(malformed.job.result).authority,liveAuthorized:true}})}}
  ]) assert.equal(parse(invalidValue).status,'INVALID');

  for(const mutate of [
    result=>result.screen=null,
    result=>result.screen={status:'BOGUS'},
    result=>delete result.screen.checks.primaryDiagnosticNetPositive,
    result=>result.screen.tradeCRV.value=0.2,
    result=>result.evidence.stoppedPolicy='FINITE_STOP'
  ]) {
    const value=fixture({state:'completed',resultStatus:'COMPLETED'});
    const result=JSON.parse(value.job.result);mutate(result);
    value.job.result=JSON.stringify(result);
    assert.equal(parse(value).status,'INVALID');
  }

  const deep=fixture({state:'failed',resultStatus:'INSUFFICIENT_EVIDENCE'});
  let nested={};
  for(let index=0;index<14;index++)nested={failure:nested};
  deep.job.result=JSON.stringify({...JSON.parse(deep.job.result),failure:nested});
  assert.equal(parse(deep).status,'INVALID');
  const nonfinite=fixture({state:'failed',resultStatus:'INSUFFICIENT_EVIDENCE'});
  nonfinite.job.result=nonfinite.job.result.replace('"protocolReview":{}','"protocolReview":{"r1RequestId":1e400}');
  assert.equal(parse(nonfinite).status,'INVALID');
  const tooLong=fixture({state:'failed',resultStatus:'INSUFFICIENT_EVIDENCE'});
  tooLong.job.result=tooLong.job.result.replace('"protocolReview":{}',
    `"protocolReview":{"r1RequestId":"${'x'.repeat(4097)}"}`);
  assert.equal(parse(tooLong).status,'INVALID');
});

test('UTF-8 byte ceiling and malformed top-level JSON are rejected before projection',()=>{
  assert.equal(parseArenaHistoricalResultFixture(null).status,'INVALID');
  assert.equal(parseArenaHistoricalResultFixture('{').status,'INVALID');
  assert.equal(parseArenaHistoricalResultFixture('é'.repeat(MAX_HISTORICAL_FIXTURE_BYTES/2+1)).status,'INVALID');
  assert.equal(parseArenaHistoricalResultFixture(' '.repeat(MAX_HISTORICAL_FIXTURE_BYTES+1)).status,'INVALID');
});

test('historical fixture renders escaped producer fields without network, digest or replay',async t=>{
  let fetchCalls=0,digestCalls=0;
  t.mock.method(globalThis.crypto.subtle,'digest',()=>{digestCalls++;throw Error('No hashing expected');});
  const root=rootFixture(),view=createStrategyArenaView(root,{fetchImpl:()=>{fetchCalls++;throw Error('No fetch');}});
  const cards=html=>[...html.matchAll(/<article class="arena-model-card">[\s\S]*?<\/article>/g)].map(match=>match[0]);
  const before=cards(root.innerHTML);
  const payload=fixture({state:'failed',resultStatus:'INSUFFICIENT_EVIDENCE'});
  payload.job.reason='<img src=x onerror=alert(1)>';
  await root.importHistorical(file(JSON.stringify(payload)));
  assert.deepEqual(cards(root.innerHTML),before);
  assert.match(root.innerHTML,/SYNTHETIC_ONLY/);
  assert.match(root.innerHTML,/Lifecycle: failed/);
  assert.match(root.innerHTML,/Engine-Ergebnisstatus: INSUFFICIENT_EVIDENCE/);
  assert.match(root.innerHTML,/Screenstatus: INSUFFICIENT_EVIDENCE/);
  assert.match(root.innerHTML,/DEVELOPMENT_AND_HISTORICAL_DIAGNOSTIC/);
  assert.match(root.innerHTML,/NOT_ESTABLISHED/);
  assert.match(root.innerHTML,/NO_FINITE_TRADE_STOP/);
  assert.match(root.innerHTML,/OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE/);
  assert.match(root.innerHTML,/DESKRIPTORENREIHENFOLGE|pathIds/i);
  assert.match(root.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(root.innerHTML,/<img src=x onerror=alert\(1\)>/);
  assert.equal(fetchCalls,0);assert.equal(digestCalls,0);
  await root.importHistorical(file('{'));
  assert.match(root.innerHTML,/role="alert"/);
  assert.doesNotMatch(root.innerHTML,/Lifecycle: failed/);
  assert.deepEqual(cards(root.innerHTML),before);
  view.dispose();
});

test('visible insufficient summaries retain the producer no-finite-stop limitation',async()=>{
  const root=rootFixture(),view=createStrategyArenaView(root);
  const stopSummary=()=>root.innerHTML.match(/<p>Quellenauthentizität:[\s\S]*?<\/p>/)?.[0];
  for(const value of [
    fixture({state:'failed',resultStatus:'INSUFFICIENT_EVIDENCE'}),
    fixture({state:'completed',resultStatus:'COMPLETED',screenStatus:'INSUFFICIENT_EVIDENCE'})
  ]) {
    await root.importHistorical(file(JSON.stringify(value)));
    assert.match(stopSummary() || '',/Quellenauthentizität: NOT_ESTABLISHED · Stoppregel: NO_FINITE_TRADE_STOP/);
  }
  view.dispose();
});

test('oversize, unreadable, stale and disposed fixture imports clear the projection',async()=>{
  const root=rootFixture(),view=createStrategyArenaView(root);
  await root.importHistorical({size:MAX_HISTORICAL_FIXTURE_BYTES+1,text:()=>{throw Error('must not read');}});
  assert.match(root.innerHTML,/abgelehnt/);
  const oldRead=deferred();
  const older=root.importHistorical({size:100,text:()=>oldRead.promise});
  await root.importHistorical(file(JSON.stringify(fixture({state:'queued'}))));
  await root.importHistorical({size:100,text:async()=>{throw Error('/private/path');}});
  assert.match(root.innerHTML,/abgelehnt/);
  assert.doesNotMatch(root.innerHTML,/trial-generated-ui-fixture|private\/path/);
  const late=deferred();
  const pending=root.importHistorical({size:100,text:()=>late.promise});
  view.dispose();
  oldRead.resolve(JSON.stringify(fixture({state:'queued'})));
  late.resolve(JSON.stringify(fixture({state:'queued'})));
  await pending;await older;
  assert.equal(root.innerHTML,'');
  assert.equal(root.listeners.size,0);
});

test('historical fixture projector has no engine, replay, network or storage dependency',()=>{
  const source=readFileSync(new URL('../v11/arena-historical-result.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/^import\s|\b(?:fetch|localStorage|sessionStorage|replayStrategyPaperArena|evaluateArenaImport|loadStoredArena)\s*\(/m);
});
