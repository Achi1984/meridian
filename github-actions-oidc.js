import crypto from 'node:crypto';

const ISSUER='https://token.actions.githubusercontent.com';
const JWKS_URL='https://token.actions.githubusercontent.com/.well-known/jwks';
const AUDIENCE='meridian-asset-watch';
const REPOSITORY='Achi1984/meridian';
const REPOSITORY_ID='1342084551';
const REF='refs/heads/main';
const WORKFLOW_REF='Achi1984/meridian/.github/workflows/asset-watch-mirror.yml@refs/heads/main';
const ALLOWED_EVENTS=new Set(['schedule','workflow_dispatch','push']);
const CLOCK_SKEW_SEC=60;
const MAX_TOKEN_AGE_SEC=900;

let jwksCache={at:0,keys:[]};

function decodePart(part){
  const raw=Buffer.from(String(part||''),'base64url').toString('utf8');
  return JSON.parse(raw);
}
function audOk(aud){
  return Array.isArray(aud)?aud.includes(AUDIENCE):String(aud||'')===AUDIENCE;
}
function claimsReason(p,nowSec){
  if(String(p?.iss||'')!==ISSUER)return 'claim_iss';
  if(!audOk(p?.aud))return 'claim_aud';
  if(String(p?.repository||'')!==REPOSITORY)return 'claim_repository';
  if(String(p?.repository_id||'')!==REPOSITORY_ID)return 'claim_repository_id';
  if(String(p?.ref||'')!==REF)return 'claim_ref';
  if(String(p?.workflow_ref||'')!==WORKFLOW_REF)return 'claim_workflow_ref';
  if(!String(p?.sub||'').startsWith('repo:Achi1984/meridian:'))return 'claim_sub';
  if(!ALLOWED_EVENTS.has(String(p?.event_name||'')))return 'claim_event_name';
  if(String(p?.runner_environment||'')!=='github-hosted')return 'claim_runner_environment';
  const exp=Number(p?.exp),nbf=Number(p?.nbf),iat=Number(p?.iat);
  if(!Number.isFinite(exp)||!Number.isFinite(nbf)||!Number.isFinite(iat))return 'claim_time_missing';
  if(exp<nowSec-CLOCK_SKEW_SEC)return 'claim_expired';
  if(nbf>nowSec+CLOCK_SKEW_SEC)return 'claim_nbf';
  if(iat>nowSec+CLOCK_SKEW_SEC)return 'claim_iat_future';
  if(nowSec-iat>MAX_TOKEN_AGE_SEC)return 'claim_iat_stale';
  return null;
}
async function getJwks(fetchFn=fetch,nowMs=Date.now()){
  if(jwksCache.keys.length&&nowMs-jwksCache.at<10*60*1000)return jwksCache.keys;
  const r=await fetchFn(JWKS_URL,{headers:{accept:'application/json','user-agent':'MERIDIAN-GitHub-OIDC/1.0'},cache:'no-store'});
  if(!r?.ok)throw new Error('github_oidc_jwks_unavailable');
  const body=await r.json();
  const keys=Array.isArray(body?.keys)?body.keys:[];
  if(!keys.length)throw new Error('github_oidc_jwks_empty');
  jwksCache={at:nowMs,keys};
  return keys;
}
export function resetGithubOidcJwksCache(){jwksCache={at:0,keys:[]};}

export async function verifyGithubActionsOidc(token,{fetchFn=fetch,nowMs=Date.now()}={}){
  try{
    const parts=String(token||'').split('.');
    if(parts.length!==3)return {ok:false,reason:'malformed'};
    const header=decodePart(parts[0]);
    const payload=decodePart(parts[1]);
    if(header?.alg!=='RS256'||!String(header?.kid||''))return {ok:false,reason:'header'};
    const claimReason=claimsReason(payload,Math.floor(nowMs/1000));
    if(claimReason)return {ok:false,reason:claimReason};
    const keys=await getJwks(fetchFn,nowMs);
    const jwk=keys.find(k=>String(k?.kid||'')===String(header.kid));
    if(!jwk)return {ok:false,reason:'kid'};
    const key=crypto.createPublicKey({key:jwk,format:'jwk'});
    const signed=Buffer.from(parts[0]+'.'+parts[1]);
    const sig=Buffer.from(parts[2],'base64url');
    if(!crypto.verify('RSA-SHA256',signed,key,sig))return {ok:false,reason:'signature'};
    return {ok:true,claims:{
      repository:payload.repository,
      repositoryId:String(payload.repository_id),
      ref:payload.ref,
      workflowRef:payload.workflow_ref,
      eventName:payload.event_name,
      runId:String(payload.run_id||''),
      runNumber:String(payload.run_number||'')
    }};
  }catch(e){
    return {ok:false,reason:String(e?.message||'verify_error')};
  }
}
