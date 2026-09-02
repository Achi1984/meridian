(function(){
  'use strict';

  function installStyles(){
    let s=document.getElementById('v760-nav-hotfix-style');
    if(!s){s=document.createElement('style');s.id='v760-nav-hotfix-style';document.head.appendChild(s)}
    s.textContent=`
      #v733-private-unlock{bottom:calc(96px + env(safe-area-inset-bottom))!important;pointer-events:none!important;z-index:60!important}
      #v733-private-unlock button{pointer-events:auto!important}
      .bottom{z-index:100!important;pointer-events:auto!important}
      .bottom .inner,.bottom .nav{pointer-events:auto!important;touch-action:manipulation!important}
      @media(max-width:520px){#v733-private-unlock{bottom:calc(98px + env(safe-area-inset-bottom))!important}}
    `;
  }

  // Important: navigation events are owned by the canonical v7.05 delegated router
  // embedded in index.html. This hotfix only protects the touch/z-index area.
  // A previous R3 capture listener stopped propagation before v7.05 could paint/hide views.
  function boot(){
    installStyles();
    try{delete document.documentElement.dataset.v760NavHotfix}catch(_e){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
  addEventListener('pageshow',boot);
})();