/* MERIDIAN release authority — runtime version/build SSOT plus stale-bootstrap recovery. Presentation/runtime metadata only; execution unchanged. */
(function(){
  'use strict';
  const POLL_MS=30000;
  let expected=null;
  let busy=false;
  let badgeObserver=null;

  function valid(j){
    const version=String(j?.version||j?.ui||'').trim();
    const build=String(j?.buildId||'').trim();
    return /^\d+\.\d+$/.test(version)&&build.startsWith(version+'-')?{version,build}:null;
  }
  function cacheTag(x){return x.version+'-'+x.build.split('-').slice(-1)[0]}
  function bootstrapMismatch(x){
    const wanted=cacheTag(x);
    const active=String(window.MERIDIAN_LOADER_TAG||window.__MERIDIAN_LOADER_ACTIVE__||'');
    if(!active||active===wanted)return false;
    window.__MERIDIAN_BOOTSTRAP_REDIRECTS__=window.__MERIDIAN_BOOTSTRAP_REDIRECTS__||{};
    if(window.__MERIDIAN_BOOTSTRAP_REDIRECTS__[wanted])return false;
    window.__MERIDIAN_BOOTSTRAP_REDIRECTS__[wanted]=true;
    for(const id of ['v8-navigation-css','v8-trade-css','v8-center-css','v8-depot-css','v8-paper-css','v8-more-css'])document.getElementById(id)?.remove();
    document.getElementById('v8-bottom-nav')?.remove();
    for(const id of ['v8-center-summary','v8-depot-summary','v8-trade-summary','v8-paper-summary'])document.getElementById(id)?.remove();
    document.documentElement.classList.remove('v8-nav-ready');
    const s=document.createElement('script');
    s.src=`app-v6.06.js?v=${encodeURIComponent(wanted)}&authority=${Date.now()}`;
    s.async=false;s.dataset.meridianBootstrap='release-authority';
    (document.head||document.documentElement).appendChild(s);
    return true;
  }
  function paint(x){
    if(!x)return;
    expected=x;
    window.MERIDIAN_RELEASE_VERSION=x.version;
    window.MERIDIAN_UI_VERSION=x.version;
    window.MERIDIAN_RELEASE_BUILD=x.build;
    window.__MERIDIAN_BUILD__=x.build;
    try{if(typeof APP_CODE_VERSION!=='undefined')APP_CODE_VERSION=x.version}catch(_e){}
    const meta=document.querySelector('meta[name="meridian-build"]');
    if(meta)meta.content=x.build;
    const badge=document.getElementById('versionBadge');
    const label=`v${x.version} · LIVE`;
    if(badge&&badge.textContent!==label)badge.textContent=label;
    const manifest=document.querySelector('link[rel="manifest"]');
    if(manifest){
      const href='manifest.webmanifest?v='+encodeURIComponent(cacheTag(x));
      if(manifest.getAttribute('href')!==href)manifest.setAttribute('href',href);
    }
    document.querySelectorAll('[data-ui-version]').forEach(el=>{if(el.textContent!==x.version)el.textContent=x.version});
    window.MERIDIAN_RELEASE_AUTHORITY={...x,source:'version.json',loaderTag:String(window.MERIDIAN_LOADER_TAG||''),appliedAt:new Date().toISOString()};
  }
  function observeBadge(){
    const badge=document.getElementById('versionBadge');
    if(!badge||badgeObserver)return;
    badgeObserver=new MutationObserver(()=>{if(expected)paint(expected)});
    badgeObserver.observe(badge,{childList:true,characterData:true,subtree:true});
  }
  async function refresh(){
    if(busy)return;
    busy=true;
    try{
      const r=await fetch('version.json?authority='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('version HTTP '+r.status);
      const x=valid(await r.json());
      if(!x)throw new Error('invalid version.json');
      const refreshed=bootstrapMismatch(x);
      paint(x);observeBadge();
      if(refreshed)window.MERIDIAN_RELEASE_AUTHORITY.bootstrapRefreshRequested=true;
    }catch(e){
      const fallback=valid({version:window.MERIDIAN_RELEASE_VERSION||window.MERIDIAN_UI_VERSION,buildId:window.MERIDIAN_RELEASE_BUILD||window.__MERIDIAN_BUILD__});
      if(fallback)paint(fallback);
      console.warn('MERIDIAN release authority',e);
    }finally{busy=false}
  }
  function start(){refresh();observeBadge()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
  setInterval(()=>{if(!document.hidden)refresh()},POLL_MS);
})();
