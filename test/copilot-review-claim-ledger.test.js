import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ledger=fileURLToPath(new URL('../scripts/copilot-review-claim-ledger.py',import.meta.url));
const temp=()=>mkdtempSync(join(tmpdir(),'meridian-review-claim-'));
const binding=(changes={})=>({
  repository:'Achi1984/meridian',pr:666,headSha:'a'.repeat(40),baseSha:'b'.repeat(40),
  requestId:'request-666',packetSha256:'c'.repeat(64),modelId:'claude-explicit-test-pin',
  expiresAt:Date.now()+60000,...changes
});
function run(db,value,{timeout=15000}={}){
  return spawnSync('python3',[ledger,'--db',db,'consume'],{
    input:typeof value==='string'?value:JSON.stringify(value),encoding:'utf8',timeout
  });
}
function concurrentRun(db,value){
  return new Promise(resolve=>{
    const child=spawn('python3',[ledger,'--db',db,'consume'],{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
    child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
    child.stdin.end(JSON.stringify(value));
  });
}
function holdWriteLock(db,durationMs){
  const script='import sqlite3,sys,time\nc=sqlite3.connect(sys.argv[1],timeout=10,isolation_level=None)\nc.execute("BEGIN IMMEDIATE")\nprint("LOCKED",flush=True)\ntime.sleep(int(sys.argv[2])/1000)\nc.commit()\nc.close()';
  const child=spawn('python3',['-u','-c',script,db,String(durationMs)],{stdio:['ignore','pipe','pipe']});
  const done=new Promise(resolve=>child.once('close',resolve));
  return new Promise((resolve,reject)=>{
    let output='';
    child.stdout.setEncoding('utf8').on('data',chunk=>{
      output+=chunk;
      if(output.includes('LOCKED\n')) resolve({child,done});
    });
    child.stderr.setEncoding('utf8').on('data',chunk=>output+=chunk);
    child.on('error',reject);
    child.on('close',code=>{
      if(!output.includes('LOCKED\n')) reject(new Error(`lock holder exited ${code}: ${output}`));
    });
  });
}

test('module import performs no database or other external work',()=>{
  const directory=temp(),db=join(directory,'not-created.sqlite');
  try{
    const result=spawnSync('python3',['-c',
      `import importlib.util\ns=importlib.util.spec_from_file_location('ledger',${JSON.stringify(ledger)})\nm=importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\nassert not __import__('os').path.exists(${JSON.stringify(db)})`
    ],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(result.status,0,result.stderr);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('claim receipt matches runtime binding and is durable against exact and altered replay',()=>{
  const directory=temp(),db=join(directory,'claims.sqlite'),request=binding();
  try{
    const first=run(db,request);
    assert.equal(first.status,0,first.stderr);
    const receipt=JSON.parse(first.stdout);
    assert.match(receipt.claimId,/^[a-f0-9]{32}$/);
    assert.deepEqual(receipt.binding,request);
    assert.equal(run(db,request).status,2);
    assert.equal(run(db,binding({packetSha256:'d'.repeat(64)})).status,2);
    assert.equal(run(db,binding({headSha:'e'.repeat(40)})).status,2);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('ledger uniqueness is per request ID, not per head or packet; authorization remains upstream',()=>{
  const directory=temp(),db=join(directory,'claims.sqlite');
  const firstRequest=binding({requestId:'separately-authorized-review-a'});
  const secondRequest={...firstRequest,requestId:'separately-authorized-review-b'};
  try{
    // API semantics only: these inputs do not attest separate authorization.
    // Runtime packet binding additionally requires a matching embedded request ID.
    const first=run(db,firstRequest),second=run(db,secondRequest);
    assert.equal(first.status,0,first.stderr);
    assert.equal(second.status,0,second.stderr);
    const firstReceipt=JSON.parse(first.stdout),secondReceipt=JSON.parse(second.stdout);
    assert.deepEqual(firstReceipt.binding,firstRequest);
    assert.deepEqual(secondReceipt.binding,secondRequest);
    assert.notEqual(firstReceipt.claimId,secondReceipt.claimId);
    for(const request of [firstRequest,secondRequest]){
      for(const replay of [request,{...request,packetSha256:'d'.repeat(64)}]){
        const result=run(db,replay);
        assert.equal(result.status,2,result.stderr);
        assert.equal(result.stdout,'');
        assert.equal(JSON.parse(result.stderr).error,'CLAIM_ALREADY_CONSUMED');
      }
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('competing processes can consume a request only once',async()=>{
  const directory=temp(),db=join(directory,'claims.sqlite'),request=binding();
  try{
    const results=await Promise.all(Array.from({length:8},()=>concurrentRun(db,request)));
    assert.equal(results.filter(result=>result.code===0).length,1,JSON.stringify(results));
    assert.equal(results.filter(result=>result.code===2).length,7,JSON.stringify(results));
    assert.equal(results.filter(result=>result.signal!==null).length,0,JSON.stringify(results));
    for(const result of results.filter(item=>item.code===2))
      assert.equal(JSON.parse(result.stderr).error,'CLAIM_ALREADY_CONSUMED');
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('claim expiring while waiting for SQLite write lock is rejected without a row',async()=>{
  const directory=temp(),db=join(directory,'claims.sqlite');
  let holder;
  try{
    holder=await holdWriteLock(db,2800);
    const request=binding({requestId:'expires-during-lock',expiresAt:Date.now()+1800});
    const started=Date.now(),result=await concurrentRun(db,request),elapsed=Date.now()-started;
    assert.ok(elapsed>=1800,`ledger returned before expiry after ${elapsed}ms`);
    assert.equal(result.code,2,result.stderr);
    assert.equal(JSON.parse(result.stderr).error,'EXPIRED');
    const rows=spawnSync('python3',['-c',
      `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nt=c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='consumed_claims'").fetchone()\nprint(c.execute('SELECT COUNT(*) FROM consumed_claims').fetchone()[0] if t else 0)`,
      db
    ],{encoding:'utf8'});
    assert.equal(rows.status,0,rows.stderr);
    assert.equal(rows.stdout.trim(),'0');
  }finally{
    if(holder) await holder.done;
    rmSync(directory,{recursive:true,force:true});
  }
});

test('expired and out-of-window bindings fail before creating a database',()=>{
  const directory=temp(),db=join(directory,'claims.sqlite');
  try{
    const expired=run(db,binding({expiresAt:Date.now()}));
    assert.equal(expired.status,2);
    assert.equal(JSON.parse(expired.stderr).error,'EXPIRED');
    const tooFar=run(db,binding({expiresAt:Date.now()+301000}));
    assert.equal(JSON.parse(tooFar.stderr).error,'EXPIRED');
    assert.equal(run(db,binding({pr:true})).status,2);
    assert.equal(run(db,binding({repository:'other/repo'})).status,2);
    assert.equal(run(db,binding({modelId:'claude-latest'})).status,2);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('strict JSON and bounded input reject duplicate keys, extras and oversized data',()=>{
  const directory=temp(),db=join(directory,'claims.sqlite');
  try{
    const duplicate=run(db,'{"requestId":"a","requestId":"b"}');
    assert.equal(JSON.parse(duplicate.stderr).error,'JSON_DUPLICATE_KEY');
    const extra=run(db,binding({unexpected:true}));
    assert.equal(JSON.parse(extra.stderr).error,'BINDING_INVALID');
    const oversized=run(db,' '.repeat(4097));
    assert.equal(JSON.parse(oversized.stderr).error,'INPUT_BOUND');
    const invalid=run(db,'{"x":NaN}');
    assert.equal(JSON.parse(invalid.stderr).error,'JSON_INVALID');
    assert.equal(run(db,binding()).status,0);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('claim survives a worker crash immediately after the committed receipt',()=>{
  const directory=temp(),db=join(directory,'claims.sqlite'),request=binding();
  try{
    const crash=spawnSync('python3',['-c',
      `import importlib.util,os,sys\ns=importlib.util.spec_from_file_location('ledger',${JSON.stringify(ledger)})\nm=importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\nm.consume_claim(sys.argv[1],${JSON.stringify(request)})\nos._exit(73)`,
      db
    ],{encoding:'utf8',timeout:15000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(crash.status,73,crash.stderr);
    const replay=run(db,request);
    assert.equal(replay.status,2);
    assert.equal(JSON.parse(replay.stderr).error,'CLAIM_ALREADY_CONSUMED');
  }finally{rmSync(directory,{recursive:true,force:true});}
});
