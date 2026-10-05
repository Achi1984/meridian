import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {runnerEventKey,sortRunnerEvents} from './cross-venue-funding-edge-v2-runner.js';

const ADAPTER_SCHEMA='CROSS-VENUE-FUNDING-EDGE-V2-RUNNER-ADAPTER-1';
const BUILDER_SCHEMA='CROSS-VENUE-FUNDING-EDGE-V2-EVENT-BUILDER-1';
const RULESET='CROSS-VENUE-FUNDING-EDGE-V2';
const TOP_LEVEL_KEYS=Object.freeze([
  'counts','events','executionImpact','packageBoundDigest','researchOnly','ruleset',
  'schema','sourceBinding','strategyPnlCalculated','strategySignalsCalculated',
  'stream','streamDigest'
].sort());
const HEX64=/^[a-f0-9]{64}$/;

function fail(code){throw new Error(code)}
function isObj(x){return !!x&&typeof x==='object'&&!Array.isArray(x)}
function strictBoolean(x,code){if(typeof x!=='boolean')fail(code);return x}
function strictDigest(x,code){if(typeof x!=='string'||!HEX64.test(x))fail(code);return x}
function canonicalize(x){
  if(Array.isArray(x))return x.map(canonicalize);
  if(isObj(x))return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonicalize(x[k])]));
  return x;
}
function digest(x){
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(x))).digest('hex');
}
function exactKeys(value,expected,code){
  if(!isObj(value)||!isDeepStrictEqual(Object.keys(value).sort(),[...expected].sort()))fail(code);
}
function verifyBuilderOutput(builderOutput){
  exactKeys(builderOutput,TOP_LEVEL_KEYS,'CROSS_VENUE_V2_ADAPTER_BUILDER_KEYS');
  if(builderOutput.schema!==BUILDER_SCHEMA||builderOutput.ruleset!==RULESET)
    fail('CROSS_VENUE_V2_ADAPTER_BUILDER_REQUIRED');
  if(builderOutput.researchOnly!==true||builderOutput.executionImpact!==false||
     builderOutput.strategyPnlCalculated!==false||builderOutput.strategySignalsCalculated!==false)
    fail('CROSS_VENUE_V2_ADAPTER_BUILDER_FLAGS');
  if(!isObj(builderOutput.sourceBinding)||!isObj(builderOutput.stream)||
     !Array.isArray(builderOutput.events)||!isObj(builderOutput.counts))
    fail('CROSS_VENUE_V2_ADAPTER_BUILDER_SHAPE');
  const streamDigest=strictDigest(builderOutput.streamDigest,'CROSS_VENUE_V2_ADAPTER_STREAM_DIGEST');
  const packageBoundDigest=strictDigest(builderOutput.packageBoundDigest,'CROSS_VENUE_V2_ADAPTER_PACKAGE_DIGEST');
  strictDigest(builderOutput.sourceBinding.receiptDigest,'CROSS_VENUE_V2_ADAPTER_RECEIPT_DIGEST');
  strictDigest(builderOutput.stream.recoveryInputsDigest,'CROSS_VENUE_V2_ADAPTER_RECOVERY_DIGEST');

  const causalEnvelope={
    schema:builderOutput.schema,
    ruleset:builderOutput.ruleset,
    researchOnly:builderOutput.researchOnly,
    executionImpact:builderOutput.executionImpact,
    strategyPnlCalculated:builderOutput.strategyPnlCalculated,
    strategySignalsCalculated:builderOutput.strategySignalsCalculated,
    contractSchema:builderOutput.sourceBinding.contractSchema,
    stream:builderOutput.stream,
    events:builderOutput.events,
    counts:builderOutput.counts
  };
  if(digest(causalEnvelope)!==streamDigest)fail('CROSS_VENUE_V2_ADAPTER_STREAM_DIGEST_MISMATCH');
  const withoutPackageDigest={
    schema:builderOutput.schema,
    ruleset:builderOutput.ruleset,
    researchOnly:builderOutput.researchOnly,
    executionImpact:builderOutput.executionImpact,
    strategyPnlCalculated:builderOutput.strategyPnlCalculated,
    strategySignalsCalculated:builderOutput.strategySignalsCalculated,
    sourceBinding:builderOutput.sourceBinding,
    stream:builderOutput.stream,
    events:builderOutput.events,
    counts:builderOutput.counts,
    streamDigest
  };
  if(digest(withoutPackageDigest)!==packageBoundDigest)fail('CROSS_VENUE_V2_ADAPTER_PACKAGE_DIGEST_MISMATCH');
  return {streamDigest,packageBoundDigest};
}

function adaptEvent(event){
  if(!isObj(event))fail('CROSS_VENUE_V2_ADAPTER_INVALID_EVENT');
  if(event.kind==='COMMON_DECISION_SLOT'){
    return Object.freeze({
      time:event.time,kind:'COMMON_DECISION',venue:'',stableId:event.stableId,
      entryActive:false,
      inputsReady:strictBoolean(event.sourceInputsReady,'CROSS_VENUE_V2_ADAPTER_INVALID_INPUTS_READY'),
      splitEligible:strictBoolean(event.splitEligible,'CROSS_VENUE_V2_ADAPTER_INVALID_SPLIT_ELIGIBLE')
    });
  }
  if(event.kind==='FUNDING_SETTLEMENT')
    return Object.freeze({time:event.time,kind:event.kind,venue:event.venue,stableId:event.stableId});
  if(event.kind==='INTEGRITY_DETECTION')
    return Object.freeze({time:event.time,kind:event.kind,venue:event.venue,stableId:event.stableId,integrityKind:event.integrityKind});
  fail('CROSS_VENUE_V2_ADAPTER_UNEXPECTED_BUILDER_KIND');
}

export function adaptCrossVenueV2BuilderForRunner({builderOutput}={}){
  if(!isObj(builderOutput))fail('CROSS_VENUE_V2_ADAPTER_BUILDER_REQUIRED');
  const {streamDigest,packageBoundDigest}=verifyBuilderOutput(builderOutput);
  const events=sortRunnerEvents(builderOutput.events.map(adaptEvent));
  for(const event of events)runnerEventKey(event);
  return Object.freeze({
    schema:ADAPTER_SCHEMA,ruleset:RULESET,researchOnly:true,executionImpact:false,
    strategyPnlCalculated:false,strategySignalsCalculated:false,
    sourceStreamDigest:streamDigest,sourcePackageBoundDigest:packageBoundDigest,
    sourceReceiptDigest:builderOutput.sourceBinding.receiptDigest,
    stream:builderOutput.stream,
    events:Object.freeze(events)
  });
}

export const CROSS_VENUE_V2_RUNNER_ADAPTER_SCHEMA=ADAPTER_SCHEMA;
