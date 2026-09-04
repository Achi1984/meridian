/* MERIDIAN v7.61 R11 — release/cache authority + TRADE freshness + DEPOT SSOT semantics. UI/data-source correction only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='7.61';
  const BUILD='7.61-20260904-R11';
  const STYLE_ID='meridian-v761-r11-tabs';
  const MARKET_LIVE_MS=45000;
  const TECH_LIVE_MS=120000;

  function getData(){
    try{return typeof DATA!=='undefined'?DATA:window.DATA}catch(_e){return window.DATA||null}
  }
  function stamp(){
    window.MERIDIAN_RELEASE_VERSION=VERSION;
    window.MERIDIAN_UI_VERSION=VERSION;
    window.MERIDIAN_RELEASE_BUILD=BUILD;
    window.__MERIDIAN_BUILD__=BUILD;
    const meta=document.querySelector('meta[name="meridian-build"]');
    if(meta)meta.content=BUILD;
    const badge=document.getElementById('versionBadge');
    if(badge)badge.textContent=`v${VERSION} · LIVE`;
  }

  function bustStyles(){
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{
      const raw=link.getAttribute('href')||'';
      if(!/styles-v6\.06\.css/i.test(raw))return;
      const u=new URL(raw,location.href);
      const tag=`${VERSION}-R11`;
      if(u.searchParams.get('v')===tag)return;
      u.searchParams.set('v',tag);
      link.href=u.pathname+u.search;
    });
  }

  function tabStyle(){
    if(document.getElementById(STYLE_ID))return;
    document.querySelectorAll('[id^="meridian-v761-r"][id$="-tabs"]').forEach(x=>x.remove());
    const s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent=`
      #view-market .segment-nav,
      #view-daytrade .segment-nav,
      #view-trade .segment-nav{
        position:relative!important;top:auto!important;z-index:auto!important;
        display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;
        min-height:0!important;height:auto!important;padding:3px!important;
        margin:0 0 10px!important;gap:3px!important;border:1px solid #173f5b!important;
        border-radius:13px!important;background:#06111a!important;box-shadow:none!important
      }
      #view-market .segment-nav button,
      #view-daytrade .segment-nav button,
      #view-trade .segment-nav button{
        min-width:0!important;width:100%!important;min-height:38px!important;height:38px!important;
        padding:0 10px!important;margin:0!important;border:1px solid transparent!important;
        border-radius:9px!important;background:transparent!important;color:#8293a7!important;
        font-size:10px!important;font-weight:900!important;letter-spacing:.08em!important;
        line-height:1!important;box-shadow:none!important
      }
      #view-market .segment-nav button.active,
      #view-daytrade .segment-nav button.active,
      #view-trade .segment-nav button.active{
        color:#27adff!important;border-color:#1685c7!important;background:rgba(32,164,255,.08)!important
      }
      [data-v761-depot-source-note]{font-size:8px!important;letter-spacing:.07em!important;color:#7f95aa!important}
    `;
    document.head.appendChild(s);
  }

  function syncTradeDataFreshness(){
    const data=getData();
    const d=data?.dayTrade;
    if(!d)return;
    d.status=d.status||{};

    const q=data?.livePrices?.BTC;
    const qTs=Number(q?.updatedAt)||0;
    const qAge=qTs?Date.now()-qTs:Infinity;
    const qPrice=Number(q?.price);
    const qState=String(q?.status||'').toUpperCase();
    const qLive=Number.isFinite(qPrice)&&qPrice>0&&qState==='LIVE'&&qAge<=MARKET_LIVE_MS;
    const qFresh=Number.isFinite(qPrice)&&qPrice>0&&qAge<=MARKET_LIVE_MS*2;

    const techTs=Date.parse(d.technicalUpdatedAt||'');
    const techFresh=Number.isFinite(techTs)&&(Date.now()-techTs)<=TECH_LIVE_MS;

    if(qLive){
      d.btcPrice=qPrice;
      d.status.btcPrice=`BROWSER LIVE · MARKET SSOT · ${q?.source||'Binance'}`;
      d.btcPriceSource='MARKET_SSOT';
      d.btcPriceUpdatedAt=new Date(qTs).toISOString();
    }else if(qFresh){
      d.btcPrice=qPrice;
      d.status.btcPrice=`FALLBACK · MARKET SSOT · ${q?.source||'Market feed'}`;
      d.btcPriceSource='MARKET_SSOT_FALLBACK';
      d.btcPriceUpdatedAt=new Date(qTs).toISOString();
    }else if(!techFresh){
      d.status.btcPrice='SNAPSHOT · MARKET PRICE UNAVAILABLE';
      d.btcPriceSource='SNAPSHOT';
    }

    const technicalKeys=['oiB','rsi4h','rsi1h','fundingPct','vwap'];
    if(!techFresh){
      for(const key of technicalKeys)d.status[key]='SNAPSHOT · FUTURES REFRESH REQUIRED';
      d.technicalFreshness='STALE_OR_SNAPSHOT';
    }else{
      d.technicalFreshness='LIVE';
    }
  }

  function leafs(root){return root?[...root.querySelectorAll('*')].filter(el=>el.children.length===0):[]}
  function findLeaf(root,re){return leafs(root).find(el=>re.test(String(el.textContent||'').trim()))||null}
  function fmtUsd(v){return '$'+new Intl.NumberFormat('de-DE',{minimumFractionDigits:0,maximumFractionDigits:0}).format(Number(v)||0)}
  function fmtPct(v){return new Intl.NumberFormat('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(v)||0)+'%'}
  function holdingValue(data,h){
    const q=Number(h?.quantity);
    const live=Number(data?.livePrices?.[h?.symbol]?.price);
    const own=Number(h?.price);
    const stored=Number(h?.value??h?.valueUsd);
    if(Number.isFinite(q)&&q>=0&&Number.isFinite(live)&&live>0)return q*live;
    if(Number.isFinite(q)&&q>=0&&Number.isFinite(own)&&own>0)return q*own;
    return Number.isFinite(stored)?stored:0;
  }
  function pionexEquity(data){
    const direct=Number(data?.portfolio?.pionexEquityUsd);
    if(Number.isFinite(direct)&&direct>=0)return direct;
    const rows=Array.isArray(data?.portfolio?.manualVenueBalances)?data.portfolio.manualVenueBalances:[];
    const p=rows.find(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex');
    const n=Number(p?.value??p?.valueUsd);
    return Number.isFinite(n)&&n>=0?n:0;
  }
  function liveVenueTotals(data){
    const out={};
    const hs=Array.isArray(data?.portfolio?.holdings)?data.portfolio.holdings:[];
    for(const h of hs){
      const venue=String(h?.venue||'').trim();
      if(!venue||venue.toLowerCase()==='pionex')continue;
      out[venue]=(out[venue]||0)+holdingValue(data,h);
    }
    const px=pionexEquity(data);if(px>0)out.Pionex=px;
    return out;
  }
  function rowForVenue(scope,name){
    const candidates=leafs(scope).filter(el=>String(el.textContent||'').trim().toLowerCase()===name.toLowerCase());
    for(const el of candidates){
      let node=el.parentElement;
      for(let i=0;i<5&&node;i++,node=node.parentElement){
        const t=String(node.textContent||'').replace(/\s+/g,' ');
        if(/\$\s*[\d.]+(?:,\d+)?/.test(t)&&t.length<260)return node;
      }
    }
    return null;
  }
  function normalizeVenueRow(row,name,value,total){
    if(!row)return;
    const ls=leafs(row);
    const money=ls.find(el=>/^\s*\$\s*[\d.]+(?:,\d+)?\s*$/.test(String(el.textContent||'')));
    if(money)money.textContent=fmtUsd(value);
    const pct=ls.find(el=>/^\s*\d+(?:[.,]\d+)?%\s*$/.test(String(el.textContent||'')));
    if(pct&&total>0)pct.textContent=fmtPct(value/total*100);
    const snap=ls.find(el=>/^\s*SNAPSHOT\s*$/i.test(String(el.textContent||'')));
    if(snap){
      snap.textContent=name.toLowerCase()==='pionex'?'EQUITY SNAP':'BESTAND SNAP · PREIS LIVE';
      snap.dataset.v761DepotSourceNote='1';
    }
  }
  function fixBtcBotUnits(root){
    const btc=findLeaf(root,/^BTC SHORT$/i);if(!btc)return;
    let card=btc.parentElement;
    for(let i=0;i<5&&card?.parentElement;i++){
      const t=String(card.textContent||'').replace(/\s+/g,' ');
      if(/BTC-S30/i.test(t)&&/Grid Profit/i.test(t)&&/Trend P&L/i.test(t)){break}
      card=card.parentElement;
    }
    if(!card)return;
    for(const label of ['Grid Profit','Trend P&L']){
      const l=findLeaf(card,new RegExp('^'+label.replace(/[&]/g,'\\&')+'$','i'));
      const box=l?.parentElement;if(!box)continue;
      const val=leafs(box).find(el=>/BTC\s*$/i.test(String(el.textContent||'')));
      if(val)val.textContent=String(val.textContent||'').replace(/BTC\s*$/i,'USDT');
    }
  }
  function clarifyDepotCopy(root){
    const note=findLeaf(root,/^Keine kritische aktive Futures-Position\./i);
    if(note)note.textContent='Keine Position unter dem 8%-Gate. BTC-S30 liegt nahe am Gate; operative Ausführung ausschließlich über GRID/Pionex-Recheck.';
    const spots=findLeaf(root,/^SPOT-VERWAHRSTELLEN$/i);
    if(spots){
      const box=spots.parentElement;
      const count=box&&leafs(box).find(el=>/^\d+$/.test(String(el.textContent||'').trim()));
      if(count&&String(count.textContent||'').trim()==='3')spots.textContent='SPOT-VERWAHRSTELLEN · +1 TRADING VENUE';
    }
  }
  function decorateDepot(){
    const data=getData();
    const root=document.getElementById('view-depot');
    if(!data||!root)return;
    const totals=liveVenueTotals(data);
    const total=Object.values(totals).reduce((a,b)=>a+(Number(b)||0),0);
    const walletHeading=findLeaf(root,/^BÖRSE\s*\/\s*WALLET$/i);
    let scope=root;
    if(walletHeading){
      let n=walletHeading.parentElement;
      for(let i=0;i<4&&n?.parentElement;i++){
        const t=String(n.textContent||'');
        if(/Bitpanda/i.test(t)&&/OKX/i.test(t)&&/Ledger/i.test(t)){scope=n;break}
        n=n.parentElement;
      }
    }
    for(const [name,value] of Object.entries(totals))normalizeVenueRow(rowForVenue(scope,name),name,value,total);
    fixBtcBotUnits(root);
    clarifyDepotCopy(root);
  }

  function installRenderBridge(){
    try{
      if(typeof renderAll!=='function'||renderAll.__v761R11Wrapped)return;
      const original=renderAll;
      const wrapped=function(){
        syncTradeDataFreshness();
        const out=original.apply(this,arguments);
        setTimeout(decorateDepot,0);
        return out;
      };
      wrapped.__v761R11Wrapped=true;
      wrapped.__v761R11Original=original;
      renderAll=wrapped;
    }catch(_e){}
  }

  function apply(){
    stamp();
    tabStyle();
    bustStyles();
    installRenderBridge();
    syncTradeDataFreshness();
    try{if(typeof renderAll==='function')renderAll()}catch(_e){}
    setTimeout(decorateDepot,20);
    setTimeout(()=>window.MERIDIAN_RUNTIME_CHECK?.(),80);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  window.addEventListener('pageshow',apply);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});
  setInterval(()=>{if(!document.hidden){syncTradeDataFreshness();decorateDepot()}},1500);
})();
