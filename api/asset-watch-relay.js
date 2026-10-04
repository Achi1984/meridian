import crypto from 'node:crypto';
import {validateAssetWatchMirrorEnvelope} from '../asset-watch-mirror-crypto.js';

const HASH_RE=/^[a-f0-9]{64}$/;

function timingSafeToken(token,expectedHash){
  const supplied=String(token||'').trim();
  const expected=String(expectedHash||'').trim().toLowerCase();
  if(!supplied||!HASH_RE.test(expected))return false;
  const actual=crypto.createHash('sha256').update(supplied).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
}
function json(res,status,body){
  res.status(status);
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store, max-age=0');
  res.setHeader('pragma','no-cache');
  res.setHeader('x-robots-tag','noindex, nofollow, noarchive');
  res.setHeader('referrer-policy','no-referrer');
  return res.send(JSON.stringify(body));
}
export default async function handler(req,res){
  if(req.method!=='GET')return json(res,405,{error:'method_not_allowed'});
  if(String(req.query?.health||'')==='1')return json(res,200,{
    ok:true,service:'meridian-asset-watch-encrypted-live-relay',
    upstreamConfigured:!!String(process.env.MERIDIAN_ASSET_WATCH_LIVE_MIRROR_URL||'').trim(),
    authConfigured:HASH_RE.test(String(process.env.MERIDIAN_RELAY_TOKEN_SHA256||'').trim().toLowerCase())
  });
  if(!timingSafeToken(req.query?.share,process.env.MERIDIAN_RELAY_TOKEN_SHA256))
    return json(res,401,{error:'relay_token_required'});
  const upstream=String(process.env.MERIDIAN_ASSET_WATCH_LIVE_MIRROR_URL||'').trim();
  if(!/^https:\/\//i.test(upstream))return json(res,503,{error:'upstream_not_configured'});
  let response;
  try{
    response=await fetch(upstream,{method:'GET',headers:{accept:'application/json','user-agent':'MERIDIAN-Asset-Watch-Encrypted-Relay/2.0'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  }catch{return json(res,502,{error:'upstream_unreachable'})}
  if(!response.ok)return json(res,502,{error:'upstream_http_error',status:response.status});
  let envelope;
  try{envelope=await response.json()}catch{return json(res,502,{error:'upstream_invalid_json'})}
  const validation=validateAssetWatchMirrorEnvelope(envelope);
  if(!validation.ok)return json(res,503,{error:'strict_live_unavailable',reason:validation.reason});
  return json(res,200,envelope);
}
export {timingSafeToken};
