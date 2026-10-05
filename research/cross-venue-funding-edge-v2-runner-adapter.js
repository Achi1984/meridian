import {runnerEventKey,sortRunnerEvents} from './cross-venue-funding-edge-v2-runner.js';

const ADAPTER_SCHEMA='CROSS-VENUE-FUNDING-EDGE-V2-RUNNER-ADAPTER-1';
const BUILDER_SCHEMA='CROSS-VENUE-FUNDING-EDGE-V2-EVENT-BUILDER-1';

function fail(code){throw new Error(code)}
function isObj(x){return !!x&&typeof x==='object'&&!Array.isArray(x)}

function adaptEvent(event){
  if(!isObj(event))fail('CROSS_VENUE_V2_ADAPTER_INVALID_EVENT');
  if(event.kind==='COMMON_DECISION_SLOT'){
    return Object.freeze({
      time:event.time,
      kind:'COMMON_DECISION',
      venue:'',
      stableId:event.stableId,
      entryActive:false,
      inputsReady:event.sourceInputsReady===true,
      splitEligible:event.splitEligible===true
    });
  }
  if(event.kind==='FUNDING_SETTLEMENT'){
    return Object.freeze({
      time:event.time,
      kind:event.kind,
      venue:event.venue,
      stableId:event.stableId
    });
  }
  if(event.kind==='INTEGRITY_DETECTION'){
    return Object.freeze({
      time:event.time,
      kind:event.kind,
      venue:event.venue,
      stableId:event.stableId,
      integrityKind:event.integrityKind
    });
  }
  fail('CROSS_VENUE_V2_ADAPTER_UNEXPECTED_BUILDER_KIND');
}

export function adaptCrossVenueV2BuilderForRunner({builderOutput}={}){
  if(!isObj(builderOutput)||builderOutput.schema!==BUILDER_SCHEMA)
    fail('CROSS_VENUE_V2_ADAPTER_BUILDER_REQUIRED');
  if(builderOutput.researchOnly!==true||builderOutput.executionImpact!==false||
     builderOutput.strategyPnlCalculated!==false||builderOutput.strategySignalsCalculated!==false)
    fail('CROSS_VENUE_V2_ADAPTER_BUILDER_FLAGS');
  if(!Array.isArray(builderOutput.events))fail('CROSS_VENUE_V2_ADAPTER_EVENTS_REQUIRED');

  const events=sortRunnerEvents(builderOutput.events.map(adaptEvent));
  for(const event of events)runnerEventKey(event);

  return Object.freeze({
    schema:ADAPTER_SCHEMA,
    ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',
    researchOnly:true,
    executionImpact:false,
    strategyPnlCalculated:false,
    strategySignalsCalculated:false,
    sourceStreamDigest:builderOutput.streamDigest,
    sourcePackageBoundDigest:builderOutput.packageBoundDigest,
    events:Object.freeze(events)
  });
}

export const CROSS_VENUE_V2_RUNNER_ADAPTER_SCHEMA=ADAPTER_SCHEMA;
