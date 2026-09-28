import crypto from 'node:crypto';

export const PIONEX_API_BASE='https://api.pionex.com';

function canonicalRows(params={}){
  const rows=[];
  for(const [k,v] of Object.entries(params)){
    if(v===undefined||v===null||v==='')continue;
    if(Array.isArray(v)){
      for(const item of v)if(item!==undefined&&item!==null&&item!=='')rows.push([String(k),String(item)]);
    }else rows.push([String(k),String(v)]);
  }
  rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  return rows;
}

export function canonicalPionexQuery(params={},encode=true){
  return canonicalRows(params).map(([k,v])=>(encode?encodeURIComponent(k):k)+'='+(encode?encodeURIComponent(v):v)).join('&');
}

export function signPionexReadGet(path,params,secret){
  const query=canonicalPionexQuery(params,false);
  const payload='GET'+path+(query?'?'+query:'');
  return crypto.createHmac('sha256',String(secret||'')).update(payload).digest('hex');
}

export async function pionexReadGet(path,params={},{
  apiKey,apiSecret,fetchImpl=fetch,now=Date.now,timeoutMs=12000
}={}){
  if(!apiKey||!apiSecret)throw new Error('pionex_read_credentials_missing');
  const all={...params,timestamp:now()};
  const query=canonicalPionexQuery(all,true);
  const sig=signPionexReadGet(path,all,apiSecret);
  const r=await fetchImpl(PIONEX_API_BASE+path+'?'+query,{
    method:'GET',
    headers:{accept:'application/json','PIONEX-KEY':apiKey,'PIONEX-SIGNATURE':sig},
    signal:AbortSignal.timeout(timeoutMs)
  });
  const raw=await r.text();let j={};
  try{j=raw?JSON.parse(raw):{}}catch{throw new Error('pionex_read_invalid_json_'+r.status)}
  if(!r.ok)throw new Error('pionex_read_http_'+r.status);
  if(j?.result!==true)throw new Error('pionex_read_api_'+String(j?.code||'error')+':'+String(j?.message||'unknown'));
  return j;
}
