import crypto from 'node:crypto';
import {CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK} from './cross-venue-funding-edge-v2-stage-lock.js';
import {CROSS_VENUE_FUNDING_EDGE_V2_SOURCE,recoveryAt} from './cross-venue-funding-edge-v2-data-contract.js';

const HOUR=60*60*1000;
const FUNDING_INTERVAL=8*HOUR;
const SPLIT_RESERVE=26*HOUR;

export const V2_RUNNER_PHASE_RANK=Object.freeze({
  FUNDING_SETTLEMENT:1,
  EXIT_FILL:2,
  ENTRY_FILL:3,
  INTEGRITY_DETECTION:4,
  COMMON_DECISION:5,
  EXIT_DECISION:6
});

export const V2_RUNNER_STATES=Object.freeze({
  FLAT_ELIGIBLE:'FLAT_ELIGIBLE',
  ENTRY_PENDING:'ENTRY_PENDING',
  POSITION_OPEN:'POSITION_OPEN',
  EXIT_PENDING:'EXIT_PENDING',
  DEGRADED_FLAT:'DEGRADED_FLAT',
  TERMINAL_INCONCLUSIVE:'TERMINAL_INCONCLUSIVE'
});

function fail(code){throw new Error(code)}
function strictTime(value,code='CROSS_VENUE_V2_INVALID_RUNNER_TIME'){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)fail(code);
  return value;
}
function strictBoolean(value,code){
  if(typeof value!=='boolean')fail(code);
  return value;
}
function strictString(value,code){
  if(typeof value!=='string'||value.length===0)fail(code);
  return value;
}
function sha256(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function eventView(e){
  return Object.freeze({
    time:e.time,
    kind:e.kind,
    venue:e.venue??'',
    stableId:e.stableId
  });
}

export function runnerEventKey(event){
  if(!event||typeof event!=='object'||Array.isArray(event))fail('CROSS_VENUE_V2_INVALID_RUNNER_EVENT');
  const time=strictTime(event.time);
  const kind=strictString(event.kind,'CROSS_VENUE_V2_INVALID_RUNNER_EVENT_KIND');
  const phaseRank=V2_RUNNER_PHASE_RANK[kind];
  if(!Number.isInteger(phaseRank))fail('CROSS_VENUE_V2_INVALID_RUNNER_EVENT_KIND');
  if(kind==='INTEGRITY_DETECTION')strictString(event.integrityKind,'CROSS_VENUE_V2_INVALID_INTEGRITY_KIND');
  const venue=event.venue??'';
  if(typeof venue!=='string')fail('CROSS_VENUE_V2_INVALID_RUNNER_EVENT_VENUE');
  const stableId=strictString(event.stableId,'CROSS_VENUE_V2_INVALID_RUNNER_EVENT_ID');
  return Object.freeze([time,phaseRank,venue,kind,stableId]);
}

function compareKeys(a,b){
  if(a[0]!==b[0])return a[0]-b[0];
  if(a[1]!==b[1])return a[1]-b[1];
  for(let i=2;i<a.length;i++){
    const x=String(a[i]),y=String(b[i]);
    if(x<y)return-1;
    if(x>y)return 1;
  }
  return 0;
}

export function sortRunnerEvents(events=[]){
  if(!Array.isArray(events))fail('CROSS_VENUE_V2_INVALID_RUNNER_EVENTS');
  const keyed=events.map(event=>({event,key:runnerEventKey(event)}))
    .sort((a,b)=>compareKeys(a.key,b.key));
  for(let i=1;i<keyed.length;i++){
    if(compareKeys(keyed[i-1].key,keyed[i].key)===0)
      fail('CROSS_VENUE_V2_DUPLICATE_RUNNER_EVENT_KEY');
  }
  return keyed.map(x=>x.event);
}

export function splitEntryAllowed({decisionTime,nextSplitStart=null}={}){
  const t=strictTime(decisionTime);
  if(nextSplitStart===null)return true;
  const next=strictTime(nextSplitStart,'CROSS_VENUE_V2_INVALID_SPLIT_BOUNDARY');
  if(next<=t)fail('CROSS_VENUE_V2_INVALID_SPLIT_BOUNDARY');
  return t+SPLIT_RESERVE<next;
}

export function fundingSettlementInWindow({entryFillTime,exitDecisionTime,settlementTime}={}){
  const entry=strictTime(entryFillTime,'CROSS_VENUE_V2_INVALID_ENTRY_TIME');
  const exitDecision=strictTime(exitDecisionTime,'CROSS_VENUE_V2_INVALID_EXIT_DECISION_TIME');
  const settlement=strictTime(settlementTime,'CROSS_VENUE_V2_INVALID_FUNDING_TIME');
  if(exitDecision<entry)fail('CROSS_VENUE_V2_INVALID_EXIT_DECISION_TIME');
  return entry<settlement&&settlement<=exitDecision;
}

export function assertV2RunnerExecutionAuthorized(lock=CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK){
  if(!lock||lock.ruleset!=='CROSS-VENUE-FUNDING-EDGE-V2'||lock.discovery!==true)
    fail('CROSS_VENUE_V2_DISCOVERY_LOCKED');
  return true;
}

export function executeV2Runner({events=[],recoveryInputs=null,lock=CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK}={}){
  assertV2RunnerExecutionAuthorized(lock);
  return runV2RunnerStateMachine(events,{recoveryInputs});
}

function initialState(){
  return {
    status:V2_RUNNER_STATES.FLAT_ELIGIBLE,
    recoveryCount:0,
    lastRecoverySettlementTime:null,
    degradationResetAt:null,
    pendingEntry:null,
    openPosition:null,
    exitPending:null,
    lastExitFillTime:null,
    terminalReason:null
  };
}
function cloneState(s){
  return {
    ...s,
    pendingEntry:s.pendingEntry?{...s.pendingEntry}:null,
    openPosition:s.openPosition?{...s.openPosition}:null,
    exitPending:s.exitPending?{...s.exitPending}:null
  };
}
function snapshotState(s){
  return Object.freeze({
    status:s.status,
    recoveryCount:s.recoveryCount,
    lastRecoverySettlementTime:s.lastRecoverySettlementTime,
    degradationResetAt:s.degradationResetAt,
    pendingEntry:s.pendingEntry?Object.freeze({...s.pendingEntry}):null,
    openPosition:s.openPosition?Object.freeze({...s.openPosition}):null,
    exitPending:s.exitPending?Object.freeze({...s.exitPending}):null,
    lastExitFillTime:s.lastExitFillTime,
    terminalReason:s.terminalReason
  });
}
function appendTrace(trace,event,from,to,action){
  trace.push(Object.freeze({event:eventView(event),from,to,action}));
}
function terminalize(s,event,trace,reason='OPEN_POSITION_AT_DATA_DEGRADATION',action='TERMINAL_INCONCLUSIVE'){
  const from=s.status;
  s.status=V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE;
  s.terminalReason=reason;
  s.pendingEntry=null;
  s.exitPending=null;
  appendTrace(trace,event,from,s.status,action);
}
function terminalizeRunEnd(s,trace,lastTime){
  if(s.status===V2_RUNNER_STATES.ENTRY_PENDING){
    terminalize(s,{time:s.pendingEntry.fillAt,kind:'RUN_END',venue:'',stableId:'run-end-entry'},trace,'ENTRY_FILL_MISSING','ENTRY_FILL_MISSING');
  }else if(s.status===V2_RUNNER_STATES.EXIT_PENDING){
    terminalize(s,{time:s.exitPending.fillAt,kind:'RUN_END',venue:'',stableId:'run-end-exit'},trace,'EXIT_FILL_MISSING','EXIT_FILL_MISSING');
  }else if(s.status===V2_RUNNER_STATES.POSITION_OPEN){
    terminalize(s,{time:lastTime??s.openPosition.entryFillTime,kind:'RUN_END',venue:'',stableId:'run-end-open'},trace,'OPEN_POSITION_AT_RUN_END','OPEN_POSITION_AT_RUN_END');
  }
}
function degradeFlat(s,event,trace,action='DATA_DEGRADED'){
  const from=s.status;
  s.status=V2_RUNNER_STATES.DEGRADED_FLAT;
  s.degradationResetAt=Math.max(s.degradationResetAt??0,event.time);
  s.recoveryCount=0;
  s.lastRecoverySettlementTime=null;
  s.pendingEntry=null;
  s.openPosition=null;
  s.exitPending=null;
  appendTrace(trace,event,from,s.status,action);
}
function maybeOpenPending(s,event,trace,fromOverride=null){
  const active=strictBoolean(event.entryActive,'CROSS_VENUE_V2_INVALID_ENTRY_ACTIVE_FLAG');
  const inputsReady=strictBoolean(event.inputsReady,'CROSS_VENUE_V2_INVALID_ENTRY_INPUTS_FLAG');
  const splitEligible=strictBoolean(event.splitEligible,'CROSS_VENUE_V2_INVALID_SPLIT_ELIGIBILITY_FLAG');
  if(!(active&&inputsReady&&splitEligible)){
    appendTrace(trace,event,fromOverride??s.status,s.status,'DECISION_NO_ENTRY');
    return;
  }
  const from=fromOverride??s.status;
  s.status=V2_RUNNER_STATES.ENTRY_PENDING;
  s.pendingEntry={decisionTime:event.time,fillAt:event.time+HOUR,decisionId:event.stableId};
  appendTrace(trace,event,from,s.status,'ENTRY_PENDING_CREATED');
}

function recoveryContextFor(ordered,recoveryInputs){
  if(!recoveryInputs||typeof recoveryInputs!=='object'||Array.isArray(recoveryInputs))
    return null;
  const {binanceMarks,okxMarks,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE}=recoveryInputs;
  if(!Array.isArray(binanceMarks)||!Array.isArray(okxMarks))
    fail('CROSS_VENUE_V2_RECOVERY_MARKS_REQUIRED');
  return{
    commonTimes:ordered.filter(e=>e.kind==='COMMON_DECISION').map(e=>e.time),
    integrityEvents:ordered.filter(e=>e.kind==='INTEGRITY_DETECTION').map(e=>({
      kind:e.integrityKind,
      venue:e.venue??'',
      detectionTime:e.time
    })),
    binanceMarks,
    okxMarks,
    contract
  };
}

function applyCommonDecision(s,event,trace,recoveryContext){
  strictBoolean(event.entryActive,'CROSS_VENUE_V2_INVALID_ENTRY_ACTIVE_FLAG');
  strictBoolean(event.inputsReady,'CROSS_VENUE_V2_INVALID_ENTRY_INPUTS_FLAG');
  strictBoolean(event.splitEligible,'CROSS_VENUE_V2_INVALID_SPLIT_ELIGIBILITY_FLAG');
  if(Object.hasOwn(event,'recoveryEligible'))
    fail('CROSS_VENUE_V2_CALLER_RECOVERY_FLAG_FORBIDDEN');

  if([V2_RUNNER_STATES.ENTRY_PENDING,V2_RUNNER_STATES.POSITION_OPEN,V2_RUNNER_STATES.EXIT_PENDING].includes(s.status)){
    appendTrace(trace,event,s.status,s.status,'DECISION_IGNORED_NO_PYRAMID');
    return;
  }
  if(s.status===V2_RUNNER_STATES.FLAT_ELIGIBLE){
    maybeOpenPending(s,event,trace);
    return;
  }
  if(s.status!==V2_RUNNER_STATES.DEGRADED_FLAT)fail('CROSS_VENUE_V2_ILLEGAL_TRANSITION');
  if(event.time<=s.degradationResetAt){
    appendTrace(trace,event,s.status,s.status,'DEGRADED_DECISION_BLOCKED');
    return;
  }
  if(!recoveryContext)fail('CROSS_VENUE_V2_RECOVERY_MARKS_REQUIRED');

  const consecutive=s.lastRecoverySettlementTime!==null&&event.time-s.lastRecoverySettlementTime===FUNDING_INTERVAL;
  const rawCount=s.lastRecoverySettlementTime===null?1:(consecutive?s.recoveryCount+1:1);
  const recoveryTime=recoveryAt({
    episodeStart:s.degradationResetAt,
    commonTimes:recoveryContext.commonTimes,
    integrityEvents:recoveryContext.integrityEvents,
    binanceMarks:recoveryContext.binanceMarks,
    okxMarks:recoveryContext.okxMarks
  },recoveryContext.contract);

  if(recoveryTime===event.time){
    if(rawCount<3)fail('CROSS_VENUE_V2_RECOVERY_STATE_DIVERGENCE');
    const from=s.status;
    s.status=V2_RUNNER_STATES.FLAT_ELIGIBLE;
    s.recoveryCount=0;
    s.lastRecoverySettlementTime=null;
    s.degradationResetAt=null;
    appendTrace(trace,event,from,s.status,'RECOVERED');
    if(event.entryActive&&event.inputsReady&&event.splitEligible){
      s.status=V2_RUNNER_STATES.ENTRY_PENDING;
      s.pendingEntry={decisionTime:event.time,fillAt:event.time+HOUR,decisionId:event.stableId};
      appendTrace(trace,event,V2_RUNNER_STATES.FLAT_ELIGIBLE,s.status,'ENTRY_PENDING_CREATED_AFTER_RECOVERY');
    }
    return;
  }
  const from=s.status;
  s.recoveryCount=Math.min(2,rawCount);
  s.lastRecoverySettlementTime=event.time;
  appendTrace(trace,event,from,s.status,'RECOVERY_PROGRESS');
}

function applyEvent(s,event,trace,recoveryContext){
  const key=runnerEventKey(event);
  event={...event,time:key[0],kind:key[3],venue:key[2],stableId:key[4]};
  const from=s.status;

  if(event.kind==='FUNDING_SETTLEMENT'){
    appendTrace(trace,event,from,from,'FUNDING_SETTLEMENT_OBSERVED');
    return;
  }

  if(event.kind==='INTEGRITY_DETECTION'){
    if(s.status===V2_RUNNER_STATES.FLAT_ELIGIBLE){
      if(s.lastExitFillTime===event.time){
        terminalize(s,event,trace);
        return;
      }
      if(
        s.lastExitFillTime!==null&&
        event.time===s.lastExitFillTime+HOUR&&
        ['MISSING_MARK','DUPLICATE_MARK','UNCONFIRMED_MARK'].includes(event.integrityKind)
      ){
        terminalize(s,event,trace,'EXIT_FILL_DATA_DEGRADATION','EXIT_FILL_DATA_DEGRADATION');
        return;
      }
      degradeFlat(s,event,trace);
      return;
    }
    if(s.status===V2_RUNNER_STATES.ENTRY_PENDING){
      if(event.time<s.pendingEntry.fillAt){
        degradeFlat(s,event,trace,'PENDING_ENTRY_CANCELLED_BY_DEGRADATION');
        return;
      }
      terminalize(s,event,trace,'ENTRY_FILL_DATA_DEGRADATION','ENTRY_FILL_DATA_DEGRADATION');
      return;
    }
    if([V2_RUNNER_STATES.POSITION_OPEN,V2_RUNNER_STATES.EXIT_PENDING].includes(s.status)){
      terminalize(s,event,trace);
      return;
    }
    if(s.status===V2_RUNNER_STATES.DEGRADED_FLAT){
      degradeFlat(s,event,trace,'DEGRADATION_RESET');
      return;
    }
    fail('CROSS_VENUE_V2_ILLEGAL_TRANSITION');
  }

  if(event.kind==='COMMON_DECISION'){
    applyCommonDecision(s,event,trace,recoveryContext);
    return;
  }

  if(event.kind==='ENTRY_FILL'){
    if(s.status!==V2_RUNNER_STATES.ENTRY_PENDING||event.time!==s.pendingEntry.fillAt)
      fail('CROSS_VENUE_V2_ILLEGAL_TRANSITION');
    s.status=V2_RUNNER_STATES.POSITION_OPEN;
    s.openPosition={entryFillTime:event.time,decisionTime:s.pendingEntry.decisionTime,decisionId:s.pendingEntry.decisionId};
    s.pendingEntry=null;
    appendTrace(trace,event,from,s.status,'ENTRY_FILLED');
    return;
  }

  if(event.kind==='EXIT_DECISION'){
    if(s.status!==V2_RUNNER_STATES.POSITION_OPEN)fail('CROSS_VENUE_V2_ILLEGAL_TRANSITION');
    s.status=V2_RUNNER_STATES.EXIT_PENDING;
    s.exitPending={exitDecisionTime:event.time,fillAt:event.time+HOUR,decisionId:event.stableId};
    appendTrace(trace,event,from,s.status,'EXIT_PENDING_CREATED');
    return;
  }

  if(event.kind==='EXIT_FILL'){
    if(s.status!==V2_RUNNER_STATES.EXIT_PENDING||event.time!==s.exitPending.fillAt)
      fail('CROSS_VENUE_V2_ILLEGAL_TRANSITION');
    s.status=V2_RUNNER_STATES.FLAT_ELIGIBLE;
    s.lastExitFillTime=event.time;
    s.openPosition=null;
    s.exitPending=null;
    appendTrace(trace,event,from,s.status,'EXIT_FILLED');
    return;
  }

  fail('CROSS_VENUE_V2_INVALID_RUNNER_EVENT_KIND');
}

export function runV2RunnerStateMachine(events=[],{recoveryInputs=null,finalize=true}={}){
  const ordered=sortRunnerEvents(events);
  const recoveryContext=recoveryContextFor(ordered,recoveryInputs);
  const state=initialState();
  const trace=[];
  let lastTime=null;
  for(const event of ordered){
    if(state.status===V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE)break;
    const key=runnerEventKey(event);
    lastTime=key[0];
    if(state.status===V2_RUNNER_STATES.ENTRY_PENDING&&key[0]>state.pendingEntry.fillAt&&key[3]!=='INTEGRITY_DETECTION'){
      terminalize(state,event,trace,'ENTRY_FILL_MISSING','ENTRY_FILL_MISSING');
      break;
    }
    if(state.status===V2_RUNNER_STATES.EXIT_PENDING&&key[0]>state.exitPending.fillAt){
      terminalize(state,event,trace,'EXIT_FILL_MISSING','EXIT_FILL_MISSING');
      break;
    }
    applyEvent(state,event,trace,recoveryContext);
  }
  if(finalize&&state.status!==V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE)
    terminalizeRunEnd(state,trace,lastTime);
  const frozenTrace=Object.freeze(trace);
  return Object.freeze({
    outcome:state.status===V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE
      ?Object.freeze({status:'INCONCLUSIVE',terminal:true,reason:state.terminalReason})
      :Object.freeze({status:state.status,terminal:false}),
    state:snapshotState(state),
    trace:frozenTrace,
    traceDigest:sha256(frozenTrace)
  });
}

export function runnerStateBeforeTime(events=[],asOfTime,{recoveryInputs=null}={}){
  const t=strictTime(asOfTime);
  const prefix=sortRunnerEvents(events).filter(e=>runnerEventKey(e)[0]<t);
  return runV2RunnerStateMachine(prefix,{recoveryInputs,finalize:false}).state;
}

export const runnerStateAtTime=runnerStateBeforeTime;
