// Inactive primitive: only a trusted host may supply fetch and credentials after
// fresh admission and durable reservation. No caller or production wiring exists.
const URL='https://api.github.com/repos/Achi1984/meridian/issues/571/comments';
const flags={authenticated:false,provenanceVerified:false,authorized:false,
 dispatchAllowed:false,mergeAllowed:false,durable:false,sendAllowed:false};
const result=(outcome,response)=>({kind:'INACTIVE_POST_TRANSPORT_RESULT',outcome,
 ...flags,...(response?{response}:{})});
function need(ok){if(!ok)throw new Error('POST_RESPONSE_REJECTED');}
function cancel(body){try{body?.cancel().catch(()=>{});}catch{}}
async function readResponse(response,signal){
 if(signal.aborted||response?.status!==201||response.url!==URL||response.redirected!==false||!response.body){
  cancel(response?.body);need(false);
 }
 const reader=response.body.getReader();const chunks=[];let size=0;
 const stop=()=>{try{reader.cancel().catch(()=>{});}catch{}};
 signal.addEventListener('abort',stop,{once:true});
 try{
  for(;;){const {done,value}=await reader.read();need(!signal.aborted);if(done)break;
   need(value instanceof Uint8Array);size+=value.byteLength;need(size<=131072);
   chunks.push(Buffer.from(value));}
  const comment=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  need(comment&&typeof comment==='object'&&!Array.isArray(comment));
  return {status:201,url:URL,redirected:false,comment};
 }finally{signal.removeEventListener('abort',stop);stop();try{reader.releaseLock();}catch{}}
}
export function createPublicationPostTransport({fetchFn}={}){
 if(typeof fetchFn!=='function')throw new Error('EXPLICIT_HOST_FETCH_REQUIRED');
 let consumed=false;
 return async function postPublication(request,credential,parentSignal){
  if(consumed)return result('ALREADY_CONSUMED');
  let body;
  try{
   need(request&&Object.keys(request).join()==='body');body=request.body;
   need(typeof body==='string'&&body.length>0&&Buffer.byteLength(body)<=8192);
   need(typeof credential==='string'&&/^[A-Za-z0-9_\-]{1,1024}$/.test(credential));
   need(!parentSignal||typeof parentSignal.aborted==='boolean'
    &&typeof parentSignal.addEventListener==='function'&&typeof parentSignal.removeEventListener==='function');
   need(!parentSignal?.aborted);
  }catch{return result('NOT_ATTEMPTED');}
  // Synchronous consumption precedes the first await; never retry this instance.
  // Recreating an instance does NOT grant permission for another send.
  consumed=true;
  const abort=new AbortController();let timer,onAbort;
  try{
   const deadline=new Promise((_,reject)=>{
    onAbort=()=>{abort.abort();reject(new Error('POST_ABORTED'));};
    timer=setTimeout(onAbort,4500);parentSignal?.addEventListener('abort',onAbort,{once:true});
    if(parentSignal?.aborted)onAbort();
   });
   const work=(async()=>{
    need(!abort.signal.aborted);
    const response=await fetchFn(URL,{method:'POST',redirect:'error',cache:'no-store',signal:abort.signal,
     headers:{accept:'application/vnd.github+json','content-type':'application/json',
      'X-GitHub-Api-Version':'2022-11-28',authorization:'Bearer '+credential},body:JSON.stringify({body})});
    return readResponse(response,abort.signal);
   })();
   return result('RESPONSE_CAPTURED',await Promise.race([work,deadline]));
  }catch{return result('UNCERTAIN');}
  finally{clearTimeout(timer);parentSignal?.removeEventListener('abort',onAbort);abort.abort();}
 };
}
