/* MERIDIAN v7.64 — DEPOT Canonical Portfolio History R2.
   Display/data-consistency correction only; trading/research execution unchanged. */
(function(){
  'use strict';
  const VERSION='7.64';
  const BUILD='7.64-20260904-R1';
  const CONTRACT='7.63-PORTFOLIO-DATA-CONTRACT-V1';
  const HISTORY='7.64-CANONICAL-PORTFOLIO-HISTORY-V1';
  const API=window.MERIDIAN_CLOUD_API||'https://p01--achi-meridian--ttvk44grdlp7.code.run';
  const RANGE_MS={d:86400000,w:7*86400000,m:30*86400000,'6m':183*86400000,y:365*86400000};
  const RANGE_API={d:'1d',w:'1w',m:'1m','6m':'6m',y:'1y'};
  const historyCache={};

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
  function activeRange(){
    const root=document.getElementById('view-depot');
    if(!root)return 'd';
    const map={'1D':'d','1W':'w','1M':'m','6M':'6m','1Y':'y'};
    const controls=[...root.querySelectorAll('button,[role="button"],[role="tab"],.seg,.chip')].filter(el=>map[String(el.textContent||'').trim().toUpperCase()]);
    const active=controls.find(el=>el.getAttribute('aria-selected')==='true'||el.getAttribute('aria-pressed')==='true'||/(^|\s)(active|selected|on)(\s|$)/i.test(el.className||''));
    return map[String(active?.textContent||'1D').trim().toUpperCase()]||'d';
  }
  function historyReady(key,points){
    if(!Array.isArray(points)||points.length<12)return false;
    const first=parseTime(points[0]?.timestamp),last=parseTime(points.at(-1)?.timestamp);
    if(!Number.isFinite(first)||!Number.isFinite(last)||last<=first)return false;
    const required=Math.min(RANGE_MS[key]*0.5,7*86400000);
    return last-first>=required;
  }
  function canonicalSeries(key){
    const h=historyCache[key];
    if(!h?.ready)return null;
    return h.points.map(p=>[p.timestamp,Number(p.cashflowAdjustedTotalUsd??p.totalUsd)]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
  }
  function alignSeries(series,snapshot,maxPts=180){
    if(!Array.isArray(series)||!series.length||!(Number(snapshot?.totalUsd)>=0))return series;
    const out=series.map(x=>Array.isArray(x)?[...x]:x);
    const last=out[out.length-1];
    const lastT=Array.isArray(last)?parseTime(last[0]):NaN;
    const within=Number.isFinite(lastT)&&Math.abs(snapshot.timestamp-lastT)<=5*60*1000;
    const point=[within?last[0]:snapshot.timestamp,snapshot.totalUsd,...(within&&Array.isArray(last)?last.slice(2):[])];
    if(within)out[out.length-1]=point;else if(out.length>=maxPts)out[out.length-1]=point;else out.push(point);
    window.MERIDIAN_PORTFOLIO_CONSISTENCY={status:'OK',chartLastUsd:snapshot.totalUsd,currentUsd:snapshot.totalUsd,deltaUsd:0,at:Date.now(),source:'V7.63_CURRENT_FALLBACK'};
    return out;
  }
  function sameBasisStats(points){
    if(!Array.isArray(points)||points.length<2)return null;
    const vals=points.map(p=>Number(p.cashflowAdjustedTotalUsd??p.totalUsd)).filter(Number.isFinite);
    if(vals.length<2)return null;
    const first=vals[0],last=vals.at(-1),high=Math.max(...vals),low=Math.min(...vals),delta=last-first,pct=first?delta/first*100:null;
    return {first,last,high,low,delta,pct};
  }
  async function refreshHistory(key=activeRange()){
    if(historyCache[key]?.fetching)return;
    historyCache[key]={...(historyCache[key]||{}),fetching:true};
    try{
      const r=await fetch(`${API}/api/private/portfolio-history?range=${RANGE_API[key]||'1d'}`,{cache:'no-store'});
      if(!r.ok)throw new Error('PORTFOLIO HISTORY HTTP '+r.status);
      const j=await r.json(),points=Array.isArray(j?.points)?j.points:[];
      const ready=historyReady(key,points);
      historyCache[key]={fetching:false,loadedAt:Date.now(),source:j?.source||null,version:j?.version||null,points,ready};
      window.MERIDIAN_PORTFOLIO_HISTORY={version:HISTORY,activeRange:key,...historyCache[key]};
      if(key==='d'&&ready)renderHistoryStats();
      if(depotActive()&&typeof renderOne==='function')try{renderOne('depot')}catch(_e){}
    }catch(e){
      historyCache[key]={...(historyCache[key]||{}),fetching:false,error:String(e?.message||e),loadedAt:Date.now(),ready:false};
    }
  }

  function installChartContract(){
    try{
      if(typeof resampleSeries!=='function'||resampleSeries.__v764PortfolioContract)return;
      const previous=resampleSeries;
      const wrapped=function(series,maxPts=180){
        const base=previous.apply(this,arguments);
        if(!depotActive())return base;
        const d=data();if(!d)return base;
        const key=activeRange();
        const canonical=canonicalSeries(key);
        if(canonical?.length){
          const sampled=previous.call(this,canonical,maxPts);
          const snap=canonicalSnapshot(d);
          const aligned=alignSeries(sampled,snap,maxPts);
          window.MERIDIAN_PORTFOLIO_CONSISTENCY={status:'OK',chartLastUsd:Number(aligned.at(-1)?.[1]),currentUsd:snap.totalUsd,deltaUsd:Number(aligned.at(-1)?.[1])-snap.totalUsd,at:Date.now(),source:'V7.64_POSTGRES_CANONICAL_HISTORY',range:key};
          return aligned;
        }
        return alignSeries(base,canonicalSnapshot(d),maxPts);
      };
      wrapped.__v764PortfolioContract=true;
      wrapped.__v764Previous=previous;
      resampleSeries=wrapped;
    }catch(e){console.error('MERIDIAN v7.64 chart contract',e)}
  }

  function nearestCard(el,max=6){
    let n=el;
    for(let i=0;i<max&&n;i++,n=n.parentElement){
      const t=String(n.textContent||'').replace(/\s+/g,' ');
      if(t.length<380&&/\$\s*[\d.]+/.test(t))return n;
    }
    return el?.parentElement||null;
  }
  function setMetricNear(labelRe,valueText,extraRe){
    const root=document.getElementById('view-depot');
    const label=findLeaf(root,labelRe);if(!label)return false;
    let scope=label.parentElement;
    for(let i=0;i<4&&scope;i++,scope=scope.parentElement){
      const xs=leafs(scope).filter(el=>el!==label&&(!extraRe||extraRe.test(String(el.textContent||'').trim())));
      if(xs.length){xs[0].textContent=valueText;return true}
    }
    return false;
  }
  function renderHistoryStats(){
    const h=historyCache.d;if(!h?.ready)return;
    const s=sameBasisStats(h.points);if(!s)return;
    const root=document.getElementById('view-depot');if(!root)return;
    setMetricNear(/^HIGH$/i,fmtUsd(s.high),/^\$\s*[\d.,]+/);
    setMetricNear(/^LOW$/i,fmtUsd(s.low),/^\$\s*[\d.,]+/);
    const perf=findLeaf(root,/^(PERFORMANCE\s*)?1D$/i)||findLeaf(root,/^1D PERFORMANCE$/i);
    if(perf){
      let scope=perf.parentElement;
      for(let i=0;i<4&&scope;i++,scope=scope.parentElement){
        const vals=leafs(scope).filter(el=>el!==perf&&(/[+$−-]\s*\$?\s*[\d.,]+/.test(String(el.textContent||''))||/%/.test(String(el.textContent||''))));
        if(vals.length){vals[0].textContent=`${s.delta>=0?'+':'−'}${fmtUsd(Math.abs(s.delta))}`;if(vals[1]&&Number.isFinite(s.pct))vals[1].textContent=`${s.pct>=0?'+':'−'}${Math.abs(s.pct).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;break}
      }
    }
    window.MERIDIAN_PORTFOLIO_1D_STATS={...s,source:'V7.64_POSTGRES_CANONICAL_HISTORY',pointCount:h.points.length};
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
      if(snap){snap.textContent=name==='Pionex'?'EQUITY SNAPSHOT':'BESTAND SNAPSHOT · PREIS LIVE';snap.style.fontSize='8px';snap.style.letterSpacing='.05em';}
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
      if(!note){note=document.createElement('div');note.dataset.v763ContractNote='1';note.style.cssText='margin:4px 0 8px;font:600 9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#28aefc;opacity:.82';const scope=hero.querySelector('[data-v760-depot-scope]')||line;scope?.insertAdjacentElement('afterend',note);}
      if(note){const h=historyCache[activeRange()];note.textContent=h?.ready?'KANONISCHE PORTFOLIO-HISTORIE · POSTGRES · CHART/HIGH/LOW/1D AUF GLEICHER BASIS':'KANONISCHE HISTORIE WIRD AUFGEBAUT · v7.63 CURRENT-VALUE FALLBACK AKTIV';}
    }
    const spots=findLeaf(root,/^SPOT-VERWAHRSTELLEN(?:\s*·.*)?$/i);if(spots)spots.textContent='SPOT-VERWAHRSTELLEN · 3 SPOT + 1 TRADING';
  }

  function clarifyExposure(root,t){
    const heading=findLeaf(root,/^FUTURES\s*&\s*EXPOSURE$/i);if(!heading)return;
    let section=heading.parentElement;
    for(let i=0;i<5&&section?.parentElement;i++){const tx=String(section.textContent||'');if(/PIONEX/i.test(tx)&&/BOT-KAPITAL/i.test(tx)&&/RISK CONTROL/i.test(tx))break;section=section.parentElement;}
    if(!section)return;
    const pionex=findLeaf(section,/^PIONEX$/i);
    if(pionex){const box=pionex.parentElement;const money=box&&leafs(box).find(el=>/^\s*\$\s*[\d.]+(?:,\d+)?\s*$/.test(String(el.textContent||'')));if(money&&t.pionex>0)money.textContent=fmtUsd(t.pionex,2);}
    if(!section.querySelector('[data-v761-r13-equity-note]')){const anchor=findLeaf(section,/^BOT-KAPITAL$/i)?.parentElement?.parentElement||heading.parentElement;const note=document.createElement('div');note.dataset.v761R13EquityNote='1';note.style.cssText='margin:8px 0 2px;color:#7f95aa;font:600 9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.055em';note.textContent='PIONEX EQUITY = GESAMTWERT AUF PIONEX · BOT-KAPITAL = AKTIV IN BOTS GEBUNDEN';anchor?.insertAdjacentElement('afterend',note);}
  }

  function decorate(){
    const d=data(),root=document.getElementById('view-depot');if(!d||!root)return;
    const snap=canonicalSnapshot(d),t={spot:snap.spotUsd,pionex:snap.tradingUsd,total:snap.totalUsd};
    normalizeHeadline(root,t);normalizeWalletSources(root);clarifyExposure(root,t);renderHistoryStats();
  }
  function stamp(){
    window.MERIDIAN_RELEASE_VERSION=VERSION;window.MERIDIAN_UI_VERSION=VERSION;window.MERIDIAN_RELEASE_BUILD=BUILD;window.__MERIDIAN_BUILD__=BUILD;
    const meta=document.querySelector('meta[name="meridian-build"]');if(meta)meta.content=BUILD;
    const badge=document.getElementById('versionBadge');if(badge)badge.textContent=`v${VERSION} · LIVE`;
  }
  function apply(){stamp();installChartContract();decorate();refreshHistory(activeRange());setTimeout(()=>{installChartContract();decorate()},50)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
  window.addEventListener('pageshow',apply);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});
  document.addEventListener('click',e=>{const t=String(e.target?.textContent||'').trim().toUpperCase();if(['1D','1W','1M','6M','1Y'].includes(t))setTimeout(()=>refreshHistory(activeRange()),50)});
  setInterval(()=>{if(!document.hidden){installChartContract();decorate()}},1500);
  setInterval(()=>{if(!document.hidden)refreshHistory(activeRange())},60000);
})();
