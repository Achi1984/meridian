import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSpotJournal,readSpotJournal,commitSpotJournalStep} from '../docs/strategy-lab/spot-journal.mjs';
const moduleURL=new URL('../docs/strategy-lab/spot-journal.mjs',import.meta.url).href;
const policy={riskBudgetMicros:'100',remainingExposureMicros:'1000',stressedExitPriceMicrosPerLot:'90',feeBps:100};
const event={type:'ENTRY_SIGNAL',id:'entry',signalId:'signal',at:10,availableAt:10,expiresAt:100,initialStop:90};
const request=directory=>({directory,expectedVersion:0,envelope:{symbol:'SYNTH',event},policy});
async function setup(t,create=true) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'spot-journal-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  if(create) assert.equal((await createSpotJournal({directory,symbol:'SYNTH',cashMicros:'1000'})).valid,true);
  return directory;
}
function child(directory,source) {
  return spawnSync(process.execPath,['--input-type=module','-e',
    `import fs from 'node:fs/promises';import * as j from ${JSON.stringify(moduleURL)};
     const directory=${JSON.stringify(directory)};const request=${JSON.stringify(request(directory))};${source}`],
    {encoding:'utf8',timeout:20000});
}
test('creation derives pristine state and never overwrites existing journal',async t=>{
  const d=await setup(t),file=path.join(d,'spot-journal.json'),before=await fs.readFile(file);
  assert.equal((await createSpotJournal({directory:d,symbol:'OTHER',cashMicros:'1'})).code,'JOURNAL_ALREADY_EXISTS');
  assert.deepEqual(await fs.readFile(file),before);assert.equal((await readSpotJournal({directory:d})).version,0);
});
test('genesis validation applies even to empty journals',async t=>{
  const d=await setup(t,false);
  assert.equal((await createSpotJournal({directory:d,symbol:'BAD\n',cashMicros:'1'})).valid,false);
  await createSpotJournal({directory:d,symbol:'SYNTH',cashMicros:'1000'});
  const file=path.join(d,'spot-journal.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));
  saved.genesis.cashMicros='01';await fs.writeFile(file,JSON.stringify(saved));
  assert.equal((await readSpotJournal({directory:d})).code,'INVALID_GENESIS');
});
test('separate process restart replays persisted state and rejects duplicate event',async t=>{
  const d=await setup(t);assert.equal((await commitSpotJournalStep(request(d))).version,1);
  const c=child(d,`const r=await j.readSpotJournal({directory});
    const x=await j.commitSpotJournalStep({...request,expectedVersion:1});console.log(JSON.stringify({r,x}));`);
  assert.equal(c.status,0,c.stderr);const {r,x}=JSON.parse(c.stdout);
  assert.equal(r.version,1);assert.equal(r.book.lifecycle.phase,'PENDING_ENTRY');assert.equal(x.valid,false);
});
test('concurrent writers with same version have one winner',async t=>{
  const d=await setup(t);const r=await Promise.all([commitSpotJournalStep(request(d)),commitSpotJournalStep(request(d))]);
  assert.equal(r.filter(x=>x.valid).length,1);assert.ok(['LOCKED','VERSION_CONFLICT'].includes(r.find(x=>!x.valid).code));
  assert.equal((await readSpotJournal({directory:d})).version,1);
});
test('invalid and truncated files are not overwritten',async t=>{
  const d=await setup(t),file=path.join(d,'spot-journal.json');
  for(const content of ['{','null','{}']) {
    await fs.writeFile(file,content);assert.equal((await commitSpotJournalStep(request(d))).valid,false);
    assert.equal(await fs.readFile(file,'utf8'),content);
  }
});
test('rejected step and expected-version conflict leave exact file bytes',async t=>{
  const d=await setup(t),file=path.join(d,'spot-journal.json'),before=await fs.readFile(file);
  assert.equal((await commitSpotJournalStep({...request(d),expectedVersion:1})).code,'VERSION_CONFLICT');
  assert.equal((await commitSpotJournalStep({...request(d),envelope:{symbol:'OTHER',event}})).valid,false);
  assert.deepEqual(await fs.readFile(file),before);
});
test('saved final book mutation is detected by complete replay',async t=>{
  const d=await setup(t);await commitSpotJournalStep(request(d));const file=path.join(d,'spot-journal.json');
  const data=JSON.parse(await fs.readFile(file,'utf8'));data.book.account.cashMicros='999';
  await fs.writeFile(file,JSON.stringify(data));assert.equal((await readSpotJournal({directory:d})).code,'BOOK_REPLAY_MISMATCH');
});
test('stale lock blocks and is never automatically removed',async t=>{
  const d=await setup(t),lock=path.join(d,'spot-journal.lock');await fs.writeFile(lock,'foreign');
  assert.equal((await commitSpotJournalStep(request(d))).code,'LOCKED');assert.equal(await fs.readFile(lock,'utf8'),'foreign');
});
test('pre-rename process crash preserves old file and blocks restart until manual recovery',async t=>{
  const d=await setup(t);const c=child(d,`fs.rename=async()=>process.exit(71);await j.commitSpotJournalStep(request);`);
  assert.equal(c.status,71,c.stderr);assert.equal((await readSpotJournal({directory:d})).version,0);
  assert.equal((await commitSpotJournalStep(request(d))).code,'LOCKED');
  // Explicit test-fixture recovery after the sole child is confirmed terminated.
  await fs.unlink(path.join(d,'spot-journal.lock'));
  assert.equal((await commitSpotJournalStep(request(d))).version,1);
});
test('post-rename process crash exposes replayable new state and stale lock',async t=>{
  const d=await setup(t);const c=child(d,`const original=fs.rename;fs.rename=async(...a)=>{await original(...a);process.exit(72)};
    await j.commitSpotJournalStep(request);`);
  assert.equal(c.status,72,c.stderr);assert.equal((await readSpotJournal({directory:d})).version,1);
  assert.equal((await commitSpotJournalStep(request(d))).code,'LOCKED');
});
test('post-rename injected error reports COMMIT_UNKNOWN and retains lock',async t=>{
  const d=await setup(t);const c=child(d,`const original=fs.rename;fs.rename=async(...a)=>{await original(...a);throw new Error('fault')};
    console.log(JSON.stringify(await j.commitSpotJournalStep(request)));`);
  assert.equal(c.status,0,c.stderr);assert.equal(JSON.parse(c.stdout).code,'COMMIT_UNKNOWN');
  assert.equal((await readSpotJournal({directory:d})).version,1);
  assert.equal((await commitSpotJournalStep(request(d))).code,'LOCKED');
});
test('replaced lock is not removed by finishing owner',async t=>{
  const d=await setup(t);const c=child(d,`const original=fs.rename;fs.rename=async(...a)=>{
    await fs.unlink(directory+'/spot-journal.lock');await fs.writeFile(directory+'/spot-journal.lock','replacement');
    await original(...a)};console.log(JSON.stringify(await j.commitSpotJournalStep(request)));`);
  assert.equal(c.status,0,c.stderr);assert.equal(JSON.parse(c.stdout).code,'COMMIT_UNKNOWN');
  assert.equal(await fs.readFile(path.join(d,'spot-journal.lock'),'utf8'),'replacement');
});
test('oversized file rejects before parse and missing file is never created by commit',async t=>{
  const d=await setup(t,false);assert.equal((await commitSpotJournalStep(request(d))).valid,false);
  const h=await fs.open(path.join(d,'spot-journal.json'),'w');await h.truncate(32*1024*1024+1);await h.close();
  assert.equal((await readSpotJournal({directory:d})).code,'JOURNAL_TOO_LARGE_OR_NOT_FILE');
});
test('caller mutation after invocation cannot alter committed snapshot',async t=>{
  const d=await setup(t),r=structuredClone(request(d));const task=commitSpotJournalStep(r);
  r.expectedVersion=99;r.envelope.event.id='changed';r.policy.feeBps=9999;
  assert.equal((await task).valid,true);const raw=JSON.parse(await fs.readFile(path.join(d,'spot-journal.json'),'utf8'));
  assert.equal(raw.records[0].envelope.event.id,'entry');assert.equal(raw.records[0].policy.feeBps,100);
});
test('temporary name collision never deletes a file it failed to create',async t=>{
  const d=await setup(t);const c=child(d,`const original=fs.open;let foreign;
    fs.open=async(p,...args)=>{if(String(p).endsWith('.tmp')){
      foreign=p;const h=await original(p,'wx');await h.writeFile('foreign-temp');await h.close();
    }return original(p,...args)};
    const result=await j.commitSpotJournalStep(request);
    console.log(JSON.stringify({result,content:await fs.readFile(foreign,'utf8')}));`);
  assert.equal(c.status,0,c.stderr);const r=JSON.parse(c.stdout);
  assert.equal(r.result.valid,false);assert.equal(r.content,'foreign-temp');
  assert.equal((await readSpotJournal({directory:d})).version,0);
});
test('held position and cash survive restart; stop and replay rejection persist together',async t=>{
  const d=await setup(t);await commitSpotJournalStep(request(d));
  const buy={...request(d),expectedVersion:1,envelope:{symbol:'SYNTH',
    event:{type:'QUOTE',id:'buyquote',at:11,quoteAt:11,bid:99,ask:100}}};
  assert.equal((await commitSpotJournalStep(buy)).version,2);
  const c=child(d,`const held=await j.readSpotJournal({directory});
    const sell={...request,expectedVersion:2,envelope:{symbol:'SYNTH',event:{type:'QUOTE',id:'stopquote',at:12,quoteAt:12,bid:70,ask:72}}};
    const closed=await j.commitSpotJournalStep(sell);console.log(JSON.stringify({held,closed}));`);
  assert.equal(c.status,0,c.stderr);const {held,closed}=JSON.parse(c.stdout);
  assert.equal(held.book.lifecycle.phase,'LONG');assert.equal(held.book.account.cashMicros,'192');
  assert.deepEqual(held.book.account.positions,[{symbol:'SYNTH',lots:'8'}]);
  assert.equal(closed.version,3);assert.equal(closed.book.lifecycle.phase,'FLAT');
  assert.equal(closed.book.account.cashMicros,'746');assert.deepEqual(closed.book.account.positions,[]);
  const restart=child(d,`const current=await j.readSpotJournal({directory});
    const duplicate=await j.commitSpotJournalStep({...request,expectedVersion:3,
      envelope:{symbol:'SYNTH',event:{type:'QUOTE',id:'stopquote',at:13,quoteAt:13,bid:70,ask:72}}});
    console.log(JSON.stringify({current,duplicate}));`);
  assert.equal(restart.status,0,restart.stderr);const r=JSON.parse(restart.stdout);
  assert.equal(r.current.book.account.cashMicros,'746');assert.equal(r.current.book.lifecycle.phase,'FLAT');
  assert.equal(r.duplicate.valid,false);
});
test('initial post-link error reports unknown without silently discarding published genesis',async t=>{
  const d=await setup(t,false);const c=child(d,`const original=fs.link;
    fs.link=async(...a)=>{await original(...a);throw new Error('postlink')};
    console.log(JSON.stringify(await j.createSpotJournal({directory,symbol:'SYNTH',cashMicros:'1000'})));`);
  assert.equal(c.status,0,c.stderr);assert.equal(JSON.parse(c.stdout).code,'COMMIT_UNKNOWN');
  assert.equal((await readSpotJournal({directory:d})).version,0);
  assert.equal((await commitSpotJournalStep(request(d))).code,'LOCKED');
});
