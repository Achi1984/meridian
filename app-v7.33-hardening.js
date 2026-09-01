(function(){
  'use strict';

  const VERSION='7.39';
  const BUILD='7.39-20260901-R1';
  const API=window.MERIDIAN_CLOUD_API||'https://p01--achi-meridian--ttvk44grdlp7.code.run';
  const TOKEN_KEY='meridian_read_token_v1';
  const PROTECTED=[
    '/api/status','/api/paper','/api/events','/api/signals','/api/evidence',
    '/api/shadow-v1','/api/challenger-v2','/api/regime-v1','/api/backtests','/api/activity-summary','/api/private/'
  ];
  let activitySummary=null;
  let privateState='UNKNOWN';

  function readToken(){try{return localStorage.getItem(TOKEN_KEY)||''}catch(_e){return ''}}
  function isProtectedPath(path){return PROTECTED.some(p=>path===p||path.startsWith(p.endsWith('/')?p:p+'/'))}
  function isMeridianApi(input){
    try{
      const u=new URL(typeof input==='string'?input:input?.url,location.href);
      const a=new URL(API,location.href);
      return u.origin===a.origin?u:null;
    }catch(_e){return null}
  }

  const rawFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    const u=isMeridianApi(input);
    if(u&&isProtectedPath(u.pathname)){
      const token=readToken();
      if(token){
        const h=new Headers(init.headers||(input instanceof Request?input.headers:undefined)||{});
        if(!h.has('authorization'))h.set('authorization','Bearer '+token);
        init={...init,headers:h};
      }
    }
    const r=await rawFetch(input,init);
    if(u&&r.status===401){privateState='LOCKED';setTimeout(renderUnlock,0)}
    return r;
  };

  function stamp(){
    try{
      window.MERIDIAN_RELEASE_VERSION=VERSION;
      window.MERIDIAN_RELEASE_BUILD=BUILD;
      window.MERIDIAN_UI_VERSION=VERSION;
      window.__MERIDIAN_BUILD__=BUILD;
      try{if(typeof APP_CODE_VERSION!=='undefined')APP_CODE_VERSION=VERSION}catch(_e){}
      try{if(typeof APP_RELEASE!=='undefined')APP_RELEASE=VERSION+' · HARDENED CLOUD'}catch(_e){}
      const meta=document.querySelector('meta[name="meridian-build"]');
      if(meta)meta.content=BUILD;
      const manifest=document.querySelector('link[rel="manifest"]');
      if(manifest)manifest.href='manifest.webmanifest?v=7.39-R1';
      const badge=document.getElementById('versionBadge');
      if(badge)badge.textContent='v'+VERSION+' · LIVE';
    }catch(_e){}
  }

  function renderUnlock(){
    if(!document.body)return;
    const token=readToken();
    let el=document.getElementById('v733-private-unlock');
    if(token&&privateState==='OK'){el?.remove();return}
    if(!el){
      el=document.createElement('div');
      el.id='v733-private-unlock';
      el.innerHTML='<div><b>PRIVATE DATA LOCKED</b><span>Depot, Paper-Ledger und Research sind geschützt.</span></div><button type="button">UNLOCK</button>';
      el.querySelector('button').onclick=()=>window.meridianConfigureReadToken();
      document.body.appendChild(el);
    }
    el.dataset.state=token?'VERIFY':'LOCKED';
  }

  window.meridianConfigureReadToken=async function(){
    const current=readToken();
    const v=prompt('MERIDIAN READ TOKEN',current?'Token ist gespeichert. Neuen Token eingeben oder Abbrechen.':'');
    if(v==null)return false;
    const token=String(v).trim();
    try{
      if(token)localStorage.setItem(TOKEN_KEY,token);else localStorage.removeItem(TOKEN_KEY);
    }catch(_e){}
    await refreshPrivate();
    return privateState==='OK';
  };
  window.meridianClearReadToken=function(){
    try{localStorage.removeItem(TOKEN_KEY)}catch(_e){}
    privateState='LOCKED';renderUnlock();
  };

  async function refreshPrivateDashboard(){
    if(!readToken())return false;
    const r=await fetch(API+'/api/private/dashboard',{cache:'no-store'});
    if(!r.ok)throw new Error('PRIVATE DASHBOARD HTTP '+r.status);
    const j=await r.json();
    const d=j?.data;
    if(!d||typeof d!=='object')throw new Error('PRIVATE DASHBOARD INVALID');
    try{
      if(typeof DATA!=='undefined'&&DATA&&typeof DATA==='object'){
        Object.keys(d).forEach(k=>{DATA[k]=d[k]});
        DATA.appVersion=VERSION;
        if(typeof renderAll==='function')renderAll();
      }
    }catch(e){console.warn('MERIDIAN v7.33 private merge',e)}
    return true;
  }

  async function refreshActivitySummary(){
    if(!readToken())return false;
    const r=await fetch(API+'/api/activity-summary',{cache:'no-store'});
    if(!r.ok)throw new Error('ACTIVITY SUMMARY HTTP '+r.status);
    activitySummary=await r.json();
    window.MERIDIAN_ACTIVITY_SUMMARY=activitySummary;
    if(activitySummary?.coverageComplete)document.body?.setAttribute('data-v733-activity-ready','true');
    return true;
  }

  async function refreshPrivate(){
    if(!readToken()){privateState='LOCKED';renderUnlock();return}
    try{
      const [a,b]=await Promise.allSettled([refreshPrivateDashboard(),refreshActivitySummary()]);
      const ok=a.status==='fulfilled';
      privateState=ok?'OK':'ERROR';
      if(!ok)console.warn('MERIDIAN v7.33 private data',a.reason);
      if(b.status==='rejected')console.warn('MERIDIAN v7.33 activity summary',b.reason);
    }catch(e){privateState='ERROR';console.warn('MERIDIAN v7.33 refresh',e)}
    renderUnlock();
    try{
      if(document.body?.dataset?.view==='paper'&&typeof renderOne==='function')renderOne('paper');
    }catch(_e){}
  }

  const nf=(v,d=1)=>Number.isFinite(Number(v))?Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  function risk(retention,baseClosed,days,coverage){
    if(!coverage)return ['COVERAGE LIMITED','muted'];
    if(!Number.isFinite(retention)||baseClosed<20||days<7)return ['SAMPLE LOW','muted'];
    if(retention<60)return ['HIGH','red'];
    if(retention<80)return ['WATCH','amber'];
    return ['OK','green'];
  }
  function activityPanel(){
    const s=activitySummary;
    if(!s)return '<div class="v731-section v733-activity"><div class="v731-title"><b>ACTIVITY / OPPORTUNITY COST</b><span>v7.33 · LOCKED</span></div><div class="v732-note">Server-Aggregate werden nach Unlock geladen.</div></div>';
    const w=s.commonWindow;
    if(!s.coverageComplete||!w||!w.ledgers){
      return '<div class="v731-section v733-activity"><div class="v731-title"><b>ACTIVITY / OPPORTUNITY COST</b><span>v7.33 · COVERAGE LIMITED</span></div><div class="v732-note">Keine Overfilter-Wertung ohne vollständige Server-Coverage.</div></div>';
    }
    const b=w.ledgers.baseline||{}, sh=w.ledgers.shadow||{}, ch=w.ledgers.challenger||{}, rg=w.ledgers.regime||{};
    const days=Math.max(Number(w.days)||0,1/24);
    const baseClosed=Number(b.closed)||0;
    const row=(name,x,key)=>{
      const closed=Number(x.closed)||0, open=Math.max(0,(Number(x.opened)||0)-closed);
      const ret=key==='baseline'?100:(baseClosed?closed/baseClosed*100:NaN);
      const [lab,cls]=key==='baseline'?['REFERENCE','cyan']:risk(ret,baseClosed,days,s.coverageComplete);
      const lost=key==='baseline'?0:(Number.isFinite(ret)?Math.max(0,100-ret):NaN);
      return `<div class="v732-row ${key}">
        <div class="v732-bot"><b>${name}</b><small>${key==='baseline'?'FROZEN 6.2':'RESEARCH LEDGER'}</small></div>
        <div><span>CLOSED</span><b>${closed}</b><small>OPEN ≈ ${open}</small></div>
        <div><span>TR / DAY</span><b>${nf(closed/days,2)}</b><small>${days>=7?(Number(x.closed7d)||0)+' / 7D':'7D —'}</small></div>
        <div><span>ACTIVE DAYS</span><b>${Number(x.activeDays)||0}</b><small>${key==='baseline'?'REFERENCE':(closed-baseClosed>=0?'+':'')+(closed-baseClosed)+' TR'}</small></div>
        <div><span>RETENTION</span><b class="${cls}">${Number.isFinite(ret)?nf(ret,0)+'%':'—'}</b><small>${key==='baseline'?'BASE':nf((closed-baseClosed)/days,2)+' TR/D'}</small></div>
        <div><span>OVERFILTER</span><b class="${cls}">${lab}</b><small>${key==='baseline'?'—':Number.isFinite(lost)?nf(lost,0)+'% LOST':'—'}</small></div>
      </div>`;
    };
    const start=new Date(w.start).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
    const end=new Date(w.end).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
    return `<div class="v731-section v733-activity">
      <div class="v731-title"><b>ACTIVITY / OPPORTUNITY COST</b><span>v7.33 · SERVER AGGREGATE</span></div>
      <div class="v732-window"><div><span>COMMON WINDOW</span><b>${nf(days,1)} DAYS</b></div><small>${start} → ${end} · FULL EVENT HISTORY</small></div>
      <div class="v732-head"><span>BOT</span><span>CLOSED</span><span>FREQUENCY</span><span>ACTIVITY</span><span>RETENTION</span><span>RISK</span></div>
      ${row('BASELINE 6.2',b,'baseline')}
      ${row('SHADOW V1',sh,'shadow')}
      ${row('CHALLENGER V2',ch,'challenger')}
      ${row('REGIME V1',rg,'regime')}
      <div class="v732-note">v7.33 nutzt serverseitige Vollhistorie statt des alten 500-Event-Fensters. Overfilter bleibt rein diagnostisch und verändert keine Execution.</div>
    </div>`;
  }

  function installCompare(){
    const current=window.cloudPaperTradeView;
    if(typeof current!=='function'||current.__v733Wrapped)return;
    const raw=current;
    const wrapped=function(){
      let html=raw.apply(this,arguments);
      try{
        const active=typeof window.meridianPaperBotTab==='function'?window.meridianPaperBotTab():window.MERIDIAN_PAPER_BOT_TAB;
        if(active==='compare'){
          const block=activityPanel();
          const marker='<div class="v731-section v732-activity">';
          const i=html.indexOf(marker);
          if(i>=0)html=html.slice(0,i)+block+html.slice(i);
          else html+=block;
        }
      }catch(e){console.warn('MERIDIAN v7.33 compare',e)}
      return html;
    };
    wrapped.__v733Wrapped=true;
    wrapped.__v733Raw=raw;
    window.cloudPaperTradeView=wrapped;
    try{cloudPaperTradeView=wrapped}catch(_e){}
  }

  stamp();
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{stamp();renderUnlock();installCompare();refreshPrivate()},{once:true});
  }else{
    renderUnlock();installCompare();refreshPrivate();
  }
  addEventListener('pageshow',()=>{stamp();installCompare();refreshPrivate()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){stamp();installCompare();refreshPrivate()}});
  setInterval(stamp,5000);
  setInterval(installCompare,1000);
  setInterval(()=>{if(!document.hidden&&readToken())refreshActivitySummary().catch(()=>{})},60000);
})();
