import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {
  CROSS_VENUE_FUNDING_EDGE_V2_SOURCE,
  normalizeFunding,
  normalizeMarks,
  usableFundingMap,
  commonFundingTimes,
  entryInputsReady,
  validateCrossVenueV2Source
} from './cross-venue-funding-edge-v2-data-contract.js';
import {splitEntryAllowed} from './cross-venue-funding-edge-v2-runner.js';

const RULESET='CROSS-VENUE-FUNDING-EDGE-V2';
const PACKAGE_SCHEMA='CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-PACKAGE-1';
const BUILDER_SCHEMA='CROSS-VENUE-FUNDING-EDGE-V2-EVENT-BUILDER-1';
const VALIDATED_KIND='VALIDATED_CROSS_VENUE_V2_SOURCE';
const VALIDATED_TOKEN=Symbol('CROSS_VENUE_V2_VALIDATED_SOURCE');
const HOUR=60*60*1000;
const PHASE_RANK=Object.freeze({
  FUNDING_SETTLEMENT:1,
  INTEGRITY_DETECTION:4,
  COMMON_DECISION_SLOT:5
});
const SPLITS=Object.freeze(['discovery','validation','holdout']);
const TOP_LEVEL_KEYS=Object.freeze([
  'binanceFunding','binanceMarks','contract','executionImpact','integrityEvents',
  'okxFunding','okxMarks','provenance','receipt','researchOnly','schema','stage'
].sort());
const HEX64=/^[a-f0-9]{64}$/;

function fail(code){throw new Error(code)}
function isObj(x){return !!x&&typeof x==='object'&&!Array.isArray(x)}
function strictTime(x,code='CROSS_VENUE_V2_BUILDER_INVALID_TIME'){
  if(typeof x!=='number'||!Number.isSafeInteger(x)||x<=0)fail(code);
  return x;
}
function iso(ms){return new Date(strictTime(ms)).toISOString()}
function sha256(x){return crypto.createHash('sha256').update(x).digest('hex')}
function compareText(a,b){return a<b?-1:a>b?1:0}
function canonicalize(x){
  if(Array.isArray(x))return x.map(canonicalize);
  if(isObj(x))return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonicalize(x[k])]));
  return x;
}
function deepFreezeCopy(x){
  if(Array.isArray(x))return Object.freeze(x.map(deepFreezeCopy));
  if(isObj(x))return Object.freeze(Object.fromEntries(Object.entries(x).map(([k,v])=>[k,deepFreezeCopy(v)])));
  return x;
}
function canonicalJson(x){return JSON.stringify(canonicalize(x))}
function digest(x){return sha256(canonicalJson(x))}
function compareBuilderEvents(a,b){
  return a.time-b.time||
    PHASE_RANK[a.kind]-PHASE_RANK[b.kind]||
    compareText(a.venue,b.venue)||
    compareText(a.kind,b.kind)||
    compareText(a.stableId,b.stableId);
}
function exactTopLevelKeys(packageData){
  if(!isObj(packageData))fail('CROSS_VENUE_V2_BUILDER_INVALID_PACKAGE');
  const keys=Object.keys(packageData).sort();
  if(!isDeepStrictEqual(keys,TOP_LEVEL_KEYS))fail('CROSS_VENUE_V2_BUILDER_PACKAGE_KEYS');
}
function requireExpectedReceipt(expectedReceiptDigest){
  if(typeof expectedReceiptDigest!=='string'||!HEX64.test(expectedReceiptDigest))
    fail('CROSS_VENUE_V2_BUILDER_EXPECTED_RECEIPT_REQUIRED');
}
function freezeRows(rows){
  return Object.freeze(rows.map(row=>Object.freeze({...row})));
}
function canonicalRecoveryMark(row){
  return Object.freeze({
    venue:row.venue,
    openTime:row.openTime,
    open:row.open,
    high:row.high,
    low:row.low,
    close:row.close,
    confirmed:row.confirmed
  });
}
function compareRecoveryMarks(a,b){
  return a.openTime-b.openTime||
    compareText(a.venue,b.venue)||
    a.open-b.open||
    a.high-b.high||
    a.low-b.low||
    a.close-b.close||
    Number(a.confirmed)-Number(b.confirmed);
}

export function validateCrossVenueV2BuilderSource({packageData,expectedReceiptDigest}={}){
  requireExpectedReceipt(expectedReceiptDigest);
  exactTopLevelKeys(packageData);
  if(packageData.schema!==PACKAGE_SCHEMA)fail('CROSS_VENUE_V2_BUILDER_PACKAGE_SCHEMA');
  if(packageData.researchOnly!==true)fail('CROSS_VENUE_V2_BUILDER_RESEARCH_ONLY');
  if(packageData.executionImpact!==false)fail('CROSS_VENUE_V2_BUILDER_EXECUTION_IMPACT');
  if(packageData.stage!=='SOURCE_AUDIT')fail('CROSS_VENUE_V2_BUILDER_SOURCE_STAGE');
  if(packageData?.provenance?.strategyPnlCalculated!==false)fail('CROSS_VENUE_V2_BUILDER_SOURCE_PNL_FLAG');
  if(!isDeepStrictEqual(packageData.contract,CROSS_VENUE_FUNDING_EDGE_V2_SOURCE))
    fail('CROSS_VENUE_V2_BUILDER_CONTRACT_MISMATCH');

  const validation=validateCrossVenueV2Source(packageData,CROSS_VENUE_FUNDING_EDGE_V2_SOURCE);
  if(validation.ok!==true)fail('CROSS_VENUE_V2_BUILDER_SOURCE_INVALID:'+String(validation.reason||'UNKNOWN'));
  if(!isObj(packageData.receipt)||packageData.receipt.digest!==expectedReceiptDigest)
    fail('CROSS_VENUE_V2_BUILDER_RECEIPT_MISMATCH');
  if(validation.receipt.digest!==expectedReceiptDigest)
    fail('CROSS_VENUE_V2_BUILDER_RECOMPUTED_RECEIPT_MISMATCH');
  if(!isDeepStrictEqual(validation.receipt,packageData.receipt))
    fail('CROSS_VENUE_V2_BUILDER_RECEIPT_CONTENT_MISMATCH');
  if(!Array.isArray(packageData.integrityEvents)||!isDeepStrictEqual(validation.integrityEvents,packageData.integrityEvents))
    fail('CROSS_VENUE_V2_BUILDER_INTEGRITY_EVENTS_MISMATCH');

  const normalized=Object.freeze({
    binanceFunding:freezeRows(normalizeFunding(packageData.binanceFunding,'BINANCE',CROSS_VENUE_FUNDING_EDGE_V2_SOURCE)),
    okxFunding:freezeRows(normalizeFunding(packageData.okxFunding,'OKX',CROSS_VENUE_FUNDING_EDGE_V2_SOURCE)),
    binanceMarks:freezeRows(normalizeMarks(packageData.binanceMarks,'BINANCE')),
    okxMarks:freezeRows(normalizeMarks(packageData.okxMarks,'OKX'))
  });
  const common=Object.freeze(commonFundingTimes(
    normalized.binanceFunding,
    normalized.okxFunding,
    CROSS_VENUE_FUNDING_EDGE_V2_SOURCE
  ));
  if(common.length!==validation.receipt.commonFundingDecisions)
    fail('CROSS_VENUE_V2_BUILDER_COMMON_COUNT_MISMATCH');

  return Object.freeze({
    [VALIDATED_TOKEN]:true,
    validatedKind:VALIDATED_KIND,
    expectedReceiptDigest,
    validation:deepFreezeCopy(validation),
    normalized,
    common,
    contract:CROSS_VENUE_FUNDING_EDGE_V2_SOURCE
  });
}

function requireValidated(validatedSource){
  if(!isObj(validatedSource)||validatedSource[VALIDATED_TOKEN]!==true||validatedSource.validatedKind!==VALIDATED_KIND)
    fail('CROSS_VENUE_V2_BUILDER_VALIDATED_SOURCE_REQUIRED');
  if(validatedSource.validation?.receipt?.digest!==validatedSource.expectedReceiptDigest)
    fail('CROSS_VENUE_V2_BUILDER_VALIDATED_SOURCE_DIGEST_MISMATCH');
  return validatedSource;
}

function splitBounds(validatedSource,split){
  const {validation,contract}=requireValidated(validatedSource);
  if(!SPLITS.includes(split))fail('CROSS_VENUE_V2_BUILDER_INVALID_SPLIT');
  const current=validation.receipt?.split?.[split];
  if(!current||!Number.isFinite(current.start)||!Number.isFinite(current.end)||!Number.isInteger(current.count)||current.count<=0)
    fail('CROSS_VENUE_V2_BUILDER_INVALID_SPLIT_RECEIPT');
  const final=split==='holdout';
  let nextSplitStart=null;
  if(split==='discovery')nextSplitStart=validation.receipt.split.validation.start;
  if(split==='validation')nextSplitStart=validation.receipt.split.holdout.start;
  const streamEnd=final
    ?Date.parse(contract.decisionWindowEnd)+27*HOUR
    :strictTime(nextSplitStart)-1;
  if(streamEnd>Date.parse(contract.markCoverageEnd))
    fail('CROSS_VENUE_V2_BUILDER_STREAM_EXCEEDS_MARK_COVERAGE');
  return Object.freeze({
    split,
    final,
    warmupStart:Date.parse(contract.rawStart),
    splitStart:current.start,
    splitLastDecision:current.end,
    nextSplitStart,
    streamEnd
  });
}

function segmentFor(time,bounds){return time<bounds.splitStart?'WARMUP':'SPLIT'}

function subjectTime(event){
  switch(event.kind){
    case'MISSING_SCHEDULED_FUNDING':
    case'DUPLICATE_CANONICAL_FUNDING':
      return strictTime(event.scheduledTime,'CROSS_VENUE_V2_BUILDER_INTEGRITY_SUBJECT');
    case'FUNDING_GAP':
      return strictTime(event.after,'CROSS_VENUE_V2_BUILDER_INTEGRITY_SUBJECT');
    case'OFF_GRID_FUNDING':
    case'DUPLICATE_FUNDING':
      return strictTime(event.rawTime,'CROSS_VENUE_V2_BUILDER_INTEGRITY_SUBJECT');
    case'MISSING_MARK':
    case'DUPLICATE_MARK':
    case'UNCONFIRMED_MARK':
      return strictTime(event.openTime,'CROSS_VENUE_V2_BUILDER_INTEGRITY_SUBJECT');
    default:
      fail('CROSS_VENUE_V2_BUILDER_UNKNOWN_INTEGRITY_KIND:'+String(event.kind));
  }
}

function settlementEvent(venue,row,bounds){
  const time=strictTime(row.time);
  return Object.freeze({
    time,
    kind:'FUNDING_SETTLEMENT',
    venue,
    stableId:'FS|'+venue+'|'+iso(time),
    rawTime:strictTime(row.rawTime),
    segment:segmentFor(time,bounds)
  });
}

function integrityEvent(event,bounds){
  if(!isObj(event)||typeof event.kind!=='string'||!event.kind||typeof event.venue!=='string'||!event.venue)
    fail('CROSS_VENUE_V2_BUILDER_INVALID_INTEGRITY_EVENT');
  const time=strictTime(event.detectionTime,'CROSS_VENUE_V2_BUILDER_INVALID_DETECTION_TIME');
  const subject=subjectTime(event);
  return Object.freeze({
    time,
    kind:'INTEGRITY_DETECTION',
    venue:event.venue,
    stableId:'ID|'+event.venue+'|'+event.kind+'|'+iso(subject),
    integrityKind:event.kind,
    subjectTime:subject,
    segment:segmentFor(time,bounds)
  });
}

function slotEvent(time,bounds,validatedSource,integrityEvents){
  const {normalized,contract}=validatedSource;
  const t=strictTime(time);
  const readiness=entryInputsReady({
    decisionTime:t,
    binanceFunding:normalized.binanceFunding,
    okxFunding:normalized.okxFunding,
    binanceMarks:normalized.binanceMarks,
    okxMarks:normalized.okxMarks,
    activeDegradation:false
  },contract);
  const initialWindowEnd=Date.parse(contract.rawStart)+2*contract.fundingIntervalMs;
  if(
    t>=initialWindowEnd&&
    readiness.ready===false&&
    ['FUNDING_INPUTS_INCOMPLETE_OR_STALE','MARK_INPUTS_INCOMPLETE_OR_STALE'].includes(readiness.reason)&&
    !integrityEvents.some(e=>e.time<=t)
  )fail('CROSS_VENUE_V2_BUILDER_UNEXPLAINED_INPUT_GAP');

  const segment=segmentFor(t,bounds);
  const splitEligible=segment==='SPLIT'&&(
    bounds.final?true:splitEntryAllowed({decisionTime:t,nextSplitStart:bounds.nextSplitStart})
  );
  return Object.freeze({
    time:t,
    kind:'COMMON_DECISION_SLOT',
    venue:'',
    stableId:'CD|'+iso(t),
    segment,
    splitEligible,
    sourceInputsReady:readiness.ready===true,
    sourceReason:String(readiness.reason)
  });
}

function assertUniqueEvents(events){
  const ids=new Set(),keys=new Set();
  for(const event of events){
    if(ids.has(event.stableId))fail('CROSS_VENUE_V2_BUILDER_DUPLICATE_STABLE_ID');
    ids.add(event.stableId);
    const rank=PHASE_RANK[event.kind];
    if(!Number.isInteger(rank))fail('CROSS_VENUE_V2_BUILDER_INVALID_EVENT_KIND');
    const key=[event.time,rank,event.venue,event.kind,event.stableId].join('|');
    if(keys.has(key))fail('CROSS_VENUE_V2_BUILDER_DUPLICATE_EVENT_KEY');
    keys.add(key);
  }
}

function recoveryInputsForBounds(validatedSource,bounds){
  const {normalized}=requireValidated(validatedSource);
  const eligible=row=>row.openTime+HOUR<=bounds.streamEnd;
  const canonicalRows=rows=>Object.freeze(
    rows.filter(eligible).map(canonicalRecoveryMark).sort(compareRecoveryMarks)
  );
  return Object.freeze({
    binanceMarks:canonicalRows(normalized.binanceMarks),
    okxMarks:canonicalRows(normalized.okxMarks)
  });
}

function streamShape(bounds,recoveryInputsDigest){
  return Object.freeze({
    split:bounds.split,
    final:bounds.final,
    warmupStart:iso(bounds.warmupStart),
    splitStart:iso(bounds.splitStart),
    splitLastDecision:iso(bounds.splitLastDecision),
    nextSplitStart:bounds.nextSplitStart===null?null:iso(bounds.nextSplitStart),
    streamEnd:iso(bounds.streamEnd),
    recoveryInputsDigest
  });
}

function eventCore(validatedSource,bounds){
  const {validation,normalized,common,contract}=requireValidated(validatedSource);
  const events=[];

  for(const [venue,rows] of [
    ['BINANCE',normalized.binanceFunding],
    ['OKX',normalized.okxFunding]
  ]){
    for(const row of usableFundingMap(rows).values()){
      if(row.time<=bounds.streamEnd)events.push(settlementEvent(venue,row,bounds));
    }
  }

  const integrityEvents=validation.integrityEvents
    .filter(e=>e.detectionTime<=bounds.streamEnd)
    .map(e=>integrityEvent(e,bounds));
  events.push(...integrityEvents);

  for(const time of common){
    if(time<=bounds.streamEnd)events.push(slotEvent(time,bounds,validatedSource,integrityEvents,contract));
  }

  events.sort(compareBuilderEvents);
  assertUniqueEvents(events);
  return Object.freeze(events);
}

export function buildCrossVenueV2EventStream({validatedSource,split}={}){
  const source=requireValidated(validatedSource);
  const bounds=splitBounds(source,split);
  const recoveryInputs=recoveryInputsForBounds(source,bounds);
  const recoveryInputsDigest=digest(recoveryInputs);
  const stream=streamShape(bounds,recoveryInputsDigest);
  const events=eventCore(source,bounds);
  const counts=Object.freeze({
    fundingSettlements:events.filter(e=>e.kind==='FUNDING_SETTLEMENT').length,
    integrityDetections:events.filter(e=>e.kind==='INTEGRITY_DETECTION').length,
    slots:events.filter(e=>e.kind==='COMMON_DECISION_SLOT').length,
    splitSlots:events.filter(e=>e.kind==='COMMON_DECISION_SLOT'&&e.segment==='SPLIT').length,
    splitEligibleSlots:events.filter(e=>e.kind==='COMMON_DECISION_SLOT'&&e.splitEligible===true).length
  });
  const receipt=source.validation.receipt;
  const sourceBinding=Object.freeze({
    packageSchema:PACKAGE_SCHEMA,
    contractSchema:source.contract.schema,
    expectedReceiptDigest:source.expectedReceiptDigest,
    receiptDigest:receipt.digest,
    integrityDigest:receipt.integrityDigest,
    dataDigests:Object.freeze({
      binanceFunding:receipt.dataDigests.binanceFunding,
      okxFunding:receipt.dataDigests.okxFunding,
      binanceMarks:receipt.dataDigests.binanceMarks,
      okxMarks:receipt.dataDigests.okxMarks
    }),
    commonFundingDecisions:receipt.commonFundingDecisions,
    splitCounts:Object.freeze({
      discovery:receipt.split.discovery.count,
      validation:receipt.split.validation.count,
      holdout:receipt.split.holdout.count
    })
  });
  const causalEnvelope={
    schema:BUILDER_SCHEMA,
    ruleset:RULESET,
    researchOnly:true,
    executionImpact:false,
    strategyPnlCalculated:false,
    strategySignalsCalculated:false,
    contractSchema:source.contract.schema,
    stream,
    events,
    counts
  };
  const streamDigest=digest(causalEnvelope);
  const withoutPackageDigest={
    schema:BUILDER_SCHEMA,
    ruleset:RULESET,
    researchOnly:true,
    executionImpact:false,
    strategyPnlCalculated:false,
    strategySignalsCalculated:false,
    sourceBinding,
    stream,
    events,
    counts,
    streamDigest
  };
  const packageBoundDigest=digest(withoutPackageDigest);
  return Object.freeze({...withoutPackageDigest,packageBoundDigest});
}

export function buildCrossVenueV2RecoveryInputs({validatedSource,stream}={}){
  const source=requireValidated(validatedSource);
  if(!isObj(stream)||!SPLITS.includes(stream.split)||typeof stream.streamEnd!=='string')
    fail('CROSS_VENUE_V2_BUILDER_STREAM_REQUIRED');
  const bounds=splitBounds(source,stream.split);
  const inputs=recoveryInputsForBounds(source,bounds);
  const expectedStream=streamShape(bounds,digest(inputs));
  if(!isDeepStrictEqual(stream,expectedStream))
    fail('CROSS_VENUE_V2_BUILDER_STREAM_MISMATCH');
  return inputs;
}

export const CROSS_VENUE_V2_EVENT_BUILDER_SCHEMA=BUILDER_SCHEMA;
