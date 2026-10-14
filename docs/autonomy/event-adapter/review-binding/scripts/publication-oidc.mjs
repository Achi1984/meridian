// Inactive standalone preparation. No token acquisition, route or ledger integration.
import {createPublicKey,verify} from 'node:crypto';
const ISSUER='https://token.actions.githubusercontent.com';
const JWKS=ISSUER+'/.well-known/jwks';
const REPOSITORY='Achi1984/meridian';
const WORKFLOW=REPOSITORY+'/.github/workflows/meridian-negative-publisher.yml@refs/heads/main';
const AUDIENCE='meridian-negative-publisher';
const flags={authenticated:false,provenanceVerified:false,authorized:false,
 dispatchAllowed:false,mergeAllowed:false,durable:false};
const utf8=new TextDecoder('utf-8',{fatal:true});
function need(ok){if(!ok)throw new Error('rejected');}
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function b64(s){need(typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s));
 const b=Buffer.from(s,'base64url');need(b.toString('base64url')===s);return b;}
function parse(s){const x=JSON.parse(utf8.decode(b64(s)));need(object(x));return x;}
function decimal(s){return typeof s==='string'&&/^[1-9][0-9]{0,15}$/.test(s)&&BigInt(s)<=9007199254740991n;}
function pinCheck(p){
 need(object(p));
 const environmentProfile=Object.hasOwn(p,'environment');
 need(Object.keys(p).sort().join()===(environmentProfile
  ?'controlSha,environment,ownerId,repositoryId,runId,subject'
  :'controlSha,ownerId,repositoryId,runId,subject'));
 if(environmentProfile)need(typeof p.environment==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(p.environment));
 need(['ownerId','repositoryId','runId'].every(k=>decimal(p[k])));
 need(typeof p.controlSha==='string'&&/^[a-f0-9]{40}$/.test(p.controlSha));
 // Require an explicit current subject; never guess legacy versus immutable form.
 // Trusted pins select the profile, never token claims. Restrict names so no
 // subject escaping, normalization or case-folding can change the binding.
 const context=environmentProfile?'environment:'+p.environment:'ref:refs/heads/main';
 const legacy='repo:'+REPOSITORY+':'+context;
 const immutable=`repo:Achi1984@${p.ownerId}/meridian@${p.repositoryId}:${context}`;
 need(p.subject===legacy||p.subject===immutable);
}
function claimsCheck(c,p,now){
 const expected={iss:ISSUER,aud:AUDIENCE,sub:p.subject,repository:REPOSITORY,
 repository_id:p.repositoryId,repository_owner:'Achi1984',repository_owner_id:p.ownerId,
 ref:'refs/heads/main',ref_type:'branch',workflow_ref:WORKFLOW,workflow_sha:p.controlSha,
 sha:p.controlSha,run_id:p.runId,run_attempt:'1',event_name:'workflow_dispatch',
 runner_environment:'github-hosted'};
 need(Object.entries(expected).every(([k,v])=>c[k]===v));
 need(!('job_workflow_ref' in c)&&!('job_workflow_sha' in c));
 if(Object.hasOwn(p,'environment'))need(c.environment===p.environment);
 else need(!('environment' in c));
 need(typeof c.jti==='string'&&c.jti.length>0&&c.jti.length<=256);
 need(['iat','nbf','exp'].every(k=>Number.isSafeInteger(c[k]))&&Number.isSafeInteger(now));
 need(c.iat>0&&c.nbf>0&&c.iat<=now+30&&c.nbf<=now+30&&c.exp>now&&c.iat<c.exp);
 need(c.nbf<=c.iat+30&&c.nbf>=c.iat-300&&c.nbf<c.exp);
 need(now-c.iat<=300&&c.exp-c.iat<=600);
}
async function keys(fetchFn){
 const abort=new AbortController();let reader,timer;
 function cancel(){try{reader?.cancel().catch(()=>{});}catch{}}
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
  abort.abort();cancel();reject(new Error('deadline'));
 },5000);});
 async function work(){
  const response=await fetchFn(JWKS,{redirect:'error',signal:abort.signal,
   headers:{accept:'application/json'},cache:'no-store'});
  if(abort.signal.aborted){try{response?.body?.cancel().catch(()=>{});}catch{}throw new Error('deadline');}
  need(response?.status===200&&response.url===JWKS&&!response.redirected&&response.body);
  reader=response.body.getReader();let size=0;const chunks=[];
  try{while(true){const item=await reader.read();if(item.done)break;
   need(!abort.signal.aborted);size+=item.value.length;need(size<=65536);chunks.push(item.value);}}
  finally{cancel();try{reader.releaseLock();}catch{}}
  need(!abort.signal.aborted);
  const data=JSON.parse(utf8.decode(Buffer.concat(chunks)));need(object(data));
  need(Array.isArray(data.keys)&&data.keys.length>0&&data.keys.length<=32);
  return data.keys;
 }
 try{return await Promise.race([work(),deadline]);}
 finally{clearTimeout(timer);abort.abort();cancel();}
}

export async function verifyPublicationToken(token,pins,{fetchFn=globalThis.fetch,clock=()=>Math.floor(Date.now()/1000)}={}){
 try{
  pinCheck(pins);pins={...pins};
  need(typeof token==='string'&&token.length<=16384);
  const parts=token.split('.');need(parts.length===3);
  const header=parse(parts[0]);const claims=parse(parts[1]);const signature=b64(parts[2]);
  need(Object.keys(header).every(k=>['alg','typ','kid'].includes(k)));
  need(header.alg==='RS256'&&header.typ==='JWT'&&typeof header.kid==='string'
       &&header.kid.length>0&&header.kid.length<=256);
  claimsCheck(claims,pins,clock());
  const jwks=await keys(fetchFn);
  const matches=jwks.filter(k=>object(k)&&k.kid===header.kid);need(matches.length===1);
  const jwk=matches[0];need(jwk.kty==='RSA'&&jwk.use==='sig'
   &&(!('alg' in jwk)||jwk.alg==='RS256')&&!('d' in jwk));
  need(!('key_ops' in jwk)||(Array.isArray(jwk.key_ops)&&jwk.key_ops.length===1&&jwk.key_ops[0]==='verify'));
  const publicKey=createPublicKey({key:jwk,format:'jwk'});
  need(publicKey.asymmetricKeyType==='rsa'&&publicKey.asymmetricKeyDetails.modulusLength>=2048);
  need(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,signature));
  claimsCheck(claims,pins,clock());
  return {kind:'VERIFIED_TOKEN_ONLY',tokenVerified:true,runId:pins.runId,
    controlSha:pins.controlSha,validUntil:Math.min(claims.exp,claims.iat+301),...flags};
 }catch{return {kind:'TOKEN_REJECTED',tokenVerified:false,...flags};}
}

