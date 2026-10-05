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
import {
  CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK
} from './cross-venue-funding-edge-v2-stage-lock.js';

const HOUR=60*60*1000;
const CANONICAL_RECEIPT_DIGEST='822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5';
const CANONICAL_DATA_DIGESTS=Object.freeze({
  binanceFunding:'442c4a68ef728ec42ccd0bedeb8a6c786e9ac9de573565d18aaaf9eb942ffef1',
  okxFunding:'f35f14e28c8d3093a7ceaceeb488f2b930f27530fed876936b3f5c8cfeeb2c9f',
  binanceMarks:'0a5679947c8bcd5562ef9aecded5eb36706fc33515e7821aeff6deaeb86e57a7',
  okxMarks:'ef7beb1a849710831c950cc561b90b7b80d3b0feb927bf7c966354cbde2c284b'
});
const SOURCE_DIGEST_KEYS=Object.freeze(Object.keys(CANONICAL_DATA_DIGESTS));
const CANONICAL_SOURCE_PINS=Object.freeze({
  receiptDigest:CANONICAL_RECEIPT_DIGEST,
  integrityDigest:'0e0a7e1dc0b8ab616114d99ba7d475185b027caacdd1544d4ce06c8b2d9d4b07',
  dataDigests:CANONICAL_DATA_DIGESTS
});
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

export function crossVenueV2ReceiptMatchesForbiddenPins(receipt,pins){
  if(!receipt||typeof receipt!=='object'||!pins||typeof pins!=='object')return false;
  if(typeof pins.receiptDigest==='string'&&receipt.digest===pins.receiptDigest)return true;
  if(typeof pins.integrityDigest==='string'&&receipt.integrityDigest===pins.integrityDigest)return true;
  const actual=receipt.dataDigests;
  const expected=pins.dataDigests;
  if(!actual||typeof actual!=='object'||!expected||typeof expected!=='object')return false;
  return SOURCE_DIGEST_KEYS.some(key=>
    typeof expected[key]==='string'&&actual[key]===expected[key]
  );
}

export function assertCrossVenueV2SyntheticSourceAllowed(validatedSource){
  if(
    validatedSource?.expectedReceiptDigest===CANONICAL_RECEIPT_DIGEST||
    crossVenueV2ReceiptMatchesForbiddenPins(
      validatedSource?.validation?.receipt,
      CANONICAL_SOURCE_PINS
    )
  )fail('CROSS_VENUE_V2_CANONICAL_SOURCE_FORBIDDEN_IN_SYNTHETIC_DRIVER');
  return true;
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

  function appendTerminalPrefixSlotsThrough(limit,evidenceBoundary){
    const existing=new Set(
      events.filter(event=>event.kind==='COMMON_DECISION').map(event=>event.stableId)
    );
    for(const pendingSlot of slots){
      if(pendingSlot.time>limit)break;
      if(existing.has(pendingSlot.stableId))continue;

      const beforeDecision=stateBefore(events,pendingSlot.time+1,recoveryInputs);
      if(beforeDecision.status===V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE)
        return true;

      const pendingSignal=strategy.entryAt({
        decisionTime:pendingSlot.time,
        sourceInputsReady:pendingSlot.sourceInputsReady,
        segment:pendingSlot.segment
      });
      const pendingDecision=activateDecision(
        structuralDecisions.get(pendingSlot.stableId),
        pendingSlot,
        pendingSignal
      );
      events.push(pendingDecision);
      existing.add(pendingSlot.stableId);

      if(
        pendingSignal.entryActive!==true||
        pendingDecision.inputsReady!==true||
        pendingDecision.splitEligible!==true
      )continue;

      const pendingFillAt=pendingSlot.time+HOUR;
      if(pendingFillAt>=evidenceBoundary)continue;
      const beforePendingFill=stateBefore(events,pendingFillAt,recoveryInputs);
      if(beforePendingFill.status===V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE)
        return true;
      if(
        beforePendingFill.status===V2_RUNNER_STATES.ENTRY_PENDING&&
        beforePendingFill.pendingEntry?.decisionId===pendingDecision.stableId
      )events.push(entryFillEvent(pendingSlot.time));
    }
    return false;
  }

  function completeTerminalPrefix(limit,evidenceBoundary){
    const prefixTerminal=appendTerminalPrefixSlotsThrough(limit,evidenceBoundary);
    if(prefixTerminal)return;
    const afterPrefix=stateBefore(events,evidenceBoundary,recoveryInputs);
    if(afterPrefix.status!==V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE)
      fail('CROSS_VENUE_V2_DRIVER_TERMINAL_PREFIX_DIVERGENCE');
  }

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
        completeTerminalPrefix(hour,hour+1);
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
        completeTerminalPrefix(exitFillAt,exitFillAt+1);
        terminal=true;
        break;
      }
      if(
        beforeExitFill.status===V2_RUNNER_STATES.EXIT_PENDING&&
        beforeExitFill.exitPending?.decisionId===exitEvent.stableId
      ){
        events.push(exitFillEvent(slot.time,exitFillAt));
        const evidenceBoundary=exitFillAt+HOUR+1;
        const preliminaryExitEvidence=stateBefore(
          events,
          evidenceBoundary,
          recoveryInputs
        );
        if(preliminaryExitEvidence.status===V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE){
          completeTerminalPrefix(exitFillAt,evidenceBoundary);
          terminal=true;
        }
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
  assertCrossVenueV2SyntheticSourceAllowed(args.validatedSource);
  return internalRun(args);
}

export function executeCrossVenueV2StrategyDriver({
  lock=CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK,
  ...args
}={}){
  if(lock!==CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK)
    fail('CROSS_VENUE_V2_DISCOVERY_LOCKED');
  assertV2RunnerExecutionAuthorized(CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK);
  const result=internalRun(args);
  return Object.freeze({...result,syntheticOnly:false});
}

export const CROSS_VENUE_V2_CANONICAL_RECEIPT_DIGEST=CANONICAL_RECEIPT_DIGEST;
export const CROSS_VENUE_V2_CANONICAL_SOURCE_PINS=CANONICAL_SOURCE_PINS;
export const CROSS_VENUE_V2_STRATEGY_DRIVER_SCHEMA=DRIVER_SCHEMA;
