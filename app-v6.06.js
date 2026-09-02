/* MERIDIAN compatibility loader. The legacy filename remains referenced by index.html. */
(function(){
  'use strict';
  const scripts=[
    'app-v7.32-legacy.js?v=7.60-R1',
    'app-v7.33-hardening.js?v=7.60-R1',
    'app-runtime-monitor.js?v=7.60-R1',
    'app-v7.37-ui-polish.js?v=7.60-R1',
    'app-v7.38-regime-ui.js?v=7.60-R1',
    'app-v7.39-paper-overview.js?v=7.60-R1',
    'app-v7.60-dashboard-consistency.js?v=7.60-R1',
    'app-v7.60-private-hydration-hotfix.js?v=7.60-R7'
  ];
  if(document.readyState==='loading'){
    scripts.forEach(src=>document.write('<script src="'+src+'"><\\/script>'));
    return;
  }
  const load=src=>new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;s.async=false;s.onload=resolve;s.onerror=reject;
    document.head.appendChild(s);
  });
  scripts.reduce((p,src)=>p.then(()=>load(src)),Promise.resolve())
    .catch(e=>console.error('MERIDIAN loader',e));
})();
