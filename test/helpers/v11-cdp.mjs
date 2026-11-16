// MERIDIAN11-CDP-R1: small dependency-free Chrome DevTools helper.
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const STARTUP_STDERR_BYTES=4096;
const STARTUP_WINDOW_MS=10_000;
const STARTUP_BUDGET_MS=25_000;
const STARTUP_CLEANUP_MS=1_000;
const PROFILE_REMOVAL_SCRIPT='require("node:fs").rmSync(process.argv[1],{recursive:true,force:true})';
function spawnCategory(code){
 if(['EAGAIN','ENOMEM','EMFILE','ENFILE'].includes(code))return 'RESOURCE_UNAVAILABLE';
 if(code==='ENOENT')return 'EXECUTABLE_UNAVAILABLE';
 if(['EACCES','EPERM'].includes(code))return 'EXECUTABLE_PERMISSION';
 return 'SPAWN_FAILED';
}
function stderrCategory(bytes){
 const text=bytes.toString('utf8');
 // Fixed categories only: never emit Chrome output, paths, URLs or credentials.
 if(/Resource temporarily unavailable|Cannot allocate memory|Too many open files/i.test(text))return 'RESOURCE_UNAVAILABLE';
 if(/No usable sandbox|Running as root without --no-sandbox is not supported/i.test(text))return 'SANDBOX_UNAVAILABLE';
 if(/error while loading shared libraries/i.test(text))return 'SHARED_LIBRARY_UNAVAILABLE';
 if(/SingletonLock[^\n]*File exists|Failed to create a ProcessSingleton/i.test(text))return 'PROFILE_LOCK';
 return 'UNKNOWN';
}
export async function withMobileChrome(chrome,width,url,probe,height=844,beforeNavigate){
 const startupDeadline=performance.now()+STARTUP_BUDGET_MS;
 const startupWorkDeadline=startupDeadline-STARTUP_CLEANUP_MS;
 let dir,child,startupReady=false;
 let ws;const pending=new Map();let seq=0;
 const removeProfileWithinDeadline=async(profile,deadline)=>{
  if(!profile||performance.now()>=deadline)return false;
  let remover,result;
  try{
   remover=spawn(process.execPath,['-e',PROFILE_REMOVAL_SCRIPT,profile],{stdio:'ignore'});
   remover.on('error',()=>{if(result===undefined)result=false;});
   remover.on('exit',code=>{if(result===undefined)result=code===0;});
  }catch{return false;}
  while(result===undefined&&performance.now()<deadline){
   const remaining=deadline-performance.now();
   if(remaining>0)await sleep(Math.min(25,remaining));
  }
  if(result===true)return true;
  try{if(Number.isInteger(remover.pid)&&remover.pid>0)process.kill(remover.pid,'SIGKILL');}catch{}
  remover.unref?.();
  return false;
 };
 const cleanupStartupAttempt=async(deadline)=>{
  const pid=child?.pid;
  let stopped=false;
  if(Number.isInteger(pid)&&pid>0){
   try{process.kill(-pid,'SIGKILL');}
   catch(error){if(error?.code==='ESRCH')stopped=true;}
   if(!stopped){
    const cleanupDeadline=Math.min(deadline,performance.now()+STARTUP_CLEANUP_MS);
    while(performance.now()<cleanupDeadline){
     try{process.kill(-pid,0);}
     catch(error){if(error?.code==='ESRCH')stopped=true;break;}
     const remaining=cleanupDeadline-performance.now();
     if(remaining>0)await sleep(Math.min(25,remaining));
    }
   }
  }
  const removed=dir?await removeProfileWithinDeadline(dir,deadline):true;
  return stopped&&removed;
 };
 const launchAndDiscover=async(attemptDeadline)=>{
  let spawnFailure,collectingStartup=true,stderrReadFailed=false,startupStderr=Buffer.alloc(0);
  const startupError=(prefix,details='')=>{
   const category=spawnFailure||(startupStderr.length?stderrCategory(startupStderr):
    stderrReadFailed?'STDERR_UNAVAILABLE':'UNKNOWN');
   return Error(prefix+' ['+category+(details?'; '+details:'')+']');
  };
  const childExitError=()=>child.exitCode!==null?startupError('Chrome exited '+child.exitCode):
   child.signalCode!=null?startupError('Chrome terminated by signal'):null;
  try{
   child=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{stdio:['ignore','ignore','pipe'],detached:true});
  }catch(error){spawnFailure=spawnCategory(error?.code);throw startupError('Chrome spawn failed');}
  child.on('error',error=>{spawnFailure=spawnCategory(error?.code);});
  child.stderr?.on('error',()=>{stderrReadFailed=true;});
  child.stderr?.on('data',chunk=>{
   if(!collectingStartup||!Buffer.isBuffer(chunk))return;
   const remaining=STARTUP_STDERR_BYTES-startupStderr.length;
   if(remaining>0)startupStderr=Buffer.concat([startupStderr,chunk.subarray(0,remaining)]);
  });
  let port,portFileState='MISSING',startupPolls=0;
  for(;startupPolls<200&&performance.now()<attemptDeadline;){
   startupPolls++;
   if(spawnFailure)throw startupError('Chrome spawn failed');
   const exitError=childExitError();if(exitError)throw exitError;
   const f=join(dir,'DevToolsActivePort');
   if(existsSync(f)){
    const contents=readFileSync(f,'utf8'),match=/^([0-9]+)\n/.exec(contents);
    const candidate=match?Number(match[1]):0;
    if(Number.isInteger(candidate)&&candidate>=1&&candidate<=65535){port=candidate;break;}
    portFileState=contents.length===0?'EMPTY':contents.includes('\n')?'INVALID':'INCOMPLETE';
   }
   const remaining=attemptDeadline-performance.now();
   if(remaining>0)await sleep(Math.min(50,remaining));
  }
  if(spawnFailure)throw startupError('Chrome spawn failed');
  const exitError=childExitError();if(exitError)throw exitError;
  if(!port){
   const category=spawnFailure||(startupStderr.length?stderrCategory(startupStderr):
    stderrReadFailed?'STDERR_UNAVAILABLE':'UNKNOWN');
   const details='phase=PORT_DISCOVERY; port='+portFileState+'; polls='+startupPolls+'; child=RUNNING';
   const error=startupError('Chrome DevTools startup timeout',details);
   error.code='CDP_PORT_DISCOVERY_TIMEOUT';
   error.startupDiagnostic=category+'; '+details;
   throw error;
  }
  collectingStartup=false;startupStderr=Buffer.alloc(0);
  return port;
 };
 try{
  dir=mkdtempSync(join(tmpdir(),'v11-cdp-'));
  let port,firstTimeout;
  for(let attempt=0;attempt<2;attempt++){
   const attemptDeadline=Math.min(startupWorkDeadline,performance.now()+STARTUP_WINDOW_MS);
   try{
    port=await launchAndDiscover(attemptDeadline);
    if(firstTimeout)console.info('Chrome DevTools startup recovered [attempt=2; phase=PORT_DISCOVERY; recovery=ONE_RETRY]');
    break;
   }catch(error){
    if(error?.code!=='CDP_PORT_DISCOVERY_TIMEOUT')throw error;
    if(firstTimeout){
     throw Error('Chrome DevTools startup timeout [attempts=2; first={'+firstTimeout.startupDiagnostic+
      '}; second={'+error.startupDiagnostic+'}]');
    }
    firstTimeout=error;
    if(!await cleanupStartupAttempt(startupWorkDeadline)){
     throw Error(firstTimeout.message.slice(0,-1)+'; recovery=ABORTED_CLEANUP]');
    }
    child=undefined;dir=undefined;
    if(performance.now()>=startupWorkDeadline){
     throw Error(firstTimeout.message.slice(0,-1)+'; recovery=STARTUP_BUDGET_EXHAUSTED]');
    }
    dir=mkdtempSync(join(tmpdir(),'v11-cdp-'));
   }
  }
  startupReady=true;
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(5000)})).json();
  const page=targets.find(x=>x.type==='page');if(!page)throw Error('No Chrome page target');
  if(typeof WebSocket!=='function')throw Error('Node WebSocket unavailable; run Node with --experimental-websocket');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
   ws.addEventListener('open',resolve,{once:true});
   ws.addEventListener('error',reject,{once:true});
  });
  const eventListeners=new Map();
  ws.addEventListener('message',e=>{
   const m=JSON.parse(e.data),p=pending.get(m.id);
   if(p){
    pending.delete(m.id);clearTimeout(p.timer);
    m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);
    return;
   }
   if(typeof m.method==='string')
    for(const listener of eventListeners.get(m.method)||[])listener(m.params);
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
   const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},10000);
   pending.set(id,{resolve,reject,timer});
   ws.send(JSON.stringify({id,method,params}));
  });
  call.onEvent=(method,listener)=>{
   if(!eventListeners.has(method))eventListeners.set(method,new Set());
   const listeners=eventListeners.get(method);listeners.add(listener);
   return ()=>listeners.delete(listener);
  };
  await call('Page.enable');await call('Runtime.enable');
  await call('Emulation.setFocusEmulationEnabled',{enabled:true});
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true,
   screenWidth:width,screenHeight:height});
  if(typeof beforeNavigate==='function')await beforeNavigate(call);
  const navigation=await call('Page.navigate',{url});
  if(navigation.errorText)throw Error('Page navigation failed: '+navigation.errorText);
  let loaded=false;
  for(let i=0;i<100;i++){
   const r=await call('Runtime.evaluate',{expression:'location.href === '+JSON.stringify(url)+' && document.readyState === "complete"',returnByValue:true});
   if(r.result?.value===true){loaded=true;break;}
   await sleep(50);
  }
  if(!loaded)throw Error('Page load timeout');
  if(typeof probe==='function')return await probe(call);
  const r=await call('Runtime.evaluate',{expression:probe,returnByValue:true});
  if(r.exceptionDetails)throw Error('CDP probe exception '+JSON.stringify(r.exceptionDetails));
  return r.result?.value;
 }finally{
  if(ws)ws.close();
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP closed'));}
  if(startupReady){
   try{if(Number.isInteger(child?.pid)&&child.pid>0)process.kill(-child.pid,'SIGKILL');}catch{}
   await sleep(100);if(dir)rmSync(dir,{recursive:true,force:true});
  }else if(dir)await cleanupStartupAttempt(startupDeadline);
 }
}
