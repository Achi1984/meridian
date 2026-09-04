/* MERIDIAN v7.62 R3 — Pionex equity SSOT resolver. Display/state consistency only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='7.62';
  const BUILD='7.62-20260904-R3';

  function data(){try{return typeof DATA!=='undefined'?DATA:window.DATA}catch(_e){return window.DATA||null}}
  function leafs(root){return root?[...root.querySelectorAll('*')].filter(el=>el.children.length===0):[]}
  function findLeaf(root,re){return leafs(root).find(el=>re.test(String(el.textContent||'').trim()))||null}
  function num(v){const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
  function ts(v){const t=Date.parse(String(v||''));return Number.isFinite(t)?t:0}
  function fmtUsd(v,d=0){return '$'+new Intl.NumberFormat('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v)||0)}
  function fmtK(v){const n=Number(v)||0;return n>=1000?'$'+new Intl.NumberFormat('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n/1000)+'K':fmtUsd(n)}

  function candidate(value,source,updatedAt,priority){
    const n=num(value);if(n==null)return null;
    return {value:n,source,updatedAt:ts(updatedAt),priority:Number(priority)||0};
  }

  function collectCandidates(d){
    const p=d?.portfolio||{};
    const out=[];
    const push=c=>{if(c)out.push(c)};

    push(candidate(d?.pionex?.equityUsd,'PRIVATE_PIONEX',d?.pionex?.updatedAt||d?.pionex?.snapshotAt,100));
    push(candidate(d?.pionex?.totalEquityUsd,'PRIVATE_PIONEX',d?.pionex?.updatedAt||d?.pionex?.snapshotAt,100));
    push(candidate(d?.pionex?.accountValueUsd,'PRIVATE_PIONEX',d?.pionex?.updatedAt||d?.pionex?.snapshotAt,100));
    push(candidate(d?.pionexRisk?.accountEquityUsd,'PRIVATE_RISK',d?.pionexRisk?.updatedAt||d?.pionexRisk?.snapshotAt,95));
    push(candidate(d?.pionexRisk?.totalEquityUsd,'PRIVATE_RISK',d?.pionexRisk?.updatedAt||d?.pionexRisk?.snapshotAt,95));

    const byVenue=Array.isArray(p.byVenue)?p.byVenue:[];
    const pv=byVenue.find(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex');
    if(pv)push(candidate(pv.value??pv.valueUsd??pv.totalUsd,'PORTFOLIO_VENUE',pv.updatedAt||p.snapshotAt||d?.privateUpdatedAt,90));

    const balances=Array.isArray(p.manualVenueBalances)?p.manualVenueBalances:[];
    const mb=balances.find(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex');
    if(mb)push(candidate(mb.value??mb.valueUsd,'MANUAL_VENUE',mb.updatedAt||p.snapshotAt||d?.privateUpdatedAt,70));

    const seedLike=String(d?.privateUpdateSource||'').toLowerCase().includes('known_holdings_startup_seed') || String(p?.pionexEquitySource||'').toUpperCase()==='KNOWN_SEED';
    push(candidate(p.pionexEquityUsd,seedLike?'KNOWN_SEED':'PORTFOLIO_EQUITY',p.pionexEquityUpdatedAt||d?.privateUpdatedAt,seedLike?10:80));
    return out;
  }

  function resolvePionex(d){
    const cs=collectCandidates(d);
    if(!cs.length)return {value:0,source:'UNAVAILABLE',updatedAt:0,priority:0};
    /* Source quality is authoritative. Freshness only breaks ties within an equally trusted source tier. */
    cs.sort((a,b)=>(b.priority-a.priority)||((b.updatedAt||0)-(a.updatedAt||0)));
    return cs[0];
  }

  function normalizeVenueRows(p,res){
    if(!p||!res||res.value<=0)return;
    const rows=Array.isArray(p.byVenue)?p.byVenue:[];
    const idx=rows.findIndex(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex');
    if(idx>=0){
      rows[idx]={...rows[idx],value:res.value,valueUsd:res.value,totalUsd:res.value,updatedAt:res.updatedAt?new Date(res.updatedAt).toISOString():rows[idx]?.updatedAt,source:res.source};
      p.byVenue=rows;
    }
  }

  function normalizeData(d,res){
    if(!d?.portfolio||!res||res.value<=0)return;
    const p=d.portfolio;
    p.pionexEquityUsd=res.value;
    p.pionexEquitySource=res.source;
    if(res.updatedAt)p.pionexEquityUpdatedAt=new Date(res.updatedAt).toISOString();
    const rows=Array.isArray(p.manualVenueBalances)?p.manualVenueBalances:[];
    const idx=rows.findIndex(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex');
    const row={venue:'Pionex',value:res.value,valueUsd:res.value,kind:'TRADING_CAPITAL',updatedAt:p.pionexEquityUpdatedAt||new Date().toISOString(),source:res.source};
    if(idx>=0)rows[idx]={...rows[idx],...row}; else rows.push(row);
    p.manualVenueBalances=rows;
    normalizeVenueRows(p,res);
  }

  function spotValue(d){
    const hs=Array.isArray(d?.portfolio?.holdings)?d.portfolio.holdings:[];
    let sum=0;
    for(const h of hs){
      if(String(h?.venue||'').toLowerCase()==='pionex')continue;
      const q=Number(h?.quantity), live=Number(d?.livePrices?.[h?.symbol]?.price), own=Number(h?.price), stored=Number(h?.value??h?.valueUsd);
      if(Number.isFinite(q)&&q>=0&&Number.isFinite(live)&&live>0)sum+=q*live;
      else if(Number.isFinite(q)&&q>=0&&Number.isFinite(own)&&own>0)sum+=q*own;
      else if(Number.isFinite(stored))sum+=stored;
    }
    return sum;
  }

  function decorateWallet(root,res){
    const heading=findLeaf(root,/^BÖRSE\s*\/\s*WALLET$/i);if(!heading)return;
    let section=heading.parentElement;
    for(let i=0;i<5&&section?.parentElement;i++){
      if(/Bitpanda/i.test(section.textContent||'')&&/Pionex/i.test(section.textContent||''))break;
      section=section.parentElement;
    }
    if(!section)return;
    const pionex=findLeaf(section,/^Pionex$/i);if(!pionex)return;
    let row=pionex.parentElement;
    for(let i=0;i<4&&row?.parentElement;i++){
      if(/Pionex/i.test(row.textContent||'')&&/\$/.test(row.textContent||''))break;
      row=row.parentElement;
    }
    if(!row)return;
    const money=leafs(row).find(el=>/^\s*\$\s*[\d.]+(?:,\d+)?\s*$/.test(String(el.textContent||'')));
    if(money)money.textContent=fmtUsd(res.value);
    const badge=leafs(row).find(el=>/^(SNAPSHOT|EQUITY SNAPSHOT|STATIC SEED)$/i.test(String(el.textContent||'').trim()));
    if(badge)badge.textContent=res.source==='KNOWN_SEED'?'STATIC SEED':'EQUITY SNAPSHOT';
  }

  function decorate(d,res){
    const root=document.getElementById('view-depot');if(!root)return;
    const spot=spotValue(d);
    const line=leafs(root).find(el=>/^GESAMT\s*=\s*SPOT\s*\+/i.test(String(el.textContent||'').trim()));
    if(line)line.textContent=`GESAMT = SPOT + PIONEX EQUITY · SPOT ${fmtK(spot)} · PIONEX ${fmtUsd(res.value)} ${res.source==='KNOWN_SEED'?'STATIC SEED':'PRIVATE SNAPSHOT'}`;

    decorateWallet(root,res);

    const exposure=findLeaf(root,/^FUTURES\s*&\s*EXPOSURE$/i);
    if(exposure){
      let section=exposure.parentElement;
      for(let i=0;i<5&&section?.parentElement;i++){
        const t=String(section.textContent||'');
        if(/PIONEX/i.test(t)&&/BOT-KAPITAL/i.test(t))break;
        section=section.parentElement;
      }
      const label=section&&findLeaf(section,/^PIONEX$/i);
      const money=label?.parentElement&&leafs(label.parentElement).find(el=>/^\s*\$\s*[\d.]+(?:,\d+)?\s*$/.test(String(el.textContent||'')));
      if(money)money.textContent=fmtUsd(res.value,2);
      let note=section?.querySelector('[data-v762-pionex-source]');
      if(!note&&section){
        note=document.createElement('div');note.dataset.v762PionexSource='1';
        note.style.cssText='margin:6px 0 2px;color:#7f95aa;font:600 9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.055em';
        const anchor=findLeaf(section,/^BOT-KAPITAL$/i)?.parentElement?.parentElement||exposure.parentElement;
        anchor?.insertAdjacentElement('afterend',note);
      }
      if(note)note.textContent=res.source==='KNOWN_SEED'?'PIONEX EQUITY · STATIC SEED · NICHT LIVE':`PIONEX EQUITY · ${res.source.replaceAll('_',' ')} · SSOT`;
    }
  }

  function stamp(){
    window.MERIDIAN_RELEASE_VERSION=VERSION;
    window.MERIDIAN_UI_VERSION=VERSION;
    window.MERIDIAN_RELEASE_BUILD=BUILD;
    window.__MERIDIAN_BUILD__=BUILD;
    const meta=document.querySelector('meta[name="meridian-build"]');if(meta)meta.content=BUILD;
    const badge=document.getElementById('versionBadge');if(badge)badge.textContent=`v${VERSION} · LIVE`;
  }

  function apply(){
    const d=data();stamp();if(!d)return;
    const res=resolvePionex(d);normalizeData(d,res);decorate(d,res);
    setTimeout(()=>{const x=resolvePionex(d);normalizeData(d,x);decorate(d,x)},80);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
  window.addEventListener('pageshow',apply);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});
  setInterval(()=>{if(!document.hidden)apply()},1500);
})();
