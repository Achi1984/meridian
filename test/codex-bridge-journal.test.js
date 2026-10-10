import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,chmodSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createOfflineJournal,openOfflineJournal} from '../scripts/codex-bridge-journal.mjs';
import {PROTOCOL,PATHS,BridgeGuardError,digest} from '../scripts/codex-bridge-contract.mjs';
const A='8a8a43fc8df4e440294bf7ef5747510b6c6a44d0',B='398674e6b24c65f319462995890377d1760f8c46';
const request=()=>({protocol:PROTOCOL,requestId:'CODEX-BRIDGE-R2-001',opId:'BRIDGE-R2-OP-001',
  expectedMain:A,expectedBase:A,expectedHead:B,targetBranch:'fix/codex-bridge-v2-security-r2-20261009',
  model:'gpt-5.3-codex',allowedPaths:[...PATHS],allowedActions:['offline_code','draft_pr'],researchStage:'SOURCE_AUDIT',
  costGuard:{overageAllowed:false,additionalSpendAllowed:false},forbidden:['merge','workflow','trading']});
const fail=(fn,code)=>assert.throws(fn,e=>e instanceof BridgeGuardError&&e.code===code);
const token=s=>({revision:s.revision,head:s.head});
const moduleURL=new URL('../scripts/codex-bridge-journal.mjs',import.meta.url).href;
function fixture(t){
  const parent=mkdtempSync(join(tmpdir(),'meridian-r2-'));
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'private-journal');return {root,parent,journal:createOfflineJournal(root)};
}
function child(t,script,args,ipc=false){
  const c=spawn(process.execPath,['--input-type=module','-e',script,...args],
    {stdio:['ignore','ignore','pipe',...(ipc?['ipc']:[])]});
  let stderr='';c.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  t.after(()=>{if(c.exitCode===null)c.kill();});
  const exited=new Promise((resolve,reject)=>{c.once('error',reject);c.once('exit',code=>resolve({code,stderr}));});
  return {c,exited};
}
test('explicit create-if-absent; no automatic recreation',t=>{
  const {root,parent}=fixture(t);fail(()=>createOfflineJournal(root),'STORE_ALREADY_EXISTS');
  fail(()=>openOfflineJournal(join(parent,'absent')),'STORE_MISSING');
});
test('register durable across reopen',t=>{
  const {root,journal}=fixture(t);journal.register(request(),token(journal.snapshot()));
  const s=openOfflineJournal(root).snapshot();assert.equal(s.revision,1);
  assert.equal(s.records[0].request.expectedHead,B);assert.equal(s.authorized,false);
});
test('snapshot is deeply immutable',t=>{
  const {journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));
  assert.throws(()=>s.records[0].request.allowedPaths.push('server.js'),TypeError);
  assert.equal(journal.snapshot().head,s.head);
});
test('identical replay leaves revision unchanged',t=>{
  const {root,journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));
  const n=openOfflineJournal(root).register(request(),token(s));assert.equal(n.revision,1);assert.equal(n.head,s.head);
});
test('request ID scope conflict locks journal',t=>{
  const {root,journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));
  fail(()=>journal.register({...request(),opId:'BRIDGE-R2-OP-002'},token(s)),'DUPLICATE_SCOPE_CONFLICT');
  fail(()=>openOfflineJournal(root),'STORE_LOCKED_RECONCILE_REQUIRED');
});
test('different request cannot reuse op ID across restart',t=>{
  const {root,journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));
  fail(()=>openOfflineJournal(root).register({...request(),requestId:'CODEX-BRIDGE-R2-002'},token(s)),'OP_ID_REUSED');
});
test('CAS rejects stale revision and leaves lock',t=>{
  const {root,journal}=fixture(t);const old=token(journal.snapshot());journal.register(request(),old);
  fail(()=>journal.reserve(request(),old),'CAS_CONFLICT_RECONCILE_REQUIRED');
  fail(()=>openOfflineJournal(root),'STORE_LOCKED_RECONCILE_REQUIRED');
});
test('CAS rejects same revision with wrong hash',t=>{
  const {journal}=fixture(t);fail(()=>journal.register(request(),{revision:0,head:'f'.repeat(64)}),'CAS_CONFLICT_RECONCILE_REQUIRED');
});
test('missing CAS token rejected before taking lock',t=>{
  const {root,journal}=fixture(t);fail(()=>journal.register(request(),{}),'CAS_TOKEN_INVALID');
  assert.equal(existsSync(join(root,'writer.lock')),false);
});
test('reservation one-shot across restart',t=>{
  const {root,journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));
  const n=journal.reserve(request(),token(s));assert.equal(n.records[0].status,'RESERVED_OFFLINE');
  fail(()=>openOfflineJournal(root).reserve(request(),token(n)),'REPLAY_NO_ACTION');
});
test('UNKNOWN never retries',t=>{
  const {root,journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));
  const n=journal.reserve(request(),token(s));const u=journal.markUnknown(request(),token(n));
  assert.equal(u.records[0].status,'UNKNOWN');fail(()=>openOfflineJournal(root).reserve(request(),token(u)),'REPLAY_NO_ACTION');
});
test('STOP terminal',t=>{
  const {root,journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));
  const n=journal.stop(request(),token(s));fail(()=>openOfflineJournal(root).reserve(request(),token(n)),'REPLAY_NO_ACTION');
});
test('cannot reserve absent request',t=>{
  const {journal}=fixture(t);fail(()=>journal.reserve(request(),token(journal.snapshot())),'REQUEST_NOT_REGISTERED');
});
test('stale writer lock never expires',t=>{
  const {root}=fixture(t);writeFileSync(join(root,'writer.lock'),'dead writer\n',{mode:0o600});
  fail(()=>openOfflineJournal(root),'STORE_LOCKED_RECONCILE_REQUIRED');
});
test('pending file is never silently overwritten',t=>{
  const {root,journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));
  writeFileSync(join(root,'journal.pending'),'ambiguous previous intent\n',{mode:0o600});
  assert.throws(()=>journal.reserve(request(),token(s)),e=>e.code==='EEXIST');
  fail(()=>openOfflineJournal(root),'STORE_LOCKED_RECONCILE_REQUIRED');
  assert.equal(readFileSync(join(root,'journal.pending'),'utf8'),'ambiguous previous intent\n');
});
test('partial JSON is not treated as empty store',t=>{
  const {root}=fixture(t);writeFileSync(join(root,'journal.json'),'{"schema":1');
  fail(()=>openOfflineJournal(root),'STORE_CORRUPT');
});
test('edited entry hash rejected',t=>{
  const {root,journal}=fixture(t);journal.register(request(),token(journal.snapshot()));
  const p=join(root,'journal.json'),s=JSON.parse(readFileSync(p,'utf8'));
  s.entries[0].payload.request.model='other';writeFileSync(p,JSON.stringify(s));
  fail(()=>openOfflineJournal(root),'STORE_CHAIN_INVALID');
});
test('rehashed forbidden authorization transition rejected',t=>{
  const {root,journal}=fixture(t);journal.register(request(),token(journal.snapshot()));
  const p=join(root,'journal.json'),s=JSON.parse(readFileSync(p,'utf8'));
  const e={revision:2,previous:s.head,type:'OWNER_AUTHORIZED',payload:{ownerApproved:true}};e.hash=digest(e);
  s.entries.push(e);s.revision=2;s.head=e.hash;writeFileSync(p,JSON.stringify(s));
  fail(()=>openOfflineJournal(root),'STORE_CHAIN_INVALID');
});
test('rehashed duplicate reservation rejected by history replay',t=>{
  const {root,journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));journal.reserve(request(),token(s));
  const p=join(root,'journal.json'),disk=JSON.parse(readFileSync(p,'utf8'));
  const e={revision:3,previous:disk.head,type:'RESERVE',payload:disk.entries[1].payload};e.hash=digest(e);
  disk.entries.push(e);disk.revision=3;disk.head=e.hash;writeFileSync(p,JSON.stringify(disk));
  fail(()=>openOfflineJournal(root),'STORE_HISTORY_INVALID');
});
test('same-account replacement is explicitly NOT authenticated authority',t=>{
  const {root}=fixture(t);
  // A valid rollback cannot be detected without an external protected anchor.
  writeFileSync(join(root,'journal.json'),JSON.stringify({schema:1,revision:0,head:'0'.repeat(64),entries:[]}));
  assert.equal(openOfflineJournal(root).snapshot().authorized,false);
});
test('unsafe directory permissions rejected',t=>{
  const {root}=fixture(t);chmodSync(root,0o755);fail(()=>openOfflineJournal(root),'STORE_ROOT_UNSAFE');
});
test('unsafe file permissions rejected',t=>{
  const {root}=fixture(t);chmodSync(join(root,'journal.json'),0o644);fail(()=>openOfflineJournal(root),'STORE_FILE_UNSAFE');
});
test('symlink root rejected',t=>{
  const {root,parent}=fixture(t);const alias=join(parent,'alias');symlinkSync(root,alias);
  fail(()=>openOfflineJournal(alias),'STORE_ROOT_UNSAFE');
});
test('symlink journal rejected',t=>{
  const {root,parent}=fixture(t);const path=join(root,'journal.json'),original=readFileSync(path);
  rmSync(path);writeFileSync(join(parent,'target'),original,{mode:0o600});symlinkSync(join(parent,'target'),path);
  assert.throws(()=>openOfflineJournal(root),e=>e.code==='ELOOP');
});
test('actual process death after committed reservation cannot repeat intent',{timeout:10000},async t=>{
  const {root,journal}=fixture(t);const s=journal.register(request(),token(journal.snapshot()));
  const script='import {openOfflineJournal} from '+JSON.stringify(moduleURL)+';'
    +'openOfflineJournal(process.argv[1]).reserve(JSON.parse(process.argv[2]),JSON.parse(process.argv[3]));process.exit(42);';
  const {exited}=child(t,script,[root,JSON.stringify(request()),JSON.stringify(token(s))]);
  const result=await exited;assert.equal(result.code,42,result.stderr);
  const restarted=openOfflineJournal(root),n=restarted.snapshot();
  assert.equal(n.records[0].status,'RESERVED_OFFLINE');fail(()=>restarted.reserve(request(),token(n)),'REPLAY_NO_ACTION');
});
test('actual interrupted writer leaves persistent lock',{timeout:10000},async t=>{
  const {root}=fixture(t);
  const script="import {writeFileSync} from 'node:fs';import {join} from 'node:path';"
    +"writeFileSync(join(process.argv[1],'writer.lock'),'crash',{flag:'wx',mode:0o600});"
    +"writeFileSync(join(process.argv[1],'journal.pending'),'{partial',{flag:'wx',mode:0o600});process.exit(42);";
  const result=await child(t,script,[root]).exited;assert.equal(result.code,42,result.stderr);
  fail(()=>openOfflineJournal(root),'STORE_LOCKED_RECONCILE_REQUIRED');
});
test('two actual child processes race; one successful CAS writer',{timeout:10000},async t=>{
  const {root,journal}=fixture(t),expected=token(journal.snapshot());
  const script='import {openOfflineJournal} from '+JSON.stringify(moduleURL)+';'
    +"process.send('ready');process.on('message',()=>{try{const s=openOfflineJournal(process.argv[1]).register(JSON.parse(process.argv[2]),JSON.parse(process.argv[3]));"
    +"process.send({ok:true,revision:s.revision});}catch(e){process.send({ok:false,code:e.code});}process.disconnect();});";
  const children=Array.from({length:2},()=>child(t,script,[root,JSON.stringify(request()),JSON.stringify(expected)],true));
  await Promise.all(children.map(({c,exited})=>Promise.race([
    new Promise((resolve,reject)=>c.once('message',m=>m==='ready'?resolve():reject(new Error('bad child message')))),
    exited.then(x=>{throw new Error('child exited before ready '+x.stderr);}),
  ])));
  const responses=children.map(({c,exited})=>Promise.race([
    new Promise(resolve=>c.once('message',resolve)),exited.then(x=>{throw new Error('child exited without response '+x.stderr);}),
  ]));
  children.forEach(({c})=>c.send('run'));
  const outcomes=await Promise.all(responses);assert.equal(outcomes.filter(x=>x.ok).length,1);
  assert.ok(['STORE_LOCKED_RECONCILE_REQUIRED','CAS_CONFLICT_RECONCILE_REQUIRED'].includes(outcomes.find(x=>!x.ok).code));
  const exits=await Promise.all(children.map(x=>x.exited));exits.forEach(x=>assert.equal(x.code,0,x.stderr));
  const disk=JSON.parse(readFileSync(join(root,'journal.json'),'utf8'));assert.equal(disk.revision,1);assert.equal(disk.entries.length,1);
});
