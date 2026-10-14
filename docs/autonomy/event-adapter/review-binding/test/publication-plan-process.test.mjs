import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {dirname} from 'node:path';
import {planForPublication} from '../scripts/publication-plan-process.mjs';

// Only this test worker's built-in binding is replaced. Production exposes no
// configurable executable, dependency injection, network or publication path.
const config={scopeRaw:'{}',policyRaw:'{}',pinsRaw:'{}'};
const plan={kind:'OFFLINE_ACTIONS_PUBLICATION_PLAN',sendAllowed:false};
const rejected=/^Error: PLAN_REJECTED$/;
function harness(t,spawnError){
 const child=new EventEmitter();
 Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null});
 const calls=[],kills=[],input=[];
 child.stdin.on('data',chunk=>input.push(chunk));
 child.kill=signal=>{kills.push(signal);return true;};
 t.mock.method(childProcess,'spawn',(...args)=>{calls.push(args);if(spawnError)throw spawnError;return child;});
 syncBuiltinESMExports();
 t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 return {child,calls,kills,input,clean:()=>{
  for(const name of ['stdin','stdout','stderr'])assert.equal(child[name].destroyed,true,name+' destroyed');
 }};
}
test('fixed isolated Python invocation and serialized stdin',async t=>{
 const h=harness(t),work=planForPublication('PRIVATE_BODY',config);
 assert.equal(h.calls.length,1);
 const [command,args,options]=h.calls[0];
 assert.equal(command,'python3');assert.deepEqual(args.slice(0,2),['-I','-B']);
 assert.ok(args[2].endsWith('/scripts/publication-plan-bridge.py'));
 assert.deepEqual(options,{stdio:['pipe','pipe','pipe'],env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});
 assert.deepEqual(JSON.parse(Buffer.concat(h.input)),{body:'PRIVATE_BODY',...config});
 h.child.stdout.emit('data',Buffer.from(JSON.stringify(plan)));h.child.exitCode=0;h.child.emit('close',0);
 assert.deepEqual(await work,plan);assert.deepEqual(h.kills,[]);h.clean();
});
test('input byte limit rejects multibyte data before spawning',async t=>{
 const h=harness(t);await assert.rejects(planForPublication('é'.repeat(32768),config),rejected);
 assert.equal(h.calls.length,0);
});
test('synchronous spawn failure is sanitized',async t=>{
 const h=harness(t,new Error('PRIVATE_SPAWN_DETAILS'));
 await assert.rejects(planForPublication('body',config),rejected);assert.equal(h.calls.length,1);
});
test('asynchronous spawn failure rejects once and cleans streams',async t=>{
 const h=harness(t),work=planForPublication('body',config),check=assert.rejects(work,rejected);
 h.child.emit('error',new Error('PRIVATE_SPAWN_DETAILS'));await check;
 assert.deepEqual(h.kills,['SIGKILL']);h.clean();
});
for(const stream of ['stdin','stdout','stderr'])test(stream+' error is sanitized and terminates child',async t=>{
 const h=harness(t),work=planForPublication('body',config),check=assert.rejects(work,rejected);
 h.child[stream].emit('error',new Error('PRIVATE_STREAM_DETAILS'));await check;
 assert.deepEqual(h.kills,['SIGKILL']);h.clean();
});
test('deadline rejects at 10000ms even if killed child never emits close',async t=>{
 const h=harness(t);t.mock.timers.enable({apis:['setTimeout']});
 const work=planForPublication('body',config),check=assert.rejects(work,rejected);
 t.mock.timers.tick(9999);assert.deepEqual(h.kills,[]);
 t.mock.timers.tick(1);await check;assert.deepEqual(h.kills,['SIGKILL']);h.clean();
});
for(const stream of ['stdout','stderr'])test(stream+' overflow terminates without returning private output',async t=>{
 const h=harness(t),work=planForPublication('body',config),check=assert.rejects(work,rejected);
 h.child[stream].emit('data',Buffer.from('PRIVATE'.repeat(4682)));await check;
 assert.deepEqual(h.kills,['SIGKILL']);h.clean();
});
test('stdout and stderr share one byte budget across chunks',async t=>{
 const h=harness(t),work=planForPublication('body',config),check=assert.rejects(work,rejected);
 h.child.stderr.emit('data',Buffer.alloc(16000));h.child.stdout.emit('data',Buffer.alloc(16000));
 assert.deepEqual(h.kills,[]);h.child.stderr.emit('data',Buffer.alloc(769));await check;
 assert.deepEqual(h.kills,['SIGKILL']);h.clean();
});
test('valid JSON at exact output byte cap succeeds and cancels deadline',async t=>{
 const h=harness(t);t.mock.timers.enable({apis:['setTimeout']});
 const work=planForPublication('body',config),raw=JSON.stringify(plan);
 h.child.stdout.emit('data',Buffer.from(raw+' '.repeat(32768-Buffer.byteLength(raw))));
 h.child.exitCode=0;h.child.emit('close',0);assert.deepEqual(await work,plan);
 t.mock.timers.tick(10000);assert.deepEqual(h.kills,[]);h.clean();
});
test('failed, signalled, malformed and wrong-kind closes reject',async t=>{
 for(const [code,output] of [[1,JSON.stringify(plan)],[null,JSON.stringify(plan)],[0,'PRIVATE_BAD_JSON'],[0,'{"kind":"WRONG"}']]){
  const h=harness(t),work=planForPublication('body',config),check=assert.rejects(work,rejected);
  h.child.stdout.emit('data',Buffer.from(output));h.child.exitCode=code;h.child.emit('close',code);await check;h.clean();
  t.mock.restoreAll();syncBuiltinESMExports();
 }
});
test('late events cannot turn rejection into success or kill twice',async t=>{
 const h=harness(t);t.mock.timers.enable({apis:['setTimeout']});
 const work=planForPublication('body',config),check=assert.rejects(work,rejected);
 h.child.emit('error',new Error('PRIVATE'));await check;
 h.child.stdout.emit('data',Buffer.from(JSON.stringify(plan)));h.child.exitCode=0;h.child.emit('close',0);
 h.child.emit('error',new Error('LATE_PRIVATE'));t.mock.timers.tick(10000);
 assert.deepEqual(h.kills,['SIGKILL']);assert.equal(h.calls.length,1);h.clean();
});
