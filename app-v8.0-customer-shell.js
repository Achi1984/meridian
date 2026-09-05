/* MERIDIAN v8.0 — customer-centered UI shell. Presentation only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='8.0';
  const BUILD='8.0-20260905-R0';

  function stamp(){
    window.MERIDIAN_RELEASE_VERSION=VERSION;
    window.MERIDIAN_UI_VERSION=VERSION;
    window.MERIDIAN_RELEASE_BUILD=BUILD;
    window.__MERIDIAN_BUILD__=BUILD;
    document.documentElement.dataset.meridianUi='v8';
    const meta=document.querySelector('meta[name="meridian-build"]');if(meta)meta.content=BUILD;
    const badge=document.getElementById('versionBadge');if(badge)badge.textContent=`v${VERSION} · PREVIEW`;
  }

  function addModeBanner(){
    if(document.getElementById('v8-customer-mode'))return;
    const host=document.querySelector('main')||document.body;
    if(!host)return;
    const el=document.createElement('div');
    el.id='v8-customer-mode';
    el.innerHTML='<b>MERIDIAN v8 · CUSTOMER VIEW</b><span>Answer first · details on demand · research separated</span>';
    host.prepend(el);
  }

  function injectCss(){
    if(document.getElementById('v8-customer-css'))return;
    const s=document.createElement('style');s.id='v8-customer-css';s.textContent=`
      #v8-customer-mode{margin:12px 28px 4px;padding:12px 14px;border:1px solid #173d58;border-radius:16px;background:#06131e;display:flex;align-items:center;justify-content:space-between;gap:12px}
      #v8-customer-mode b{font:800 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:#35bfff}
      #v8-customer-mode span{font:600 9px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:#8294a8;text-align:right}
      @media(max-width:650px){#v8-customer-mode{margin:10px 28px 2px;align-items:flex-start;flex-direction:column}#v8-customer-mode span{text-align:left}}
    `;document.head.appendChild(s);
  }

  function start(){stamp();injectCss();addModeBanner();window.MERIDIAN_V8_STATUS={version:VERSION,build:BUILD,phase:'FOUNDATION',executionImpact:false,frozenLegacy:'archive/v7.65-dashboard-frozen-20260905'};}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  addEventListener('pageshow',start);
})();
