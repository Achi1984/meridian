/* MERIDIAN compatibility loader. Legacy filename is intentionally preserved; module cache tags are authority-driven. */
(function(){
  'use strict';
  const LOCAL_TAG='8.0-R9';
  const FILES=[
    'app-v7.32-legacy.js','app-v7.33-hardening.js','app-runtime-monitor.js','app-v7.37-ui-polish.js',
    'app-v7.38-regime-ui.js','app-v7.39-paper-overview.js','app-v7.60-dashboard-consistency.js',
    'app-v7.61-release-sync.js','app-v7.61-market-audit.js','app-v7.61-depot-audit.js',
    'app-v7.62-pionex-ssot.js','app-v7.62-market-consistency.js','trade-risk-presentation-v765.js',
    'app-v7.65-trade-risk-cleanup.js','app-v7.65-paper-activity-cleanup.js','app-v8.0-customer-shell.js',
    'app-v8.0-paper-summary.js','app-v8.0-trade-summary.js','app-v8.0-center-summary.js',
    'app-v8.0-depot-summary.js','app-v8.0-more-hub.js','app-v8.0-navigation.js','app-release-authority.js'
  ];
  const BOOTSTRAP_CSS_IDS=['v8-navigation-css','v8-trade-css','v8-center-css','v8-depot-css','v8-paper-css','v8-more-css'];

  function authorityTag(j){
    const version=String(j?.version||j?.ui||'').trim();
    const build=String(j?.buildId||'').trim();
    if(!/^\d+\.\d+$/.test(version)||!build.startsWith(version+'-'))return null;
    const suffix=build.split('-').slice(-1)[0];
    return suffix?`${version}-${suffix}`:null;
  }
  async function latestTag(){
    try{
      const r=await fetch(`version.json?bootstrap=${Date.now()}`,{cache:'no-store'});
      if(!r.ok)throw new Error('version HTTP '+r.status);
      return authorityTag(await r.json())||LOCAL_TAG;
    }catch(_e){return LOCAL_TAG;}
  }
  function src(file,tag){return `${file}?v=${encodeURIComponent(tag)}`;}
  function load(file,tag){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=src(file,tag);s.async=false;s.dataset.meridianLoaderTag=tag;
      s.onload=resolve;s.onerror=()=>reject(new Error('load failed: '+file));
      (document.head||document.documentElement).appendChild(s);
    });
  }
  function prepareHotReload(){
    for(const id of BOOTSTRAP_CSS_IDS)document.getElementById(id)?.remove();
    document.getElementById('v8-bottom-nav')?.remove();
    document.documentElement.classList.remove('v8-nav-ready');
    for(const id of ['v8-center-summary','v8-depot-summary','v8-trade-summary','v8-paper-summary'])document.getElementById(id)?.remove();
  }
  function injectLatestLoader(tag){
    window.__MERIDIAN_BOOTSTRAP_REDIRECTS__=window.__MERIDIAN_BOOTSTRAP_REDIRECTS__||{};
    if(window.__MERIDIAN_BOOTSTRAP_REDIRECTS__[tag])return false;
    window.__MERIDIAN_BOOTSTRAP_REDIRECTS__[tag]=true;
    prepareHotReload();
    const s=document.createElement('script');
    s.src=`app-v6.06.js?v=${encodeURIComponent(tag)}&bootstrap=${Date.now()}`;
    s.async=false;s.dataset.meridianBootstrap='authority-refresh';
    (document.head||document.documentElement).appendChild(s);
    return true;
  }
  async function boot(){
    const wanted=await latestTag();
    if(wanted!==LOCAL_TAG){injectLatestLoader(wanted);return;}
    if(window.__MERIDIAN_LOADER_ACTIVE__===LOCAL_TAG)return;
    window.__MERIDIAN_LOADER_ACTIVE__=LOCAL_TAG;
    window.MERIDIAN_LOADER_TAG=LOCAL_TAG;
    for(const file of FILES)await load(file,LOCAL_TAG);
  }
  boot().catch(e=>console.error('MERIDIAN loader',e));
})();
