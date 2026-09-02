/* MERIDIAN canonical compatibility loader. index.html contains the canonical render engine. */
(function(){
  'use strict';
  const scripts=[
    'app-v7.33-hardening.js?v=7.60-R12',
    'app-runtime-monitor.js?v=7.60-R12',
    'app-v7.37-ui-polish.js?v=7.60-R12',
    'app-v7.38-regime-ui.js?v=7.60-R12',
    'app-v7.39-paper-overview.js?v=7.60-R12',
    'app-v7.60-dashboard-consistency.js?v=7.60-R12',
    'app-v7.60-private-hydration-hotfix.js?v=7.60-R12',
    'app-v7.60-final-ui-authority.js?v=7.60-R12'
  ];
  if(document.readyState==='loading'){
    scripts.forEach(src=>document.write('<script src="'+src+'"></'+'script>'));
    return;
  }
  const load=src=>new Promise((resolve,reject)=>{
    const s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=()=>reject(new Error('MERIDIAN script failed: '+src));document.head.appendChild(s);
  });
  scripts.reduce((p,src)=>p.then(()=>load(src)),Promise.resolve()).catch(e=>console.error('MERIDIAN canonical loader',e));
})();
