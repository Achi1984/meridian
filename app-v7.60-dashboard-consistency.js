/* MERIDIAN v7.60 — Dashboard Consistency Fix
   UI/data-source correction only. No trading/research execution changes. */
(function(){
  'use strict';

  const VERSION='7.60-DASHBOARD-CONSISTENCY';

  function manualTradingTotal(){
    try{return (DATA?.portfolio?.manualVenueBalances||[]).reduce((s,x)=>s+(Number(x?.value)||0),0)}catch(_){return 0}
  }

  // DEPOT SSOT: manual venue/bot balances are informational trading capital and
  // must not silently inflate the spot/holdings portfolio total.
  try{
    if(typeof recalcPortfolio==='function' && !recalcPortfolio.__v760Wrapped){
      const originalRecalc=recalcPortfolio;
      const wrapped=function(){
        const p=DATA?.portfolio;
        if(!p)return originalRecalc.apply(this,arguments);
        const manual=Array.isArray(p.manualVenueBalances)?p.manualVenueBalances:[];
        const manualTotal=manual.reduce((s,x)=>s+(Number(x?.value)||0),0);
        p.manualVenueBalances=[];
        try{
          originalRecalc.apply(this,arguments);
        } finally {
          p.manualVenueBalances=manual;
        }
        p.tradingCapitalTotal=manualTotal;
        p.totalIncludingTrading=(Number(p.total)||0)+manualTotal;
        p.valuationScope='SPOT_HOLDINGS_ONLY';
        p.valuationConsistency='7.60-DEPOT-SSOT';
        return p.total;
      };
      wrapped.__v760Wrapped=true;
      wrapped.__v760Original=originalRecalc;
      recalcPortfolio=wrapped;
    }
  }catch(e){console.error('MERIDIAN v7.60 recalc wrapper',e)}

  // Preserve the most recent observation when chart points are downsampled.
  try{
    if(typeof resampleSeries==='function' && !resampleSeries.__v760Wrapped){
      const originalResample=resampleSeries;
      const wrapped=function(series,maxPts=180){
        const out=originalResample(series,maxPts);
        if(!Array.isArray(series)||!series.length||!Array.isArray(out)||!out.length)return out;
        const latest=series[series.length-1];
        const last=out[out.length-1];
        if(!last || Number(last[0])!==Number(latest[0])){
          if(out.length>=maxPts)out[out.length-1]=latest;
          else out.push(latest);
        }
        return out;
      };
      wrapped.__v760Wrapped=true;
      resampleSeries=wrapped;
    }
  }catch(e){console.error('MERIDIAN v7.60 resample wrapper',e)}

  // Primary tabs are a SPA control. Some legacy route pages (for example
  // depot.html) are historical standalone copies and must never win over the
  // live in-page renderer. Capture the tap before a legacy href can navigate.
  function installPrimaryTabGuard(){
    if(window.__MERIDIAN_V760_TAB_GUARD)return;
    window.__MERIDIAN_V760_TAB_GUARD=true;
    document.addEventListener('click',e=>{
      const nav=e.target?.closest?.('.nav[data-view]');
      if(!nav)return;
      const view=String(nav.dataset.view||'').trim();
      const target=document.getElementById('view-'+view);
      if(!view||!target||typeof openView!=='function')return;
      e.preventDefault();
      e.stopImmediatePropagation();
      try{openView(view,nav)}catch(err){console.error('MERIDIAN v7.60 tab guard',view,err)}
    },true);
  }

  function textReplace(root,from,to){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const n of nodes)if(n.nodeValue&&n.nodeValue.includes(from))n.nodeValue=n.nodeValue.split(from).join(to);
  }

  function decoratePaper(){
    const paper=document.querySelector('[data-view="paper"], #paperView, .paper-view, main');
    if(!paper)return;
    textReplace(paper,'3 BOTS','4 BOTS');
    textReplace(paper,'1 VERGLEICH','1 ÜBERSICHT');
    textReplace(paper,'BASELINE · SHADOW · CHALLENGER','BASELINE · SHADOW · CHALLENGER · REGIME');

    const titles=[...paper.querySelectorAll('.section-title,.eyebrow,h1,h2,h3,b,strong')];
    const anchor=titles.find(el=>/PAPER LAB|BASELINE.*SHADOW.*CHALLENGER/i.test(el.textContent||''));
    if(anchor && !document.querySelector('[data-v760-research-next]')){
      const note=document.createElement('div');
      note.dataset.v760ResearchNext='1';
      note.textContent='NEXT BOT · CHALLENGER V3.2 IN RESEARCH · NO PAPER EXECUTION';
      note.style.cssText='margin-top:10px;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#28aefc;opacity:.88';
      const host=anchor.closest('.card,.hero,.paper-head')||anchor.parentElement;
      if(host)host.appendChild(note);
    }
  }

  function decorateDepot(){
    const eyebrow=[...document.querySelectorAll('.eyebrow')].find(el=>(el.textContent||'').trim()==='GESAMTPORTFOLIO');
    if(!eyebrow)return;
    const hero=eyebrow.closest('.hero')||eyebrow.parentElement;
    if(!hero)return;
    let scope=hero.querySelector('[data-v760-depot-scope]');
    if(!scope){
      scope=document.createElement('div');
      scope.dataset.v760DepotScope='1';
      scope.style.cssText='margin:6px 0 2px;font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#7f95aa';
      const valueLine=hero.querySelector('.portfolio-value-line');
      if(valueLine)valueLine.insertAdjacentElement('afterend',scope);else eyebrow.insertAdjacentElement('afterend',scope);
    }
    const manual=manualTradingTotal();
    const extra=manual>0?` · TRADING/BOT SEPARAT $${new Intl.NumberFormat('de-DE',{maximumFractionDigits:0}).format(manual)}`:'';
    scope.textContent=`DEPOT SSOT · SPOT-HOLDINGS${extra}`;
  }

  function apply(){
    installPrimaryTabGuard();
    try{
      if(typeof recalcPortfolio==='function')recalcPortfolio();
      if(typeof renderAll==='function')renderAll();
    }catch(e){console.error('MERIDIAN v7.60 initial refresh',e)}
    try{decoratePaper();decorateDepot();document.body?.setAttribute('data-v760-consistency-ready','1')}catch(e){console.error('MERIDIAN v7.60 decorate',e)}
  }

  const observer=new MutationObserver(()=>{decoratePaper();decorateDepot()});
  if(document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else setTimeout(apply,0);

  window.MERIDIAN_DASHBOARD_CONSISTENCY={version:VERSION,spotOnlyDepot:true,manualTradingSeparated:true,spaTabGuard:true};
})();
