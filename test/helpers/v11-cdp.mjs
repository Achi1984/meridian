// MERIDIAN11-CDP-R1: small dependency-free Chrome DevTools helper.
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const STARTUP_STDERR_BYTES=4096;
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
export async function withMobileChrome(chrome,width,url,probe,height=844){
 const dir=mkdtempSync(join(tmpdir(),'v11-cdp-'));
 let child,spawnFailure,collectingStartup=true,stderrReadFailed=false,startupStderr=Buffer.alloc(0);
 let ws;const pending=new Map();let seq=0;
 const startupError=prefix=>Error(prefix+' ['+(spawnFailure||
  (startupStderr.length?stderrCategory(startupStderr):stderrReadFailed?'STDERR_UNAVAILABLE':'UNKNOWN'))+']');
 try{
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
  let port;
  for(let i=0;i<200;i++){
   if(spawnFailure)throw startupError('Chrome spawn failed');
   if(child.exitCode!==null)throw startupError('Chrome exited '+child.exitCode);
   const f=join(dir,'DevToolsActivePort');
   if(existsSync(f)){
    const match=/^([0-9]+)\n/.exec(readFileSync(f,'utf8'));
    const candidate=match?Number(match[1]):0;
    if(Number.isInteger(candidate)&&candidate>=1&&candidate<=65535){port=candidate;break;}
   }
   await sleep(50);
  }
  if(spawnFailure)throw startupError('Chrome spawn failed');
  if(!port)throw startupError('Chrome DevTools startup timeout');
  collectingStartup=false;startupStderr=Buffer.alloc(0);
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
  collectingStartup=false;startupStderr=Buffer.alloc(0);
  if(ws)ws.close();
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP closed'));}
  try{if(Number.isInteger(child?.pid)&&child.pid>0)process.kill(-child.pid,'SIGKILL');}catch{}
  await sleep(100);rmSync(dir,{recursive:true,force:true});
 }
}
