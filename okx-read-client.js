import crypto from 'node:crypto';

export const OKX_ACCOUNT_BALANCE_PATH='/api/v5/account/balance';
export const OKX_DEFAULT_API_BASE='https://www.okx.com';
const OKX_ALLOWED_HOSTS=new Set(['www.okx.com','eea.okx.com','us.okx.com']);

export function normalizeOkxApiBase(value=OKX_DEFAULT_API_BASE){
  const raw=String(value||OKX_DEFAULT_API_BASE).trim();
  let u;
  try{u=new URL(raw)}catch{throw new Error('okx_read_api_base_invalid')}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!OKX_ALLOWED_HOSTS.has(u.hostname))throw new Error('okx_read_api_base_not_allowed');
  return u.origin;
}

export function signOkxReadRequest(timestamp,method,requestPath,secret,body=''){
  const verb=String(method||'GET').toUpperCase();
  const path=String(requestPath||'');
  if(!timestamp||!path.startsWith('/'))throw new Error('okx_read_sign_input_invalid');
  return crypto.createHmac('sha256',String(secret||'')).update(String(timestamp)+verb+path+String(body||'')).digest('base64');
}

export async function okxReadGet(path=OKX_ACCOUNT_BALANCE_PATH,{
  apiKey,apiSecret,passphrase,apiBase=OKX_DEFAULT_API_BASE,fetchImpl=fetch,now=Date.now,timeoutMs=12000
}={}){
  if(!apiKey||!apiSecret||!passphrase)throw new Error('okx_read_credentials_missing');
  if(path!==OKX_ACCOUNT_BALANCE_PATH)throw new Error('okx_read_endpoint_not_allowed');
  const base=normalizeOkxApiBase(apiBase);
  const timestamp=new Date(now()).toISOString();
  const signature=signOkxReadRequest(timestamp,'GET',path,apiSecret);
  const r=await fetchImpl(base+path,{
    method:'GET',
    headers:{
      accept:'application/json',
      'OK-ACCESS-KEY':String(apiKey),
      'OK-ACCESS-SIGN':signature,
      'OK-ACCESS-TIMESTAMP':timestamp,
      'OK-ACCESS-PASSPHRASE':String(passphrase)
    },
    signal:AbortSignal.timeout(timeoutMs)
  });
  const raw=await r.text();let j={};
  try{j=raw?JSON.parse(raw):{}}catch{throw new Error('okx_read_invalid_json_'+r.status)}
  if(!r.ok)throw new Error('okx_read_http_'+r.status);
  if(String(j?.code)!=='0')throw new Error('okx_read_api_'+String(j?.code||'error')+':'+String(j?.msg||'unknown'));
  if(!Array.isArray(j?.data))throw new Error('okx_read_data_invalid');
  return j;
}
