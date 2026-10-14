// Inactive confirmation-only recovery. No send, reservation or record reconstruction.
import {confirmPublication} from './publication-service.mjs';
import {createPublishedCommentReader} from './publication-github-reader.mjs';
import {createSendRecordReader} from './publication-send-record.mjs';

const flags=Object.freeze({authenticated:false,provenanceVerified:false,authorized:false,
 dispatchAllowed:false,mergeAllowed:false,durable:false,sendAllowed:false});
const result=outcome=>({kind:'INACTIVE_PUBLICATION_RECOVERY_RESULT',outcome,...flags});
function need(ok){if(!ok)throw new Error('RECOVERY_REJECTED');}
function method(object,key){need(typeof object?.[key]==='function');return object[key].bind(object);}

// This closure must be constructed by a trusted host, never from request fields.
// Its deadline bounds waiting and gates later effects; it cannot undo a DB write
// already submitted. A synchronous validator can delay timer delivery, so every
// effect gate also checks monotonic elapsed time. Host DB timeouts remain required.
export function createPublicationRecovery(trustedConfig,dependencies,{timeoutMs=30000}={}){
 let config,query,readQuery,readEvidence,fetchFn,clock;
 try{
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000);
  config=JSON.parse(JSON.stringify(trustedConfig));
  query=method(dependencies.pool,'query');
  readQuery=method(dependencies.senderRecordReadPool,'query');
  readEvidence=method(dependencies,'readEvidence');
  fetchFn=method(dependencies,'fetchFn');
  clock=dependencies.clock===undefined?()=>Math.floor(Date.now()/1000):method(dependencies,'clock');
 }catch{throw new Error('RECOVERY_CONFIGURATION_REJECTED');}
 return async function recoverPublication(request,parentSignal){
  const controller=new AbortController();let timer,onAbort,removeParentListener;
  const endsAt=performance.now()+timeoutMs;
  const check=()=>need(!controller.signal.aborted&&performance.now()<endsAt);
  try{
   need(request&&Object.keys(request).sort().join()==='body,commentId,token');
   const input={body:request.body,token:request.token,commentId:request.commentId};
   need(typeof input.body==='string'&&Buffer.byteLength(input.body)<=8192
    &&typeof input.token==='string'&&input.token.length<=16384
    &&Number.isSafeInteger(input.commentId)&&input.commentId>0);
   need(parentSignal===undefined||parentSignal instanceof AbortSignal);
   need(!parentSignal?.aborted);
   removeParentListener=parentSignal?.removeEventListener.bind(parentSignal);
   const stopped=new Promise((_,reject)=>{
    onAbort=()=>{controller.abort();reject(new Error('RECOVERY_REJECTED'));};
    timer=setTimeout(onAbort,timeoutMs);
    parentSignal?.addEventListener('abort',onAbort,{once:true});
   });
   const combine=signal=>signal?AbortSignal.any([controller.signal,signal]):controller.signal;
   const guarded=fn=>async(...args)=>{check();const value=await fn(...args);check();return value;};
   const safeFetch=async(url,options={})=>{
    check();need((options.method??'GET')==='GET');
    const response=await fetchFn(url,{...options,signal:combine(options.signal)});
    try{check();}catch(error){
     try{response?.body?.cancel().catch(()=>{});}catch{}
     throw error;
    }
    return response;
   };
   const readRecord=createSendRecordReader({query:guarded(readQuery)});
   const readComment=createPublishedCommentReader({fetchFn:safeFetch});
   const work=confirmPublication(input,config,{
    pool:{query:guarded(query)},fetchFn:safeFetch,clock:()=>{check();return clock();},
    readEvidence:signal=>guarded(readEvidence)(combine(signal)),
    readSendRecord:(binding,signal)=>{check();return readRecord(binding,combine(signal));},
    readPublishedComment:(id,signal)=>{check();return readComment(id,combine(signal));}
   });
   const confirmed=await Promise.race([work,stopped]);check();
   return result(confirmed.kind==='INACTIVE_CONFIRMATION_RESULT'&&confirmed.outcome==='ACKNOWLEDGED'
    ?'OBSERVED_CONFIRMATION':'OWNER_RECONCILIATION_REQUIRED');
  }catch{return result('OWNER_RECONCILIATION_REQUIRED');}
  finally{
   clearTimeout(timer);
   try{if(onAbort)removeParentListener?.('abort',onAbort);}catch{}
   finally{controller.abort();}
  }
 };
}
