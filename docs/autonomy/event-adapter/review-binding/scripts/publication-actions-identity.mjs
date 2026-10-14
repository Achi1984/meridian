// Source-only adapter. Importing does not acquire credentials or perform I/O.
const AUDIENCE='meridian-negative-publisher';
const MAX_BYTES=32768;
const rejected=()=>new Error('publication identity rejected');
function need(ok){if(!ok)throw rejected();}
function cancel(body){try{Promise.resolve(body?.cancel()).catch(()=>{});}catch{}}
function request(config){
 need(config!==null&&typeof config==='object'&&!Array.isArray(config));
 need(Object.keys(config).sort().join()==='audience,endpointPin,requestToken,requestUrl');
 need(config.audience===AUDIENCE);
 need(typeof config.requestUrl==='string'&&config.requestUrl.length<=8192);
 need(config.requestUrl===config.endpointPin);
 const url=new URL(config.requestUrl);
 need(url.protocol==='https:'&&url.hostname&&url.username===''&&url.password===''&&!config.requestUrl.includes('#'));
 // Reject normalization ambiguities; retain the exact trusted path and query.
 need(url.href===config.endpointPin&&!url.searchParams.has('audience'));
 need(typeof config.requestToken==='string'&&config.requestToken.length>0&&config.requestToken.length<=16384
  &&/^[\x21-\x7e]+$/.test(config.requestToken));
 url.searchParams.append('audience',AUDIENCE);
 return {url:url.href,credential:config.requestToken};
}

export async function acquireActionsPublicationToken(config,{signal,fetchFn=globalThis.fetch,timeoutMs=5000}={}){
 let controller,reader,timer,onAbort;
 try{
  const target=request(config);
  need(typeof fetchFn==='function'&&Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000);
  need(signal===undefined||signal instanceof AbortSignal);
  need(!signal?.aborted);
  controller=new AbortController();
  const stop=()=>{controller.abort();cancel(reader);};
  const boundary=new Promise((_,reject)=>{
   onAbort=()=>{stop();reject(rejected());};
   signal?.addEventListener('abort',onAbort,{once:true});
   timer=setTimeout(onAbort,timeoutMs);
  });
  const work=async()=>{
   const response=await fetchFn(target.url,{method:'GET',redirect:'error',cache:'no-store',
    signal:controller.signal,headers:{accept:'application/json',authorization:'Bearer '+target.credential}});
   if(controller.signal.aborted){cancel(response?.body);throw rejected();}
   try{
    need(response?.status===200&&response.url===target.url&&response.redirected===false&&response.body);
    reader=response.body.getReader();
    const chunks=[];let size=0;
    while(true){
     const part=await reader.read();
     need(!controller.signal.aborted);
     if(part.done)break;
     need(part.value instanceof Uint8Array);
     size+=part.value.byteLength;need(size<=MAX_BYTES);chunks.push(part.value);
    }
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    need(data!==null&&typeof data==='object'&&!Array.isArray(data));
    need(typeof data.value==='string'&&data.value.length<=16384
     &&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.value));
    need(!controller.signal.aborted);
    // Syntax only; the caller MUST authenticate this JWT with the existing verifier.
    return data.value;
   }finally{
    if(reader){cancel(reader);try{reader.releaseLock();}catch{}}
    else cancel(response?.body);
   }
  };
  return await Promise.race([work(),boundary]);
 }catch{throw rejected();}
 finally{
  clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort);
  controller?.abort();cancel(reader);
 }
}

export function createActionsPublicationIdentity(options={}){
 const {fetchFn=globalThis.fetch,timeoutMs=5000}=options;
 return (config,signal)=>acquireActionsPublicationToken(config,{signal,fetchFn,timeoutMs});
}
