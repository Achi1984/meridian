(function(){
  'use strict';

  function originalNavButton(view){
    return document.querySelector('.bottom .nav[data-view="'+view+'"]');
  }

  function triggerView(view){
    const btn=originalNavButton(view);
    try{
      if(btn){btn.click();return true}
    }catch(_e){}
    try{
      if(document.body)document.body.dataset.view=view;
      if(typeof window.renderOne==='function'){window.renderOne(view);return true}
      if(typeof renderOne==='function'){renderOne(view);return true}
    }catch(e){console.warn('MERIDIAN emergency nav',view,e)}
    return false;
  }

  function triggerUnlock(){
    try{
      if(typeof window.meridianUnlockPrivateData==='function')return window.meridianUnlockPrivateData();
      if(typeof window.meridianConfigureReadToken==='function')return window.meridianConfigureReadToken();
    }catch(e){console.warn('MERIDIAN emergency unlock',e)}
  }

  function install(){
    if(document.getElementById('v760-emergency-hit-layer'))return;
    const layer=document.createElement('div');
    layer.id='v760-emergency-hit-layer';
    layer.innerHTML='\
      <button data-view="center" aria-label="Center"></button>\
      <button data-view="portfolio" aria-label="Depot"></button>\
      <button data-view="market" aria-label="Markt"></button>\
      <button data-view="daytrade" aria-label="Trade"></button>\
      <button data-view="paper" aria-label="Paper"></button>\
      <button data-view="forecast" aria-label="Forecast"></button>';
    document.body.appendChild(layer);

    const style=document.createElement('style');
    style.id='v760-emergency-hit-style';
    style.textContent=`
      #v760-emergency-hit-layer{position:fixed;left:0;right:0;bottom:0;height:calc(78px + env(safe-area-inset-bottom));z-index:2147483646;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));pointer-events:auto;background:transparent}
      #v760-emergency-hit-layer button{border:0;background:transparent;color:transparent;padding:0;margin:0;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
      #v760-emergency-unlock-hit{position:fixed;right:18px;bottom:calc(112px + env(safe-area-inset-bottom));width:128px;height:54px;z-index:2147483647;border:0;background:transparent;color:transparent;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    `;
    document.head.appendChild(style);

    layer.querySelectorAll('button[data-view]').forEach(btn=>{
      const fire=ev=>{ev.preventDefault();ev.stopPropagation();triggerView(btn.dataset.view)};
      btn.addEventListener('pointerdown',fire,{passive:false});
      btn.addEventListener('touchstart',fire,{passive:false});
    });

    const unlock=document.createElement('button');
    unlock.id='v760-emergency-unlock-hit';
    unlock.type='button';
    unlock.setAttribute('aria-label','Private Daten entsperren');
    document.body.appendChild(unlock);
    const ufire=ev=>{ev.preventDefault();ev.stopPropagation();triggerUnlock()};
    unlock.addEventListener('pointerdown',ufire,{passive:false});
    unlock.addEventListener('touchstart',ufire,{passive:false});
  }

  function syncUnlockHit(){
    const hit=document.getElementById('v760-emergency-unlock-hit');
    if(!hit)return;
    hit.style.display=document.getElementById('v733-private-unlock')?'block':'none';
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{install();syncUnlockHit()},{once:true});
  else {install();syncUnlockHit()}
  addEventListener('pageshow',()=>{install();syncUnlockHit()});
  setInterval(syncUnlockHit,500);
})();
