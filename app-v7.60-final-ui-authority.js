/* MERIDIAN v7.60 R9 — final UI authority and private-data recovery.
   Presentation/data hydration only. No execution, entry, sizing, risk or exit changes. */
(function(){
  'use strict';
  const VERSION='7.60';
  const BUILD='7.60-20260902-R1';
  const TOKEN_KEY='meridian_read_token_v1';
  let refreshBusy=false;

  function token(){try{return String(localStorage.getItem(TOKEN_KEY)||'').trim()}catch(_e){return ''}}
  function data(){try{return (typeof DATA!=='undefined'&&DATA&&typeof DATA==='object')?DATA:null}catch(_e){return null}}
  function holdings(){const d=data();return Array.isArray(d?.portfolio?.holdings)?d.portfolio.holdings:[]}
  function hasPrivatePortfolio(){return holdings().length>0}

  function stamp(){
    try{
      window.MERIDIAN_RELEASE_VERSION=VERSION;
      window.MERIDIAN_RELEASE_BUILD=BUILD;
      window.MERIDIAN_UI_VERSION=VERSION;
      window.__MERIDIAN_BUILD__=BUILD;
      try{if(typeof APP_CODE_VERSION!=='undefined')APP_CODE_VERSION=VERSION}catch(_e){}
      try{if(typeof APP_RELEASE!=='undefined')APP_RELEASE=VERSION+' · CANONICAL UI'}catch(_e){}
      const badge=document.getElementById('versionBadge');if(badge)badge.textContent='v'+VERSION+' · LIVE';
      const meta=document.querySelector('meta[name="meridian-build"]');if(meta)meta.content=BUILD;
      const manifest=document.querySelector('link[rel="manifest"]');if(manifest)manifest.href='manifest.webmanifest?v=7.60-R9';
      document.querySelectorAll('[data-ui-version]').forEach(el=>el.textContent=VERSION);
    }catch(_e){}
  }

  function ensureUnlock(){
    if(!document.body)return;
    const legacy=document.getElementById('v733-private-unlock');
    if(hasPrivatePortfolio()){
      document.getElementById('v760-final-private-state')?.remove();
      legacy?.remove();
      return;
    }
    if(legacy)legacy.style.display='none';
    let el=document.getElementById('v760-final-private-state');
    if(!el){
      el=document.createElement('div');el.id='v760-final-private-state';
      el.innerHTML='<div><b>PRIVATE DEPOT</b><span>Depotdaten sind geschützt und derzeit nicht geladen.</span></div><button type="button">UNLOCK</button>';
      document.body.appendChild(el);
      el.querySelector('button').addEventListener('click',async()=>{
        const btn=el.querySelector('button');if(btn){btn.disabled=true;btn.textContent='PRÜFE…'}
        try{
          if(typeof window.meridianConfigureReadToken==='function')await window.meridianConfigureReadToken();
          if(typeof window.meridianRefreshPrivateDashboard==='function')await window.meridianRefreshPrivateDashboard();
        }catch(e){console.warn('MERIDIAN private unlock',e)}
        if(btn){btn.disabled=false;btn.textContent='UNLOCK'}
        setTimeout(()=>{stamp();ensureUnlock();decoratePaper()},80);
      });
    }
    el.dataset.mode=token()?'RETRY':'LOCKED';
    const span=el.querySelector('span');
    if(span)span.textContent=token()
      ?'Read-Passcode gespeichert · private Daten werden erneut geladen. UNLOCK öffnet die Prüfung.'
      :'UNLOCK antippen und den MERIDIAN Read-Passcode eingeben.';
  }

  async function recoverPrivate(){
    if(refreshBusy||hasPrivatePortfolio()||!token())return;
    if(typeof window.meridianRefreshPrivateDashboard!=='function')return;
    refreshBusy=true;
    try{
      const ok=await window.meridianRefreshPrivateDashboard();
      if(ok){try{if(typeof recalcPortfolio==='function')recalcPortfolio();if(typeof renderAll==='function')renderAll()}catch(_e){}}
    }catch(e){console.warn('MERIDIAN private recovery',e)}finally{refreshBusy=false;ensureUnlock()}
  }

  function replaceText(root,from,to){
    if(!root)return;
    const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const xs=[];
    while(w.nextNode())xs.push(w.currentNode);
    xs.forEach(n=>{if(n.nodeValue&&n.nodeValue.includes(from))n.nodeValue=n.nodeValue.split(from).join(to)});
  }
  function regimeCard(){
    const r=window.MERIDIAN_CLOUD?.regimeV1||{};const a=r.account||{};
    const eq=Number(a.equity||10000),start=Number(a.startEquity||10000),p=eq-start;
    const f=(v,d=2)=>Number(v||0).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
    return `<div class="v731-compare-card regime" data-v760-final-regime="1"><span>ADAPTIVE STRATEGY SELECTOR</span><h4>REGIME V1</h4><div class="line"><span>Equity</span><b>$${f(eq)}</b></div><div class="line"><span>P&L</span><b class="${p>=0?'green':'red'}">${p>=0?'+':'−'}$${f(Math.abs(p))}</b></div><div class="line"><span>Trades</span><b>${Number(r.closedCount||0)}</b></div><div class="line"><span>WR / PF</span><b>${f(r.winRate||0,1)}% / ${f(r.profitFactor||0,2)}</b></div><div class="line"><span>DD</span><b>${f(a.drawdownPct||0,2)}%</b></div><div class="line"><span>Open</span><b>${Number(r.openCount||0)}</b></div></div>`;
  }
  function v32ResearchCard(){
    return `<div class="v760-v32-card" data-v760-v32="1"><div><span>CHALLENGER V3.2</span><b>SOFT CONTEXT SCORE · RESEARCH CANDIDATE</b><small>KEINE PAPER-/LIVE-EXECUTION · SCORE EINGEFROREN</small></div><div class="v760-v32-metrics"><span><b>4/4</b><small>SIGNAL-QUALITÄT vs BASELINE</small></span><span><b>0/4</b><small>DD-VORTEIL IM PORTFOLIO-REPLAY</small></span><span><b>v7.68</b><small>NÄCHSTER RISK-SENSITIVITY TEST</small></span></div></div>`;
  }
  function decoratePaper(){
    if(document.body?.dataset?.view!=='paper')return;
    const root=document.getElementById('view-paper')||document.querySelector('[data-view-container="paper"]')||document.querySelector('main')||document.body;
    replaceText(root,'3 BOTS','4 BOTS');
    replaceText(root,'1 VERGLEICH','1 ÜBERSICHT');
    replaceText(root,'BASELINE · SHADOW · CHALLENGER','BASELINE · SHADOW · CHALLENGER · REGIME');
    replaceText(root,'A/B/C BOT VERGLEICH','A/B/C/D BOT ÜBERSICHT');
    const tabs=root.querySelector('#v731-paper-tabs');
    if(tabs){
      const c=[...tabs.querySelectorAll('button')].find(b=>(b.getAttribute('onclick')||'').includes("'compare'"));
      if(c)c.textContent='ÜBERSICHT';
      if(!root.querySelector('[data-v760-v32]'))tabs.closest('.card,.v731-section')?.insertAdjacentHTML('afterend',v32ResearchCard());
    }
    const grid=root.querySelector('.v731-compare-grid');
    if(grid&&!grid.querySelector('[data-v760-final-regime]')&&!grid.querySelector('.v731-compare-card.regime'))grid.insertAdjacentHTML('beforeend',regimeCard());
    const head=[...root.querySelectorAll('.v731-title span,.paper-version,.eyebrow')].find(x=>/RESEARCH|PAPER|VERDICT/i.test(x.textContent||''));
    if(head&&/7\.32/.test(head.textContent||''))head.textContent=(head.textContent||'').replace(/7\.32/g,'7.60');
  }

  function style(){
    let s=document.getElementById('v760-final-authority-style');
    if(!s){s=document.createElement('style');s.id='v760-final-authority-style';document.head.appendChild(s)}
    s.textContent=`
      #v760-final-private-state{position:fixed;left:50%;bottom:calc(104px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:90;width:min(92vw,560px);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid rgba(232,178,74,.72);border-radius:14px;background:rgba(5,14,22,.98);box-shadow:0 12px 34px rgba(0,0,0,.45);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      #v760-final-private-state b{display:block;color:#f0b84b;font-size:9px;letter-spacing:.09em}#v760-final-private-state span{display:block;margin-top:3px;color:#8297a8;font-size:7px;line-height:1.35}
      #v760-final-private-state button{flex:0 0 auto;border:1px solid #159bd7;border-radius:999px;background:#08202d;color:#37c5ff;padding:9px 12px;font:900 8px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;touch-action:manipulation}
      .v731-compare-card.regime{border-color:#6f5bd3!important}.v731-compare-card.regime>span{color:#a996ff!important}
      .v760-v32-card{margin:12px 0;padding:14px;border:1px solid rgba(32,164,255,.5);border-radius:18px;background:linear-gradient(145deg,rgba(7,17,26,.98),rgba(13,24,39,.98));display:grid;gap:12px}.v760-v32-card>div>span{display:block;color:#20a4ff;font-size:10px;font-weight:900;letter-spacing:1.4px}.v760-v32-card>div>b{display:block;margin-top:5px;font-size:15px}.v760-v32-card>div>small{display:block;margin-top:5px;color:#8297a8;font-size:8px;letter-spacing:.8px}.v760-v32-metrics{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.v760-v32-metrics span{border:1px solid #17354f;border-radius:12px;padding:9px;color:#f4f7fb!important}.v760-v32-metrics b{display:block;font-size:15px}.v760-v32-metrics small{display:block;margin-top:4px;color:#8297a8;font-size:7px;line-height:1.3}
      @media(max-width:520px){#v760-final-private-state{bottom:calc(98px + env(safe-area-inset-bottom));width:calc(100vw - 18px)}.v760-v32-metrics{grid-template-columns:1fr!important}}
    `;
  }

  function tick(){stamp();style();ensureUnlock();decoratePaper();recoverPrivate()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
  addEventListener('pageshow',tick);document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
  new MutationObserver(()=>{stamp();decoratePaper();ensureUnlock()}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-view']});
  setInterval(tick,1200);
})();
