/* MERIDIAN v7.60 — Dashboard Consistency Fix
   UI/data-source correction only. No trading/research execution changes. */
(function(){
  'use strict';

  const VERSION='7.60-DASHBOARD-CONSISTENCY-R6';

  function balanceValue(x){return Number(x?.value??x?.valueUsd??0)||0}
  function manualTradingTotal(){
    try{return (DATA?.portfolio?.manualVenueBalances||[]).reduce((s,x)=>s+balanceValue(x),0)}catch(_){return 0}
  }
  function holdingValue(h){
    const q=Number(h?.quantity),p=Number(h?.price);
    if(Number.isFinite(q)&&Number.isFinite(p))return q*p;
    const v=Number(h?.value??h?.valueUsd);
    return Number.isFinite(v)?v:0;
  }
  function spotHoldingsTotal(){
    try{
      const hs=Array.isArray(DATA?.portfolio?.holdings)?DATA.portfolio.holdings:[];
      const sum=hs.reduce((s,h)=>s+holdingValue(h),0);
      if(sum>0)return sum;
      const total=Number(DATA?.portfolio?.total)||0;
      const trading=manualTradingTotal();
      return trading>0&&total>trading?total-trading:total;
    }catch(_){return 0}
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
        const manualTotal=manual.reduce((s,x)=>s+balanceValue(x),0);
        p.manualVenueBalances=[];
        try{originalRecalc.apply(this,arguments)}finally{p.manualVenueBalances=manual}
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
          if(out.length>=maxPts)out[out.length-1]=latest;else out.push(latest);
        }
        return out;
      };
      wrapped.__v760Wrapped=true;
      wrapped.__v760Original=originalResample;
      resampleSeries=wrapped;
    }
  }catch(e){console.error('MERIDIAN v7.60 resample wrapper',e)}

  function paperRoot(){
    return document.getElementById('view-paper') || document.querySelector('#paperView,.paper-view,[data-view="paper"]');
  }

  // IMPORTANT: this must be idempotent. The old implementation replaced the
  // prefix "BASELINE · SHADOW · CHALLENGER" on every MutationObserver pass,
  // creating endless "· REGIME" text and starving the UI thread.
  function decoratePaper(){
    const paper=paperRoot();
    if(!paper)return;
    const walker=document.createTreeWalker(paper,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const n of nodes){
      const before=n.nodeValue||'';
      let after=before;
      after=after.replace(/\b3 BOTS\b/g,'4 BOTS').replace(/\b1 VERGLEICH\b/g,'1 ÜBERSICHT');
      if(/BASELINE\s*·\s*SHADOW\s*·\s*CHALLENGER/i.test(after)){
        after=after.replace(/BASELINE\s*·\s*SHADOW\s*·\s*CHALLENGER(?:\s*·\s*REGIME)*/gi,'BASELINE · SHADOW · CHALLENGER · REGIME');
      }
      if(after!==before)n.nodeValue=after;
    }

    const titles=[...paper.querySelectorAll('.section-title,.eyebrow,h1,h2,h3,b,strong')];
    const anchor=titles.find(el=>/PAPER LAB|BASELINE.*SHADOW.*CHALLENGER/i.test(el.textContent||''));
    if(anchor){
      let note=paper.querySelector('[data-v760-research-next]');
      if(!note){
        note=document.createElement('div');
        note.dataset.v760ResearchNext='1';
        note.style.cssText='margin-top:10px;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#28aefc;opacity:.88';
        const host=anchor.closest('.card,.hero,.paper-head')||anchor.parentElement;
        if(host)host.appendChild(note);
      }
      if(note)note.textContent='PAPER · CHALLENGER V2 · RESEARCH · V3.2 · NO EXECUTION CHANGE';
    }
  }

  function compactUsd(v){
    const n=Number(v)||0;
    if(Math.abs(n)>=1000)return `$${new Intl.NumberFormat('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n/1000)}K`;
    return `$${new Intl.NumberFormat('de-DE',{maximumFractionDigits:0}).format(n)}`;
  }

  function decorateDepot(){
    const depot=document.getElementById('view-depot')||document;
    const eyebrow=[...depot.querySelectorAll('.eyebrow')].find(el=>(el.textContent||'').trim()==='GESAMTPORTFOLIO');
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
    const spot=spotHoldingsTotal();
    const trading=manualTradingTotal();
    const next=trading>0
      ?`GESAMT = SPOT + TRADING/BOTS · SPOT ${compactUsd(spot)} · BOTS ${compactUsd(trading)} SNAPSHOT`
      :'GESAMT = SPOT-HOLDINGS';
    if(scope.textContent!==next)scope.textContent=next;

    // The headline combines live-priced holdings with a static Pionex snapshot,
    // therefore its status is HYBRID rather than fully LIVE. The historical
    // chart and largest-position percentage remain spot-only.
    const walker=document.createTreeWalker(hero,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const n=walker.currentNode;
      const before=n.nodeValue||'';
      let after=before;
      if(/^\s*LIVE\s*$/i.test(after))after=after.replace(/LIVE/i,'HYBRID');
      after=after.replace(/\b1D PERFORMANCE\s*·\s*CASHFLOW[-–]BEREINIGT\b/i,'SPOT 1D PERFORMANCE · CASHFLOW-BEREINIGT');
      after=after.replace(/\bGRÖSSTE POSITION\b/i,'GRÖSSTE SPOT-POSITION');
      if(after!==before)n.nodeValue=after;
    }
  }

  let decorateQueued=false;
  function queueDecorate(){
    if(decorateQueued)return;
    decorateQueued=true;
    requestAnimationFrame(()=>{
      decorateQueued=false;
      try{decoratePaper();decorateDepot()}catch(e){console.error('MERIDIAN v7.60 decorate',e)}
    });
  }

  function apply(){
    try{
      if(typeof recalcPortfolio==='function')recalcPortfolio();
      if(typeof renderAll==='function')renderAll();
    }catch(e){console.error('MERIDIAN v7.60 initial refresh',e)}
    queueDecorate();
    document.body?.setAttribute('data-v760-consistency-ready','1');
  }

  const observer=new MutationObserver(queueDecorate);
  if(document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else setTimeout(apply,0);

  window.MERIDIAN_DASHBOARD_CONSISTENCY={version:VERSION,spotOnlyDepot:true,manualTradingSeparated:true,chartScopeExplicit:true,hybridHeadlineExplicit:true,paperResearchLabelExplicit:true,mutationLoopFixed:true};
})();
