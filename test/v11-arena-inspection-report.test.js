import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {MAX_INSPECTION_REPORT_BYTES,parseArenaInspectionReport} from '../v11/arena-inspection-report.js';
import {createStrategyArenaView} from '../v11/strategy-arena.js';

function fixture(state='queued') {
  const attempted=!['queued','rejected'].includes(state),completed=state==='completed',unresolved=state==='unknown';
  return {schema:'MERIDIAN_B1_INSPECTION_REPORT_V1',profile:'MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1',
    evidenceClass:'SYNTHETIC_ONLY',trialId:'a'.repeat(64),state,unresolved,requiresExplicitReconciliation:unresolved,
    attempts:attempted?1:0,fence:attempted?1:0,
    fenceInterpretation:unresolved?'UNRESOLVED_FENCE_RETAINED':'NO_UNRESOLVED_FENCE_FOR_THIS_TRIAL',
    integrity:'STORED_JOURNAL_VALIDATED_NOT_SOURCE_AUTHENTICITY',
    timestamps:{createdAt:'2026-01-01T00:00:00Z',startedAt:attempted?'2026-01-01T00:00:01Z':null,
      finishedAt:(attempted&&!unresolved)||state==='rejected'?'2026-01-01T00:00:02Z':null},
    identities:{protocolSha256:'b'.repeat(64),sourceSha256:'c'.repeat(64),dataSha256:'d'.repeat(64),
      manifestSha256:'e'.repeat(64),resultSha256:completed?'f'.repeat(64):null,summarySha256:completed?'0'.repeat(64):null},
    pathsStarted:completed?44:0,pathsCompleted:completed?44:0,reasonCode:null,
    executionAuthorized:false,promotionAuthorized:false,profitabilityInferred:false,recoveryPerformed:false};
}
const parse = value=>parseArenaInspectionReport(JSON.stringify(value));
function rootFixture(){
  const listeners=new Map();
  return {innerHTML:'',contains:()=>true,addEventListener:(key,fn)=>listeners.set(key,fn),
    removeEventListener:key=>listeners.delete(key),replaceChildren(){this.innerHTML='';},
    importFile(file){return listeners.get('change')({target:{closest:selector=>selector==='[data-arena-inspection]'?{files:[file]}:null}});},listeners};
}
const file = text=>({size:new TextEncoder().encode(text).length,text:async()=>text});
const deferred = ()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('all producer states remain explicit synthetic claims without promotion',()=>{
  for(const state of ['queued','unknown','completed','rejected','failed','timed_out','partial']){
    const result=parse(fixture(state));assert.equal(result.status,'PRESENT_UNVERIFIED',state);
    assert.equal(result.report.state,state);assert.equal(result.report.executionAuthorized,false);
    assert.equal(result.report.promotionAuthorized,false);assert.match(result.message,/keine Echtheitsbestätigung/);
  }
  const partial=fixture('partial');partial.pathsStarted=19;partial.pathsCompleted=19;
  partial.identities.resultSha256='1'.repeat(64);partial.identities.summarySha256='2'.repeat(64);
  assert.equal(parse(partial).report.state,'partial');
});

test('missing, malformed, oversized and historical imports fail closed',()=>{
  assert.equal(parseArenaInspectionReport(null).status,'UNKNOWN');
  for(const input of ['', '{', true, ' '.repeat(MAX_INSPECTION_REPORT_BYTES+1), 'é'.repeat(8193)])
    assert.equal(parseArenaInspectionReport(input).status,'INVALID');
  for(const extra of [{evidenceClass:'HISTORICAL'},{schema:'OTHER'},{profile:'OTHER'},{state:'running'},
    {executionAuthorized:true},{promotionAuthorized:true},{profitabilityInferred:true},{recoveryPerformed:true},
    {winner:true},{result:{netPnl:99}},{trialId:'invalid'},{reasonCode:'<script>alert(1)</script>'}])
    assert.equal(parse({...fixture(),...extra}).status,'INVALID');
});

test('identity, attempt, timestamp and completeness conflicts are rejected',()=>{
  const mutations=[x=>delete x.identities.dataSha256,x=>x.identities.inputSha256='a'.repeat(64),
    x=>x.identities.summarySha256=null,x=>x.pathsCompleted=45,x=>x.attempts=0,x=>x.fence=0,
    x=>x.unresolved=true,x=>x.requiresExplicitReconciliation=true,x=>x.timestamps.finishedAt=null,
    x=>x.timestamps.startedAt='2025-01-01T00:00:00Z',x=>x.pathsStarted=43,x=>x.timestamps.createdAt='2026-02-30T00:00:00Z',
    x=>x.timestamps.createdAt='2026-01-01T24:00:00Z'];
  for(const mutate of mutations){const value=fixture('completed');mutate(value);assert.equal(parse(value).status,'INVALID');}
  const pending=fixture('unknown');pending.timestamps.finishedAt='2026-01-01T00:00:02Z';assert.equal(parse(pending).status,'INVALID');
  const queued=fixture();queued.pathsStarted=1;assert.equal(parse(queued).status,'INVALID');
});

test('single in-flight path and rejected completion time follow the producer lifecycle',()=>{
  const unknown=fixture('unknown');unknown.pathsStarted=44;unknown.pathsCompleted=0;
  assert.equal(parse(unknown).status,'INVALID');
  unknown.pathsStarted=1;
  assert.equal(parse(unknown).status,'PRESENT_UNVERIFIED');
  unknown.pathsStarted=0;unknown.timestamps.startedAt=null;
  assert.equal(parse(unknown).status,'PRESENT_UNVERIFIED','claimed unknown may have no start timestamp');
  const rejected=fixture('rejected');
  assert.equal(parse(rejected).status,'PRESENT_UNVERIFIED');
  rejected.timestamps.finishedAt=null;
  assert.equal(parse(rejected).status,'INVALID');
});

test('settled unknown requires a finish while pre-start terminal failures remain representable',()=>{
  const settled=fixture('unknown');
  settled.unresolved=false;settled.requiresExplicitReconciliation=false;
  settled.fenceInterpretation='NO_UNRESOLVED_FENCE_FOR_THIS_TRIAL';
  settled.timestamps.startedAt=null;
  assert.equal(parse(settled).status,'INVALID');
  settled.timestamps.finishedAt='2026-01-01T00:00:02Z';
  assert.equal(parse(settled).status,'PRESENT_UNVERIFIED');
  for(const state of ['failed','timed_out','partial']){
    const report=fixture(state);report.timestamps.startedAt=null;
    assert.equal(parse(report).status,'PRESENT_UNVERIFIED',state);
  }
});

test('report import renders separate identities without network, hashing or replay path',async t=>{
  let fetchCalls=0,digestCalls=0;
  t.mock.method(globalThis.crypto.subtle,'digest',()=>{digestCalls++;throw Error('Report import must not hash replay input');});
  const root=rootFixture(),view=createStrategyArenaView(root,{fetchImpl:()=>{fetchCalls++;throw Error('No fetch');}});
  const cards=html=>[...html.matchAll(/<article class="arena-model-card">([\s\S]*?)<\/article>/g)].map(match=>match[0]);
  const before=cards(root.innerHTML);
  await root.importFile(file(JSON.stringify(fixture('completed'))));
  assert.deepEqual(cards(root.innerHTML),before);
  assert.match(root.innerHTML,/Separater synthetischer Prüfbericht/);assert.match(root.innerHTML,/SYNTHETIC_ONLY · Status: completed/);
  assert.match(root.innerHTML,/keine Echtheitsbestätigung/);assert.match(root.innerHTML,/overflow-wrap:anywhere/);
  assert.equal(fetchCalls,0);assert.equal(digestCalls,0);
  await root.importFile(file('{'));assert.match(root.innerHTML,/Prüfbericht abgelehnt/);
  assert.doesNotMatch(root.innerHTML,/SYNTHETIC_ONLY · Status: completed/);
  assert.deepEqual(cards(root.innerHTML),before);view.dispose();
});

test('size is checked before reading; latest import wins and disposed view never repaints',async()=>{
  const root=rootFixture(),view=createStrategyArenaView(root);
  await root.importFile({size:MAX_INSPECTION_REPORT_BYTES+1,text:()=>{throw Error('must not read');}});
  assert.match(root.innerHTML,/Prüfbericht abgelehnt/);
  const gate=deferred(),older=root.importFile({size:100,text:()=>gate.promise});
  await root.importFile(file(JSON.stringify(fixture('partial'))));
  gate.resolve(JSON.stringify(fixture('completed')));await older;
  assert.match(root.innerHTML,/SYNTHETIC_ONLY · Status: partial/);
  assert.doesNotMatch(root.innerHTML,/SYNTHETIC_ONLY · Status: completed/);
  const late=deferred(),pending=root.importFile({size:100,text:()=>late.promise});
  view.dispose();late.resolve(JSON.stringify(fixture('completed')));await pending;
  assert.equal(root.innerHTML,'');assert.equal(root.listeners.size,0);
});

test('file read failure cannot restore an old successful report',async()=>{
  const root=rootFixture(),view=createStrategyArenaView(root);
  await root.importFile(file(JSON.stringify(fixture('completed'))));
  await root.importFile({size:100,text:async()=>{throw Error('/private/path');}});
  assert.match(root.innerHTML,/Prüfbericht abgelehnt/);assert.doesNotMatch(root.innerHTML,/private\/path|Status: completed/);
  view.dispose();
});

test('metadata parser has no runtime, network or engine dependency',()=>{
  const source=readFileSync(new URL('../v11/arena-inspection-report.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/^import\s|\b(?:fetch|replayStrategyPaperArena|evaluateArenaImport|loadStoredArena)\s*\(/m);
});
