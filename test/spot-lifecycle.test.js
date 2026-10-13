import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition } from '../docs/strategy-lab/spot-lifecycle.mjs';

const entry = (at = 10) => ({type:'ENTRY_SIGNAL',id:`e${at}`,signalId:`s${at}`,
  at,availableAt:at,expiresAt:at+100,initialStop:90});
const quote = (at=20,bid=100) => ({type:'QUOTE',id:`q${at}`,at,quoteAt:at,bid,ask:bid+1});
const exit = (at=30) => ({type:'EXIT_SIGNAL',id:`x${at}`,signalId:`z${at}`,
  at,availableAt:at,expiresAt:at+100});
const step = (s,e) => {const r=transition(s,e);assert.equal(r.valid,true,r.error);return r;};
const pending = () => step(initialState(),entry()).state;
const long = () => step(pending(),quote()).state;

test('entry uses ask and exposes no authority',()=>{
  const r=step(pending(),quote()); assert.equal(r.fill.price,101);
  assert.equal(r.state.phase,'LONG');assert.equal(r.executionAuthorized,false);
  assert.equal(r.fill.researchOnly,true);
});
test('explicit exit uses bid only after signal',()=>{
  const s=step(long(),exit()).state;
  const waiting=step(s,{...quote(31),quoteAt:30});assert.equal(waiting.fill,null);
  assert.equal(step(waiting.state,quote(32,104)).fill.price,104);
});
test('gap stop executes at bid not stop',()=>{
  const r=step(long(),quote(30,70));assert.equal(r.fill.price,70);
  assert.equal(r.fill.reason,'STOP');assert.equal(r.state.phase,'FLAT');
});
test('entry at stop cancels without any fill',()=>{
  const r=step(pending(),quote(20,90));assert.equal(r.fill,null);
  assert.equal(r.state.phase,'FLAT');assert.equal(r.state.lastExitAt,20);
});
test('exit cancels pending entry',()=>{
  const r=step(pending(),exit(15));assert.equal(r.state.phase,'FLAT');
  assert.equal(step(r.state,quote()).fill,null);
});
test('entry expiry boundary blocks entry',()=>{
  const r=step(pending(),quote(110));assert.equal(r.fill,null);assert.equal(r.state.phase,'FLAT');
  assert.equal(r.state.lastExitAt,110);
  assert.equal(transition(r.state,{...entry(120),availableAt:10}).valid,false);
  assert.equal(transition(pending(),entry(120)).error,'ENTRY_BEFORE_BARRIER');
  assert.equal(step(r.state,entry(120)).state.phase,'PENDING_ENTRY');
});
test('expired pending exit retains position and stop',()=>{
  const s=step(long(),{...exit(),expiresAt:40}).state;
  const r=step(s,quote(40,80));assert.equal(r.fill.reason,'STOP');
  assert.equal(step(s,quote(40,100)).state.phase,'LONG');
});
test('stop priority over pending exit',()=>{
  const s=step(long(),exit()).state;assert.equal(step(s,quote(40,89)).fill.reason,'STOP');
});
test('quote must follow signal availability',()=>{
  assert.equal(step(pending(),{...quote(11),quoteAt:10}).fill,null);
});
test('reject stale future unordered and malformed quotes',()=>{
  for(const patch of [{quoteAt:0,at:1001},{quoteAt:21},{bid:102},
    {bid:NaN},{ask:Infinity},{bid:0},{extra:1}])
    assert.equal(transition(pending(),{...quote(),...patch}).valid,false);
  const s=step(long(),quote(30)).state;
  assert.equal(transition(s,{...quote(40),quoteAt:29}).valid,false);
  assert.equal(transition(s,{...quote(40),quoteAt:30}).valid,false);
});
test('replay and cross namespace collisions reject',()=>{
  for(const patch of [{id:'e10'},{id:'s10'}])
    assert.equal(transition(pending(),{...quote(),...patch}).valid,false);
  assert.equal(transition(initialState(),{...entry(),signalId:'e10'}).valid,false);
  assert.equal(transition(initialState(),{...entry(),id:'bad\n'}).valid,false);
  assert.equal(transition(initialState(),{...entry(),signalId:'bad\n'}).valid,false);
});
test('reject timestamp ordering and expired/future signals',()=>{
  for(const patch of [{at:10},{availableAt:21},{expiresAt:20}])
    assert.equal(transition(pending(),{...exit(20),...patch}).valid,false);
});
test('exit requires a newer subsequent entry signal',()=>{
  const s=step(long(),quote(30,80)).state;
  assert.equal(transition(s,{...entry(40),availableAt:30}).valid,false);
  const p=step(s,entry(40)).state;
  assert.equal(step(p,quote(41)).fill.side,'BUY');
});
test('immutable input and JSON restart replay protection',()=>{
  const s=pending(),e=quote();const before=JSON.stringify([s,e]);
  const r=step(s,e);assert.equal(JSON.stringify([s,e]),before);
  const restored=JSON.parse(JSON.stringify(r.state));
  assert.equal(transition(restored,{...quote(30),id:'q20'}).valid,false);
  const rejected=transition(restored,{...entry(30),extra:true});
  assert.equal(rejected.state,restored);
});
test('forged inconsistent states and authority reject',()=>{
  for(const patch of [{phase:'FLAT'},{executionAuthorized:true},{lastQuoteAt:100},
    {consumedIds:['same','same']},{position:{...long().position,initialStop:102}}])
    assert.equal(transition({...long(),...patch},quote(30)).valid,false);
});
test('bounded ID storage fails closed',()=>{
  const s={...initialState(),lastAt:1,consumedIds:Array.from({length:10000},(_,i)=>`id${i}`)};
  assert.equal(transition(s,quote()).error,'ID_CAPACITY');
});
test('busy entry and pre-entry exit reject',()=>{
  assert.equal(transition(long(),entry(30)).error,'ENTRY_WHILE_BUSY');
  assert.equal(transition(long(),{...exit(),availableAt:19}).error,'EXIT_PREDATES_ENTRY');
});
test('late pre-entry quote cannot retrospectively stop position',()=>{
  const s=step(pending(),{...quote(30),quoteAt:20}).state;
  const late=step(s,{...quote(31,80),quoteAt:25});
  assert.equal(late.fill,null);assert.equal(late.state.phase,'LONG');
  assert.equal(step(late.state,quote(32,80)).fill.reason,'STOP');
});
