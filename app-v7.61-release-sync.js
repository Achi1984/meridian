/* MERIDIAN v7.61 R7 — release/cache authority bridge. UI only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='7.61';
  const BUILD='7.61-20260904-R7';
  const STYLE_ID='meridian-v761-r7-tabs';

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
      const tag=`${VERSION}-R7`;
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
        min-height:0!important;height:auto!important;padding:4px!important;
        margin:0 0 12px!important;gap:4px!important;border:1px solid #173f5b!important;
        border-radius:15px!important;background:#06111a!important;box-shadow:none!important
      }
      #view-market .segment-nav button,
      #view-daytrade .segment-nav button,
      #view-trade .segment-nav button{
        min-width:0!important;width:100%!important;min-height:42px!important;height:42px!important;
        padding:0 12px!important;margin:0!important;border:1px solid transparent!important;
        border-radius:11px!important;background:transparent!important;color:#8293a7!important;
        font-size:11px!important;font-weight:900!important;letter-spacing:.08em!important;
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

  function apply(){
    stamp();
    tabStyle();
    bustStyles();
    setTimeout(()=>window.MERIDIAN_RUNTIME_CHECK?.(),80);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  window.addEventListener('pageshow',apply);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});
})();
