import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  CROSS_VENUE_FUNDING_EDGE_V2_SOURCE,
  normalizeFunding,
  normalizeMarks,
  commonFundingTimes,
  recoveryAt,
  validateCrossVenueV2Source
} from '../research/cross-venue-funding-edge-v2-data-contract.js';
import {
  validateCrossVenueV2BuilderSource,
  buildCrossVenueV2EventStream,
  buildCrossVenueV2RecoveryInputs
} from '../research/cross-venue-funding-edge-v2-event-builder.js';
import {
  runV2RunnerStateMachine,
  splitEntryAllowed
} from '../research/cross-venue-funding-edge-v2-runner.js';
import {v2SourceCollectionGate} from '../research/cross-venue-funding-edge-v2-source-gate.js';

const H=60*60*1000;
const F=8*H;
const CONTRACT=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE;
const RAW_START=Date.parse(CONTRACT.rawStart);
const FUND_END=Date.parse(CONTRACT.fundingCoverageEnd);
const MARK_END=Date.parse(CONTRACT.markCoverageEnd);

function canonicalize(x){
  if(Array.isArray(x))return x.map(canonicalize);
  if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonicalize(x[k])]));
  return x;
}
function digest(x){
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(x))).digest('hex');
}
function makeDraft(){
  const binanceFunding=[],okxFunding=[],binanceMarks=[],okxMarks=[];
  for(let t=RAW_START;t<=FUND_END;t+=F){
    binanceFunding.push({fundingTime:t,fundingRate:.0002});
    okxFunding.push({fundingTime:t,fundingRate:.0001});
  }
  for(let t=RAW_START;t<=MARK_END;t+=H){
    const row={openTime:t,open:100,high:101,low:99,close:100,confirmed:true};
    binanceMarks.push({...row});
    okxMarks.push({...row});
  }
  return{
    schema:'CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-PACKAGE-1',
    researchOnly:true,
    executionImpact:false,
    stage:'SOURCE_AUDIT',
    contract:CONTRACT,
    provenance:{
      collectedAt:'2026-01-01T00:00:00.000Z',
      binanceChecksumsVerified:true,
      okxFundingArchivesHashed:true,
      okxMarkPagesHashed:true,
      deterministicParsing:true,
      strategyPnlCalculated:false
    },
    binanceFunding,okxFunding,binanceMarks,okxMarks
  };
}
function finalize(draft){
  const validation=validateCrossVenueV2Source(draft,CONTRACT);
  assert.equal(validation.ok,true,validation.reason);
  return{
    ...draft,
    integrityEvents:validation.integrityEvents,
    receipt:validation.receipt
  };
}
function draftFrom(pkg){
  return{
    schema:pkg.schema,
    researchOnly:pkg.researchOnly,
    executionImpact:pkg.executionImpact,
    stage:pkg.stage,
    contract:CONTRACT,
    provenance:{...pkg.provenance},
    binanceFunding:pkg.binanceFunding.map(x=>({...x})),
    okxFunding:pkg.okxFunding.map(x=>({...x})),
    binanceMarks:pkg.binanceMarks.map(x=>({...x})),
    okxMarks:pkg.okxMarks.map(x=>({...x}))
  };
}
function rebuild(pkg,mutate){
  const d=draftFrom(pkg);
  mutate?.(d);
  return finalize(d);
}
const VALIDATED_CACHE=new WeakMap();
const OUTPUT_CACHE=new WeakMap();
const FIXTURE_CACHE=new Map();

function cachedFixture(name,factory){
  if(!FIXTURE_CACHE.has(name))FIXTURE_CACHE.set(name,factory());
  return FIXTURE_CACHE.get(name);
}
function validated(pkg,expected=pkg.receipt.digest){
  if(expected===pkg.receipt.digest&&VALIDATED_CACHE.has(pkg))return VALIDATED_CACHE.get(pkg);
  const value=validateCrossVenueV2BuilderSource({packageData:pkg,expectedReceiptDigest:expected});
  if(expected===pkg.receipt.digest)VALIDATED_CACHE.set(pkg,value);
  return value;
}
function output(pkg,split='discovery',expected=pkg.receipt.digest){
  if(expected===pkg.receipt.digest){
    let map=OUTPUT_CACHE.get(pkg);
    if(!map){map=new Map();OUTPUT_CACHE.set(pkg,map)}
    if(map.has(split))return map.get(split);
    const value=buildCrossVenueV2EventStream({validatedSource:validated(pkg,expected),split});
    map.set(split,value);
    return value;
  }
  return buildCrossVenueV2EventStream({validatedSource:validated(pkg,expected),split});
}
function subjectFor(e){
  if(['MISSING_SCHEDULED_FUNDING','DUPLICATE_CANONICAL_FUNDING'].includes(e.kind))return e.scheduledTime;
  if(e.kind==='FUNDING_GAP')return e.after;
  if(['OFF_GRID_FUNDING','DUPLICATE_FUNDING'].includes(e.kind))return e.rawTime;
  return e.openTime;
}
function anomalyPackage(){
  return cachedFixture('anomaly',()=>rebuild(BASE,d=>{
    const gapIndex=80;
    d.okxFunding.splice(gapIndex,1);

    const dupIndex=90;
    d.binanceFunding.push({...d.binanceFunding[dupIndex]});

    const offIndex=1000;
    d.okxFunding.push({
      fundingTime:d.okxFunding[offIndex].fundingTime+2*H,
      fundingRate:.00015
    });

    const splitStart=BASE.receipt.split.validation.start;
    d.okxFunding.push({fundingTime:splitStart-12*H,fundingRate:.00012});

    const entryDecision=BASE.receipt.split.discovery.times[100];
    d.binanceMarks=d.binanceMarks.filter(x=>x.openTime!==entryDecision+H);
    d.okxMarks.push({...d.okxMarks[600]});
    d.binanceMarks[700]={...d.binanceMarks[700],confirmed:false};
  }));
}
function isolationPackage({futureRow=true}={}){
  return cachedFixture('isolation-'+String(futureRow),()=>rebuild(BASE,d=>{
    const next=BASE.receipt.split.validation.start;
    const row=d.binanceMarks.find(x=>x.openTime===next);
    assert.ok(row);
    row.close=100.5;

    const zero=Date.parse('2026-09-30T00:00:00.000Z');
    const eight=Date.parse('2026-09-30T08:00:00.000Z');
    d.okxFunding=d.okxFunding.filter(x=>
      x.fundingTime!==zero&&(futureRow===true||x.fundingTime!==eight)
    );
  }));
}
function permutedPackage(){
  return cachedFixture('permuted',()=>({
    ...BASE,
    binanceFunding:[...BASE.binanceFunding].reverse(),
    okxFunding:[...BASE.okxFunding].reverse(),
    binanceMarks:[...BASE.binanceMarks].reverse(),
    okxMarks:[...BASE.okxMarks].reverse()
  }));
}
function collectedAtChangedPackage(){
  return cachedFixture('collected-at',()=>({
    ...BASE,
    provenance:{...BASE.provenance,collectedAt:'2030-12-31T23:59:59.999Z'}
  }));
}

const BASE=finalize(makeDraft());
const BASE_VALID=validated(BASE);
const BASE_DISCOVERY=buildCrossVenueV2EventStream({validatedSource:BASE_VALID,split:'discovery'});

test('B1/B14 input permutations canonicalize to identical output and both digests',()=>{
  const perm=permutedPackage();
  assert.equal(perm.receipt.digest,BASE.receipt.digest);
  const actual=output(perm);
  assert.deepEqual(actual,BASE_DISCOVERY);
  assert.equal(actual.streamDigest,BASE_DISCOVERY.streamDigest);
  assert.equal(actual.packageBoundDigest,BASE_DISCOVERY.packageBoundDigest);
});

test('B2 provenance.collectedAt-only change is invisible to receipt and builder digests',()=>{
  const changed=collectedAtChangedPackage();
  assert.equal(changed.receipt.digest,BASE.receipt.digest);
  const actual=output(changed);
  assert.equal(actual.streamDigest,BASE_DISCOVERY.streamDigest);
  assert.equal(actual.packageBoundDigest,BASE_DISCOVERY.packageBoundDigest);
  assert.deepEqual(actual,BASE_DISCOVERY);
});

test('B3 every frozen synthetic integrity event maps to one deterministic detection event',()=>{
  const pkg=anomalyPackage();
  const out=output(pkg);
  const detections=out.events.filter(e=>e.kind==='INTEGRITY_DETECTION');
  const expectedSourceEvents=pkg.integrityEvents.filter(e=>e.detectionTime<=Date.parse(out.stream.streamEnd));
  assert.equal(detections.length,expectedSourceEvents.length);
  for(const e of expectedSourceEvents){
    const subject=subjectFor(e);
    const id='ID|'+e.venue+'|'+e.kind+'|'+new Date(subject).toISOString();
    const hit=detections.find(x=>x.stableId===id);
    assert.ok(hit,id);
    assert.deepEqual(Object.keys(hit).sort(),[
      'integrityKind','kind','segment','stableId','subjectTime','time','venue'
    ]);
    assert.equal(hit.time,e.detectionTime);
    assert.equal(hit.integrityKind,e.kind);
    assert.equal(hit.subjectTime,subject);
  }
});

test('B4 duplicate stable-id and event-key defenses are present and fail closed before serialization',()=>{
  const source=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-event-builder.js',import.meta.url),'utf8');
  assert.match(source,/CROSS_VENUE_V2_BUILDER_DUPLICATE_STABLE_ID/);
  assert.match(source,/CROSS_VENUE_V2_BUILDER_DUPLICATE_EVENT_KEY/);
  assert.match(source,/assertUniqueEvents\(events\)/);
});

test('B5/B6 decision slot never reads t+1h fill candle; anomaly appears only at t+2h',()=>{
  const t=BASE.receipt.split.discovery.times[100];
  const baseSlot=BASE_DISCOVERY.events.find(e=>e.kind==='COMMON_DECISION_SLOT'&&e.time===t);
  assert.ok(baseSlot);
  const broken=anomalyPackage();
  const out=output(broken);
  const slot=out.events.find(e=>e.kind==='COMMON_DECISION_SLOT'&&e.time===t);
  assert.deepEqual(slot,baseSlot);
  const detection=out.events.find(e=>
    e.kind==='INTEGRITY_DETECTION'&&
    e.integrityKind==='MISSING_MARK'&&
    e.venue==='BINANCE'&&
    e.subjectTime===t+H
  );
  assert.ok(detection);
  assert.equal(detection.time,t+2*H);
});

test('B7 non-final split eligibility remains strict and equality at +26h is rejected',()=>{
  const next=BASE.receipt.split.validation.start;
  assert.equal(splitEntryAllowed({decisionTime:next-26*H,nextSplitStart:next}),false);
  const slots=BASE_DISCOVERY.events.filter(e=>e.kind==='COMMON_DECISION_SLOT'&&e.segment==='SPLIT');
  for(const slot of slots){
    assert.equal(slot.splitEligible,slot.time+26*H<next);
  }
});

test('B8 last eligible decision lifecycle is fully contained in every stream',()=>{
  for(const split of ['discovery','validation','holdout']){
    const out=buildCrossVenueV2EventStream({validatedSource:BASE_VALID,split});
    const eligible=out.events.filter(e=>e.kind==='COMMON_DECISION_SLOT'&&e.splitEligible);
    assert.ok(eligible.length>0,split);
    const last=eligible.at(-1).time;
    assert.ok(last+27*H<=Date.parse(out.stream.streamEnd),split);
  }
});

test('B9 fixed-boundary later mark perturbation cannot change split-local causal output',()=>{
  const changed=isolationPackage({futureRow:true});
  assert.notEqual(changed.receipt.digest,BASE.receipt.digest);
  const out=output(changed,'discovery',changed.receipt.digest);
  assert.deepEqual(out.events,BASE_DISCOVERY.events);
  assert.deepEqual(out.stream,BASE_DISCOVERY.stream);
  assert.deepEqual(out.counts,BASE_DISCOVERY.counts);
  assert.equal(out.stream.recoveryInputsDigest,BASE_DISCOVERY.stream.recoveryInputsDigest);
  assert.equal(out.streamDigest,BASE_DISCOVERY.streamDigest);
  assert.notDeepEqual(out.sourceBinding,BASE_DISCOVERY.sourceBinding);
  assert.notEqual(out.packageBoundDigest,BASE_DISCOVERY.packageBoundDigest);
});

test('B9c future funding row cannot retroactively create a prior-stream FUNDING_GAP',()=>{
  const withFuture=isolationPackage({futureRow:true});
  const withoutFuture=isolationPackage({futureRow:false});
  const a=output(withFuture,'holdout',withFuture.receipt.digest);
  const b=output(withoutFuture,'holdout',withoutFuture.receipt.digest);
  const end=Date.parse(a.stream.streamEnd);

  assert.deepEqual(a.stream,b.stream);
  assert.deepEqual(a.events,b.events);
  assert.deepEqual(a.counts,b.counts);
  assert.equal(a.stream.recoveryInputsDigest,b.stream.recoveryInputsDigest);
  assert.equal(a.streamDigest,b.streamDigest);
  assert.notDeepEqual(a.sourceBinding,b.sourceBinding);
  assert.notEqual(a.packageBoundDigest,b.packageBoundDigest);

  const retro=e=>e.kind==='FUNDING_GAP'&&e.venue==='OKX'&&e.detectionTime<=end;
  assert.equal(withFuture.integrityEvents.some(retro),true);
  assert.equal(withoutFuture.integrityEvents.some(retro),false);
  assert.equal(a.events.some(e=>e.kind==='INTEGRITY_DETECTION'&&e.integrityKind==='FUNDING_GAP'&&e.venue==='OKX'),false);
});

test('B9b boundary-changing source perturbation cannot pass the original receipt binding',()=>{
  const t=BASE.receipt.split.validation.start;
  const pkg={
    ...BASE,
    okxFunding:BASE.okxFunding.filter(x=>x.fundingTime!==t)
  };
  assert.throws(
    ()=>validateCrossVenueV2BuilderSource({packageData:pkg,expectedReceiptDigest:BASE.receipt.digest}),
    /RECOMPUTED_RECEIPT_MISMATCH/
  );
});

test('B10 perturbing future marks cannot change any prior event prefix',()=>{
  const x=BASE.receipt.split.discovery.start;
  const changed=isolationPackage({futureRow:true});
  const out=output(changed,'discovery',changed.receipt.digest);
  const prefix=a=>a.events.filter(e=>e.time<=x);
  assert.deepEqual(prefix(out),prefix(BASE_DISCOVERY));
});

test('B11 moving an exogenous integrity event earlier cannot improve structural entry eligibility',()=>{
  const withEarlierIntegrity=output(anomalyPackage());
  assert.equal(withEarlierIntegrity.counts.splitEligibleSlots,BASE_DISCOVERY.counts.splitEligibleSlots);
  const readyCount=o=>o.events.filter(e=>e.kind==='COMMON_DECISION_SLOT'&&e.sourceInputsReady).length;
  assert.ok(readyCount(withEarlierIntegrity)<=readyCount(BASE_DISCOVERY));
  assert.ok(withEarlierIntegrity.events.some(e=>e.kind==='INTEGRITY_DETECTION'&&e.integrityKind==='OFF_GRID_FUNDING'));
});

test('B12 recovery inputs preserve frozen recoveryAt semantics and never carry recoveryEligible',()=>{
  const pkg=anomalyPackage();
  const source=validated(pkg);
  const out=buildCrossVenueV2EventStream({validatedSource:source,split:'holdout'});
  const recoveryInputs=buildCrossVenueV2RecoveryInputs({validatedSource:source,stream:out.stream});
  const normalizedFundingB=normalizeFunding(pkg.binanceFunding,'BINANCE',CONTRACT);
  const normalizedFundingO=normalizeFunding(pkg.okxFunding,'OKX',CONTRACT);
  const common=commonFundingTimes(normalizedFundingB,normalizedFundingO,CONTRACT);
  const event=out.events.find(e=>e.kind==='INTEGRITY_DETECTION'&&e.integrityKind==='OFF_GRID_FUNDING');
  assert.ok(event);
  const integrity=[{kind:event.integrityKind,venue:event.venue,detectionTime:event.time}];
  const direct=recoveryAt({
    episodeStart:event.time,
    commonTimes:common,
    integrityEvents:integrity,
    binanceMarks:normalizeMarks(pkg.binanceMarks,'BINANCE'),
    okxMarks:normalizeMarks(pkg.okxMarks,'OKX')
  },CONTRACT);
  const throughBuilder=recoveryAt({
    episodeStart:event.time,
    commonTimes:common,
    integrityEvents:integrity,
    binanceMarks:recoveryInputs.binanceMarks,
    okxMarks:recoveryInputs.okxMarks
  },CONTRACT);
  assert.equal(throughBuilder,direct);
  assert.equal(JSON.stringify(out).includes('recoveryEligible'),false);
});

test('validatedSource evidence is deeply immutable and copied handles are rejected',()=>{
  const source=validated(BASE);
  assert.throws(()=>source.validation.integrityEvents.push({kind:'MISSING_MARK'}),/read only|not extensible|object is not extensible|Cannot add property/i);
  assert.throws(()=>{source.validation.receipt.dataDigests.binanceFunding='f'.repeat(64)},/read only|Cannot assign/i);
  assert.throws(()=>{source.normalized.binanceMarks[0].close=999},/read only|Cannot assign/i);

  const forged={...source};
  assert.throws(
    ()=>buildCrossVenueV2EventStream({validatedSource:forged,split:'discovery'}),
    /VALIDATED_SOURCE_REQUIRED/
  );
});

test('B13 malformed package, receipt, expected digest and row data fail closed',()=>{
  assert.throws(
    ()=>validateCrossVenueV2BuilderSource({packageData:BASE}),
    /EXPECTED_RECEIPT_REQUIRED/
  );
  const extra={...BASE,unexpected:true};
  assert.throws(
    ()=>validateCrossVenueV2BuilderSource({packageData:extra,expectedReceiptDigest:BASE.receipt.digest}),
    /PACKAGE_KEYS/
  );
  assert.throws(
    ()=>validateCrossVenueV2BuilderSource({packageData:BASE,expectedReceiptDigest:'f'.repeat(64)}),
    /RECEIPT_MISMATCH/
  );
  const bad=draftFrom(BASE);
  bad.binanceFunding[0].fundingRate='not-a-number';
  const malformed={...bad,integrityEvents:BASE.integrityEvents,receipt:BASE.receipt};
  assert.throws(
    ()=>validateCrossVenueV2BuilderSource({packageData:malformed,expectedReceiptDigest:BASE.receipt.digest}),
    /SOURCE_INVALID/
  );
});

test('B15 implementation is pure and tests never read canonical research/data source files',()=>{
  const module=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-event-builder.js',import.meta.url),'utf8');
  const self=fs.readFileSync(new URL('./cross-venue-funding-edge-v2-event-builder.test.js',import.meta.url),'utf8');
  assert.doesNotMatch(module,/\bfetch\s*\(|child_process|process\.env|from ['"]node:fs['"]|api\.github\.com/i);
  assert.doesNotMatch(module,/research\/data/i);
  assert.doesNotMatch(self,/research\/data\/cross-venue-funding-edge-v2-source\.json/i);
});

test('B16/B18 builder output is structural only and carries no strategy/economic result fields',()=>{
  assert.equal(BASE_DISCOVERY.researchOnly,true);
  assert.equal(BASE_DISCOVERY.executionImpact,false);
  assert.equal(BASE_DISCOVERY.strategyPnlCalculated,false);
  assert.equal(BASE_DISCOVERY.strategySignalsCalculated,false);
  const text=JSON.stringify(BASE_DISCOVERY);
  for(const forbidden of [
    '"fundingRate"','"rate"','"price"','"spread"','"direction"','"entryActive"',
    '"basis"','"equity"','"profitFactor"','"drawdown"','"expectancy"','"stageDecision"'
  ])assert.equal(text.includes(forbidden),false,forbidden);
});

test('B17 source seal remains final-skip and frozen collection condition stays sealed',()=>{
  const run={
    runId:1,runAttempt:1,commitSha:'a'.repeat(40),artifactId:1,
    receiptDigest:'b'.repeat(64),artifactZipSha256:'c'.repeat(64),sourcePackageSha256:'d'.repeat(64)
  };
  const gate=v2SourceCollectionGate({
    stageLock:{ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',sourceAudit:true},
    evaluation:{
      schema:'CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-EVALUATION-1',
      ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',stage:'SOURCE_AUDIT',
      sourceAuditFinal:true,sourceAuditOutcome:'VALID_CLEAN',strategyPnlCalculated:false,
      canonicalSourceRun:run,
      interpretation:{discoveryAuthorized:false,strategyPnlAuthorized:false,laterStageTransitionAuthorized:false}
    },
    resumeV2:{sourceAuditEvaluated:true,sourceAuditOutcome:'VALID_CLEAN',canonicalSourceRun:run},
    agentCheckpoint:{canonicalSourceRun:{runId:1,receiptDigest:'b'.repeat(64)}}
  });
  assert.equal(gate,'SOURCE_FINAL_SKIP');
  const workflow=fs.readFileSync(new URL('../.github/workflows/cross-venue-funding-edge-v2-source.yml',import.meta.url),'utf8');
  assert.match(workflow,/source_gate == 'COLLECT_CANONICAL_SOURCE'/);
});

test('B19 warmup carries the identical runner degradation state across split start',()=>{
  const splitStart=BASE.receipt.split.validation.start;
  const pkg=anomalyPackage();
  const source=validated(pkg);
  const discovery=buildCrossVenueV2EventStream({validatedSource:source,split:'discovery'});
  const validation=buildCrossVenueV2EventStream({validatedSource:source,split:'validation'});
  const recovery=buildCrossVenueV2RecoveryInputs({validatedSource:source,stream:discovery.stream});
  const adapt=events=>events.map(e=>{
    if(e.kind!=='COMMON_DECISION_SLOT')return e;
    return{
      time:e.time,kind:'COMMON_DECISION',venue:'',stableId:e.stableId,
      entryActive:false,inputsReady:e.sourceInputsReady,splitEligible:false
    };
  });
  const globalPrefix=adapt(discovery.events);
  const validationWarmup=adapt(validation.events.filter(e=>e.time<splitStart));
  const a=runV2RunnerStateMachine(globalPrefix,{recoveryInputs:recovery,finalize:false}).state;
  const b=runV2RunnerStateMachine(validationWarmup,{recoveryInputs:recovery,finalize:false}).state;
  assert.deepEqual(b,a);
  assert.equal(a.status,'DEGRADED_FLAT');
});

test('B20 PR1 output is deliberately not runner-valid because COMMON_DECISION_SLOT is not a runner kind',()=>{
  assert.throws(
    ()=>runV2RunnerStateMachine(BASE_DISCOVERY.events,{finalize:false}),
    /INVALID_RUNNER_EVENT_KIND/
  );
});

test('B21 FUNDING_GAP and MISSING_SCHEDULED at the same detection time keep distinct stable IDs',()=>{
  const pkg=anomalyPackage();
  const out=output(pkg);
  const gaps=out.events.filter(e=>e.kind==='INTEGRITY_DETECTION'&&e.integrityKind==='FUNDING_GAP');
  const missing=out.events.filter(e=>e.kind==='INTEGRITY_DETECTION'&&e.integrityKind==='MISSING_SCHEDULED_FUNDING');
  const pair=gaps.find(g=>missing.some(m=>m.time===g.time&&m.venue===g.venue));
  assert.ok(pair);
  const mate=missing.find(m=>m.time===pair.time&&m.venue===pair.venue);
  assert.notEqual(pair.stableId,mate.stableId);
});

test('B22 initial two-settlement window may be not-ready; unexplained-gap guard remains fail-closed',()=>{
  const early=BASE_DISCOVERY.events.filter(e=>
    e.kind==='COMMON_DECISION_SLOT'&&e.time<RAW_START+2*F
  );
  assert.ok(early.length>=2);
  assert.ok(early.every(e=>e.sourceInputsReady===false));
  const module=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-event-builder.js',import.meta.url),'utf8');
  assert.match(module,/CROSS_VENUE_V2_BUILDER_UNEXPLAINED_INPUT_GAP/);
});

test('B22b input gaps require an integrity event for the exact missing causal input',()=>{
  const pkg=anomalyPackage();
  const out=output(pkg,'discovery',pkg.receipt.digest);
  const missing=BASE.okxFunding[80].fundingTime;
  const slot=out.events.find(e=>e.kind==='COMMON_DECISION_SLOT'&&e.time===missing+F);
  assert.ok(slot);
  assert.equal(slot.sourceInputsReady,false);
  assert.equal(slot.sourceReason,'FUNDING_INPUTS_INCOMPLETE_OR_STALE');
  assert.ok(out.events.some(e=>
    e.kind==='INTEGRITY_DETECTION'&&
    e.integrityKind==='MISSING_SCHEDULED_FUNDING'&&
    e.subjectTime===missing&&
    e.time<=slot.time
  ));

  const module=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-event-builder.js',import.meta.url),'utf8');
  assert.ok(module.includes('function readinessGapExplained'));
  assert.ok(module.includes('required.has(event.subjectTime)'));
  assert.ok(module.includes('event.subjectTime===requiredMark'));
  assert.equal(module.includes('!integrityEvents.some(e=>e.time<=t)'),false);
});

test('B29 recovery inputs are deterministic and their digest is exactly stream-bound',()=>{
  const a=buildCrossVenueV2RecoveryInputs({validatedSource:BASE_VALID,stream:BASE_DISCOVERY.stream});
  const b=buildCrossVenueV2RecoveryInputs({validatedSource:BASE_VALID,stream:BASE_DISCOVERY.stream});
  assert.deepEqual(a,b);
  assert.equal(digest(a),BASE_DISCOVERY.stream.recoveryInputsDigest);
});

test('B30 marks whose close-observation is after streamEnd cannot change recovery inputs or streamDigest',()=>{
  const changed=isolationPackage({futureRow:true});
  const source=validated(changed,changed.receipt.digest);
  const out=buildCrossVenueV2EventStream({validatedSource:source,split:'discovery'});
  const a=buildCrossVenueV2RecoveryInputs({validatedSource:BASE_VALID,stream:BASE_DISCOVERY.stream});
  const b=buildCrossVenueV2RecoveryInputs({validatedSource:source,stream:out.stream});
  assert.deepEqual(a,b);
  assert.equal(out.stream.recoveryInputsDigest,BASE_DISCOVERY.stream.recoveryInputsDigest);
  assert.equal(out.streamDigest,BASE_DISCOVERY.streamDigest);
});
