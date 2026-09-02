(function(){
  'use strict';

  const TOKEN_KEY='meridian_read_token_v1';
  const STATE=window.MERIDIAN_UNLOCK_HOTFIX||(window.MERIDIAN_UNLOCK_HOTFIX={status:'IDLE',lastError:null,updatedAt:null});

  function token(){try{return String(localStorage.getItem(TOKEN_KEY)||'').trim()}catch(_e){return ''}}
  function activeView(){return String(document.body?.dataset?.view||'')}
  function isDepot(){return ['portfolio','depot'].includes(activeView())}

  function style(){
    if(document.getElementById('v760-unlock-hotfix-style'))return;
    const s=document.createElement('style');
    s.id='v760-unlock-hotfix-style';
    s.textContent=`
      #v733-private-unlock{bottom:calc(98px + env(safe-area-inset-bottom))!important;z-index:70!important;pointer-events:none!important}
      #v733-private-unlock button{pointer-events:auto!important;position:relative!important;z-index:2!important;touch-action:manipulation!important}
      .bottom{z-index:120!important}
      #v760-private-state{position:fixed;left:50%;bottom:calc(154px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:65;width:min(92vw,560px);padding:9px 11px;border:1px solid rgba(232,178,74,.42);border-radius:12px;background:rgba(5,14,22,.96);font:800 8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8fa4b5;pointer-events:none}
      #v760-private-state b{color:#f0b84b;letter-spacing:.08em}
      #v760-private-state.ok{border-color:rgba(47,210,133,.42)}
      #v760-private-state.ok b{color:#2fd285}
      @media(max-width:520px){#v760-private-state{width:calc(100vw - 18px);bottom:calc(148px + env(safe-area-inset-bottom))}}
    `;
    document.head.appendChild(s);
  }

  function setState(status,message){
    STATE.status=status;STATE.lastError=status==='ERROR'?String(message||''):null;STATE.updatedAt=new Date().toISOString();
    let el=document.getElementById('v760-private-state');
    const needs=status!=='OK'&&isDepot();
    if(!needs){el?.remove();return}
    if(!el){el=document.createElement('div');el.id='v760-private-state';document.body.appendChild(el)}
    const title=status==='LOCKED'?'DEPOT GESPERRT':status==='VERIFYING'?'DEPOT WIRD ENTSPERRT':status==='ERROR'?'UNLOCK FEHLGESCHLAGEN':'PRIVATE DATA';
    el.className=status==='OK'?'ok':'';
    el.innerHTML=`<b>${title}</b><br>${String(message||'UNLOCK antippen und den MERIDIAN Read-Passcode eingeben.')}`;
  }

  async function runUnlock(){
    if(typeof window.meridianConfigureReadToken!=='function'){
      setState('ERROR','Unlock-Funktion noch nicht geladen. App neu laden.');
      return false;
    }
    setState('VERIFYING','Passcode eingeben; danach werden die privaten Depotdaten direkt neu geladen.');
    let ok=false;
    try{
      ok=await window.meridianConfigureReadToken();
      if(ok&&typeof window.meridianRefreshPrivateDashboard==='function')ok=await window.meridianRefreshPrivateDashboard();
    }catch(e){STATE.lastError=String(e?.message||e);ok=false}
    if(ok){
      setState('OK','Private Daten geladen.');
      document.getElementById('v733-private-unlock')?.remove();
      try{if(typeof window.renderOne==='function')window.renderOne(activeView()||'portfolio');else if(typeof renderOne==='function')renderOne(activeView()||'portfolio')}catch(_e){}
      return true;
    }
    setState('ERROR',token()?'Passcode wurde vom Backend nicht akzeptiert oder Backend ist nicht erreichbar.':'Kein Passcode gespeichert. UNLOCK erneut antippen.');
    return false;
  }

  function bindUnlock(){
    const el=document.getElementById('v733-private-unlock');
    const btn=el?.querySelector('button');
    if(!btn||btn.dataset.v760Unlock==='1')return;
    btn.dataset.v760Unlock='1';
    const handler=ev=>{ev.preventDefault();ev.stopPropagation();runUnlock()};
    btn.addEventListener('click',handler,true);
    btn.addEventListener('touchend',handler,{capture:true,passive:false});
  }

  function reflect(){
    style();bindUnlock();
    if(token()){
      const hs=window.meridianPrivateHydrationState?.();
      if(hs?.status==='HYDRATED')setState('OK','Private Daten geladen.');
      else if(isDepot())setState('VERIFYING','Gespeicherter Passcode wird geprüft …');
    }else setState('LOCKED','UNLOCK antippen und den MERIDIAN Read-Passcode eingeben.');
  }

  window.meridianUnlockPrivateData=runUnlock;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reflect,{once:true});else reflect();
  addEventListener('pageshow',()=>setTimeout(reflect,80));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(reflect,80)});
  setInterval(reflect,750);
})();
