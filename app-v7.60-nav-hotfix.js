(function(){
  'use strict';

  function installStyles(){
    if(document.getElementById('v760-nav-hotfix-style'))return;
    const s=document.createElement('style');
    s.id='v760-nav-hotfix-style';
    s.textContent=`
      #v733-private-unlock{bottom:calc(96px + env(safe-area-inset-bottom))!important;pointer-events:none!important;z-index:60!important}
      #v733-private-unlock button{pointer-events:auto!important}
      .bottom{z-index:100!important;pointer-events:auto!important}
      .bottom .inner,.bottom .nav{pointer-events:auto!important}
      @media(max-width:520px){#v733-private-unlock{bottom:calc(98px + env(safe-area-inset-bottom))!important}}
    `;
    document.head.appendChild(s);
  }

  function activate(view,btn){
    try{
      document.querySelectorAll('.bottom .nav[data-view]').forEach(x=>x.classList.toggle('active',x===btn));
      if(document.body)document.body.dataset.view=view;
      if(typeof window.renderOne==='function')window.renderOne(view);
      else if(typeof renderOne==='function')renderOne(view);
    }catch(e){console.warn('MERIDIAN nav hotfix',e)}
  }

  function bind(){
    if(document.documentElement.dataset.v760NavHotfix==='1')return;
    document.documentElement.dataset.v760NavHotfix='1';
    document.addEventListener('click',ev=>{
      const btn=ev.target&&ev.target.closest?ev.target.closest('.bottom .nav[data-view]'):null;
      if(!btn)return;
      ev.preventDefault();
      ev.stopPropagation();
      activate(btn.dataset.view,btn);
    },true);
    document.addEventListener('touchend',ev=>{
      const btn=ev.target&&ev.target.closest?ev.target.closest('.bottom .nav[data-view]'):null;
      if(!btn)return;
      ev.preventDefault();
      activate(btn.dataset.view,btn);
    },{capture:true,passive:false});
  }

  function boot(){installStyles();bind()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
  addEventListener('pageshow',boot);
})();