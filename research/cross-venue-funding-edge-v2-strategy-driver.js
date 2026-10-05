import {
  buildCrossVenueV2EventStream,
  buildCrossVenueV2RecoveryInputs
} from './cross-venue-funding-edge-v2-event-builder.js';
import {
  adaptCrossVenueV2BuilderForRunner
} from './cross-venue-funding-edge-v2-runner-adapter.js';
import {
  V2_RUNNER_STATES,
  runnerEventKey,
  sortRunnerEvents,
  runV2RunnerStateMachine,
  runnerStateBeforeTime,
  assertV2RunnerExecutionAuthorized
} from './cross-venue-funding-edge-v2-runner.js';
import {
  createCrossVenueV2StrategyAdapter
} from './cross-venue-funding-edge-v2-strategy-adapter.js';

const HOUR=60*60*1000;
const DRIVER_SCHEMA='CROSS-VENUE-FUNDING-EDGE-V2-STRATEGY-DRIVER-1';
const ALLOWED_FINAL=new Set([
  V2_RUNNER_STATES.FLAT_ELIGIBLE,
  V2_RUNNER_STATES.DEGRADED_FLAT,
  V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE
]);

function fail(code){throw new Error(code)}
function strictTime(value,code='CROSS_VENUE_V2_DRIVER_INVALID_TIME'){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)fail(code);
  return value;
}
function iso(time){return new Date(strictTime(time)).toISOString()}
function stateBefore(events,time,recoveryInputs){
  return runnerStateBeforeTime(events,time,{recoveryInputs});
}
function eventIdentity(event){
  const key=runnerEventKey(event);
  return [key[0],key[2],key[3],key[4]].join('|');
}
function consumedPrefix(ordered,trace){
  const seen=new Set(trace.map(x=>[
    x.event.time,x.event.venue??'',x.event.kind,x.event.stableId
  ].join('|')));
  return ordered.filter(event=>seen.has(eventIdentity(event)));
}
function assertBoundary(state){
  if(!ALLOWED_FINAL.has(state.status))
    fail('CROSS_VENUE_V2_STREAM_BOUNDARY_VIOLATION');
}
function entryFillEvent(decisionTime){
  return Object.freeze({
    time:decisionTime+HOUR,
    kind:'ENTRY_FILL',
    venue:'PAIR',
    stableId:'EF|'+iso(decisionTime)
  });
}
function exitDecisionEvent(entryDecisionTime,hour,reason){
  return Object.freeze({
    time:hour,
    kind:'EXIT_DECISION',
    venue:'',
    stableId:'XD|'+iso(entryDecisionTime)+'|'+iso(hour),
    exitReason:reason
  });
}
function exitFillEvent(entryDecisionTime,fillTime){
  return Object.freeze({
    time:fillTime,
    kind:'EXIT_FILL',
    venue:'PAIR',
    stableId:'XF|'+iso(entryDecisionTime)
  });
}
function activateDecision(structuralDecision,slot,signal){
  if(
    !structuralDecision||
    structuralDecision.kind!=='COMMON_DECISION'||
    structuralDecision.stableId!==slot.stableId||
    structuralDecision.time!==slot.time||
    structuralDecision.inputsReady!==slot.sourceInputsReady||
    structuralDecision.splitEligible!==slot.splitEligible||
    structuralDecision.entryActive!==false
  )fail('CROSS_VENUE_V2_DRIVER_STRUCTURAL_DIVERGENCE');
  return Object.freeze({
    ...structuralDecision,
    entryActive:signal.entryActive===true
  });
}

function internalRun({validatedSource,split}={}){
  const built=buildCrossVenueV2EventStream({validatedSource,split});
  const structural=adaptCrossVenueV2BuilderForRunner({builderOutput:built});
  const recoveryInputs=buildCrossVenueV2RecoveryInputs({
    validatedSource,
    stream:built.stream
  });
  const strategy=createCrossVenueV2StrategyAdapter({
    normalized:validatedSource.normalized
  });

  const streamEnd=Date.parse(structural.stream.streamEnd);
  if(!Number.isSafeInteger(streamEnd)||streamEnd<=0)
    fail('CROSS_VENUE_V2_DRIVER_INVALID_STREAM');

  const slots=built.events.filter(event=>event.kind==='COMMON_DECISION_SLOT');
  const structuralDecisions=new Map(
    structural.events
      .filter(event=>event.kind==='COMMON_DECISION')
      .map(event=>[event.stableId,event])
  );
  if(structuralDecisions.size!==slots.length)
    fail('CROSS_VENUE_V2_DRIVER_STRUCTURAL_DIVERGENCE');

  const events=structural.events.filter(event=>event.kind!=='COMMON_DECISION');
  let terminal=false;

  slotLoop:
  for(const slot of slots){
    const signal=strategy.entryAt({
      decisionTime:slot.time,
      sourceInputsReady:slot.sourceInputsReady,
      segment:slot.segment
    });
    const decision=activateDecision(
      structuralDecisions.get(slot.stableId),
      slot,
      signal
    );
    events.push(decision);

    if(
      signal.entryActive!==true||
      decision.inputsReady!==true||
      decision.splitEligible!==true
    )continue;

    const fillAt=slot.time+HOUR;
    if(fillAt>streamEnd)fail('CROSS_VENUE_V2_STREAM_BOUNDARY_VIOLATION');

    const beforeFill=stateBefore(events,fillAt,recoveryInputs);
    if(beforeFill.status===V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE){
      terminal=true;
      break;
    }
    if(
      beforeFill.status!==V2_RUNNER_STATES.ENTRY_PENDING||
      beforeFill.pendingEntry?.decisionId!==decision.stableId
    )continue;

    events.push(entryFillEvent(slot.time));

    for(let k=1;k<=24;k++){
      const hour=fillAt+k*HOUR;
      if(hour>streamEnd)fail('CROSS_VENUE_V2_STREAM_BOUNDARY_VIOLATION');

      const atHour=stateBefore(events,hour+1,recoveryInputs);
      if(atHour.status===V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE){
        terminal=true;
        break;
      }
      if(atHour.status!==V2_RUNNER_STATES.POSITION_OPEN)break;

      const exitSignal=strategy.exitAt({
        entryDecisionTime:slot.time,
        entryFillTime:fillAt,
        hour
      });
      if(exitSignal.exit!==true)continue;

      const exitEvent=exitDecisionEvent(slot.time,hour,exitSignal.reason);
      events.push(exitEvent);

      const exitFillAt=hour+HOUR;
      if(exitFillAt>streamEnd)
        fail('CROSS_VENUE_V2_STREAM_BOUNDARY_VIOLATION');

      const beforeExitFill=stateBefore(events,exitFillAt,recoveryInputs);
      if(beforeExitFill.status===V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE){
        terminal=true;
        break;
      }
      if(
        beforeExitFill.status===V2_RUNNER_STATES.EXIT_PENDING&&
        beforeExitFill.exitPending?.decisionId===exitEvent.stableId
      ){
        events.push(exitFillEvent(slot.time,exitFillAt));
        const afterExitEvidence=stateBefore(
          events,
          exitFillAt+HOUR+1,
          recoveryInputs
        );
        if(afterExitEvidence.status===V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE)
          terminal=true;
      }
      break;
    }

    if(terminal)break slotLoop;
  }

  const ordered=sortRunnerEvents(events);
  const beforeFinalize=runV2RunnerStateMachine(
    ordered,
    {recoveryInputs,finalize:false}
  );
  assertBoundary(beforeFinalize.state);

  const finalRun=runV2RunnerStateMachine(
    ordered,
    {recoveryInputs,finalize:true}
  );
  const visibleEvents=finalRun.outcome.terminal===true
    ?consumedPrefix(ordered,finalRun.trace)
    :ordered;

  return Object.freeze({
    schema:DRIVER_SCHEMA,
    ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',
    researchOnly:true,
    executionImpact:false,
    syntheticOnly:true,
    strategySignalsCalculated:true,
    strategyPnlCalculated:false,
    split:structural.stream.split,
    structuralAdapterSchema:structural.schema,
    sourceBinding:Object.freeze({
      receiptDigest:structural.sourceReceiptDigest,
      streamDigest:structural.sourceStreamDigest,
      packageBoundDigest:structural.sourcePackageBoundDigest,
      recoveryInputsDigest:structural.stream.recoveryInputsDigest
    }),
    events:Object.freeze(visibleEvents),
    counts:Object.freeze({
      commonDecisions:visibleEvents.filter(e=>e.kind==='COMMON_DECISION').length,
      entryFills:visibleEvents.filter(e=>e.kind==='ENTRY_FILL').length,
      exitDecisions:visibleEvents.filter(e=>e.kind==='EXIT_DECISION').length,
      exitFills:visibleEvents.filter(e=>e.kind==='EXIT_FILL').length
    }),
    outcome:finalRun.outcome,
    state:finalRun.state,
    traceDigest:finalRun.traceDigest
  });
}

export function runCrossVenueV2StrategyDriverSynthetic({syntheticOnly,...args}={}){
  if(syntheticOnly!==true)
    fail('CROSS_VENUE_V2_SYNTHETIC_DRIVER_FLAG_REQUIRED');
  return internalRun(args);
}

export function executeCrossVenueV2StrategyDriver({lock,...args}={}){
  assertV2RunnerExecutionAuthorized(lock);
  const result=internalRun(args);
  return Object.freeze({...result,syntheticOnly:false});
}

export const CROSS_VENUE_V2_STRATEGY_DRIVER_SCHEMA=DRIVER_SCHEMA;
