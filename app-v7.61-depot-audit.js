/* MERIDIAN v7.63 — DEPOT Portfolio Data Contract V1.
   Display/data-consistency correction only; trading/research execution unchanged. */
(function(){
  'use strict';
  const VERSION='7.63';
  const BUILD='7.63-20260904-R1';
  const CONTRACT='7.63-PORTFOLIO-DATA-CONTRACT-V1';

  function data(){try{return typeof DATA!=='undefined'?DATA:window.DATA}catch(_e){return window.DATA||null}}
  function leafs(root){return root?[...root.querySelectorAll('*')].filter(el=>el.children.length===0):[]}
  function findLeaf(root,re){return leafs(root).find(el=>re.test(String(el.textContent||'').trim()))||null}
  function fmtUsd(v,digits=0){return '$'+new Intl.NumberFormat('de-DE',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(v)||0)}
  function fmtK(v){const n=Number(v)||0;return n>=1000?'$'+new Intl.NumberFormat('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n/1000)+'K':fmtUsd(n)}
  function parseTime(v){const n=Number(v);return Number.isFinite(n)?n:Date.parse(v)}

  function holdingValue(d,h){
    const q=Number(h?.quantity);
    const live=Number(d?.livePrices?.[h?.symbol]?.price);
    const own=Number(h?.price);
    const stored=Number(h?.value??h?.valueUsd);
    if(Number.isFinite(q)&&q>=0&&Number.isFinite(live)&&live>0)return q*live;
    if(Number.isFinite(q)&&q>=0&&Number.isFinite(own)&&own>0)return q*own;
    return Number.isFinite(stored)?stored:0;
  }
  function pionexEquity(d){
    const direct=Number(d?.portfolio?.pionexEquityUsd);
    if(Number.isFinite(direct)&&direct>=0)return direct;
    const rows=Array.isArray(d?.portfolio?.manualVenueBalances)?d.portfolio.manualVenueBalances:[];
    const p=rows.find(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex');
    const n=Number(p?.value??p?.valueUsd);
    return Number.isFinite(n)&&n>=0?n:0;
  }
  function totals(d){
    const venues={};
    const hs=Array.isArray(d?.portfolio?.holdings)?d.portfolio.holdings:[];
    for(const h of hs){
      const venue=String(h?.venue||'').trim();
      if(!venue||venue.toLowerCase()==='pionex')continue;
      venues[venue]=(venues[venue]||0)+holdingValue(d,h);
    }
    const spot=Object.values(venues).reduce((a,b)=>a+(Number(b)||0),0);
    const px=pionexEquity(d);
    return {venues,spot,pionex:px,total:spot+px};
  }
  function canonicalSnapshot(d){
    const t=totals(d);
    const snap={version:CONTRACT,timestamp:Date.now(),spotUsd:t.spot,tradingUsd:t.pionex,totalUsd:t.total,sourceStatus:{spot:Object.keys(t.venues).length?'HOLDINGS_PLUS_LIVE_PRICE':'MISSING',trading:t.pionex>0?'PIONEX_EQUITY':'MISSING'}};
    window.MERIDIAN_PORTFOLIO_CANONICAL=snap;
    try{if(d?.portfolio){d.portfolio.canonicalSnapshot=snap;d.portfolio.totalIncludingTrading=t.total;d.portfolio.valuationConsistency=CONTRACT;}}catch(_e){}
    return snap;
  }
  function depotActive(){
    const root=document.getElementById('view-depot');
    if(!root)return false;
    try{const s=getComputedStyle(root);return s.display!=='none'&&s.visibility!=='hidden';}catch(_e){return true}
  }
  function alignSeries(series,snapshot,maxPts=180){
    if(!Array.isArray(series)||!series.length||!(Number(snapshot?.totalUsd)>=0))return series;
    const out=series.map(x=>Array.isArray(x)?[...x]:x);
    const last=out[out.length-1];
    const lastT=Array.isArray(last)?parseTime(last[0]):NaN;
    const within=Number.isFinite(lastT)&&Math.abs(snapshot.timestamp-lastT)<=5*60*1000;
    const point=[within?last[0]:snapshot.timestamp,snapshot.totalUsd,...(within&&Array.isArray(last)?last.slice(2):[])];
    if(within)out[out.length-1]=point;else if(out.length>=maxPts)out[out.length-1]=point;else out.push(point);
    window.MERIDIAN_PORTFOLIO_CONSISTENCY={status:'OK',chartLastUsd:snapshot.totalUsd,currentUsd:snapshot.totalUsd,deltaUsd:0,at:Date.now()};
    return out;
  }

  function installChartContract(){
    try{
      if(typeof resampleSeries!=='function'||resampleSeries.__v763PortfolioContract)return;
      const previous=resampleSeries;
      const wrapped=function(series,maxPts=180){
        const base=previous.apply(this,arguments);
        if(!depotActive())return base;
        const d=data();if(!d)return base;
        return alignSeries(base,canonicalSnapshot(d),maxPts);
      };
      wrapped.__v763PortfolioContract=true;
      wrapped.__v763Previous=previous;
      resampleSeries=wrapped;
    }catch(e){console.error('MERIDIAN v7.63 chart contract',e)}
  }

  function nearestCard(el,max=6){
    let n=el;
    for(let i=0;i<max&&n;i++,n=n.parentElement){
      const t=String(n.textContent||'').replace(/\s+/g,' ');
      if(t.length<380&&/\$\s*[\d.]+/.test(t))return n;
    }
    return el?.parentElement||null;
  }

  function normalizeWalletSources(root){
    const wallet=findLeaf(root,/^BÖRSE\s*\/\s*WALLET$/i);
    if(!wallet)return;
    let scope=wallet.parentElement;
    for(let i=0;i<5&&scope?.parentElement;i++){
      const t=String(scope.textContent||'');
      if(/Bitpanda/i.test(t)&&/OKX/i.test(t)&&/Ledger/i.test(t)&&/Pionex/i.test(t))break;
      scope=scope.parentElement;
    }
    for(const name of ['Bitpanda','OKX','Ledger','Pionex']){
      const label=leafs(scope).find(el=>String(el.textContent||'').trim().toLowerCase()===name.toLowerCase());
      const card=nearestCard(label);
      if(!card)continue;
      const snap=leafs(card).find(el=>/^(SNAPSHOT|BESTAND SNAP(?:\s*·\s*PREIS LIVE)?|EQUITY SNAP)$/i.test(String(el.textContent||'').trim()));
      if(snap){
        snap.textContent=name==='Pionex'?'EQUITY SNAPSHOT':'BESTAND SNAPSHOT · PREIS LIVE';
        snap.style.fontSize='8px';
        snap.style.letterSpacing='.05em';
      }
    }
  }

  function normalizeHeadline(root,t){
    const line=leafs(root).find(el=>/^GESAMT\s*=\s*SPOT\s*\+\s*(?:TRADING\/BOTS|PIONEX EQUITY)/i.test(String(el.textContent||'').trim()));
    if(line)line.textContent=`GESAMT = SPOT + PIONEX EQUITY · SPOT ${fmtK(t.spot)} · PIONEX ${fmtUsd(t.pionex)} SNAPSHOT`;
    const eye=findLeaf(root,/^GESAMTPORTFOLIO$/i);
    const hero=eye?.closest('.hero')||eye?.parentElement;
    if(hero){
      const candidates=leafs(hero).filter(el=>/^\s*\$\s*[\d.]+(?:,\d+)?\s*$/.test(String(el.textContent||'')));
      const big=candidates.find(el=>el.classList.contains('big'))||candidates[0];
      if(big&&t.total>0){big.textContent=fmtUsd(t.total);big.dataset.portfolioCanonical='1';}
      let note=hero.querySelector('[data-v763-contract-note]');
      if(!note){
        note=document.createElement('div');note.dataset.v763ContractNote='1';
        note.style.cssText='margin:4px 0 8px;font:600 9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#28aefc;opacity:.82';
        const scope=hero.querySelector('[data-v760-depot-scope]')||line;
        scope?.insertAdjacentElement('afterend',note);
      }
      if(note)note.textContent='CHART · GESAMTPORTFOLIO · LETZTER PUNKT = AKTUELLER KANONISCHER GESAMTWERT';
    }
    const spots=findLeaf(root,/^SPOT-VERWAHRSTELLEN(?:\s*·.*)?$/i);
    if(spots)spots.textContent='SPOT-VERWAHRSTELLEN · 3 SPOT + 1 TRADING';
  }

  function clarifyExposure(root,t){
    const heading=findLeaf(root,/^FUTURES\s*&\s*EXPOSURE$/i);
    if(!heading)return;
    let section=heading.parentElement;
    for(let i=0;i<5&&section?.parentElement;i++){
      const tx=String(section.textContent||'');
      if(/PIONEX/i.test(tx)&&/BOT-KAPITAL/i.test(tx)&&/RISK CONTROL/i.test(tx))break;
      section=section.parentElement;
    }
    if(!section)return;
    const pionex=findLeaf(section,/^PIONEX$/i);
    if(pionex){
      const box=pionex.parentElement;
      const money=box&&leafs(box).find(el=>/^\s*\$\s*[\d.]+(?:,\d+)?\s*$/.test(String(el.textContent||'')));
      if(money&&t.pionex>0)money.textContent=fmtUsd(t.pionex,2);
    }
    if(!section.querySelector('[data-v761-r13-equity-note]')){
      const anchor=findLeaf(section,/^BOT-KAPITAL$/i)?.parentElement?.parentElement || heading.parentElement;
      const note=document.createElement('div');
      note.dataset.v761R13EquityNote='1';
      note.style.cssText='margin:8px 0 2px;color:#7f95aa;font:600 9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.055em';
      note.textContent='PIONEX EQUITY = GESAMTWERT AUF PIONEX · BOT-KAPITAL = AKTIV IN BOTS GEBUNDEN';
      anchor?.insertAdjacentElement('afterend',note);
    }
  }

  function decorate(){
    const d=data();
    const root=document.getElementById('view-depot');
    if(!d||!root)return;
    const snap=canonicalSnapshot(d);
    const t={spot:snap.spotUsd,pionex:snap.tradingUsd,total:snap.totalUsd};
    normalizeHeadline(root,t);
    normalizeWalletSources(root);
    clarifyExposure(root,t);
  }

  function stamp(){
    window.MERIDIAN_RELEASE_VERSION=VERSION;
    window.MERIDIAN_UI_VERSION=VERSION;
    window.MERIDIAN_RELEASE_BUILD=BUILD;
    window.__MERIDIAN_BUILD__=BUILD;
    const meta=document.querySelector('meta[name="meridian-build"]');if(meta)meta.content=BUILD;
    const badge=document.getElementById('versionBadge');if(badge)badge.textContent=`v${VERSION} · LIVE`;
  }
  function apply(){stamp();installChartContract();decorate();setTimeout(()=>{installChartContract();decorate()},50)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
  window.addEventListener('pageshow',apply);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});
  setInterval(()=>{if(!document.hidden){installChartContract();decorate()}},1500);
})();
