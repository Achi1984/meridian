/* MERIDIAN compatibility loader. The legacy filename remains referenced by index.html. */
(function(){
  'use strict';
  if(document.readyState==='loading'){
    document.write('<script src="app-v7.32-legacy.js?v=7.47-R1"><\/script>');
    document.write('<script src="app-v7.33-hardening.js?v=7.47-R1"><\/script>');
    document.write('<script src="app-runtime-monitor.js?v=7.47-R1"><\/script>');
    document.write('<script src="app-v7.37-ui-polish.js?v=7.47-R1"><\/script>');
    document.write('<script src="app-v7.38-regime-ui.js?v=7.47-R1"><\/script>');
    document.write('<script src="app-v7.39-paper-overview.js?v=7.47-R1"><\/script>');
    return;
  }
  const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
  load('app-v7.32-legacy.js?v=7.47-R1')
    .then(()=>load('app-v7.33-hardening.js?v=7.47-R1'))
    .then(()=>load('app-runtime-monitor.js?v=7.47-R1'))
    .then(()=>load('app-v7.37-ui-polish.js?v=7.47-R1'))
    .then(()=>load('app-v7.38-regime-ui.js?v=7.47-R1'))
    .then(()=>load('app-v7.39-paper-overview.js?v=7.47-R1'))
    .catch(e=>console.error('MERIDIAN loader',e));
})();
