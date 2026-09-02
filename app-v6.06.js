/* MERIDIAN canonical compatibility loader. index.html contains the canonical render engine.
   Critical rule: legacy inline scripts in index.html must finish first; canonical modules load last. */
(function(){
  'use strict';
  const scripts=[
    'app-v7.33-hardening.js?v=7.60-R16',
    'app-runtime-monitor.js?v=7.60-R16',
    'app-v7.37-ui-polish.js?v=7.60-R16',
    'app-v7.38-regime-ui.js?v=7.60-R16',
    'app-v7.39-paper-overview.js?v=7.60-R16',
    'app-v7.60-dashboard-consistency.js?v=7.60-R16',
    'app-v7.60-private-hydration-hotfix.js?v=7.60-R16',
    'app-v7.60-final-ui-authority.js?v=7.60-R16'
  ];
  let started=false;
  const load=src=>new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;
    s.async=false;
    s.onload=resolve;
    s.onerror=()=>reject(new Error('MERIDIAN script failed: '+src));
    document.head.appendChild(s);
  });
  async function start(){
    if(started)return;
    started=true;
    try{
      for(const src of scripts)await load(src);
      document.documentElement.setAttribute('data-meridian-canonical-ready','true');
      try{
        const view=String(document.body?.dataset?.view||'center');
        if(typeof renderOne==='function')renderOne(view);
        else if(typeof renderAll==='function')renderAll();
      }catch(e){console.warn('MERIDIAN final render recovery',e)}
    }catch(e){
      console.error('MERIDIAN canonical loader',e);
      document.documentElement.setAttribute('data-meridian-canonical-error','true');
    }
  }
  /* app-v6.06.js is intentionally located before many legacy inline blocks in index.html.
     Never document.write canonical modules here: that made them run too early and later legacy
     blocks overwrote header, nav and render hooks. Waiting for window.load makes this loader
     the actual final authority without changing the frozen engine. */
  if(document.readyState==='complete')start();
  else window.addEventListener('load',()=>setTimeout(start,0),{once:true});
})();
