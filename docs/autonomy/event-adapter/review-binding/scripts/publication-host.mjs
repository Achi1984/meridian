// Inactive composition only: no route, pool, credential acquisition or startup.
// A deployment must authenticate/bootstrap these dependencies; flags are not a kill switch.
import {prepareAdmission,capturePublicationResponse,confirmPublication} from './publication-service.mjs';
import {reserveWithReceipt} from './publication-reservation-receipt.mjs';
import {createPublicationPostTransport} from './publication-post-transport.mjs';
import {createSendRecordReader} from './publication-send-record.mjs';
import {createPublishedCommentReader} from './publication-github-reader.mjs';
const flags={authenticated:false,provenanceVerified:false,authorized:false,dispatchAllowed:false,
 mergeAllowed:false,durable:false,sendAllowed:false};
const answer=(stage,outcome)=>({kind:'INACTIVE_HOST_RESULT',stage,outcome,...flags});
function need(ok){if(!ok)throw new Error('HOST_REJECTED');}
export function createPublicationHost(bootstrap){
 const config=JSON.parse(JSON.stringify(bootstrap.trustedConfig));
 const {readEvidence,oidcFetch,postFetch,commentFetch,readCredential,
  clockMs=Date.now,monotonicMs=()=>performance.now(),deadlineMs=60000}=bootstrap;
 for(const f of [readEvidence,oidcFetch,postFetch,commentFetch,readCredential,clockMs,monotonicMs])need(typeof f==='function');
 need(Number.isSafeInteger(deadlineMs)&&deadlineMs>0&&deadlineMs<=60000);
 const bind=pool=>{need(typeof pool?.query==='function');return pool.query.bind(pool);};
 const reserveQuery=bind(bootstrap.reservationPool),senderQuery=bind(bootstrap.senderRecordPool),
  readerQuery=bind(bootstrap.sendRecordReadPool);
 let consumed=false;
 return async function run(request,parentSignal){
  if(consumed)return answer('INPUT','ALREADY_CONSUMED');
  consumed=true;
  let stage='INPUT',timer,onAbort,removeAbort,lastWall,startMono,lastMono;
  const abort=new AbortController();
  const fail=()=>abort.abort();
  function guard(){
   need(!abort.signal.aborted&&!parentSignal?.aborted);
   const wall=clockMs(),mono=monotonicMs();
   need(Number.isSafeInteger(wall)&&wall>0&&wall<=8640000000000000&&Number.isFinite(mono));
   need(lastWall===undefined||wall>=lastWall);need(lastMono===undefined||mono>=lastMono);
   startMono??=mono;need(mono-startMono<=deadlineMs);lastMono=mono;lastWall=wall;return wall;
  }
  let rejectStop;
  const stopped=new Promise((_,reject)=>{rejectStop=()=>{fail();reject(new Error('HOST_STOPPED'));};});
  // Every continuation and every injected DB/network side effect checks this gate.
  // A late DB commit cannot cancel itself, but cannot advance this host to POST.
  const bounded=async work=>{guard();const value=await Promise.race([Promise.resolve().then(()=>{guard();return work();}),stopped]);guard();return value;};
  const pool=query=>Object.freeze({query:(...args)=>bounded(()=>query(...args))});
  const wrapFetch=fetchFn=>(...args)=>bounded(()=>fetchFn(...args));
  try{
   need(request&&Object.keys(request).sort().join()==='body,token');
   const input=Object.freeze({body:request.body,token:request.token});
   need(typeof input.body==='string'&&typeof input.token==='string');
   need(!parentSignal||typeof parentSignal.aborted==='boolean'&&typeof parentSignal.addEventListener==='function'&&typeof parentSignal.removeEventListener==='function');
   guard();onAbort=rejectStop;
   if(parentSignal){removeAbort=parentSignal.removeEventListener.bind(parentSignal);parentSignal.addEventListener('abort',onAbort,{once:true});}
   timer=setTimeout(rejectStop,deadlineMs);
   const deps=Object.freeze({readEvidence:()=>bounded(()=>readEvidence(abort.signal)),
    fetchFn:wrapFetch(oidcFetch),clock:()=>Math.floor(guard()/1000),pool:pool(reserveQuery)});
   const admission=async()=>{const a=await bounded(()=>prepareAdmission(input,config,deps));
    need(a.kind==='UNAUTHENTICATED_ADMISSION_CANDIDATE');return a;};
   stage='ADMISSION';const initial=await admission();const binding=Object.freeze({...initial.ledgerBinding});
   stage='RESERVATION';const reserved=await bounded(()=>reserveWithReceipt(deps.pool,binding));
   if(reserved.outcome!=='ACKNOWLEDGED')return answer(stage,reserved.outcome);
   const receipt=reserved.reservation;
   need(receipt&&JSON.stringify(receipt.binding)===JSON.stringify(binding));
   stage='CREDENTIAL';const credential=await bounded(()=>readCredential(abort.signal));
   stage='FRESH_ADMISSION';const fresh=await admission();need(JSON.stringify(fresh.ledgerBinding)===JSON.stringify(binding));
   const sendStartedAtMs=guard();need(Number.isSafeInteger(receipt.reservedAtMs)&&receipt.reservedAtMs>0
    &&receipt.reservedAtMs<=sendStartedAtMs&&sendStartedAtMs-receipt.reservedAtMs<=900000);
   stage='POST';const sendMono=lastMono;
   const transport=createPublicationPostTransport({fetchFn:wrapFetch(postFetch)});
   const sent=await bounded(()=>transport({body:input.body},credential,abort.signal));
   const responseReceivedAtMs=guard();need(lastMono-sendMono<=4500);
   if(sent.outcome!=='RESPONSE_CAPTURED')return answer(stage,sent.outcome);
   const publicationWindow=Object.freeze({reservedAtMs:receipt.reservedAtMs,sendStartedAtMs,responseReceivedAtMs});
   stage='CAPTURE';const captured=await bounded(()=>capturePublicationResponse(input,sent.response,config,
    {...deps,senderRecordPool:pool(senderQuery),publicationWindow,publicationClock:guard}));
   if(captured.outcome!=='ACKNOWLEDGED')return answer(stage,captured.outcome??'REJECTED');
   stage='CONFIRMATION';const confirmed=await bounded(()=>confirmPublication({...input,commentId:sent.response.comment.id},config,
    {...deps,readSendRecord:createSendRecordReader(pool(readerQuery)),
     readPublishedComment:createPublishedCommentReader({fetchFn:wrapFetch(commentFetch)})}));
   return answer(stage,confirmed.outcome??'REJECTED');
  }catch{return answer(stage,stage==='INPUT'||stage==='ADMISSION'?'REJECTED':'UNCERTAIN');}
  finally{clearTimeout(timer);try{removeAbort?.('abort',onAbort);}catch{}fail();}
 };
}
