// Fixed isolated Python child. Importing this module performs no work.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
const bridge=fileURLToPath(new URL('./publication-plan-bridge.py',import.meta.url));
export async function planForPublication(body,config){
 const input=JSON.stringify({body,scopeRaw:config.scopeRaw,policyRaw:config.policyRaw,pinsRaw:config.pinsRaw});
 if(Buffer.byteLength(input)>65536)throw Error('PLAN_REJECTED');
 return new Promise((resolve,reject)=>{
  let done=false,total=0;const chunks=[];
  const child=spawn('python3',['-I','-B',bridge],{stdio:['pipe','pipe','pipe'],
   env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});
  const timer=setTimeout(()=>finish(),10000);
  function finish(plan){
   if(done)return;done=true;clearTimeout(timer);
   child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
   if(child.exitCode===null)child.kill('SIGKILL');
   if(plan)resolve(plan);else reject(Error('PLAN_REJECTED'));
  }
  child.on('error',()=>finish());
  child.stdin.on('error',()=>finish());
  child.stdout.on('error',()=>finish());child.stderr.on('error',()=>finish());
  child.stdout.on('data',chunk=>{total+=chunk.length;if(total>32768)finish();else chunks.push(chunk);});
  // Count stderr against the same limit; never return/log it (it may hold input).
  child.stderr.on('data',chunk=>{total+=chunk.length;if(total>32768)finish();});
  child.on('close',code=>{
   if(done)return;
   try{if(code!==0)throw Error();
    const plan=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(plan.kind!=='OFFLINE_ACTIONS_PUBLICATION_PLAN')throw Error();finish(plan);
   }catch{finish();}
  });
  child.stdin.end(input);
 });
}
