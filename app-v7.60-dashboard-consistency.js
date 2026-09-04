/* MERIDIAN v7.61 — Dashboard Consistency Fix
   UI/data-source correction only. No trading/research execution changes. */
(function(){
  'use strict';

  const VERSION='7.61-DASHBOARD-CONSISTENCY-R5';
  const UI_VERSION='7.61';
  const BUILD='7.61-20260903-R5';

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
  function spotVenueCount(){
    try{
      const hs=Array.isArray(DATA?.portfolio?.holdings)?DATA.portfolio.holdings:[];
      const venues=new Set(hs.map(h=>String(h?.venue||'').trim()).filter(Boolean).filter(v=>v.toLowerCase()!=='pionex'));
      return venues.size;
    }catch(_){return 0}
  }
  function formatUsd(v){
    return `$${new Intl.NumberFormat('de-DE',{minimumFractionDigits:0,maximumFractionDigits:0}).format(Number(v)||0)}`;
  }
  function tradingSnapshotStart(){
    try{
      const xs=(DATA?.portfolio?.manualVenueBalances||[])
        .filter(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex')
        .map(x=>Date.parse(x?.updatedAt||x?.updated_at||''))
        .filter(Number.isFinite);
      const seed=Date.parse(DATA?.portfolio?.knownHoldingsSeedAt||'');
      if(Number.isFinite(seed))xs.push(seed);
      return xs.length?Math.min(...xs):NaN;
    }catch(_){return NaN}
  }
  function totalPortfolioSeries(series){
    const trading=manualTradingTotal();
    const start=tradingSnapshotStart();
    if(!(trading>0)||!Array.isArray(series))return series;
    return series.map(pt=>{
      if(!Array.isArray(pt)||pt.length<2)return pt;
      const raw=pt[0];
      const t=Number.isFinite(Number(raw))?Number(raw):Date.parse(raw);
      const v=Number(pt[1]);
      if(!Number.isFinite(v))return pt;
      if(Number.isFinite(start)&&Number.isFinite(t)&&t<start)return pt;
      return [pt[0],v+trading,...pt.slice(2)];
    });
  }
  function looksLikeSpotPortfolioSeries(series){
    try{
      if(!Array.isArray(series)||series.length<2)return false;
      const vals=series.map(x=>Array.isArray(x)?Number(x[1]):NaN).filter(Number.isFinite);
      if(vals.length<2)return false;
      const latest=vals[vals.length-1],spot=spotHoldingsTotal();
      if(!(spot>0))return false;
      return Math.abs(latest-spot)/spot<0.18;
    }catch(_){return false}
  }
  function depotActive(){
    try{
      if(document.body?.dataset?.view==='depot')return true;
      const el=document.getElementById('view-depot');
      if(!el)return false;
      const st=getComputedStyle(el);
      return st.display!=='none'&&st.visibility!=='hidden';
    }catch(_){return false}
  }

  try{
    if(typeof recalcPortfolio==='function' && !recalcPortfolio.__v761Wrapped){
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
        p.valuationConsistency='7.61-DEPOT-SSOT-R5';
        return p.total;
      };
      wrapped.__v761Wrapped=true;
      wrapped.__v761Original=originalRecalc;
      recalcPortfolio=wrapped;
    }
  }catch(e){console.error('MERIDIAN v7.61 recalc wrapper',e)}

  try{
    if(typeof resampleSeries==='function' && !resampleSeries.__v761Wrapped){
      const originalResample=resampleSeries;
      const wrapped=function(series,maxPts=180){
        const shouldHybrid=depotActive()&&manualTradingTotal()>0&&looksLikeSpotPortfolioSeries(series);
        const input=shouldHybrid?totalPortfolioSeries(series):series;
        const out=originalResample(input,maxPts);
        if(!Array.isArray(input)||!input.length||!Array.isArray(out)||!out.length)return out;
        const latest=input[input.length-1];
        const last=out[out.length-1];
        if(!last || Number(last[0])!==Number(latest[0])){
          if(out.length>=maxPts)out[out.length-1]=latest;else out.push(latest);
        }
        return out;
      };
      wrapped.__v761Wrapped=true;
      wrapped.__v761Original=originalResample;
      resampleSeries=wrapped;
    }
  }catch(e){console.error('MERIDIAN v7.61 resample wrapper',e)}

  function stampVersion(){
    try{
      window.MERIDIAN_RELEASE_VERSION=UI_VERSION;
      window.MERIDIAN_UI_VERSION=UI_VERSION;
      window.MERIDIAN_RELEASE_BUILD=BUILD;
      window.__MERIDIAN_BUILD__=BUILD;
      const badge=document.getElementById('versionBadge');
      if(badge && badge.textContent!==`v${UI_VERSION} · LIVE`)badge.textContent=`v${UI_VERSION} · LIVE`;
      document.querySelectorAll('[data-ui-version]').forEach(el=>{if(el.textContent!==UI_VERSION)el.textContent=UI_VERSION});
      const meta=document.querySelector('meta[name="meridian-build"]');
      if(meta)meta.setAttribute('content',BUILD);
    }catch(_e){}
  }

  function hideGlobalPionexNotice(){
    try{
      const root=document.body||document.documentElement;
      if(!root)return;
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      const matches=[];
      while(walker.nextNode()){
        const text=String(walker.currentNode.nodeValue||'').replace(/\s+/g,' ').trim();
        if(/PIONEX/i.test(text)&&/STATISCHER\s+SNAPSHOT/i.test(text)&&/QUELLE\s+NICHT\s+LIVE/i.test(text))matches.push(walker.currentNode);
      }
      for(const node of matches){
        let el=node.parentElement;
        if(!el)continue;
        let candidate=el;
        for(let i=0;i<4&&candidate?.parentElement;i++){
          const text=String(candidate.textContent||'').replace(/\s+/g,' ').trim();
          if(/PIONEX/i.test(text)&&/STATISCHER\s+SNAPSHOT/i.test(text)&&/QUELLE\s+NICHT\s+LIVE/i.test(text)&&text.length<180){
            candidate=candidate.parentElement;
            continue;
          }
          break;
        }
        const target=(candidate&&String(candidate.textContent||'').length<220)?candidate:el;
        target.style.display='none';
        target.setAttribute('aria-hidden','true');
        target.dataset.v761PionexHeaderHidden='1';
      }
    }catch(_e){}
  }

  function paperRoot(){
    return document.getElementById('view-paper') || document.querySelector('#paperView,.paper-view,[data-view="paper"]');
  }
  function decoratePaper(){
    const paper=paperRoot();
    if(!paper)return;
    const walker=document.createTreeWalker(paper,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const n of nodes){
      const before=n.nodeValue||'';
      let after=before;
      after=after.replace(/\b3 BOTS\b/g,'4 BOTS').replace(/\b1 VERGLEICH\b/g,'1 ÜBERSICHT');
      if(/BASELINE\s*·\s*SHADOW\s*·\s*CHALLENGER/i.test(after))after=after.replace(/BASELINE\s*·\s*SHADOW\s*·\s*CHALLENGER(?:\s*·\s*REGIME)*/gi,'BASELINE · SHADOW · CHALLENGER · REGIME');
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
  function setDepotHeadlineTotal(hero,total){
    if(!(total>0))return;
    const scope=hero.querySelector('[data-v760-depot-scope]');
    const els=[...hero.querySelectorAll('*')].filter(el=>el!==scope && !scope?.contains(el));
    const valueEl=els.find(el=>/^\s*\$\s*[\d.]+(?:,\d+)?\s*$/.test(el.textContent||'') && ![...el.children].length);
    if(valueEl){
      const next=formatUsd(total);
      if((valueEl.textContent||'').trim()!==next)valueEl.textContent=next;
      valueEl.dataset.v760HybridTotal='1';
    }
  }
  function normalizeDepotLabel(text){
    let after=String(text||'');
    after=after.replace(/^(?:\s*SPOT\s+)+1D PERFORMANCE\s*·\s*CASHFLOW[-–]BEREINIGT\s*$/i,'SPOT 1D PERFORMANCE · CASHFLOW-BEREINIGT');
    after=after.replace(/^(?:\s*SPOT[-–])+VERWAHRSTELLEN\s*$/i,'SPOT-VERWAHRSTELLEN');
    after=after.replace(/^(?:\s*SPOT[-–])+GRÖSSTE\s+(?:SPOT[-–])?POSITION\s*$/i,'GRÖSSTE SPOT-POSITION');
    after=after.replace(/^\s*1D PERFORMANCE\s*·\s*CASHFLOW[-–]BEREINIGT\s*$/i,'SPOT 1D PERFORMANCE · CASHFLOW-BEREINIGT');
    after=after.replace(/^\s*(?:SPOT[-–])?VERWAHRSTELLEN\s*$/i,'SPOT-VERWAHRSTELLEN');
    after=after.replace(/^\s*(?:GRÖSSTE\s+)?(?:SPOT[-–])?POSITION\s*$/i,m=>/GRÖSSTE/i.test(m)?'GRÖSSTE SPOT-POSITION':m);
    return after;
  }
  function fixSpotVenueCard(hero){
    const venueLabel=[...hero.querySelectorAll('*')].find(el=>![...el.children].length && /^(?:SPOT[-–])?VERWAHRSTELLEN$/i.test((el.textContent||'').trim()));
    if(!venueLabel)return;
    venueLabel.textContent='SPOT-VERWAHRSTELLEN';
    const card=venueLabel.closest('.card,.metric,.stat,.portfolio-stat')||venueLabel.parentElement;
    if(!card)return;
    const count=spotVenueCount();
    if(!(count>0))return;
    const leaf=[...card.querySelectorAll('*')].find(el=>![...el.children].length && /^\s*\d+\s*$/.test(el.textContent||''));
    if(leaf)leaf.textContent=String(count);
  }
  function fixHybridCard(hero){
    const mode=[...hero.querySelectorAll('*')].find(el=>![...el.children].length && /^\s*DATENMODUS\s*$/i.test(el.textContent||''));
    if(!mode)return;
    const card=mode.closest('.card,.metric,.stat,.portfolio-stat')||mode.parentElement;
    if(!card)return;
    const leaves=[...card.querySelectorAll('*')].filter(el=>![...el.children].length);
    for(const el of leaves){
      const t=(el.textContent||'').trim();
      if(/^HYBRID\s*[•·]?\s*HYBRID$/i.test(t))el.textContent='Hybrid';
      else if(/^LIVE$/i.test(t))el.textContent='HYBRID';
    }
  }
  function decorateDepot(){
    const depot=document.getElementById('view-depot')||document;
    const eyebrow=[...depot.querySelectorAll('.eyebrow')].find(el=>(el.textContent||'').trim()==='GESAMTPORTFOLIO');
    if(!eyebrow)return;
    const hero=eyebrow.closest('.hero')||eyebrow.parentElement;
    if(!hero)return;
    const spot=spotHoldingsTotal();
    const trading=manualTradingTotal();
    const hybridTotal=spot+trading;
    if(trading>0)setDepotHeadlineTotal(hero,hybridTotal);

    let scope=hero.querySelector('[data-v760-depot-scope]');
    if(!scope){
      scope=document.createElement('div');
      scope.dataset.v760DepotScope='1';
      scope.style.cssText='margin:6px 0 2px;font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#7f95aa';
      const valueLine=hero.querySelector('.portfolio-value-line');
      if(valueLine)valueLine.insertAdjacentElement('afterend',scope);else eyebrow.insertAdjacentElement('afterend',scope);
    }
    const next=trading>0?`GESAMT = SPOT + TRADING/BOTS · SPOT ${compactUsd(spot)} · BOTS ${compactUsd(trading)} SNAPSHOT`:'GESAMT = SPOT-HOLDINGS';
    if(scope.textContent!==next)scope.textContent=next;

    let chartNote=hero.querySelector('[data-v760-total-chart-note]');
    if(!chartNote && trading>0){
      chartNote=document.createElement('div');
      chartNote.dataset.v760TotalChartNote='1';
      chartNote.style.cssText='margin:4px 0 8px;font:600 9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#28aefc;opacity:.82';
      scope.insertAdjacentElement('afterend',chartNote);
    }
    if(chartNote)chartNote.textContent='CHART · GESAMTPORTFOLIO · PIONEX AB SNAPSHOT';

    const walker=document.createTreeWalker(hero,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const n of nodes){
      if(scope===n.parentElement||scope?.contains(n)||chartNote===n.parentElement||chartNote?.contains(n))continue;
      const before=n.nodeValue||'';
      let after=before;
      after=normalizeDepotLabel(after);
      if(after!==before)n.nodeValue=after;
    }
    fixSpotVenueCard(hero);
    fixHybridCard(hero);
  }

  function leafNodes(root){
    if(!root)return[];
    return [...root.querySelectorAll('*')].filter(el=>![...el.children].length);
  }
  function runtimeRisk(){
    try{return typeof currentBtcRiskSnapshot==='function'?currentBtcRiskSnapshot():null}catch(_){return null}
  }
  function runtimeCloud(){
    try{return typeof cloudBackendFresh==='function'?cloudBackendFresh():null}catch(_){return null}
  }
  function decorateExecutionConsistency(){
    try{
      const risk=runtimeRisk();
      const cloud=runtimeCloud();
      const riskKnown=!!risk&&typeof risk.open==='boolean';
      const riskText=riskKnown?(risk.open?'RISK OPEN':'RISK BLOCKED'):'RISK UNKNOWN';
      const riskTone=riskKnown?(risk.open?'green':'red'):'amber';

      const trade=document.getElementById('view-trade')||document.querySelector('#tradeView,.trade-view,[data-view="trade"]');
      if(trade&&riskKnown){
        for(const el of leafNodes(trade)){
          const text=(el.textContent||'').replace(/\s+/g,' ').trim();
          if(/^RISK\s+(?:OPEN|BLOCKED|UNKNOWN)$/i.test(text)){
            if(text!==riskText)el.textContent=riskText;
            el.classList.remove('green','red','amber');
            el.classList.add(riskTone);
            el.dataset.v761RiskSsot='1';
          }
        }
      }

      const center=document.getElementById('view-center')||document.querySelector('#centerView,.center-view,[data-view="center"]');
      if(center&&cloud){
        const source=String(cloud.source||'ENGINE').toUpperCase();
        const age=Number(cloud.age);
        const fresh=!!cloud.ok;
        const next=`${source} · ${fresh?'LIVE':'STALE'}${Number.isFinite(age)?` · ${Math.max(0,Math.round(age))}s`:''}`;
        for(const el of leafNodes(center)){
          const text=(el.textContent||'').replace(/\s+/g,' ').trim();
          if(/^ENGINE\s+(?:DIRECT|MIRROR)\s*·\s*(?:RUNNING|LIVE|STALE)(?:\s*·\s*\d+s)?$/i.test(text)){
            if(text!==next)el.textContent=next;
            el.classList.remove('green','red','amber');
            el.classList.add(fresh?'green':'amber');
            el.dataset.v761EngineFreshness='1';
          }
        }
      }

      if(center&&risk?.short?.source==='PIONEX VERIFIED'){
        const riskCard=[...center.querySelectorAll('.card,.v602-riskcard')].find(el=>/BTC\s+LIQUIDATION\s+RISK/i.test(el.textContent||''));
        if(riskCard&&!riskCard.querySelector('[data-v761-risk-source-note]')){
          const note=document.createElement('div');
          note.dataset.v761RiskSourceNote='1';
          note.textContent='PUFFER · PIONEX SNAPSHOT · BTC-KURS LIVE';
          note.style.cssText='margin:5px 0 0;font:600 9px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:#e8b24a;opacity:.9';
          const head=riskCard.querySelector('.v602-riskhead')||riskCard.firstElementChild;
          if(head)head.insertAdjacentElement('afterend',note);else riskCard.prepend(note);
        }
      }
    }catch(e){console.error('MERIDIAN v7.61 execution consistency',e)}
  }

  let decorateQueued=false;
  function queueDecorate(){
    if(decorateQueued)return;
    decorateQueued=true;
    requestAnimationFrame(()=>{
      decorateQueued=false;
      try{stampVersion();hideGlobalPionexNotice();decoratePaper();decorateDepot();decorateExecutionConsistency()}catch(e){console.error('MERIDIAN v7.61 decorate',e)}
    });
  }
  function apply(){
    try{
      stampVersion();
      hideGlobalPionexNotice();
      if(typeof recalcPortfolio==='function')recalcPortfolio();
      if(typeof renderAll==='function')renderAll();
      decorateExecutionConsistency();
    }catch(e){console.error('MERIDIAN v7.61 initial refresh',e)}
    queueDecorate();
    document.body?.setAttribute('data-v760-consistency-ready','1');
  }

  const observer=new MutationObserver(queueDecorate);
  if(document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else setTimeout(apply,0);

  window.MERIDIAN_DASHBOARD_CONSISTENCY={version:VERSION,uiVersion:UI_VERSION,build:BUILD,spotOnlyDepot:true,hybridTotalHeadline:true,manualTradingSeparated:true,chartScopeExplicit:true,hybridPortfolioChart:true,pionexHistoryMode:'SNAPSHOT_FROM_KNOWN_AT',hybridHeadlineExplicit:true,paperResearchLabelExplicit:true,mutationLoopFixed:true,spotVenueCountExplicit:true,pionexHeaderBannerHidden:true,riskSsotUi:true,engineFreshnessUi:true,riskSourceExplicit:true};
})();