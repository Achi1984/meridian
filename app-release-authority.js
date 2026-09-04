/* MERIDIAN release authority — runtime version/build SSOT. Presentation/runtime metadata only; execution unchanged. */
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
    window.MERIDIAN_RELEASE_AUTHORITY={...x,source:'version.json',appliedAt:new Date().toISOString()};
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
      paint(x);observeBadge();
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
