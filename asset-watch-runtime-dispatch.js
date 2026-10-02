const DEFAULT_REPO='Achi1984/meridian';
const DEFAULT_WORKFLOW='asset-watch-mirror.yml';
let lastDispatchAt=0;

function configured(env={}){
  const token=String(env.MERIDIAN_GITHUB_ASSET_WATCH_TOKEN||'').trim();
  return {token,ok:!!token};
}

export async function dispatchAssetWatchMirror({
  env=process.env,fetchImpl=fetch,now=Date.now,minimumIntervalMs=4*60*1000
}={}){
  const cfg=configured(env);
  if(!cfg.ok)return {ok:false,reason:'missing_dispatch_token',configured:false};
  const t=Number(now());
  if(Number.isFinite(t)&&lastDispatchAt&&t-lastDispatchAt<minimumIntervalMs)
    return {ok:true,reason:'rate_limited',configured:true,dispatched:false};
  const repo=String(env.MERIDIAN_GITHUB_REPOSITORY||DEFAULT_REPO).trim();
  const workflow=String(env.MERIDIAN_ASSET_WATCH_WORKFLOW||DEFAULT_WORKFLOW).trim();
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))return {ok:false,reason:'invalid_repository',configured:true};
  if(!/^[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow))return {ok:false,reason:'invalid_workflow',configured:true};
  try{
    const r=await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,{
      method:'POST',
      headers:{
        accept:'application/vnd.github+json',
        authorization:`Bearer ${cfg.token}`,
        'x-github-api-version':'2022-11-28',
        'content-type':'application/json',
        'user-agent':'MERIDIAN-Asset-Watch-Runtime/1.0'
      },
      body:JSON.stringify({ref:'main'}),
      signal:AbortSignal.timeout(10000)
    });
    if(r.status!==204)return {ok:false,reason:`github_dispatch_http_${r.status}`,configured:true,dispatched:false};
    lastDispatchAt=Number.isFinite(t)?t:Date.now();
    return {ok:true,configured:true,dispatched:true};
  }catch(e){
    return {ok:false,reason:String(e?.name||'dispatch_error'),configured:true,dispatched:false};
  }
}

export function assetWatchDispatchConfigured(env=process.env){return configured(env).ok}
