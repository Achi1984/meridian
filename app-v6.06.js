/* MERIDIAN compatibility loader. The legacy filename remains referenced by index.html. */
(function(){
  'use strict';
  const TAG='8.0-R7';
  const src=x=>x+'?v='+TAG;
  if(document.readyState==='loading'){
    document.write('<script src="'+src('app-v7.32-legacy.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.33-hardening.js')+'"><\/script>');
    document.write('<script src="'+src('app-runtime-monitor.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.37-ui-polish.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.38-regime-ui.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.39-paper-overview.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.60-dashboard-consistency.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.61-release-sync.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.61-market-audit.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.61-depot-audit.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.62-pionex-ssot.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.62-market-consistency.js')+'"><\/script>');
    document.write('<script src="'+src('trade-risk-presentation-v765.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.65-trade-risk-cleanup.js')+'"><\/script>');
    document.write('<script src="'+src('app-v7.65-paper-activity-cleanup.js')+'"><\/script>');
    document.write('<script src="'+src('app-v8.0-customer-shell.js')+'"><\/script>');
    document.write('<script src="'+src('app-v8.0-paper-summary.js')+'"><\/script>');
    document.write('<script src="'+src('app-v8.0-trade-summary.js')+'"><\/script>');
    document.write('<script src="'+src('app-v8.0-center-summary.js')+'"><\/script>');
    document.write('<script src="'+src('app-v8.0-depot-summary.js')+'"><\/script>');
    document.write('<script src="'+src('app-v8.0-more-hub.js')+'"><\/script>');
    document.write('<script src="'+src('app-v8.0-navigation.js')+'"><\/script>');
    document.write('<script src="'+src('app-release-authority.js')+'"><\/script>');
    return;
  }
  const load=file=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src(file);s.async=false;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
  load('app-v7.32-legacy.js')
    .then(()=>load('app-v7.33-hardening.js'))
    .then(()=>load('app-runtime-monitor.js'))
    .then(()=>load('app-v7.37-ui-polish.js'))
    .then(()=>load('app-v7.38-regime-ui.js'))
    .then(()=>load('app-v7.39-paper-overview.js'))
    .then(()=>load('app-v7.60-dashboard-consistency.js'))
    .then(()=>load('app-v7.61-release-sync.js'))
    .then(()=>load('app-v7.61-market-audit.js'))
    .then(()=>load('app-v7.61-depot-audit.js'))
    .then(()=>load('app-v7.62-pionex-ssot.js'))
    .then(()=>load('app-v7.62-market-consistency.js'))
    .then(()=>load('trade-risk-presentation-v765.js'))
    .then(()=>load('app-v7.65-trade-risk-cleanup.js'))
    .then(()=>load('app-v7.65-paper-activity-cleanup.js'))
    .then(()=>load('app-v8.0-customer-shell.js'))
    .then(()=>load('app-v8.0-paper-summary.js'))
    .then(()=>load('app-v8.0-trade-summary.js'))
    .then(()=>load('app-v8.0-center-summary.js'))
    .then(()=>load('app-v8.0-depot-summary.js'))
    .then(()=>load('app-v8.0-more-hub.js'))
    .then(()=>load('app-v8.0-navigation.js'))
    .then(()=>load('app-release-authority.js'))
    .catch(e=>console.error('MERIDIAN loader',e));
})();