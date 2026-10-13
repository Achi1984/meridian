// Execute the real helper with isolated VM doubles: no child, browser or network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./helpers/v11-cdp.mjs',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'')
 .replace('export async function withMobileChrome','async function withMobileChrome');

async function startup(values,{exitCode=null,stderr=[],spawnError=null,syncSpawnError=null,pid=spawnError?undefined:123,stderrError=false}={}){
 const calls={reads:0,exists:0,sleeps:[],fetches:[],kills:[],removed:[],spawnOptions:null,maxRetained:0};
 const events={};
 const child={pid,exitCode,on:(name,fn)=>{events[name]=fn;},stderr:{on:(name,fn)=>{
  if(name==='data')for(const text of stderr)fn(Buffer.from(text));
  if(name==='error'&&stderrError)fn(Error('SECRET stderr /private/path'));
 }}};
 const sandbox={
  spawn:(_chrome,_args,options)=>{calls.spawnOptions=options;if(syncSpawnError)throw syncSpawnError;return child;},
  Buffer:{alloc:Buffer.alloc,isBuffer:Buffer.isBuffer,concat:parts=>{
   const result=Buffer.concat(parts);calls.maxRetained=Math.max(calls.maxRetained,result.length);return result;
  }},
  mkdtempSync:()=>'/synthetic/profile',
  tmpdir:()=>'/synthetic',join:(...parts)=>parts.join('/'),
  existsSync:()=>{calls.exists++;return values[Math.min(calls.reads,values.length-1)]!==undefined;},
  readFileSync:()=>values[Math.min(calls.reads++,values.length-1)],
  rmSync:(...args)=>calls.removed.push(args),
  process:{kill:(...args)=>calls.kills.push(args)},
  setTimeout:callback=>{throw Error('Unexpected timer');},clearTimeout:()=>{},
  AbortSignal:{timeout:()=>({})},
  fetch:async url=>{calls.fetches.push(url);return {json:async()=>[]};},
 };
 // Substitute only the sleep dependency so exhaustion can be tested without time.
 const runnable=source.replace('const sleep=ms=>new Promise(r=>setTimeout(r,ms));',
  'const sleep=async ms=>recordSleep(ms);');
 sandbox.recordSleep=ms=>{calls.sleeps.push(ms);if(ms===50&&spawnError)events.error(spawnError);};
 const run=runInNewContext(runnable+'\nwithMobileChrome;',sandbox);
 let error;
 try{await run('synthetic-chrome',320,'about:blank',()=>{});}catch(e){error=e;}
 assert.deepEqual(calls.kills,syncSpawnError||!Number.isInteger(pid)||pid<=0?[]:[[-pid,'SIGKILL']]);
 assert.equal(calls.removed.length,1);
 assert.equal(calls.removed[0][0],'/synthetic/profile');
 assert.equal(calls.sleeps.at(-1),100); // existing cleanup delay
 return {calls,error};
}

test('startup waits through empty, partial and invalid port writes before fetching',async()=>{
 const {calls,error}=await startup(['','32','0\n','65536\n','-1\n','1.5\n',' 32123\n','1e3\n','32123\n/devtools/browser/synthetic']);
 assert.match(error.message,/No Chrome page target/);
 assert.equal(calls.reads,9);
 assert.deepEqual(calls.sleeps,[...Array(8).fill(50),100]);
 assert.deepEqual(calls.fetches,['http://127.0.0.1:32123/json/list']);
});

test('valid inclusive port boundaries are accepted immediately',async()=>{
 for(const port of [1,65535]){
  const {calls,error}=await startup([port+'\n']);
  assert.match(error.message,/No Chrome page target/);
  assert.equal(calls.reads,1);
  assert.deepEqual(calls.sleeps,[100]);
  assert.deepEqual(calls.fetches,['http://127.0.0.1:'+port+'/json/list']);
 }
});

test('incomplete and invalid files exhaust the original 200 polls without fetch',async()=>{
 for(const value of ['', '32123', '0\n', '65536\n',undefined]){
  const {calls,error}=await startup([value]);
  assert.match(error.message,/Chrome DevTools startup timeout/);
  assert.equal(calls.exists,200);
  assert.equal(calls.reads,value===undefined?0:200);
  assert.deepEqual(calls.sleeps,[...Array(200).fill(50),100]);
  assert.deepEqual(calls.fetches,[]);
 }
});

test('early child exit still fails immediately and cleans up',async()=>{
 const {calls,error}=await startup(['32123\n'],{exitCode:7});
 assert.match(error.message,/Chrome exited 7/);
 assert.equal(calls.exists,0);
 assert.deepEqual(calls.fetches,[]);
 assert.deepEqual(calls.sleeps,[100]);
});

test('startup stderr yields only fixed matched categories and preserves exhaustion',async()=>{
 const cases=[['pthread_create: Resource temporarily unavailable (11)','RESOURCE_UNAVAILABLE'],
  ['Cannot allocate memory','RESOURCE_UNAVAILABLE'],['Too many open files','RESOURCE_UNAVAILABLE'],
  ['No usable sandbox!','SANDBOX_UNAVAILABLE'],
  ['Running as root without --no-sandbox is not supported','SANDBOX_UNAVAILABLE'],
  ['error while loading shared libraries: /private/libSECRET.so','SHARED_LIBRARY_UNAVAILABLE'],
  ['SingletonLock: File exists','PROFILE_LOCK'],['Failed to create a ProcessSingleton','PROFILE_LOCK'],
  ['ordinary Chrome output /private/SECRET token=SECRET','UNKNOWN']];
 for(const [diagnostic,category] of cases){
  const {calls,error}=await startup([undefined],{stderr:['SECRET private-prefix\n'+diagnostic+'\nhttps://SECRET.invalid']});
  assert.equal(error.message,'Chrome DevTools startup timeout ['+category+']');
  assert.equal(calls.exists,200);assert.equal(calls.sleeps.length,201);
  assert.deepEqual(calls.fetches,[]);
  assert.doesNotMatch(error.message,/SECRET|private|https:/);
  assert.equal(JSON.stringify(calls.spawnOptions.stdio),JSON.stringify(['ignore','ignore','pipe']));
 }
});

test('stderr retention is byte bounded across chunks and never exposes the prefix',async()=>{
 for(const stderr of [['x'.repeat(4096),'Cannot allocate memory SECRET'],['x'.repeat(100000)+'Cannot allocate memory SECRET']]){
  const {calls,error}=await startup([undefined],{stderr});
  assert.equal(calls.maxRetained,4096);
  assert.equal(error.message,'Chrome DevTools startup timeout [UNKNOWN]');
 }
 const {calls,error}=await startup([undefined],{stderr:['SECRET /private/\nResource temporarily ','unavailable\n'+'x'.repeat(100000)]});
 assert.equal(calls.maxRetained,4096);
 assert.equal(error.message,'Chrome DevTools startup timeout [RESOURCE_UNAVAILABLE]');
 const ready=await startup(['32123\n'],{stderr:['Cannot allocate memory SECRET']});
 assert.equal(ready.error.message,'No Chrome page target'); // diagnostics never bypass later browser checks
 assert.equal(ready.calls.fetches.length,1);
});

test('asynchronous spawn errors are handled with fixed categories and safe no-pid cleanup',async()=>{
 for(const [code,category] of [['EAGAIN','RESOURCE_UNAVAILABLE'],['ENOMEM','RESOURCE_UNAVAILABLE'],
  ['ENOENT','EXECUTABLE_UNAVAILABLE'],['EACCES','EXECUTABLE_PERMISSION'],['SECRET','SPAWN_FAILED']]){
  const {calls,error}=await startup([undefined],{pid:undefined,spawnError:Object.assign(Error('/private/SECRET executable'),{code})});
  assert.equal(error.message,'Chrome spawn failed ['+category+']');
  assert.equal(calls.exists,1);assert.deepEqual(calls.sleeps,[50,100]);
  assert.deepEqual(calls.fetches,[]);assert.deepEqual(calls.kills,[]);
 }
});

test('synchronous spawn errors and stderr failures are sanitized and clean the profile',async()=>{
 const {calls,error}=await startup([undefined],{syncSpawnError:Object.assign(Error('/private/SECRET'),{code:'ENOENT'})});
 assert.equal(error.message,'Chrome spawn failed [EXECUTABLE_UNAVAILABLE]');
 assert.equal(calls.exists,0);assert.deepEqual(calls.sleeps,[100]);
 assert.deepEqual(calls.fetches,[]);assert.deepEqual(calls.kills,[]);
 const stderr=await startup([undefined],{stderrError:true});
 assert.equal(stderr.error.message,'Chrome DevTools startup timeout [STDERR_UNAVAILABLE]');
});

