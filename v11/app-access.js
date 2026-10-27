const VERIFY_ENDPOINT='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/portfolio-history?range=1w';
const ACCESS_MS=15*60*1000;
const MAX_BYTES=512*1024;
const TIMEOUT_MS=10000;

function password(value){
  if(typeof value!=='string'||value.length>4096||/[\x00-\x1f\x7f]/.test(value))return null;
  const candidate=value.trim();
  if(!candidate||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate)||/^(?:[/\\]{2}|www\.)/i.test(candidate)||
    /^[A-Za-z0-9_-]{43}$/.test(candidate))return null;
  return candidate;
}

async function readBounded(response,signal){
  if(!response.ok)throw new Error('unavailable');
  const length=response.headers?.get('content-length');
  if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))
    throw new Error('unavailable');
  const reader=response.body?.getReader();
  if(!reader)throw new Error('unavailable');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0,text='';
  const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      if(signal.aborted)throw new Error('unavailable');
      const {done,value}=await reader.read();
      if(signal.aborted)throw new Error('unavailable');
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES)throw new Error('unavailable');
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
    const data=JSON.parse(text);
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('unavailable');
  }finally{
    signal.removeEventListener('abort',cancel);
    cancel();
    try{reader.releaseLock();}catch{}
  }
}

export function createAppAccess({fetchImpl=globalThis.fetch,now=Date.now,schedule=setTimeout,
  cancelSchedule=clearTimeout}={}){
  if(typeof fetchImpl!=='function')throw new Error('Access unavailable');
  let credential=null,expiresAt=null,pending=null,expiryTimer=null,generation=0,disposed=false;
  const readers=new Set(),subscribers=new Set();

  function cancelExpiry(){
    if(expiryTimer!==null){cancelSchedule(expiryTimer);expiryTimer=null;}
  }
  function state(){return Object.freeze({status:credential?'unlocked':'locked',expiresAt:credential?expiresAt:null});}
  function publish(){const current=state();for(const listener of subscribers){try{listener(current);}catch{}}}
  function lock(){
    generation++;
    credential=null;expiresAt=null;
    if(pending){pending.abort();pending=null;}
    cancelExpiry();
    for(const clear of readers){try{clear();}catch{}}
    publish();
  }
  function scheduleExpiry(id){
    cancelExpiry();
    const remaining=expiresAt-now();
    expiryTimer=schedule(()=>{
      if(disposed||id!==generation)return;
      expiryTimer=null;
      if(now()>=expiresAt)lock();
      else scheduleExpiry(id);
    },Math.max(0,remaining));
  }
  function isUnlocked(){
    if(credential&&now()>=expiresAt)lock();
    return !!credential&&!disposed;
  }
  function getToken(){return isUnlocked()?credential:null;}
  async function verify(value){
    if(disposed)return 'unavailable';
    const candidate=password(value);
    lock();
    if(!candidate||typeof AbortController==='undefined')return 'rejected';
    const id=generation,controller=new AbortController();
    pending=controller;
    let timer,onAbort;
    const aborted=new Promise((_,reject)=>{
      onAbort=()=>reject(new Error('unavailable'));
      controller.signal.addEventListener('abort',onAbort,{once:true});
    });
    aborted.catch(()=>{});
    try{
      timer=schedule(()=>controller.abort(),TIMEOUT_MS);
      const operation=(async()=>{
        const response=await fetchImpl(VERIFY_ENDPOINT,{method:'GET',redirect:'error',credentials:'omit',
          cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,
          headers:{accept:'application/json',authorization:'Bearer '+candidate}});
        if(controller.signal.aborted)throw new Error('unavailable');
        if(response.status===401||response.status===403)return 'rejected';
        await readBounded(response,controller.signal);
        return 'verified';
      })();
      const result=await Promise.race([operation,aborted]);
      if(id!==generation||disposed||controller.signal.aborted)return 'unavailable';
      if(result!=='verified')return result;
      pending=null;
      credential=candidate;expiresAt=now()+ACCESS_MS;
      scheduleExpiry(id);publish();
      return 'unlocked';
    }catch{
      return 'unavailable';
    }finally{
      if(timer!==undefined)cancelSchedule(timer);
      controller.signal.removeEventListener('abort',onAbort);
      if(pending===controller)pending=null;
    }
  }
  function registerReader(clear){
    if(typeof clear!=='function')throw new Error('Access unavailable');
    readers.add(clear);
    let active=true;
    return ()=>{if(active){active=false;readers.delete(clear);}};
  }
  function subscribe(listener){
    if(typeof listener!=='function')throw new Error('Access unavailable');
    subscribers.add(listener);
    try{listener(state());}catch{}
    return ()=>subscribers.delete(listener);
  }
  function dispose(){
    if(disposed)return;
    lock();disposed=true;
    readers.clear();subscribers.clear();
  }
  return Object.freeze({verify,lock,isUnlocked,getToken,registerReader,subscribe,dispose});
}

export const appAccess=createAppAccess();
