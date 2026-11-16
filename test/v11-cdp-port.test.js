// Execute the real helper with isolated VM doubles: no browser or network.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {CDP_STARTUP_RECOVERY_DIAGNOSTIC,forwardCdpStartupRecoveryDiagnostic} from './helpers/v11-cdp.mjs';

const source=readFileSync(new URL('./helpers/v11-cdp.mjs',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'')
 .replace('export const CDP_STARTUP_RECOVERY_DIAGNOSTIC','const CDP_STARTUP_RECOVERY_DIAGNOSTIC')
 .replace('export function forwardCdpStartupRecoveryDiagnostic','function forwardCdpStartupRecoveryDiagnostic')
 .replace('export async function withMobileChrome','async function withMobileChrome');

async function startup(values,options={}){
 const calls={reads:[],exists:0,sleeps:[],fetches:[],kills:[],removed:[],spawnOptions:null,
  spawnArgs:[],spawned:[],maxRetained:0,now:0,recovered:[],methods:[],profileRemovals:[],events:[],
  retryWhileGroupAlive:[]};
 const configFor=index=>options.attempts?.[index]||options;
 const sandbox={
  spawn:(_chrome,args,spawnOptions)=>{
   if(args[0]==='-e'){
    calls.profileRemovals.push(args[2]);
    const config=configFor(calls.spawnArgs.length-1);
    return {pid:9000+calls.profileRemovals.length,on:(name,fn)=>{
     if(name==='exit'&&!config.cleanupStalls)Promise.resolve().then(()=>fn(0,null));
    }};
   }
   const index=calls.spawnArgs.length,config=configFor(index);
   if(index>0){
    const prior=calls.spawned[index-1];
    calls.retryWhileGroupAlive.push(prior.groupAlive);
    calls.events.push('launch-'+index);
   }
   calls.spawnOptions=spawnOptions;calls.spawnArgs.push(args);
   if(config.syncSpawnError)throw config.syncSpawnError;
   const pid=Object.hasOwn(config,'pid')?config.pid:123+index;
   const events={},child={pid,exitCode:config.exitCode??null,signalCode:config.signalCode??null,
    on:(name,fn)=>{events[name]=fn;},unref:()=>{},
    stderr:{destroy:()=>{},on:(name,fn)=>{
     if(name==='data')for(const text of config.stderr||[])fn(Buffer.from(text));
     if(name==='error'&&config.stderrError)fn(Error('SECRET stderr /private/path'));
    }}};
   calls.spawned.push({pid,events,config,groupAlive:true,child,killAt:null});
   return child;
  },
  Buffer:{alloc:Buffer.alloc,isBuffer:Buffer.isBuffer,concat:parts=>{
   const result=Buffer.concat(parts);calls.maxRetained=Math.max(calls.maxRetained,result.length);return result;
  }},
  mkdtempSync:()=>'/synthetic/profile-'+(calls.spawnArgs.length+1),
  tmpdir:()=>'/synthetic',join:(...parts)=>parts.join('/'),
  existsSync:()=>{const index=calls.spawnArgs.length-1,config=configFor(index),current=calls.reads[index]||0;
   calls.exists++;const files=config.values||values;return files[Math.min(current,files.length-1)]!==undefined;},
  readFileSync:()=>{const index=calls.spawnArgs.length-1,config=configFor(index),current=calls.reads[index]||0;
   calls.reads[index]=current+1;const files=config.values||values;return files[Math.min(current,files.length-1)];},
  rmSync:(...args)=>calls.removed.push(args),
  process:{execPath:'/synthetic/node',kill:(...args)=>{
   calls.kills.push(args);const group=calls.spawned.find(x=>-x.pid===args[0]);
   if(args[1]==='SIGKILL'&&group){
    if(group.killAt===null)group.killAt=calls.now;
    if(!group.config.neverTerminate&&(group.config.terminationDelay??0)===0)group.groupAlive=false;
   }
   if(args[1]===0&&group&&group.groupAlive&&group.killAt!==null&&
     !group.config.neverTerminate&&calls.now>=group.killAt+(group.config.terminationDelay??0)){
    group.groupAlive=false;
   }
   if(args[1]===0&&group&&!group.groupAlive){
    calls.events.push('group-gone-'+group.pid);
    throw Object.assign(Error('gone'),{code:'ESRCH'});
   }
  }},
  setTimeout:()=>({}),clearTimeout:()=>{},
  AbortSignal:{timeout:()=>({})},
  fetch:async url=>{calls.fetches.push(url);const config=configFor(calls.spawnArgs.length-1);
   if(config.fetchError)throw config.fetchError;
   return {json:async()=>config.targets||[]};},
  console:{info:message=>calls.recovered.push(message)},
  performance:{now:()=>calls.now},
  WebSocket:class{
   constructor(){this.listeners={};Promise.resolve().then(()=>this.emit('open'));}
   addEventListener(name,fn){this.listeners[name]=fn;}
   emit(name,event={}){this.listeners[name]?.(event);}
   send(data){const message=JSON.parse(data),config=configFor(calls.spawnArgs.length-1);calls.methods.push(message.method);
    const result=message.method==='Page.navigate'?{errorText:config.navigationError||''}:
     message.method==='Runtime.evaluate'?{result:{value:true}}:{};
    Promise.resolve().then(()=>this.emit('message',{data:JSON.stringify({id:message.id,result})}));
   }
   close(){}
  },
 };
 // Substitute only the sleep dependency so exhaustion can be tested without time.
 const runnable=source.replace('const sleep=ms=>new Promise(r=>setTimeout(r,ms));',
  'const sleep=async ms=>recordSleep(ms);');
 sandbox.recordSleep=ms=>{
  calls.sleeps.push(ms);calls.now+=ms;
  const index=calls.spawnArgs.length-1,config=configFor(index);
  const polls=calls.sleeps.filter(x=>x===50).length;
  if(ms===50&&config.spawnError&&!config.errorSent){config.errorSent=true;calls.spawned[index].events.error(config.spawnError);}
  if(ms===50&&config.finalSleepState&&polls%200===0)Object.assign(calls.spawned[index].child,config.finalSleepState);
 };
 const run=runInNewContext(runnable+'\nwithMobileChrome;',sandbox);
 let error;
 try{await run('synthetic-chrome',320,'about:blank',()=>{},844,options.beforeNavigate);}catch(e){error=e;}
 return {calls,error};
}

test('startup waits through empty, partial and invalid port writes before fetching',async()=>{
 const {calls,error}=await startup(['','32','0\n','65536\n','-1\n','1.5\n',' 32123\n','1e3\n','32123\n/devtools/browser/synthetic']);
 assert.match(error.message,/No Chrome page target/);
 assert.deepEqual(calls.reads,[9]);
 assert.deepEqual(calls.sleeps,[...Array(8).fill(50),100]);
 assert.deepEqual(calls.fetches,['http://127.0.0.1:32123/json/list']);
});

test('subprocess forwarding emits only the exact fixed recovery diagnostic',()=>{
 const output=['Chrome output /private/profile https://private.invalid',CDP_STARTUP_RECOVERY_DIAGNOSTIC,
  '# '+CDP_STARTUP_RECOVERY_DIAGNOSTIC,
  CDP_STARTUP_RECOVERY_DIAGNOSTIC+' ',CDP_STARTUP_RECOVERY_DIAGNOSTIC.replace('ONE_RETRY','ONE_RETRY; url=https://private.invalid'),
  'Chrome DevTools startup recovered [attempt=2; phase=PORT_DISCOVERY; recovery=ONE_RETRY; path=/private/profile]'].join('\n');
 const forwarded=[];
 assert.equal(forwardCdpStartupRecoveryDiagnostic(output,line=>forwarded.push(line)),2);
 assert.deepEqual(forwarded,[CDP_STARTUP_RECOVERY_DIAGNOSTIC,CDP_STARTUP_RECOVERY_DIAGNOSTIC]);
});

test('valid inclusive port boundaries are accepted immediately',async()=>{
 for(const port of [1,65535]){
  const {calls,error}=await startup([port+'\n']);
  assert.match(error.message,/No Chrome page target/);
  assert.deepEqual(calls.reads,[1]);
  assert.deepEqual(calls.sleeps,[100]);
  assert.deepEqual(calls.fetches,['http://127.0.0.1:'+port+'/json/list']);
 }
});

test('one port-discovery timeout recovers once with a fresh profile and fixed diagnostic',async()=>{
 const {calls,error}=await startup([undefined],{attempts:[
  {values:[undefined],stderr:['SECRET /private/profile https://private.invalid']},{values:['32123\n']}
 ]});
 assert.match(error.message,/No Chrome page target/);
 assert.equal(calls.spawnArgs.length,2);
 assert.ok(calls.spawnArgs[0].includes('--user-data-dir=/synthetic/profile-1'));
 assert.ok(calls.spawnArgs[1].includes('--user-data-dir=/synthetic/profile-2'));
 assert.deepEqual(calls.recovered,['Chrome DevTools startup recovered [attempt=2; phase=PORT_DISCOVERY; recovery=ONE_RETRY]']);
 assert.deepEqual(calls.profileRemovals,['/synthetic/profile-1']);
 assert.deepEqual(calls.removed.map(([path])=>path),['/synthetic/profile-2']);
 assert.deepEqual(calls.kills,[[-123,'SIGKILL'],[-123,0],[-124,'SIGKILL']]);
 assert.equal(calls.exists,201);
 assert.deepEqual(calls.fetches,['http://127.0.0.1:32123/json/list']);
 assert.deepEqual(calls.sleeps.slice(0,200),Array(200).fill(50));
 assert.ok(calls.sleeps.includes(25),'bounded process-group and profile cleanup is accounted in the startup budget');
 assert.doesNotMatch(calls.recovered[0],/synthetic|private|https?:|\/tmp/);
});

test('authentication and navigation errors after startup never trigger recovery',async()=>{
 const page={type:'page',webSocketDebuggerUrl:'ws://private.invalid/devtools/browser/secret'};
 const cases=[
  {beforeNavigate:async()=>{throw Error('authentication failed');},expected:'authentication failed'},
  {navigationError:'net::ERR_ABORTED',expected:'Page navigation failed: net::ERR_ABORTED'}
 ];
 for(const scenario of cases){
  const {calls,error}=await startup(['32123\n'],{...scenario,targets:[page]});
  assert.equal(error.message,scenario.expected);
  assert.equal(calls.spawnArgs.length,1);
  assert.deepEqual(calls.recovered,[]);
  assert.deepEqual(calls.methods.includes('Page.navigate'),scenario.navigationError!==undefined);
  assert.deepEqual(calls.removed.map(([path])=>path),['/synthetic/profile-1']);
  assert.doesNotMatch(error.message,/private|secret|https?:/i);
 }
});

test('absent, incomplete and invalid files exhaust both 200-poll windows without fetch',async()=>{
 for(const [value,state] of [['','EMPTY'],['32123','INCOMPLETE'],['0\n','INVALID'],
  ['65536\n','INVALID'],[undefined,'MISSING']]){
  const {calls,error}=await startup([value]);
  assert.equal(error.message,'Chrome DevTools startup timeout [attempts=2; first={UNKNOWN; phase=PORT_DISCOVERY; port='+state+'; polls=200; child=RUNNING}; second={UNKNOWN; phase=PORT_DISCOVERY; port='+state+'; polls=200; child=RUNNING}]');
  assert.equal(calls.exists,400);
  assert.deepEqual(calls.reads,value===undefined?[]:[200,200]);
  assert.deepEqual(calls.sleeps.filter(ms=>ms===50),Array(400).fill(50));
  assert.deepEqual(calls.fetches,[]);
  assert.deepEqual(calls.kills,[[-123,'SIGKILL'],[-123,0],[-124,'SIGKILL'],[-124,0]]);
  assert.deepEqual(calls.profileRemovals,['/synthetic/profile-1','/synthetic/profile-2']);
 }
});

test('stalled bounded cleanup prevents a retry and respects the startup deadline',async()=>{
 const {calls,error}=await startup([undefined],{attempts:[{values:[undefined],cleanupStalls:true}]});
 assert.match(error.message,/recovery=ABORTED_CLEANUP/);
 assert.equal(calls.spawnArgs.length,1);
 assert.ok(calls.now<=25_000);
 assert.deepEqual(calls.profileRemovals,['/synthetic/profile-1','/synthetic/profile-1']);
 assert.ok(calls.kills.some(([pid,signal])=>pid===9001&&signal==='SIGKILL'));
 assert.deepEqual(calls.recovered,[]);
});

test('retry waits for delayed process-group disappearance and shares the startup deadline',async()=>{
 const {calls,error}=await startup([undefined],{attempts:[
  {values:[undefined],terminationDelay:75},{values:['32123\n']}
 ]});
 assert.match(error.message,/No Chrome page target/);
 assert.equal(calls.spawnArgs.length,2);
 assert.deepEqual(calls.retryWhileGroupAlive,[false]);
 assert.ok(calls.events.indexOf('group-gone-123')<calls.events.indexOf('launch-1'));
 assert.ok(calls.now>=10_075);
 assert.ok(calls.now<=25_000);
 assert.deepEqual(calls.profileRemovals,['/synthetic/profile-1']);
 assert.deepEqual(calls.removed.map(([path])=>path),['/synthetic/profile-2']);
});

test('a process group that never disappears prevents retry and stays within the shared deadline',async()=>{
 const {calls,error}=await startup([undefined],{attempts:[
  {values:[undefined],neverTerminate:true},{values:['32123\n']}
 ]});
 assert.match(error.message,/recovery=ABORTED_CLEANUP/);
 assert.equal(calls.spawnArgs.length,1);
 assert.deepEqual(calls.retryWhileGroupAlive,[]);
 assert.equal(calls.events.some(event=>event==='group-gone-123'),false);
 assert.ok(calls.spawned[0].groupAlive,'the timed-out process group was not confirmed stopped');
 assert.ok(calls.now<=25_000);
 assert.deepEqual(calls.profileRemovals,['/synthetic/profile-1','/synthetic/profile-1']);
});

test('profile cleanup failure does not re-signal a process group already confirmed absent',async()=>{
 const {calls,error}=await startup([undefined],{attempts:[
  {values:[undefined],terminationDelay:50,cleanupStalls:true}
 ]});
 assert.match(error.message,/recovery=ABORTED_CLEANUP/);
 assert.equal(calls.spawnArgs.length,1);
 assert.ok(calls.events.includes('group-gone-123'));
 assert.equal(calls.kills.filter(([pid,signal])=>pid===-123&&signal==='SIGKILL').length,1);
 assert.ok(calls.now<=25_000);
});

test('startup failure exits its subprocess even if a detached child keeps stderr open',()=>{
 const runnable=source.replace('const sleep=ms=>new Promise(r=>setTimeout(r,ms));',
  'const sleep=async ms=>advance(ms);');
 const script=`
  import {spawn} from 'node:child_process';
  import {runInNewContext} from 'node:vm';
  let now=0,launches=0;
  const context={
   spawn(_command,args){
    if(args[0]==='-e')return {on(name,fn){if(name==='exit')queueMicrotask(()=>fn(0));}};
    launches++;
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],
     {detached:true,stdio:['ignore','ignore','pipe']});
    console.log('FIXTURE_CHILD '+child.pid);
    return child;
   },
   advance(ms){now+=ms;},
   performance:{now:()=>now},
   process:{execPath:process.execPath,kill(){}},
   mkdtempSync:()=>'/synthetic/profile',tmpdir:()=>'/synthetic',
   join:(...parts)=>parts.join('/'),existsSync:()=>false,Buffer,Map,console,
  };
  const run=runInNewContext(${JSON.stringify(runnable+'\nwithMobileChrome;')},context);
  try{await run('fake-chrome',320,'about:blank','true');}
  catch(error){
   if(launches!==1||now>25000||!error.message.includes('recovery=ABORTED_CLEANUP'))throw error;
   console.log('STARTUP_FAILED_WITHOUT_RETRY');
  }
 `;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],
  {encoding:'utf8',timeout:4000});
 const pid=Number(/^FIXTURE_CHILD (\d+)$/m.exec(result.stdout??'')?.[1]);
 try{
  assert.ok(Number.isInteger(pid)&&pid>0,'fixture launched a real child');
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/^STARTUP_FAILED_WITHOUT_RETRY$/m);
 }finally{
  if(Number.isInteger(pid)&&pid>0){
   try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
 }
});

test('early child exit still fails immediately and cleans up',async()=>{
 const {calls,error}=await startup(['32123\n'],{exitCode:7});
 assert.match(error.message,/Chrome exited 7/);
 assert.equal(calls.exists,0);
 assert.deepEqual(calls.fetches,[]);
 assert.equal(calls.spawnArgs.length,1);
 assert.deepEqual(calls.kills,[[-123,'SIGKILL'],[-123,0]]);
 assert.deepEqual(calls.profileRemovals,['/synthetic/profile-1']);
 assert.deepEqual(calls.sleeps,[25]);
});

test('child termination by signal is reported without exposing process output',async()=>{
 const {calls,error}=await startup([undefined],{signalCode:'SIGKILL'});
 assert.equal(error.message,'Chrome terminated by signal [UNKNOWN]');
 assert.equal(calls.exists,0);
 assert.deepEqual(calls.fetches,[]);
 assert.equal(calls.spawnArgs.length,1);
 assert.deepEqual(calls.sleeps,[25]);
});

for(const [state,diagnostic] of [[{signalCode:'SIGKILL'},'Chrome terminated by signal'],
 [{exitCode:7},'Chrome exited 7']]){
 test(diagnostic+' during the final polling sleep is reported and cleans up',async()=>{
  const {calls,error}=await startup([undefined],{finalSleepState:state});
  assert.equal(error.message,diagnostic+' [UNKNOWN]');
  assert.equal(calls.exists,200);
  assert.deepEqual(calls.reads,[]);
  assert.deepEqual(calls.sleeps,[...Array(200).fill(50),25]);
  assert.deepEqual(calls.fetches,[]);
  assert.equal(calls.spawnArgs.length,1);
  assert.deepEqual(calls.kills,[[-123,'SIGKILL'],[-123,0]]);
  assert.deepEqual(calls.profileRemovals,['/synthetic/profile-1']);
 });
}

test('startup stderr yields only fixed matched categories across both bounded attempts',async()=>{
 const cases=[['pthread_create: Resource temporarily unavailable (11)','RESOURCE_UNAVAILABLE'],
  ['Cannot allocate memory','RESOURCE_UNAVAILABLE'],['Too many open files','RESOURCE_UNAVAILABLE'],
  ['No usable sandbox!','SANDBOX_UNAVAILABLE'],
  ['Running as root without --no-sandbox is not supported','SANDBOX_UNAVAILABLE'],
  ['error while loading shared libraries: /private/libSECRET.so','SHARED_LIBRARY_UNAVAILABLE'],
  ['SingletonLock: File exists','PROFILE_LOCK'],['Failed to create a ProcessSingleton','PROFILE_LOCK'],
  ['ordinary Chrome output /private/SECRET token=SECRET','UNKNOWN']];
 for(const [diagnostic,category] of cases){
  const {calls,error}=await startup([undefined],{stderr:['SECRET private-prefix\n'+diagnostic+'\nhttps://SECRET.invalid']});
  assert.equal(error.message,'Chrome DevTools startup timeout [attempts=2; first={'+category+'; phase=PORT_DISCOVERY; port=MISSING; polls=200; child=RUNNING}; second={'+category+'; phase=PORT_DISCOVERY; port=MISSING; polls=200; child=RUNNING}]');
  assert.equal(calls.exists,400);assert.equal(calls.sleeps.filter(ms=>ms===50).length,400);
  assert.deepEqual(calls.fetches,[]);
  assert.doesNotMatch(error.message,/SECRET|private|https:/);
  assert.equal(JSON.stringify(calls.spawnOptions.stdio),JSON.stringify(['ignore','ignore','pipe']));
 }
});

test('stderr retention is byte bounded across chunks and never exposes the prefix',async()=>{
 for(const stderr of [['x'.repeat(4096),'Cannot allocate memory SECRET'],['x'.repeat(100000)+'Cannot allocate memory SECRET']]){
  const {calls,error}=await startup([undefined],{stderr});
  assert.equal(calls.maxRetained,4096);
  assert.match(error.message,/attempts=2; first=\{UNKNOWN; phase=PORT_DISCOVERY; port=MISSING; polls=200; child=RUNNING\}; second=\{UNKNOWN; phase=PORT_DISCOVERY; port=MISSING; polls=200; child=RUNNING\}/);
 }
 const {calls,error}=await startup([undefined],{stderr:['SECRET /private/\nResource temporarily ','unavailable\n'+'x'.repeat(100000)]});
 assert.equal(calls.maxRetained,4096);
 assert.match(error.message,/attempts=2; first=\{RESOURCE_UNAVAILABLE; phase=PORT_DISCOVERY; port=MISSING; polls=200; child=RUNNING\}; second=\{RESOURCE_UNAVAILABLE; phase=PORT_DISCOVERY; port=MISSING; polls=200; child=RUNNING\}/);
 const ready=await startup(['32123\n'],{stderr:['Cannot allocate memory SECRET']});
 assert.equal(ready.error.message,'No Chrome page target'); // diagnostics never bypass later browser checks
 assert.equal(ready.calls.fetches.length,1);
});

test('asynchronous spawn errors are handled with fixed categories and safe no-pid cleanup',async()=>{
 for(const [code,category] of [['EAGAIN','RESOURCE_UNAVAILABLE'],['ENOMEM','RESOURCE_UNAVAILABLE'],
  ['ENOENT','EXECUTABLE_UNAVAILABLE'],['EACCES','EXECUTABLE_PERMISSION'],['SECRET','SPAWN_FAILED']]){
  const {calls,error}=await startup([undefined],{pid:undefined,spawnError:Object.assign(Error('/private/SECRET executable'),{code})});
  assert.equal(error.message,'Chrome spawn failed ['+category+']');
  assert.equal(calls.exists,1);assert.deepEqual(calls.sleeps,[50,25]);
  assert.deepEqual(calls.fetches,[]);assert.deepEqual(calls.kills,[]);
 }
});

test('synchronous spawn errors and stderr failures are sanitized and clean the profile',async()=>{
 const {calls,error}=await startup([undefined],{syncSpawnError:Object.assign(Error('/private/SECRET'),{code:'ENOENT'})});
 assert.equal(error.message,'Chrome spawn failed [EXECUTABLE_UNAVAILABLE]');
 assert.equal(calls.exists,0);assert.deepEqual(calls.sleeps,[25]);
 assert.deepEqual(calls.fetches,[]);assert.deepEqual(calls.kills,[]);
 const stderr=await startup([undefined],{stderrError:true});
 assert.match(stderr.error.message,/attempts=2; first=\{STDERR_UNAVAILABLE; phase=PORT_DISCOVERY; port=MISSING; polls=200; child=RUNNING\}/);
});
