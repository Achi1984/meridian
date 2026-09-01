(function(){
  'use strict';

  const VERSION='7.32';
  const BUILD='7.32-20260901-R1';
  const API=window.MERIDIAN_CLOUD_API||'https://p01--achi-meridian--ttvk44grdlp7.code.run';
  const DAY=86400000;
  const TYPES={
    baseline:{open:'POSITION_OPENED',closed:'POSITION_CLOSED'},
    shadow:{open:'SHADOW_V1_POSITION_OPENED',closed:'SHADOW_V1_POSITION_CLOSED'},
    challenger:{open:'CHALLENGER_V2_POSITION_OPENED',closed:'CHALLENGER_V2_POSITION_CLOSED'}
  };

  const activity=window.MERIDIAN_V732_ACTIVITY||{
    events:[],
    loadedAt:0,
    fetching:false,
    error:null,
    coverageLimited:false
  };
  window.MERIDIAN_V732_ACTIVITY=activity;

  function n(v,f=0){const x=Number(v);return Number.isFinite(x)?x:f}
  function ts(v){
    if(v==null)return NaN;
    const x=typeof v==='number'?v:Date.parse(v);
    return Number.isFinite(x)?x:NaN;
  }
  function esc(v){
    return String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  }
  function fmt(v,d=1){
    const x=Number(v);
    if(!Number.isFinite(x))return '—';
    return x.toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
  }
  function signed(v,d=2,suffix=''){
    const x=Number(v);
    if(!Number.isFinite(x))return '—';
    return `${x>0?'+':x<0?'−':''}${fmt(Math.abs(x),d)}${suffix}`;
  }
  function pct(v){
    const x=Number(v);
    return Number.isFinite(x)?`${fmt(x,0)}%`:'—';
  }
  function shortDate(v){
    const x=ts(v);
    if(!Number.isFinite(x))return '—';
    return new Date(x).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
  }
  function eventTs(e){
    return ts(e?.created_at||e?.createdAt||e?.payload?.closedAt||e?.payload?.openedAt||e?.ts);
  }
  function relevant(e,key,which){
    return String(e?.type||'')===TYPES[key][which];
  }
  function eventSet(key,which,start,end){
    return (activity.events||[]).filter(e=>{
      const t=eventTs(e);
      return relevant(e,key,which)&&Number.isFinite(t)&&t>=start&&t<=end;
    });
  }
  function startFor(key){
    const xs=(activity.events||[]).filter(e=>relevant(e,key,'open')||relevant(e,key,'closed')).map(eventTs).filter(Number.isFinite);
    return xs.length?Math.min(...xs):NaN;
  }
  function statusOpen(C,key){
    const s=key==='baseline'?(C.paper||{}):key==='shadow'?(C.shadow||{}):(C.challenger||{});
    if(Number.isFinite(Number(s.openCount)))return Number(s.openCount);
    const xs=Array.isArray(s.openPositions)?s.openPositions:Array.isArray(s.positions)?s.positions:[];
    return xs.filter(x=>!x?.status||String(x.status).toUpperCase()==='OPEN').length;
  }
  function latestMarker(C,key){
    if(key==='baseline'){
      return ts(C?.signals?.updatedAt||C?.status?.engine?.lastSignalScanAt||C?.paper?.updatedAt);
    }
    const s=key==='shadow'?(C.shadow||{}):(C.challenger||{});
    return ts(s.lastScanAt||s.updatedAt);
  }
  function statsFor(C,key,start,end){
    const closed=eventSet(key,'closed',start,end);
    const opened=eventSet(key,'open',start,end);
    const span=Math.max((end-start)/DAY,1/24);
    const activeDays=new Set([...closed,...opened].map(e=>{
      const t=eventTs(e);
      return Number.isFinite(t)?new Date(t).toISOString().slice(0,10):null;
    }).filter(Boolean)).size;
    const last7Start=Math.max(start,end-7*DAY);
    const trades7d=span>=7?closed.filter(e=>eventTs(e)>=last7Start).length:null;
    return {
      closed:closed.length,
      open:statusOpen(C,key),
      activeDays,
      tpd:closed.length/span,
      trades7d
    };
  }
  function riskFor(retention,baseClosed,spanDays){
    // Diagnostic maturity reuses MERIDIAN's existing 20-trade review scale and a full 7-day rate window.
    if(!Number.isFinite(retention)||baseClosed<20||spanDays<7)return {label:'SAMPLE LOW',cls:'muted'};
    if(retention<60)return {label:'HIGH',cls:'red'};
    if(retention<80)return {label:'WATCH',cls:'amber'};
    return {label:'OK',cls:'green'};
  }
  function row(name,key,z,base){
    const retention=key==='baseline'?100:(base.closed>0?100*z.closed/base.closed:NaN);
    const risk=key==='baseline'?{label:'REFERENCE',cls:'cyan'}:riskFor(retention,base.closed,base.spanDays);
    const deltaTrades=key==='baseline'?0:z.closed-base.closed;
    const deltaTpd=key==='baseline'?0:z.tpd-base.tpd;
    const missed=key==='baseline'?0:(Number.isFinite(retention)?Math.max(0,100-retention):NaN);
    return `<div class="v732-row ${key}">
      <div class="v732-bot"><b>${name}</b><small>${key==='baseline'?'FROZEN 6.2':'RESEARCH LEDGER'}</small></div>
      <div><span>CLOSED</span><b>${z.closed}</b><small>OPEN ${z.open}</small></div>
      <div><span>TR / DAY</span><b>${fmt(z.tpd,2)}</b><small>${z.trades7d==null?'7D —':`${z.trades7d} / 7D`}</small></div>
      <div><span>ACTIVE DAYS</span><b>${z.activeDays}</b><small>${key==='baseline'?'REFERENCE':`${signed(deltaTrades,0)} TR`}</small></div>
      <div><span>RETENTION</span><b class="${risk.cls}">${key==='baseline'?'100%':pct(retention)}</b><small>${key==='baseline'?'BASE':`${signed(deltaTpd,2)} TR/D`}</small></div>
      <div><span>OVERFILTER</span><b class="${risk.cls}">${risk.label}</b><small>${key==='baseline'?'—':`${pct(missed)} LOST`}</small></div>
    </div>`;
  }
  function cfBlock(C){
    const cf=C?.challenger?.counterfactual||{};
    const recent=Array.isArray(cf.recent)?cf.recent.filter(x=>Number.isFinite(Number(x?.outcomeR))):[];
    const closed=n(cf.closed);
    const complete=closed>0&&recent.length===closed;
    let rHtml='<div class="v732-rline"><span>R SUM</span><b class="muted">UNAVAILABLE · BACKEND AGGREGATE MISSING</b></div>';
    if(complete){
      const vals=recent.map(x=>Number(x.outcomeR));
      const pos=vals.filter(x=>x>0).reduce((a,b)=>a+b,0);
      const neg=Math.abs(vals.filter(x=>x<0).reduce((a,b)=>a+b,0));
      const net=vals.reduce((a,b)=>a+b,0);
      rHtml=`<div class="v732-rsum">
        <div><span>SACRIFICED +R</span><b class="red">${fmt(pos,2)}R</b></div>
        <div><span>AVOIDED −R</span><b class="green">${fmt(neg,2)}R</b></div>
        <div><span>NET CLOSED R</span><b class="${net>0?'red':net<0?'green':'muted'}">${signed(net,2,'R')}</b></div>
      </div>`;
    }
    return `<div class="v732-cf">
      <div class="v732-cfcol"><span>SHADOW CF COVERAGE</span><b class="muted">NOT AVAILABLE</b><small>LEGACY V1 EXPERIMENT · NO PERSISTENT COUNTERFACTUAL LEDGER</small></div>
      <div class="v732-cfcol"><span>CHALLENGER CF COVERAGE</span><b>${n(cf.closed)}/${n(cf.tracked)} CLOSED</b><small>${n(cf.positiveR)} POSITIVE R · ${n(cf.negativeR)} NEGATIVE R · ${n(cf.open)} OPEN</small></div>
      ${rHtml}
    </div>`;
  }
  function panel(){
    const C=window.MERIDIAN_CLOUD||{};
    if(activity.fetching&&!activity.loadedAt){
      return `<div class="v731-section v732-activity"><div class="v731-title"><b>ACTIVITY / OPPORTUNITY COST</b><span>v7.32 · SYNCING</span></div><div class="v732-note">Lade gemeinsame Forward-Test-Aktivität …</div></div>`;
    }
    if(activity.error&&!activity.loadedAt){
      return `<div class="v731-section v732-activity"><div class="v731-title"><b>ACTIVITY / OPPORTUNITY COST</b><span>v7.32 · DATA ERROR</span></div><div class="v732-note red">${esc(activity.error)}</div></div>`;
    }

    const starts={
      baseline:startFor('baseline'),
      shadow:startFor('shadow'),
      challenger:startFor('challenger')
    };
    const validStarts=Object.values(starts).filter(Number.isFinite);
    const totals={
      baseline:n(C?.paper?.closedCount ?? C?.paper?.trades?.length),
      shadow:n(C?.shadow?.closedCount),
      challenger:n(C?.challenger?.closedCount)
    };
    if(validStarts.length<3){
      return `<div class="v731-section v732-activity">
        <div class="v731-title"><b>ACTIVITY / OPPORTUNITY COST</b><span>v7.32 · COLLECTING</span></div>
        <div class="v732-window"><div><span>COMMON WINDOW</span><b>START NOCH NICHT FÜR ALLE LEDGER BEOBACHTET</b></div><small>BASE ${totals.baseline} · SHADOW ${totals.shadow} · CHALLENGER ${totals.challenger} CLOSED TOTAL</small></div>
        ${cfBlock(C)}
        <div class="v732-note">Retention wird erst berechnet, wenn für Baseline, Shadow und Challenger ein beobachtbarer Start im Event-Ledger vorhanden ist. Keine Schätzung aus unterschiedlichen Gesamtzeiträumen.</div>
      </div>`;
    }

    const start=Math.max(starts.baseline,starts.shadow,starts.challenger);
    const now=Date.now();
    const markers=['baseline','shadow','challenger'].map(k=>latestMarker(C,k)).filter(x=>Number.isFinite(x)&&x>start);
    const end=Math.min(now,...markers);
    if(!(end>start)){
      return `<div class="v731-section v732-activity"><div class="v731-title"><b>ACTIVITY / OPPORTUNITY COST</b><span>v7.32 · SAMPLE LOW</span></div><div class="v732-note">Gemeinsames Zeitfenster ist noch nicht lang genug.</div>${cfBlock(C)}</div>`;
    }

    const spanDays=(end-start)/DAY;
    const base={...statsFor(C,'baseline',start,end),spanDays};
    const shadow={...statsFor(C,'shadow',start,end),spanDays};
    const challenger={...statsFor(C,'challenger',start,end),spanDays};
    const limited=activity.coverageLimited?' · EVENT LIMIT 500':'';

    return `<div class="v731-section v732-activity">
      <div class="v731-title"><b>ACTIVITY / OPPORTUNITY COST</b><span>v7.32 · DIAGNOSTIC ONLY</span></div>
      <div class="v732-window">
        <div><span>COMMON WINDOW</span><b>${fmt(spanDays,1)} DAYS</b></div>
        <small>${shortDate(start)} → ${shortDate(end)} · max(ledger starts) → latest common data${limited}</small>
      </div>
      <div class="v732-head"><span>BOT</span><span>CLOSED</span><span>FREQUENCY</span><span>ACTIVITY</span><span>RETENTION</span><span>RISK</span></div>
      ${row('BASELINE 6.2','baseline',base,base)}
      ${row('SHADOW V1','shadow',shadow,base)}
      ${row('CHALLENGER V2','challenger',challenger,base)}
      ${cfBlock(C)}
      <div class="v732-note">Retention = Closed Trades im identischen Common Window ÷ Baseline Closed Trades. OVERFILTER ist rein diagnostisch: SAMPLE LOW bis Baseline ≥20 Trades im gemeinsamen Fenster und ≥7 Tage Beobachtungszeit; danach ≥80% OK, 60–79% WATCH, &lt;60% HIGH. Diese Labels verändern keine Entry-, Risk-, Sizing- oder Exit-Logik.</div>
    </div>`;
  }

  function stamp(){
    try{
      window.MERIDIAN_RELEASE_VERSION=VERSION;
      window.MERIDIAN_RELEASE_BUILD=BUILD;
      window.MERIDIAN_UI_VERSION=VERSION;
      window.__MERIDIAN_BUILD__=BUILD;
      try{if(typeof APP_CODE_VERSION!=='undefined')APP_CODE_VERSION=VERSION}catch(_e){}
      try{if(typeof APP_RELEASE!=='undefined')APP_RELEASE=VERSION+' · CLOUD PAPER COCKPIT'}catch(_e){}
      const meta=document.querySelector('meta[name="meridian-build"]');
      if(meta)meta.setAttribute('content',BUILD);
      const manifest=document.querySelector('link[rel="manifest"]');
      if(manifest)manifest.setAttribute('href','manifest.webmanifest?v=7.32-R1');
      const badge=document.getElementById('versionBadge');
      if(badge)badge.textContent='v'+VERSION+' · LIVE';
      document.querySelectorAll('[data-ui-version]').forEach(el=>el.textContent=VERSION);
      document.querySelectorAll('.eyebrow,.paper-version,.ui-version').forEach(el=>{
        const t=el.textContent||'';
        if(/UI\s+[0-9.]+/.test(t))el.textContent=t.replace(/UI\s+[0-9.]+/,'UI '+VERSION);
      });
    }catch(_e){}
  }

  async function refreshActivity(){
    if(activity.fetching)return;
    activity.fetching=true;
    try{
      const r=await fetch(API+'/api/events?limit=500',{cache:'no-store'});
      if(!r.ok)throw new Error('EVENT API HTTP '+r.status);
      const j=await r.json();
      const xs=Array.isArray(j)?j:Array.isArray(j?.events)?j.events:Array.isArray(j?.items)?j.items:[];
      activity.events=xs;
      activity.loadedAt=Date.now();
      activity.error=null;
      activity.coverageLimited=xs.length>=500;
    }catch(e){
      activity.error=String(e?.message||e||'Activity data unavailable');
    }finally{
      activity.fetching=false;
    }
    try{
      const active=typeof window.meridianPaperBotTab==='function'?window.meridianPaperBotTab():window.MERIDIAN_PAPER_BOT_TAB;
      if(active==='compare'&&document.body?.dataset?.view==='paper'&&typeof window.renderOne==='function'){
        setTimeout(()=>window.renderOne('paper'),30);
      }
    }catch(_e){}
  }

  function install(){
    const current=window.cloudPaperTradeView;
    if(typeof current!=='function'||current.__v732Wrapped)return;
    const raw=current;
    const wrapped=function(){
      let html=raw.apply(this,arguments);
      try{
        const active=typeof window.meridianPaperBotTab==='function'?window.meridianPaperBotTab():window.MERIDIAN_PAPER_BOT_TAB;
        if(active!=='compare')return html;
        const block=panel();
        const marker='<div class="v731-section"><div class="v731-title"><b>RESEARCH COVERAGE</b><span>OPPORTUNITY COST</span></div>';
        html=html.includes(marker)?html.replace(marker,block+marker):html+block;
      }catch(e){console.warn('MERIDIAN v7.32 activity render',e)}
      return html;
    };
    wrapped.__v732Wrapped=true;
    wrapped.__v732Raw=raw;
    window.cloudPaperTradeView=wrapped;
    try{cloudPaperTradeView=wrapped}catch(_e){}
  }

  stamp();
  install();
  refreshActivity();

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{stamp();install();setTimeout(refreshActivity,250)},{once:true});
  }else{
    setTimeout(()=>{stamp();install()},50);
  }
  window.addEventListener('pageshow',()=>{stamp();install();setTimeout(refreshActivity,150)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){stamp();install();refreshActivity()}});
  setInterval(stamp,5000);
  setInterval(install,1000);
  setInterval(refreshActivity,60000);
})();
