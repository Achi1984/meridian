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
  function dataReady(){try{return typeof DATA!=='undefined'&&DATA&&typeof DATA==='object'}catch(_e){return false}}
  function hasPrivatePortfolio(d){return !!(d&&d.portfolio&&Array.isArray(d.portfolio.holdings)&&d.portfolio.holdings.length)}

  function recoverUi(){
    try{
      document.getElementById('v760-emergency-hit-layer')?.remove();
      document.getElementById('v760-emergency-unlock-hit')?.remove();
      document.getElementById('v760-emergency-hit-style')?.remove();
      document.getElementById('v760-private-state')?.remove();
      document.documentElement?.removeAttribute('data-v760-nav-hotfix');
      let s=document.getElementById('v760-r7-recovery-style');
      if(!s){
        s=document.createElement('style');s.id='v760-r7-recovery-style';
        s.textContent=`
          #v733-private-unlock{bottom:calc(108px + env(safe-area-inset-bottom))!important;z-index:80!important;pointer-events:auto!important}
          #v733-private-unlock button{pointer-events:auto!important;touch-action:manipulation!important}
          .bottom{z-index:120!important;pointer-events:auto!important}
          .bottom .inner,.bottom .nav{pointer-events:auto!important}
        `;
        document.head.appendChild(s);
      }
      document.querySelectorAll('.app,.bottom').forEach(el=>{el.style.removeProperty('display');el.style.removeProperty('visibility');el.style.removeProperty('opacity')});
    }catch(_e){}
  }

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
    STATE.status='HYDRATED';STATE.lastError=null;STATE.hydratedAt=new Date().toISOString();
    try{if(typeof recalcPortfolio==='function')recalcPortfolio()}catch(_e){}
    try{if(typeof renderAll==='function')renderAll()}catch(_e){}
    recoverUi();
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
    recoverUi();
    const t=token();
    if(!t){
      STATE.status='LOCKED';STATE.lastError='READ TOKEN fehlt';
      renderDepotError('Private Daten sind gesperrt. Bitte MERIDIAN READ TOKEN entsperren.');
      return false;
    }
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      STATE.status='FETCHING';
      const r=await fetch(API+'/api/private/dashboard',{cache:'no-store',headers:{accept:'application/json',authorization:'Bearer '+t}});
      if(!r.ok)throw new Error('PRIVATE DASHBOARD HTTP '+r.status);
      const j=await r.json(),d=j?.data;
      if(!d||typeof d!=='object')throw new Error('PRIVATE DASHBOARD INVALID');
      cachedPrivate=d;
      await mergeWhenReady(d);
      return true;
    })().catch(e=>{
      STATE.status='ERROR';STATE.lastError=String(e?.message||e);
      console.warn('MERIDIAN private hydration hotfix',e);
      renderDepotError(STATE.lastError);recoverUi();return false;
    }).finally(()=>{inFlight=null});
    return inFlight;
  }

  function rehydrate(){recoverUi();if(cachedPrivate&&dataReady()){try{mergePrivate(cachedPrivate);return}catch(_e){}}fetchPrivate()}

  window.meridianRefreshPrivateDashboard=fetchPrivate;
  window.meridianPrivateHydrationState=()=>({...STATE,hasCachedPrivate:!!cachedPrivate,hasPrivatePortfolio:hasPrivatePortfolio(cachedPrivate)});

  recoverUi();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{recoverUi();setTimeout(rehydrate,0)},{once:true});
  else setTimeout(rehydrate,0);
  addEventListener('load',()=>{recoverUi();setTimeout(rehydrate,120)});
  addEventListener('pageshow',()=>{recoverUi();setTimeout(rehydrate,120)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){recoverUi();setTimeout(rehydrate,120)}});
  setTimeout(()=>{recoverUi();if(cachedPrivate)mergePrivate(cachedPrivate);else fetchPrivate()},1200);
  setTimeout(()=>{recoverUi();if(cachedPrivate)mergePrivate(cachedPrivate)},3000);
})();
