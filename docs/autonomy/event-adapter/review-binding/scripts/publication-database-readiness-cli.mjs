// Opt-in CLI only. Importing reads no environment, imports no driver and connects nowhere.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createPublicationDatabaseReadiness} from './publication-database-readiness.mjs';
const HOST='ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech';
const PREFIX='MERIDIAN_PUBLISHER_TEST_';
const outcomes=new Set(['SCOPED_READ_ONLY_CHECKS_PASSED','SCOPED_CHECKS_FAILED','INDETERMINATE','ALREADY_CONSUMED']);
function need(ok){if(!ok)throw Error('CLI_REJECTED');}
export async function runPublicationDatabaseReadinessCli(argv,{readEnv,loadPg,processApi,timeoutMs=10000}={}){
 let reported=false,terminalCode=1,operationTimer,hardTimer,signalName;
 const controller=new AbortController();
 const emit=async(code,outcome)=>{
  terminalCode=code;
  if(reported)return code;reported=true;
  const output={kind:'PUBLICATION_DATABASE_READINESS_CLI_RESULT',outcome,
   liveAuthorized:false,publicationAllowed:false,universalSecurityVerified:false};
  let outputTimer;
  try{processApi.setExitCode(code);await Promise.race([
   Promise.resolve().then(()=>processApi.writeStdout(JSON.stringify(output)+'\n')),
   new Promise((_,reject)=>{outputTimer=setTimeout(()=>reject(Error('OUTPUT_TIMEOUT')),1000);})]);}
  catch{terminalCode=1;try{processApi.setExitCode(1);}catch{}}
  finally{clearTimeout(outputTimer);}
  // A result may already be buffered when a signal/deadline interrupts flush;
  // the nonzero exit status remains authoritative over that earlier snapshot.
  if(terminalCode===0&&controller.signal.aborted){
   terminalCode=signalName==='SIGINT'?130:signalName==='SIGTERM'?143:124;
   try{processApi.setExitCode(terminalCode);}catch{terminalCode=1;}
  }
  return terminalCode;
 };
 // Check exact activation syntax before touching the environment or driver.
 if(!Array.isArray(argv)||argv.length!==1||argv[0]!=='--check-test-db')return emit(2,'NOT_REQUESTED');
 let config;
 try{
  for(const fn of [readEnv,loadPg,processApi?.writeStdout,processApi?.setExitCode,
   processApi?.onSignal,processApi?.offSignal,processApi?.hardExit])need(typeof fn==='function');
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=15000);
  // Exactly seven named reads; no enumeration, URI, file, host, or PG* fallback.
  config={host:HOST,database:readEnv(PREFIX+'DATABASE'),
   reservation:{user:readEnv(PREFIX+'RESERVATION_USER'),password:readEnv(PREFIX+'RESERVATION_PASSWORD')},
   senderRecord:{user:readEnv(PREFIX+'SENDER_USER'),password:readEnv(PREFIX+'SENDER_PASSWORD')},
   sendRecordRead:{user:readEnv(PREFIX+'READER_USER'),password:readEnv(PREFIX+'READER_PASSWORD')}};
  // Reuse the production validator; this sentinel is never instantiated.
  createPublicationDatabaseReadiness(config,{Pool:class ValidationOnlyPool{},timeoutMs});
  for(const role of ['reservation','senderRecord','sendRecordRead'])Object.freeze(config[role]);Object.freeze(config);
 }catch{return emit(2,'CONFIGURATION_REJECTED');}
 let stop;
 const stopped=new Promise((_,reject)=>{stop=()=>{controller.abort();reject(Error('STOPPED'));};});stopped.catch(()=>{});
 const interrupt=name=>()=>{signalName=name;stop();};
 const onInt=interrupt('SIGINT'),onTerm=interrupt('SIGTERM');
 let intInstalled=false,termInstalled=false;
 // Independent fallback covers driver acquisition, checker cleanup and output.
 // Direct execution explicitly exits after bounded output flush, so a pass
 // cannot leave the CLI waiting indefinitely on a leaked driver handle.
 hardTimer=setTimeout(()=>{
  const code=signalName==='SIGINT'?130:signalName==='SIGTERM'?143:reported?(terminalCode===0?1:terminalCode):124;
  try{processApi.hardExit(code);}catch{}
 },timeoutMs+3000);hardTimer.unref?.();
 try{
  processApi.onSignal('SIGINT',onInt);intInstalled=true;
  processApi.onSignal('SIGTERM',onTerm);termInstalled=true;
  operationTimer=setTimeout(stop,timeoutMs);
  const work=(async()=>{
   need(!controller.signal.aborted);
   const driver=await loadPg();need(!controller.signal.aborted);
   const Pool=driver?.Pool??driver?.default?.Pool;need(typeof Pool==='function');
   const check=createPublicationDatabaseReadiness(config,{Pool,timeoutMs});
   const result=await check(controller.signal);need(!controller.signal.aborted&&outcomes.has(result?.outcome));
   return result.outcome;
  })();
  const outcome=await Promise.race([work,stopped]);
  return await emit(outcome==='SCOPED_READ_ONLY_CHECKS_PASSED'?0:1,outcome);
 }catch{
  return await emit(signalName==='SIGINT'?130:signalName==='SIGTERM'?143:controller.signal.aborted?124:1,
   signalName?'INTERRUPTED':controller.signal.aborted?'DEADLINE_EXCEEDED':'INDETERMINATE');
 }finally{
  clearTimeout(operationTimer);clearTimeout(hardTimer);controller.abort();
  try{if(intInstalled)processApi.offSignal('SIGINT',onInt);}catch{}
  try{if(termInstalled)processApi.offSignal('SIGTERM',onTerm);}catch{}
 }
}

// Only direct execution binds the real process. The exported test seam has no
// provider defaults and cannot implicitly acquire a database or publisher token.
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const code=await runPublicationDatabaseReadinessCli(process.argv.slice(2),{
  readEnv:name=>process.env[name],loadPg:()=>import('pg'),
  processApi:{writeStdout:text=>new Promise((resolve,reject)=>process.stdout.write(text,error=>error?reject(error):resolve())),setExitCode:code=>{process.exitCode=code;},
   onSignal:(name,fn)=>process.on(name,fn),offSignal:(name,fn)=>process.off(name,fn),hardExit:code=>process.exit(code)}
 });
 process.exit(code);
}
