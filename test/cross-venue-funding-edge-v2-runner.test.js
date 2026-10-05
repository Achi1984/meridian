import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  V2_RUNNER_STATES,runnerEventKey,sortRunnerEvents,runV2RunnerStateMachine,
  runnerStateAtTime,splitEntryAllowed,assertV2RunnerExecutionAuthorized
} from '../research/cross-venue-funding-edge-v2-runner.js';
import {recoveryAt} from '../research/cross-venue-funding-edge-v2-data-contract.js';

const H=60*60*1000;
const T=Date.parse('2026-01-01T00:00:00.000Z');

const e=(kind,time,stableId,extra={})=>({kind,time,stableId,...extra});
const decision=(time,stableId,{
  entryActive=true,inputsReady=true,splitEligible=true
}={})=>e('COMMON_DECISION',time,stableId,{entryActive,inputsReady,splitEligible});
const integrity=(time,stableId,integrityKind='OFF_GRID_FUNDING')=>
  e('INTEGRITY_DETECTION',time,stableId,{venue:'OKX',integrityKind});
const entryFill=(time,id='entry-fill')=>e('ENTRY_FILL',time,id,{venue:'PAIR'});
const exitDecision=(time,id='exit-decision')=>e('EXIT_DECISION',time,id);
const exitFill=(time,id='exit-fill')=>e('EXIT_FILL',time,id,{venue:'PAIR'});
const funding=(time,id='funding',venue='BINANCE')=>e('FUNDING_SETTLEMENT',time,id,{venue});

function completeCycle(){
  return[
    decision(T,'d0'),
    entryFill(T+H),
    exitDecision(T+2*H),
    exitFill(T+3*H)
  ];
}

function recoveryInputs({missingBinance=null,missingOkx=null}={}){
  const make=(missing)=>Array.from({length:49},(_,i)=>({
    openTime:T+i*H,open:100,high:101,low:99,close:100,confirmed:true
  })).filter(x=>x.openTime!==missing);
  return{binanceMarks:make(missingBinance),okxMarks:make(missingOkx)};
}

test('runnerEventKey freezes the total same-timestamp phase order',()=>{
  const time=T+8*H;
  const rows=[
    exitDecision(time,'6'),
    decision(time,'5',{entryActive:false}),
    integrity(time,'4'),
    entryFill(time,'3'),
    exitFill(time,'2'),
    funding(time,'1')
  ];
  assert.deepEqual(sortRunnerEvents(rows).map(x=>x.kind),[
    'FUNDING_SETTLEMENT','EXIT_FILL','ENTRY_FILL','INTEGRITY_DETECTION','COMMON_DECISION','EXIT_DECISION'
  ]);
  assert.deepEqual(runnerEventKey(funding(time,'x')),[time,1,'BINANCE','FUNDING_SETTLEMENT','x']);
  assert.throws(()=>sortRunnerEvents([funding(time,'x'),funding(time,'x')]),/DUPLICATE_RUNNER_EVENT_KEY/);
});

test('G1 detection equal to entry fill is terminal INCONCLUSIVE',()=>{
  const r=runV2RunnerStateMachine([
    decision(T,'d0'),entryFill(T+H),integrity(T+H,'i1')
  ]);
  assert.equal(r.outcome.status,'INCONCLUSIVE');
  assert.equal(r.outcome.terminal,true);
  assert.equal(r.state.status,V2_RUNNER_STATES.TERMINAL_INCONCLUSIVE);
});

test('G2 detection equal to exit decision wins before the decision and is terminal',()=>{
  const r=runV2RunnerStateMachine([
    decision(T,'d0'),entryFill(T+H),exitDecision(T+2*H),integrity(T+2*H,'i2')
  ]);
  assert.equal(r.outcome.status,'INCONCLUSIVE');
  assert.equal(r.trace.some(x=>x.action==='EXIT_PENDING_CREATED'),false);
});

test('G3 detection equal to exit fill remains terminal because the position is open through the tie',()=>{
  const r=runV2RunnerStateMachine([
    decision(T,'d0'),entryFill(T+H),exitDecision(T+2*H),exitFill(T+3*H),integrity(T+3*H,'i3')
  ]);
  assert.equal(r.outcome.status,'INCONCLUSIVE');
  assert.equal(r.trace.at(-2).action,'EXIT_FILLED');
  assert.equal(r.trace.at(-1).action,'TERMINAL_INCONCLUSIVE');
});

test('G4 degradation between decision and fill cancels pending entry with no economics',()=>{
  const r=runV2RunnerStateMachine([
    decision(T,'d0'),integrity(T+H/2,'i4')
  ]);
  assert.equal(r.state.status,V2_RUNNER_STATES.DEGRADED_FLAT);
  assert.equal(r.trace.at(-1).action,'PENDING_ENTRY_CANCELLED_BY_DEGRADATION');
  assert.equal(r.trace.some(x=>x.action==='ENTRY_FILLED'),false);
});

test('G5 detection at decision timestamp is processed first and blocks pending entry',()=>{
  const r=runV2RunnerStateMachine([
    decision(T,'d0'),integrity(T,'i5')
  ]);
  assert.equal(r.state.status,V2_RUNNER_STATES.DEGRADED_FLAT);
  assert.equal(r.state.pendingEntry,null);
  assert.equal(r.state.recoveryCount,0);
  assert.equal(r.trace.at(-1).action,'DEGRADED_DECISION_BLOCKED');
});

test('G6 cancelled pending entry never resurrects after recovery',()=>{
  const events=[
    decision(T,'old'),
    integrity(T+H/2,'i6'),
    decision(T+8*H,'r1',{entryActive:false}),
    decision(T+16*H,'r2',{entryActive:false}),
    decision(T+24*H,'r3',{entryActive:false})
  ];
  const recovered=runV2RunnerStateMachine(events,{recoveryInputs:recoveryInputs()});
  assert.equal(recovered.state.status,V2_RUNNER_STATES.FLAT_ELIGIBLE);
  assert.equal(recovered.state.pendingEntry,null);
  assert.equal(recovered.trace.some(x=>x.action==='ENTRY_PENDING_CREATED_AFTER_RECOVERY'),false);

  const fresh=runV2RunnerStateMachine([
    ...events,decision(T+32*H,'new',{entryActive:true})
  ],{recoveryInputs:recoveryInputs(),finalize:false});
  assert.equal(fresh.state.status,V2_RUNNER_STATES.ENTRY_PENDING);
  assert.equal(fresh.state.pendingEntry.decisionId,'new');
});

test('G7 common decisions while pending or open are ignored and never pyramid',()=>{
  const r=runV2RunnerStateMachine([
    decision(T,'d0'),
    decision(T+H/2,'d-pending'),
    entryFill(T+H),
    decision(T+3*H/2,'d-open')
  ],{finalize:false});
  assert.equal(r.state.status,V2_RUNNER_STATES.POSITION_OPEN);
  assert.equal(r.trace.filter(x=>x.action==='DECISION_IGNORED_NO_PYRAMID').length,2);
  assert.equal(r.trace.filter(x=>x.action==='ENTRY_FILLED').length,1);
});

test('G8 illegal fills and exit decisions fail closed',()=>{
  assert.throws(()=>runV2RunnerStateMachine([entryFill(T)]),/ILLEGAL_TRANSITION/);
  assert.throws(()=>runV2RunnerStateMachine([exitFill(T)]),/ILLEGAL_TRANSITION/);
  assert.throws(()=>runV2RunnerStateMachine([exitDecision(T)]),/ILLEGAL_TRANSITION/);
});

test('G9 permutation of input event arrays yields identical trace and digest',()=>{
  const xs=[
    ...completeCycle(),
    funding(T+H/2,'f1','BINANCE'),
    funding(T+H/2,'f2','OKX')
  ];
  const a=runV2RunnerStateMachine(xs);
  const b=runV2RunnerStateMachine([...xs].reverse());
  assert.deepEqual(a.trace,b.trace);
  assert.equal(a.traceDigest,b.traceDigest);
});

test('G10 a later integrity event before recovery resets the episode clock',()=>{
  const r=runV2RunnerStateMachine([
    integrity(T,'start'),
    integrity(T+4*H,'reset','FUNDING_GAP'),
    decision(T+8*H,'r1',{entryActive:false}),
    decision(T+16*H,'r2',{entryActive:false}),
    decision(T+24*H,'r3',{entryActive:false})
  ],{recoveryInputs:recoveryInputs()});
  assert.equal(r.state.status,V2_RUNNER_STATES.FLAT_ELIGIBLE);
  assert.equal(r.trace.some(x=>x.action==='DEGRADATION_RESET'),true);
});

test('G11 an integrity event exactly at candidate recovery T resets before the settlement',()=>{
  const r=runV2RunnerStateMachine([
    integrity(T,'start'),
    decision(T+8*H,'r1',{entryActive:false}),
    decision(T+16*H,'r2',{entryActive:false}),
    integrity(T+24*H,'reset-at-t','MISSING_SCHEDULED_FUNDING'),
    decision(T+24*H,'r3',{entryActive:false})
  ],{recoveryInputs:recoveryInputs()});
  assert.equal(r.state.status,V2_RUNNER_STATES.DEGRADED_FLAT);
  assert.equal(r.state.recoveryCount,0);
  assert.equal(r.state.degradationResetAt,T+24*H);
});

test('G12 a gap in common settlements resets the consecutive recovery count',()=>{
  const r=runV2RunnerStateMachine([
    integrity(T,'start'),
    decision(T+8*H,'r1',{entryActive:false}),
    decision(T+24*H,'gap',{entryActive:false})
  ],{recoveryInputs:recoveryInputs()});
  assert.equal(r.state.status,V2_RUNNER_STATES.DEGRADED_FLAT);
  assert.equal(r.state.recoveryCount,1);
  assert.equal(r.state.lastRecoverySettlementTime,T+24*H);
});

test('G13 one-venue funding settlement is not a common recovery settlement',()=>{
  const r=runV2RunnerStateMachine([
    integrity(T,'start'),
    funding(T+8*H,'one-venue','BINANCE')
  ]);
  assert.equal(r.state.status,V2_RUNNER_STATES.DEGRADED_FLAT);
  assert.equal(r.state.recoveryCount,0);
});

test('G15 split start state is derived causally from events strictly before the boundary',()=>{
  const events=[
    integrity(T,'start'),
    decision(T+8*H,'r1',{entryActive:false}),
    decision(T+16*H,'r2',{entryActive:false}),
    decision(T+24*H,'future-r3',{entryActive:false})
  ];
  const s=runnerStateAtTime(events,T+20*H,{recoveryInputs:recoveryInputs()});
  assert.equal(s.status,V2_RUNNER_STATES.DEGRADED_FLAT);
  assert.equal(s.recoveryCount,2);
});

test('G16 moving every integrity-event family earlier can only block or worsen outcome',()=>{
  const kinds=[
    'FUNDING_GAP','MISSING_SCHEDULED_FUNDING','OFF_GRID_FUNDING',
    'DUPLICATE_FUNDING','DUPLICATE_CANONICAL_FUNDING','DUPLICATE_MARK',
    'MISSING_MARK','UNCONFIRMED_MARK','ENTRY_FILL_ANOMALY',
    'PROVENANCE_FAILURE','ARCHIVE_FAILURE','PARSER_FAILURE'
  ];
  const baseline=runV2RunnerStateMachine(completeCycle());
  assert.equal(baseline.trace.some(x=>x.action==='EXIT_FILLED'),true);
  for(const kind of kinds){
    const degraded=runV2RunnerStateMachine([
      decision(T,'d0'),integrity(T+H/2,'early-'+kind,kind)
    ]);
    assert.notEqual(degraded.outcome.status,V2_RUNNER_STATES.FLAT_ELIGIBLE,kind);
    assert.equal(degraded.trace.some(x=>x.action==='EXIT_FILLED'),false,kind);
  }
});

test('G17 terminal outcome is prefix-invariant to later recovery funding decisions and events',()=>{
  const prefix=[decision(T,'d0'),entryFill(T+H),integrity(T+H,'terminal')];
  const a=runV2RunnerStateMachine(prefix);
  const b=runV2RunnerStateMachine([
    ...prefix,
    funding(T+8*H,'later-funding'),
    decision(T+8*H,'later-decision',{entryActive:false}),
    integrity(T+9*H,'later-integrity')
  ]);
  assert.deepEqual(b.outcome,a.outcome);
  assert.deepEqual(b.trace,a.trace);
  assert.equal(b.traceDigest,a.traceDigest);
});

test('G18 state at x is unchanged when all later data are removed',()=>{
  const full=completeCycle();
  const x=T+3*H/2;
  const a=runnerStateAtTime(full,x);
  const b=runnerStateAtTime(full.filter(row=>row.time<x),x);
  assert.deepEqual(a,b);
  assert.equal(a.status,V2_RUNNER_STATES.POSITION_OPEN);
});

test('G19 split isolation requires decision + 26h to be strictly before next split',()=>{
  assert.equal(splitEntryAllowed({decisionTime:T,nextSplitStart:T+26*H}),false);
  assert.equal(splitEntryAllowed({decisionTime:T,nextSplitStart:T+26*H+1}),true);
  assert.equal(splitEntryAllowed({decisionTime:T,nextSplitStart:null}),true);
});

test('G28 entryActive is a strict boolean in the runner contract',()=>{
  for(const bad of ['true',1,undefined,null]){
    assert.throws(()=>runV2RunnerStateMachine([
      e('COMMON_DECISION',T,'bad',{
        entryActive:bad,inputsReady:true,splitEligible:true
      })
    ]),/INVALID_ENTRY_ACTIVE_FLAG/);
  }
});

test('G30 runner execution is self-locked while discovery remains false',()=>{
  assert.throws(()=>assertV2RunnerExecutionAuthorized(),/DISCOVERY_LOCKED/);
  assert.equal(assertV2RunnerExecutionAuthorized({ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',discovery:true}),true);
  assert.throws(()=>assertV2RunnerExecutionAuthorized({ruleset:'OTHER',discovery:true}),/DISCOVERY_LOCKED/);
});

test('G31 runner implementation tests do not consume canonical source packages or artifacts',()=>{
  const bodies=[
    fs.readFileSync(new URL('./cross-venue-funding-edge-v2-runner.test.js',import.meta.url),'utf8'),
    fs.readFileSync(new URL('./cross-venue-funding-edge-v2-ledger.test.js',import.meta.url),'utf8')
  ].join('\n');
  assert.doesNotMatch(bodies,/research\/data\/.*source.*\.json/i);
  const artifactId='113365'+'41442';
  assert.equal(bodies.includes(artifactId),false);
});


test('R2.1 pending entry without fill becomes terminal on the first later event',()=>{
  const r=runV2RunnerStateMachine([
    decision(T,'entry'),
    decision(T+8*H,'later',{entryActive:false})
  ]);
  assert.equal(r.outcome.status,'INCONCLUSIVE');
  assert.equal(r.outcome.reason,'ENTRY_FILL_MISSING');
  assert.equal(r.trace.at(-1).action,'ENTRY_FILL_MISSING');
});

test('R2.2 exit pending without fill becomes terminal on the first later event',()=>{
  const r=runV2RunnerStateMachine([
    decision(T,'entry'),entryFill(T+H),exitDecision(T+2*H),
    funding(T+8*H,'later')
  ]);
  assert.equal(r.outcome.status,'INCONCLUSIVE');
  assert.equal(r.outcome.reason,'EXIT_FILL_MISSING');
  assert.equal(r.trace.at(-1).action,'EXIT_FILL_MISSING');
});

test('R2.3 pending entry plus integrity at t+2h without fill is terminal data degradation, not throw',()=>{
  const r=runV2RunnerStateMachine([
    decision(T,'entry'),
    integrity(T+2*H,'entry-candle','ENTRY_FILL_ANOMALY')
  ]);
  assert.equal(r.outcome.status,'INCONCLUSIVE');
  assert.equal(r.outcome.reason,'ENTRY_FILL_DATA_DEGRADATION');
  assert.equal(r.trace.at(-1).action,'ENTRY_FILL_DATA_DEGRADATION');
});

test('R2.4 run end with open pending or position is always terminal',()=>{
  const pending=runV2RunnerStateMachine([decision(T,'entry')]);
  assert.equal(pending.outcome.reason,'ENTRY_FILL_MISSING');

  const open=runV2RunnerStateMachine([decision(T,'entry'),entryFill(T+H)]);
  assert.equal(open.outcome.status,'INCONCLUSIVE');
  assert.equal(open.outcome.reason,'OPEN_POSITION_AT_RUN_END');

  const exitPending=runV2RunnerStateMachine([
    decision(T,'entry'),entryFill(T+H),exitDecision(T+2*H)
  ]);
  assert.equal(exitPending.outcome.reason,'EXIT_FILL_MISSING');
});

test('R2.5 recovery is derived from recoveryAt and cannot be supplied by caller',()=>{
  const events=[
    integrity(T,'start'),
    decision(T+8*H,'r1',{entryActive:false}),
    decision(T+16*H,'r2',{entryActive:false}),
    decision(T+24*H,'r3',{entryActive:false})
  ];
  const complete=recoveryInputs();
  const r=runV2RunnerStateMachine(events,{recoveryInputs:complete});
  assert.equal(r.state.status,V2_RUNNER_STATES.FLAT_ELIGIBLE);

  const missing=recoveryInputs({missingOkx:T+23*H});
  const blocked=runV2RunnerStateMachine(events,{recoveryInputs:missing});
  assert.equal(blocked.state.status,V2_RUNNER_STATES.DEGRADED_FLAT);

  const direct=recoveryAt({
    episodeStart:T,
    commonTimes:[T+8*H,T+16*H,T+24*H],
    integrityEvents:[],
    binanceMarks:complete.binanceMarks,
    okxMarks:complete.okxMarks
  });
  assert.equal(direct,T+24*H);

  assert.throws(()=>runV2RunnerStateMachine([
    integrity(T,'start'),
    e('COMMON_DECISION',T+8*H,'bad-flag',{
      entryActive:false,inputsReady:true,splitEligible:true,recoveryEligible:true
    })
  ],{recoveryInputs:complete}),/CALLER_RECOVERY_FLAG_FORBIDDEN/);
});

test('R2.6 recovery requires T-1h marks but not the mark at T',()=>{
  const events=[
    integrity(T,'start'),
    decision(T+8*H,'r1',{entryActive:false}),
    decision(T+16*H,'r2',{entryActive:false}),
    decision(T+24*H,'r3',{entryActive:false})
  ];
  const missingLastClosed=runV2RunnerStateMachine(events,{
    recoveryInputs:recoveryInputs({missingOkx:T+23*H})
  });
  assert.equal(missingLastClosed.state.status,V2_RUNNER_STATES.DEGRADED_FLAT);

  const missingAtT=runV2RunnerStateMachine(events,{
    recoveryInputs:recoveryInputs({missingOkx:T+24*H})
  });
  assert.equal(missingAtT.state.status,V2_RUNNER_STATES.FLAT_ELIGIBLE);
});
