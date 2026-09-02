/* MERIDIAN v7.60 R8 — final UI authority and private-data recovery.
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
      const badge=document.getElementById('versionBadge');
      if(badge)badge.textContent='v'+VERSION+' · LIVE';
      const meta=document.querySelector('meta[name="meridian-build"]');if(meta)meta.content=BUILD;
      document.querySelectorAll('[data-ui-version]').forEach(el=>el.textContent=VERSION);
    }catch(_e){}
  }

  function ensureUnlock(){
    if(!document.body)return;
    if(hasPrivatePortfolio()){
      document.getElementById('v760-final-private-state')?.remove();
      return;
    }
    let el=document.getElementById('v760-final-private-state');
    if(!el){
      el=document.createElement('div');el.id='v760-final-private-state';
      el.innerHTML='<div><b>PRIVATE DEPOT</b><span>Depotdaten sind geschützt und derzeit nicht geladen.</span></div><button type="button">UNLOCK</button>';
      document.body.appendChild(el);
      el.querySelector('button').addEventListener('click',async()=>{
        try{
          if(typeof window.meridianConfigureReadToken==='function')await window.meridianConfigureReadToken();
          if(typeof window.meridianRefreshPrivateDashboard==='function')await window.meridianRefreshPrivateDashboard();
        }catch(_e){}
        setTimeout(()=>{stamp();ensureUnlock();decoratePaper()},50);
      });
    }
    el.dataset.mode=token()?'RETRY':'LOCKED';
    const span=el.querySelector('span');
    if(span)span.textContent=token()?'Gespeicherter Read-Passcode vorhanden · private Daten werden erneut geladen.':'UNLOCK antippen und den MERIDIAN Read-Passcode eingeben.';
  }

  async function recoverPrivate(){
    if(refreshBusy||hasPrivatePortfolio()||!token())return;
    if(typeof window.meridianRefreshPrivateDashboard!=='function')return;
    refreshBusy=true;
    try{
      const ok=await window.meridianRefreshPrivateDashboard();
      if(ok){try{if(typeof renderAll==='function')renderAll()}catch(_e){}}
    }catch(_e){}finally{refreshBusy=false;ensureUnlock()}
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
  function decoratePaper(){
    if(document.body?.dataset?.view!=='paper')return;
    const root=document.getElementById('view-paper')||document.querySelector('[data-view-container="paper"]')||document.querySelector('main')||document.body;
    replaceText(root,'3 BOTS','4 BOTS');
    replaceText(root,'1 VERGLEICH','1 ÜBERSICHT');
    replaceText(root,'BASELINE · SHADOW · CHALLENGER','BASELINE · SHADOW · CHALLENGER · REGIME');
    replaceText(root,'A/B/C BOT VERGLEICH','A/B/C/D BOT ÜBERSICHT');
    const tabs=root.querySelector('#v731-paper-tabs');
    if(tabs){const c=[...tabs.querySelectorAll('button')].find(b=>(b.getAttribute('onclick')||'').includes("'compare'"));if(c)c.textContent='ÜBERSICHT'}
    const grid=root.querySelector('.v731-compare-grid');
    if(grid&&!grid.querySelector('[data-v760-final-regime]')&&!grid.querySelector('.v731-compare-card.regime'))grid.insertAdjacentHTML('beforeend',regimeCard());
    const head=[...root.querySelectorAll('.v731-title span,.paper-version,.eyebrow')].find(x=>/RESEARCH|PAPER|VERDICT/i.test(x.textContent||''));
    if(head&&/7\.32/.test(head.textContent||''))head.textContent=(head.textContent||'').replace(/7\.32/g,'7.60');
  }

  function style(){
    if(document.getElementById('v760-final-authority-style'))return;
    const s=document.createElement('style');s.id='v760-final-authority-style';s.textContent=`
      #v760-final-private-state{position:fixed;left:50%;bottom:calc(104px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:90;width:min(92vw,560px);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid rgba(232,178,74,.72);border-radius:14px;background:rgba(5,14,22,.98);box-shadow:0 12px 34px rgba(0,0,0,.45);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      #v760-final-private-state b{display:block;color:#f0b84b;font-size:9px;letter-spacing:.09em}#v760-final-private-state span{display:block;margin-top:3px;color:#8297a8;font-size:7px;line-height:1.35}
      #v760-final-private-state button{flex:0 0 auto;border:1px solid #159bd7;border-radius:999px;background:#08202d;color:#37c5ff;padding:9px 12px;font:900 8px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;touch-action:manipulation}
      .v731-compare-card.regime{border-color:#6f5bd3!important}.v731-compare-card.regime>span{color:#a996ff!important}
    `;document.head.appendChild(s);
  }

  function tick(){stamp();style();ensureUnlock();decoratePaper();recoverPrivate()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick,{once:true});else tick();
  addEventListener('pageshow',tick);document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
  new MutationObserver(()=>{stamp();decoratePaper();ensureUnlock()}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-view']});
  setInterval(tick,1500);
})();
