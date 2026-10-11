import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('../scripts/event-write-fence.py', import.meta.url));
const binding = (extra={}) => ({repository:'Achi1984/meridian', branch:'isolated/test',
  eventKey:'workflow-17-attempt-1', opId:'op-1', writer:'lead', expectedHead:'a'.repeat(40),
  expectedBase:'b'.repeat(40), intendedHead:'c'.repeat(40), payloadSha256:'d'.repeat(64),
  expiresAt:Date.now()+60000, expectedFence:0, ...extra});
const owner = (extra={}) => ({opId:'op-1',writer:'lead',fence:1,...extra});
const evidence = (outcome, extra={}) => ({...owner(),outcome,
  observedHead:(outcome==='APPLIED'?'c':'a').repeat(40), evidenceSha256:'e'.repeat(64),...extra});
const second = (extra={}) => binding({opId:'op-2',eventKey:'workflow-18-attempt-1',expectedFence:1,...extra});
function run(db, command, input) {
  const r=spawnSync('python3',[script,'--db',db,command],{
    input:typeof input==='string'?input:JSON.stringify(input), encoding:'utf8',timeout:10000});
  assert.equal(r.signal,null,r.stderr);
  return {code:r.status, ...JSON.parse(r.stdout||r.stderr)};
}
function asyncRun(db, command, input) {
  return new Promise((resolve,reject)=>{
    const p=spawn('python3',[script,'--db',db,command]); let out='',err='';
    p.on('error',reject); p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);
    p.on('close',code=>{try{resolve({code,...JSON.parse(out||err)});}catch(e){reject(e);}});
    p.stdin.end(JSON.stringify(input));
  });
}
async function fixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),'meridian-event-fence-'));
  try {await fn(join(dir,'state.sqlite'));} finally {rmSync(dir,{recursive:true,force:true});}
}

test('event fence: completed lifecycle advances fence, consumes identities forever, grants no authority',()=>fixture(db=>{
  const r=run(db,'reserve',binding()); assert.equal(r.state,'RESERVED');
  for(const key of ['authenticated','mayWrite','mayDispatch','mayMerge']) assert.equal(r[key],false);
  assert.equal(run(db,'begin',owner()).state,'STARTED');
  assert.equal(run(db,'settle',evidence('APPLIED')).state,'APPLIED');
  assert.equal(run(db,'reserve',binding({expectedFence:1})).error,'PERMANENTLY_CONSUMED');
  assert.equal(run(db,'reserve',second({eventKey:'workflow-17-attempt-1'})).error,'PERMANENTLY_CONSUMED');
  assert.equal(run(db,'reserve',second()).fence,2);
  assert.equal(run(db,'begin',owner()).error,'STALE_WRITER_OR_FENCE');
}));

test('event fence: eight competing processes produce one reservation',()=>fixture(async db=>{
  const b=binding(); const results=await Promise.all(Array.from({length:8},()=>asyncRun(db,'reserve',b)));
  assert.equal(results.filter(x=>x.code===0).length,1,JSON.stringify(results));
  assert.equal(results.filter(x=>x.error==='PERMANENTLY_CONSUMED').length,7,JSON.stringify(results));
}));

test('event fence: distinct events on one branch still have a single writer',()=>fixture(async db=>{
  const results=await Promise.all(Array.from({length:8},(_,i)=>asyncRun(db,'reserve',binding({eventKey:`event-${i}`,opId:`op-${i}`}))));
  assert.equal(results.filter(x=>x.code===0).length,1,JSON.stringify(results));
  assert.equal(results.filter(x=>x.error==='STALE_FENCE').length,7,JSON.stringify(results));
}));

test('event fence: changed IDs do not bypass active scope; changed scope does not bypass event identity',()=>fixture(db=>{
  assert.equal(run(db,'reserve',binding()).code,0);
  assert.equal(run(db,'reserve',second()).error,'SCOPE_BUSY');
  assert.equal(run(db,'reserve',second({branch:'other',expectedFence:0,eventKey:'workflow-17-attempt-1'})).error,'PERMANENTLY_CONSUMED');
  assert.equal(run(db,'reserve',second({branch:'other',expectedFence:0,opId:'op-1'})).error,'PERMANENTLY_CONSUMED');
}));

test('event fence: wrong writer, stale fence and malformed fences cannot begin or settle',()=>fixture(db=>{
  run(db,'reserve',binding());
  for(const mutation of [{writer:'other'},{fence:2},{fence:true}]) {
    assert.notEqual(run(db,'begin',owner(mutation)).code,0);
    assert.notEqual(run(db,'settle',evidence('ABSENT',mutation)).code,0);
  }
  assert.equal(run(db,'begin',owner()).state,'STARTED');
  assert.equal(run(db,'begin',owner()).error,'ALREADY_STARTED_OR_TERMINAL');
}));

test('event fence: only never-started reservation may be cancelled, old token cannot act later',()=>fixture(db=>{
  run(db,'reserve',binding());
  assert.equal(run(db,'settle',evidence('ABSENT',{observedHead:'f'.repeat(40)})).error,'UNSAFE_ABSENCE');
  assert.equal(run(db,'settle',evidence('APPLIED')).error,'UNSAFE_APPLIED');
  assert.equal(run(db,'settle',evidence('ABSENT')).state,'ABSENT');
  assert.equal(run(db,'reserve',second()).fence,2);
  assert.equal(run(db,'begin',owner()).error,'STALE_WRITER_OR_FENCE');
}));

test('event fence: started/unknown outcome cannot be freed by unchanged ref, expiry or new event',()=>fixture(db=>{
  run(db,'reserve',binding());run(db,'begin',owner());
  assert.equal(run(db,'settle',evidence('ABSENT')).error,'UNSAFE_ABSENCE');
  assert.equal(run(db,'settle',evidence('APPLIED',{observedHead:'f'.repeat(40)})).error,'UNSAFE_APPLIED');
  assert.equal(run(db,'settle',evidence('UNKNOWN')).state,'UNKNOWN');
  assert.equal(run(db,'reserve',second()).error,'SCOPE_BUSY');
  assert.equal(run(db,'settle',evidence('APPLIED')).error,'TERMINAL_OPERATION');
  assert.equal(run(db,'begin',owner()).error,'ALREADY_STARTED_OR_TERMINAL');
}));

test('event fence: crash after committed start preserves consumption and blocks re-execution',()=>fixture(db=>{
  const req=binding();run(db,'reserve',req);
  const code=`import importlib.util,os,sys,json\ns=importlib.util.spec_from_file_location('fence',sys.argv[1])\nm=importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\nm.operate(sys.argv[2],'begin',json.loads(sys.argv[3]))\nos._exit(73)`;
  const r=spawnSync('python3',['-c',code,script,db,JSON.stringify(owner())],{encoding:'utf8',timeout:10000});
  assert.equal(r.status,73,r.stderr);
  assert.equal(run(db,'reserve',req).error,'PERMANENTLY_CONSUMED');
  assert.equal(run(db,'begin',owner()).error,'ALREADY_STARTED_OR_TERMINAL');
  assert.equal(run(db,'reserve',second()).error,'SCOPE_BUSY');
}));

test('event fence: expiry while waiting for write lock consumes nothing',()=>fixture(async db=>{
  const code='import sqlite3,sys,time\nc=sqlite3.connect(sys.argv[1],isolation_level=None)\nc.execute("BEGIN IMMEDIATE")\nprint("LOCKED",flush=True)\ntime.sleep(2)\nc.commit()';
  const holder=spawn('python3',['-u','-c',code,db]);
  const done=new Promise(resolve=>holder.on('close',resolve));
  await new Promise((resolve,reject)=>{holder.on('error',reject);holder.stdout.once('data',resolve);});
  const r=await asyncRun(db,'reserve',binding({expiresAt:Date.now()+1000}));
  await done; assert.equal(r.error,'EXPIRED');
  assert.equal(run(db,'reserve',binding()).fence,1);
}));

test('event fence: strict inputs fail before database creation',()=>fixture(db=>{
  for(const b of [binding({expiresAt:0}),binding({expectedFence:true}),binding({repository:'fork/repo'}),
    binding({unknown:1}),binding({intendedHead:'a'.repeat(40)}),' '.repeat(4097),'{"a":1,"a":2}','{"a":NaN}'])
    assert.equal(run(db,'reserve',b).code,2);
  assert.equal(existsSync(db),false);
}));

test('event fence: expiry blocks begin but never frees an existing reservation',()=>fixture(db=>{
  run(db,'reserve',binding({expiresAt:Date.now()+800}));
  const code=`import importlib.util,sys,json\ns=importlib.util.spec_from_file_location('fence',sys.argv[1])\nm=importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\nm.time.time=lambda:9999999999\ntry: m.operate(sys.argv[2],'begin',json.loads(sys.argv[3]))\nexcept m.FenceError as e: print(str(e))`;
  const r=spawnSync('python3',['-c',code,script,db,JSON.stringify(owner())],{encoding:'utf8'});
  assert.equal(r.stdout.trim(),'EXPIRED',r.stderr);
  assert.equal(run(db,'reserve',second()).error,'SCOPE_BUSY');
}));
