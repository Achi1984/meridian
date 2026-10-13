import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../docs/strategy-lab/spot-lifecycle.mjs';
import {simulateSpotStep} from '../docs/strategy-lab/spot-simulation-step.mjs';
const policy={riskBudgetMicros:'100',remainingExposureMicros:'1000',
  stressedExitPriceMicrosPerLot:'90',feeBps:100};
const initial=()=>({symbol:'SYNTH',lifecycle:initialState(),account:{currency:'EUR',
  cashMicros:'1000',positions:[],processedFillIds:[]}});
const entry={type:'ENTRY_SIGNAL',id:'entry',signalId:'signal',at:10,availableAt:10,
  expiresAt:100,initialStop:90};
const quote=(at=20,bid=99,ask=100)=>({type:'QUOTE',id:`q${at}`,at,quoteAt:at,bid,ask});
const exit={type:'EXIT_SIGNAL',id:'exit',signalId:'exit-signal',at:30,availableAt:30,expiresAt:100};
const run=(book,event,p=policy)=>simulateSpotStep(book,{symbol:'SYNTH',event},p);
const ok=(book,event,p=policy)=>{const r=run(book,event,p);assert.equal(r.valid,true,r.errors);return r;};
const pending=()=>ok(initial(),entry).book;
const long=()=>ok(pending(),quote()).book;
const reject=(book,event,p=policy)=>{const before=JSON.stringify(book),r=run(book,event,p);
  assert.equal(r.valid,false);assert.equal(r.book,book);assert.equal(r.fill,null);
  assert.equal(r.sizing,null);assert.equal(JSON.stringify(book),before);return r;};

test('buy commits matching lifecycle and exact ledger cash/fees',()=>{
  const r=ok(pending(),quote());assert.equal(r.book.lifecycle.phase,'LONG');
  assert.equal(r.fill.lots,'8');assert.equal(r.fill.feeMicros,'8');
  assert.equal(r.book.account.cashMicros,'192');assert.equal(r.fill.priceMicrosPerLot,'100');
});
test('sell all held lots at bid with rounded fee and exact cash',()=>{
  const p=ok(long(),exit).book,r=ok(p,quote(40,110,111));
  assert.equal(r.fill.lots,'8');assert.equal(r.fill.feeMicros,'9');
  assert.equal(r.book.account.cashMicros,'1063');assert.deepEqual(r.book.account.positions,[]);
  assert.equal(r.book.lifecycle.phase,'FLAT');
});
test('zero feasible quantity rolls back pending entry',()=>{
  reject(pending(),quote(),{...policy,riskBudgetMicros:'0'});
});
test('replayed ledger fill rolls back candidate buy',()=>{
  const b=pending();b.account.processedFillIds=['q20'];
  assert.match(reject(b,quote()).errors[0],/FILL_ALREADY_PROCESSED/);
});
test('ledger history capacity blocks stop without deleting lots',()=>{
  const b=long();b.account.processedFillIds=Array.from({length:10000},(_,i)=>`f${i}`);
  assert.match(reject(b,quote(30,70,71)).errors[0],/CAPACITY/);
  assert.equal(b.account.positions[0].lots,'8');assert.equal(b.lifecycle.phase,'LONG');
});
test('malformed accounts reject no-fill events',()=>{
  for(const patch of [{currency:'USD'},{cashMicros:'01'},{processedFillIds:['x','x']},
    {positions:[{symbol:'SYNTH',lots:'1'}]},{extra:1}]) {
    const b=initial();Object.assign(b.account,patch);reject(b,quote());
  }
});
test('instrument mismatch and other holdings reject',()=>{
  const b=initial();assert.equal(simulateSpotStep(b,{symbol:'OTHER',event:entry},policy).valid,false);
  const held=long();held.account.positions[0].symbol='OTHER';reject(held,quote(30));
});
test('unsafe fractional or mis-scaled stored prices reject',()=>{
  for(const value of [1.5,Number.MAX_SAFE_INTEGER+1,NaN,0,'100'])
    reject(pending(),{...quote(),ask:value});
  const b=long();b.lifecycle.position.entryAsk=100.5;reject(b,quote(30));
  reject(initial(),{...entry,initialStop:89.5});
});
test('safe integer maximum can pass no-fill quote validation',()=>{
  assert.equal(ok(initial(),quote(20,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)).fill,null);
});
test('stress must be at or below initial stop for entry',()=>{
  reject(pending(),quote(),{...policy,stressedExitPriceMicrosPerLot:'91'});
});
test('stop gap sells all original lots; zero entry budgets cannot block exit',()=>{
  for(const stress of ['0','999']) {
  const r=ok(long(),quote(30,70,71),{...policy,riskBudgetMicros:'0',
    remainingExposureMicros:'0',stressedExitPriceMicrosPerLot:stress});
  assert.equal(r.fill.lots,'8');assert.equal(r.fill.priceMicrosPerLot,'70');
  assert.equal(r.fill.feeMicros,'6');assert.equal(r.book.account.cashMicros,'746');
  assert.equal(r.book.lifecycle.phase,'FLAT');
  }
});
test('strict policy and event ID limits reject even without fills',()=>{
  reject(initial(),quote(),{...policy,extra:1});reject(initial(),quote(),{...policy,feeBps:-1});
  reject(initial(),{...quote(),id:'x'.repeat(65)});reject(initial(),{...quote(),id:'x\n'});
});
test('no-fill lifecycle advance preserves account and validates lifecycle',()=>{
  const b=initial(),r=ok(b,entry);assert.deepEqual(r.book.account,b.account);
  assert.equal(r.book.lifecycle.phase,'PENDING_ENTRY');assert.equal(r.fill,null);
  const bad=initial();bad.lifecycle.executionAuthorized=true;reject(bad,quote());
});
test('JSON restart replay protection and all inputs immutable',()=>{
  const b=pending(),e=quote(),before=JSON.stringify([b,e,policy]);
  const r=ok(b,e);assert.equal(JSON.stringify([b,e,policy]),before);
  const restored=JSON.parse(JSON.stringify(r.book));reject(restored,{...quote(30),id:'q20'});
  assert.equal(r.executionAuthorized,false);assert.equal(r.researchOnly,true);
  assert.equal(r.fill.executionAuthorized,false);
});
