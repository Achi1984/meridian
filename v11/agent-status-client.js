const MAX_BYTES=512*1024;

// The consumer projects through the approved browser renderer; rejection clears the cache.
export function createAgentStatusClient({now=Date.now,onChange}={}){
  if(typeof onChange!=='function')throw new TypeError('Status consumer required');
  let serializedDto=null,deadlines=[],disposed=false;
  function clear(reason='empty'){
    serializedDto=null;deadlines=[];
    if(!disposed)try{onChange(Object.freeze({status:reason==='unavailable'?'unavailable':'empty'}));}catch{}
  }
  function revalidate(){
    if(disposed||serializedDto===null)return false;
    try{
      const nowMs=now();
      if(!Number.isFinite(nowMs))throw new TypeError('Invalid clock');
      const nextExpiryAt=deadlines.filter(time=>time>nowMs).sort((a,b)=>a-b)[0]??null;
      onChange(Object.freeze({status:'ready',serializedDto,nowMs,nextExpiryAt}));
      return serializedDto!==null;
    }catch{
      clear('unavailable');
      return false;
    }
  }
  function accept(value){
    if(disposed)return false;
    try{
      if(typeof value!=='string'||value.length>MAX_BYTES||
        new TextEncoder().encode(value).byteLength>MAX_BYTES)throw new TypeError('Bounded JSON required');
      const dto=JSON.parse(value);
      if(!dto||dto.schemaVersion!==1||!Array.isArray(dto.rows)||
        dto.rows.length===0||dto.rows.length>50)throw new TypeError('Invalid rows');
      const expiry=[];
      for(const row of dto.rows){
        if(!row||typeof row!=='object')throw new TypeError('Invalid row');
        for(const item of [row,row.providerEvidence,row.modelEvidence,row.coordinatorEvidence]){
          const time=typeof item?.expiresAt==='string'?Date.parse(item.expiresAt):NaN;
          if(Number.isFinite(time))expiry.push(time);
        }
      }
      serializedDto=value;deadlines=expiry;
      return revalidate();
    }catch{
      clear('unavailable');
      return false;
    }
  }
  function dispose(){
    if(disposed)return;
    disposed=true;serializedDto=null;deadlines=[];
    try{onChange(Object.freeze({status:'empty'}));}catch{}
  }
  return Object.freeze({accept,clear,revalidate,dispose});
}
