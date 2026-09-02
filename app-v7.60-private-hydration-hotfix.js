(function(){
  'use strict';

  const VERSION='7.60';
  const API=window.MERIDIAN_CLOUD_API||'https://p01--achi-meridian--ttvk44grdlp7.code.run';
  const TOKEN_KEY='meridian_read_token_v1';
  const STATE=window.MERIDIAN_PRIVATE_HYDRATION||(window.MERIDIAN_PRIVATE_HYDRATION={status:'IDLE',attempts:0,lastError:null,hydratedAt:null});
  let cachedPrivate=null;
  let inFlight=null;

  function token(){try{return String(localStorage.getItem(TOKEN_KEY)||'').trim()}catch(_e){return ''}}
  function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
  function dataReady(){
    try{return typeof DATA!=='undefined'&&DATA&&typeof DATA==='object'}catch(_e){return false}
  }
  function hasPrivatePortfolio(d){return !!(d&&d.portfolio&&Array.isArray(d.portfolio.holdings)&&d.portfolio.holdings.length)}

  function renderDepotError(message){
    try{
      const host=document.getElementById('view-portfolio');
      if(!host||host.classList.contains('hidden'))return;
      host.innerHTML=`<div class="card"><div class="eyebrow red">DEPOT NICHT VERFÜGBAR</div><div class="forecast-main">PRIVATE DATEN KONNTEN NICHT GELADEN WERDEN</div><p class="footer-note">${String(message||'Authentifizierung oder Backend prüfen.')}</p><button type="button" class="tab" onclick="window.meridianConfigureReadToken&&window.meridianConfigureReadToken()">UNLOCK / TOKEN PRÜFEN</button></div>`;
    }catch(_e){}
  }

  function mergePrivate(d){
    if(!dataReady()||!d||typeof d!=='object')return false;
    Object.keys(d).forEach(k=>{DATA[k]=d[k]});
    DATA.appVersion=VERSION;
    STATE.status='HYDRATED';
    STATE.lastError=null;
    STATE.hydratedAt=new Date().toISOString();
    try{if(typeof recalcPortfolio==='function')recalcPortfolio()}catch(_e){}
    try{if(typeof renderAll==='function')renderAll()}catch(_e){}
    return true;
  }

  async function mergeWhenReady(d){
    for(let i=0;i<48;i++){
      STATE.attempts++;
      if(mergePrivate(d))return true;
      await sleep(i<8?125:250);
    }
    throw new Error('DATA bootstrap timeout');
  }

  async function fetchPrivate(){
    const t=token();
    if(!t){
      STATE.status='LOCKED';
      STATE.lastError='READ TOKEN fehlt';
      try{window.meridianConfigureReadToken&&setTimeout(()=>{},0)}catch(_e){}
      renderDepotError('Private Daten sind gesperrt. Bitte MERIDIAN READ TOKEN entsperren.');
      return false;
    }
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      STATE.status='FETCHING';
      const r=await fetch(API+'/api/private/dashboard',{
        cache:'no-store',
        headers:{accept:'application/json',authorization:'Bearer '+t}
      });
      if(!r.ok)throw new Error('PRIVATE DASHBOARD HTTP '+r.status);
      const j=await r.json();
      const d=j?.data;
      if(!d||typeof d!=='object')throw new Error('PRIVATE DASHBOARD INVALID');
      cachedPrivate=d;
      await mergeWhenReady(d);
      return true;
    })().catch(e=>{
      STATE.status='ERROR';
      STATE.lastError=String(e?.message||e);
      console.warn('MERIDIAN private hydration hotfix',e);
      renderDepotError(STATE.lastError);
      return false;
    }).finally(()=>{inFlight=null});
    return inFlight;
  }

  function rehydrate(){
    if(cachedPrivate&&dataReady()){
      try{mergePrivate(cachedPrivate);return}catch(_e){}
    }
    fetchPrivate();
  }

  window.meridianRefreshPrivateDashboard=fetchPrivate;
  window.meridianPrivateHydrationState=()=>({...STATE,hasCachedPrivate:!!cachedPrivate,hasPrivatePortfolio:hasPrivatePortfolio(cachedPrivate)});

  // v7.60-R2: private hydration must happen after the inline DATA bootstrap, not merely after DOMContentLoaded.
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(rehydrate,0),{once:true});
  else setTimeout(rehydrate,0);
  addEventListener('load',()=>setTimeout(rehydrate,120));
  addEventListener('pageshow',()=>setTimeout(rehydrate,120));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(rehydrate,120)});

  // One bounded late pass closes the race where public data.json replaces DATA after the first private merge.
  setTimeout(()=>{if(cachedPrivate)mergePrivate(cachedPrivate);else fetchPrivate()},1200);
  setTimeout(()=>{if(cachedPrivate)mergePrivate(cachedPrivate)},3000);
})();
