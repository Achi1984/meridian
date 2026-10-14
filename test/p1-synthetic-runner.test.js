import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSyntheticP1Account,advanceSyntheticP1} from '../docs/strategy-lab/p1-synthetic-runner.mjs';
import {readSpotJournal} from '../docs/strategy-lab/spot-journal.mjs';
const DAY=86400000,UNIT=1000000;
const moduleURL=new URL('../docs/strategy-lab/p1-synthetic-runner.mjs',import.meta.url).href;
const journalURL=new URL('../docs/strategy-lab/spot-journal.mjs',import.meta.url).href;
const policy={riskBudgetMicros:'100000000',remainingExposureMicros:'10000000000',
  stressedExitPriceMicrosPerLot:'80000000',feeBps:10};
const head=directory=>({schemaVersion:'MERIDIAN_P1_SYNTHETIC_STEP_V1',synthetic:true,
  priceUnit:'EUR_MICROS_PER_SYNTHETIC_LOT',directory,symbol:'SYNTH_P1'});
function fixture() {
  const start=Date.UTC(2024,0,1);
  const bars=Array.from({length:201},(_,i)=>({openTimeMs:start+i*DAY,closeTimeMs:start+(i+1)*DAY,
    availableAtMs:start+(i+1)*DAY+1000,open:100*UNIT,high:(i>=190?110:101)*UNIT,
    low:(i>=190?90:99)*UNIT,close:(i===199?92:i===200?104:100)*UNIT,volume:10}));
  const asOfMs=bars[200].availableAtMs;
  return {kind:'SIGNAL',bars,asOfMs,receivedAtMs:asOfMs,expiresAtMs:asOfMs+5000};
}
const quote=(t,bid=103900000,ask=104000000)=>({kind:'QUOTE',quoteAtMs:t,receivedAtMs:t,bid,ask});
const request=(d,v,step,p=policy)=>({...head(d),expectedVersion:v,policy:structuredClone(p),step});
async function setup(t) {
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'p1-synthetic-test-'));
  t.after(()=>fs.rm(d,{recursive:true,force:true}));
  const r=await createSyntheticP1Account({...head(d),cashMicros:'10000000000'});
  assert.equal(r.valid,true,r.code);return d;
}
async function enter(d) {
  const s=fixture(),pending=await advanceSyntheticP1(request(d,0,s));
  assert.equal(pending.valid,true,pending.code);assert.equal(pending.book.lifecycle.phase,'PENDING_ENTRY');
  const bought=await advanceSyntheticP1(request(d,1,quote(s.asOfMs+1)));
  assert.equal(bought.valid,true,bought.code);return {s,pending,bought};
}
function child(request,source='console.log(JSON.stringify(await r.advanceSyntheticP1(request)));') {
  const c=spawnSync(process.execPath,['--input-type=module','-e',
    `import fs from 'node:fs/promises';import * as r from ${JSON.stringify(moduleURL)};
     import * as j from ${JSON.stringify(journalURL)};const request=${JSON.stringify(request)};${source}`],
    {encoding:'utf8',timeout:20000});
  assert.equal(c.error,undefined,c.error?.message);assert.equal(c.status,0,c.stderr);
  return JSON.parse(c.stdout);
}
async function unchanged(d,fn) {
  const file=path.join(d,'spot-journal.json'),before=await fs.readFile(file);
  const r=await fn();assert.equal(r.valid,false);assert.equal(r.fill,null);
  assert.deepEqual(await fs.readFile(file),before);return r;
}

test('P1 entry maps actual availability, lower integer stop, exact four-lot EUR booking',async t=>{
  const d=await setup(t),{s,pending,bought}=await enter(d);
  assert.equal(pending.signal.action,'ENTER_LONG_CANDIDATE');
  assert.equal(pending.book.lifecycle.pending.availableAt,s.receivedAtMs);
  assert.equal(pending.book.lifecycle.pending.initialStop,Math.floor(pending.signal.initialStop));
  assert.equal(bought.fill.side,'BUY');assert.equal(bought.fill.lots,'4');
  assert.equal(bought.fill.feeMicros,'416000');assert.equal(bought.book.account.cashMicros,'9583584000');
  assert.equal(bought.version,2);assert.equal(bought.executionAuthorized,false);
  assert.equal(bought.fill.executionAuthorized,false);assert.equal(bought.researchOnly,true);
  assert.ok(BigInt(bought.sizing.modeledRiskMicros)<=100000000n);
});
test('separate process restart preserves entry, P1 exits on next window and SELL is exactly once',async t=>{
  const d=await setup(t),{s,bought}=await enter(d),last=s.bars[200];
  const exit=structuredClone(s);exit.bars.shift();exit.bars.push({...last,openTimeMs:last.openTimeMs+DAY,
    closeTimeMs:last.closeTimeMs+DAY,availableAtMs:last.availableAtMs+DAY,close:108*UNIT});
  exit.asOfMs=exit.receivedAtMs=last.availableAtMs+DAY;exit.expiresAtMs=exit.asOfMs+5000;
  const pending=child(request(d,2,exit),`const held=await j.readSpotJournal({directory:request.directory});
    const pending=await r.advanceSyntheticP1(request);console.log(JSON.stringify({held,pending}));`);
  assert.deepEqual(pending.held.book,bought.book);assert.equal(pending.pending.valid,true,pending.pending.code);
  assert.equal(pending.pending.signal.action,'EXIT_LONG');assert.equal(pending.pending.version,3);
  const q=quote(exit.asOfMs+1,109000000,110000000),closed=child(request(d,3,q));
  assert.equal(closed.fill.side,'SELL');assert.equal(closed.fill.lots,'4');
  assert.equal(closed.book.account.cashMicros,'10019148000');assert.deepEqual(closed.book.account.positions,[]);
  await unchanged(d,()=>advanceSyntheticP1(request(d,4,q)));
  assert.equal((await readSpotJournal({directory:d})).version,4);
});
test('restart stop sells once; altered asOf cannot reuse the same daily candidate',async t=>{
  const d=await setup(t),{s}=await enter(d),stop=quote(s.asOfMs+2,70000000,71000000);
  const closed=child(request(d,2,stop));assert.equal(closed.fill.side,'SELL');assert.equal(closed.version,3);
  const duplicate={...stop,receivedAtMs:s.asOfMs+3};
  // A fresh receipt of the same old quote cannot book another sell while flat.
  const noSell=await unchanged(d,()=>advanceSyntheticP1(request(d,3,duplicate)));assert.equal(noSell.fill,null);
  const old=structuredClone(s);old.asOfMs=old.receivedAtMs=s.asOfMs+4;old.expiresAtMs=s.asOfMs+5000;
  const r=await unchanged(d,()=>advanceSyntheticP1(request(d,3,old)));
  assert.match(r.code,/ID_REPLAY_OR_COLLISION/);
});
test('equal-time quote cannot fill before signal availability; later quote can',async t=>{
  const d=await setup(t),s=fixture();s.receivedAtMs=s.asOfMs+1;
  const pending=await advanceSyntheticP1(request(d,0,s));assert.equal(pending.valid,true);
  const equal=await advanceSyntheticP1(request(d,1,{...quote(s.asOfMs),receivedAtMs:s.asOfMs+2}));
  assert.equal(equal.valid,true,equal.code);assert.equal(equal.fill,null);
  assert.equal(equal.book.lifecycle.phase,'PENDING_ENTRY');
  const later=await advanceSyntheticP1(request(d,2,quote(s.asOfMs+3)));
  assert.equal(later.fill.side,'BUY');
});
test('quote before or equal to delayed actual signal receipt cannot BUY; strictly later quote can',async t=>{
  const d=await setup(t),s=fixture();s.receivedAtMs=s.asOfMs+500;
  const pending=await advanceSyntheticP1(request(d,0,s));
  assert.equal(pending.valid,true,pending.code);
  assert.equal(pending.signal.signalAvailableAtMs,s.asOfMs);
  assert.equal(pending.book.lifecycle.pending.availableAt,s.receivedAtMs);
  const earlier=await advanceSyntheticP1(request(d,1,
    {...quote(s.asOfMs+250),receivedAtMs:s.receivedAtMs+1}));
  assert.equal(earlier.valid,true,earlier.code);assert.equal(earlier.fill,null);
  assert.equal(earlier.book.lifecycle.phase,'PENDING_ENTRY');
  const equal=await advanceSyntheticP1(request(d,2,
    {...quote(s.receivedAtMs),receivedAtMs:s.receivedAtMs+2}));
  assert.equal(equal.valid,true,equal.code);assert.equal(equal.fill,null);
  assert.equal(equal.book.lifecycle.phase,'PENDING_ENTRY');
  const later=await advanceSyntheticP1(request(d,3,quote(s.receivedAtMs+3)));
  assert.equal(later.valid,true,later.code);assert.equal(later.fill.side,'BUY');
  assert.equal(later.fill.signalAvailableAtMs,s.receivedAtMs);
});
test('strict synthetic header, units, schema, integer prices and policy reject without writes',async t=>{
  const d=await setup(t);
  for(const patch of [{synthetic:false},{priceUnit:'USD'},{symbol:'BTC'},{schemaVersion:'OTHER'},
    {extra:1},{policy:{...policy,extra:1}},{expectedVersion:-1}])
    await unchanged(d,()=>advanceSyntheticP1({...request(d,0,fixture()),...patch}));
  const s=fixture();s.bars[0].open+=0.5;
  await unchanged(d,()=>advanceSyntheticP1(request(d,0,s)));
});
test('future bar receipt, incomplete candle, stale window, backdated receipt reject atomically',async t=>{
  const d=await setup(t);
  for(const edit of [s=>{s.bars[0].availableAtMs=s.asOfMs+1;},
    s=>{s.asOfMs=s.bars[200].closeTimeMs-1;},
    s=>{s.asOfMs=s.receivedAtMs=s.bars[200].closeTimeMs+DAY;s.expiresAtMs=s.asOfMs+5000;},
    s=>{s.receivedAtMs=s.asOfMs-1;},
    s=>{s.receivedAtMs=s.bars[200].closeTimeMs+DAY;s.expiresAtMs=s.receivedAtMs+5000;}]) {
    const s=fixture();edit(s);await unchanged(d,()=>advanceSyntheticP1(request(d,0,s)));
  }
});
test('stressed exit above rounded P1 stop rejects candidate before any persistence',async t=>{
  const d=await setup(t);const r=await unchanged(d,()=>advanceSyntheticP1(request(d,0,fixture(),
    {...policy,stressedExitPriceMicrosPerLot:'82000000'})));
  assert.equal(r.code,'STRESSED_EXIT_ABOVE_ROUNDED_STOP');
});
test('zero risk entry fill rejects preserving pending journal; zero entry budgets do not block stop',async t=>{
  const d=await setup(t),s=fixture();assert.equal((await advanceSyntheticP1(request(d,0,s))).valid,true);
  await unchanged(d,()=>advanceSyntheticP1(request(d,1,quote(s.asOfMs+1),{...policy,riskBudgetMicros:'0'})));
  assert.equal((await advanceSyntheticP1(request(d,1,quote(s.asOfMs+1)))).fill.side,'BUY');
  const close=await advanceSyntheticP1(request(d,2,quote(s.asOfMs+2,70000000,71000000),
    {...policy,riskBudgetMicros:'0',remainingExposureMicros:'0',stressedExitPriceMicrosPerLot:'0'}));
  assert.equal(close.fill.side,'SELL');
});
test('expected version conflicts and duplicate signal preserve bytes',async t=>{
  const d=await setup(t),s=fixture();await advanceSyntheticP1(request(d,0,s));
  await unchanged(d,()=>advanceSyntheticP1(request(d,0,quote(s.asOfMs+1))));
  s.receivedAtMs+=1;s.asOfMs+=1;const r=await unchanged(d,()=>advanceSyntheticP1(request(d,1,s)));
  assert.match(r.code,/ID_REPLAY_OR_COLLISION/);
});
test('caller mutation during read cannot alter captured version, bars or risk budget',async t=>{
  const d=await setup(t),x=request(d,0,fixture()),before=JSON.stringify(x);
  const task=advanceSyntheticP1(x);x.expectedVersion=999;x.step.bars[200].close=1;x.policy.riskBudgetMicros='0';
  const r=await task;assert.equal(r.valid,true,r.code);assert.equal(r.signal.action,'ENTER_LONG_CANDIDATE');
  const file=JSON.parse(await fs.readFile(path.join(d,'spot-journal.json'),'utf8'));
  assert.equal(file.records[0].policy.riskBudgetMicros,'100000000');
  assert.notEqual(JSON.stringify(x),before);
});
test('P1 no-action evaluates without writing; stale caller version still rejects',async t=>{
  const d=await setup(t),s=fixture();s.bars[200].close=108*UNIT;
  const before=await fs.readFile(path.join(d,'spot-journal.json'));
  const r=await advanceSyntheticP1(request(d,0,s));assert.equal(r.changed,false);assert.equal(r.version,0);
  assert.equal(r.signal.action,'NONE');assert.deepEqual(await fs.readFile(path.join(d,'spot-journal.json')),before);
  await unchanged(d,()=>advanceSyntheticP1(request(d,1,s)));
});
test('post-rename COMMIT_UNKNOWN returns no fill, retains lock and never retries or steals it',async t=>{
  const d=await setup(t),s=fixture();await advanceSyntheticP1(request(d,0,s));
  const x=request(d,1,quote(s.asOfMs+1));
  const fault=child(x,`let calls=0;const original=fs.rename;fs.rename=async(...a)=>{
    calls++;await original(...a);throw new Error('postrename')};
    const result=await r.advanceSyntheticP1(request);const stored=await j.readSpotJournal({directory:request.directory});
    console.log(JSON.stringify({result,stored,calls}));`);
  assert.equal(fault.calls,1);assert.equal(fault.result.code,'COMMIT_UNKNOWN');assert.equal(fault.result.fill,null);
  assert.equal(fault.stored.version,2);assert.equal(fault.stored.book.lifecycle.phase,'LONG');
  const blocked=await unchanged(d,()=>advanceSyntheticP1(request(d,2,quote(s.asOfMs+2,70000000,71000000))));
  assert.equal(blocked.code,'LOCKED');
  assert.ok((await fs.readFile(path.join(d,'spot-journal.lock'),'utf8')).length>0);
});
