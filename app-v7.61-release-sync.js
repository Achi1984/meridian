/* MERIDIAN v7.61 R10 — release/cache authority + TRADE data freshness bridge. UI/data-source correction only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='7.61';
  const BUILD='7.61-20260904-R10';
  const STYLE_ID='meridian-v761-r10-tabs';
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
      const tag=`${VERSION}-R10`;
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

  function installRenderBridge(){
    try{
      if(typeof renderAll!=='function'||renderAll.__v761R10Wrapped)return;
      const original=renderAll;
      const wrapped=function(){
        syncTradeDataFreshness();
        return original.apply(this,arguments);
      };
      wrapped.__v761R10Wrapped=true;
      wrapped.__v761R10Original=original;
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
    setTimeout(()=>window.MERIDIAN_RUNTIME_CHECK?.(),80);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  window.addEventListener('pageshow',apply);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});
  setInterval(()=>{if(!document.hidden)syncTradeDataFreshness()},1500);
})();
