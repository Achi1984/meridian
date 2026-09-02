/* MERIDIAN v7.60 — canonical mobile header/navigation polish.
   Uses the user-approved ACHI MERIDIAN banner asset. No live/refresh controls in the top bar. */
(function(){
  'use strict';
  const STYLE_ID='meridian-v760-canonical-header-style';
  const BRAND_IMG_ID='meridian-horizontal-brand';
  const LOGO_SRC='assets/achi-meridian-topbar.webp?v=7.60-R11';

  function installStyle(){
    let s=document.getElementById(STYLE_ID);
    if(!s){s=document.createElement('style');s.id=STYLE_ID;document.head.appendChild(s)}
    s.textContent=`
      .topbar{display:block!important;margin:0 0 10px!important;padding:0!important;text-align:center!important}
      .topbar .brand{width:100%!important;min-width:0!important;margin:0 auto!important}
      .topbar .brandline{display:flex!important;align-items:center!important;justify-content:center!important;width:100%!important;margin:0 auto!important;gap:0!important}
      #${BRAND_IMG_ID}{display:block!important;width:min(100%,780px)!important;height:auto!important;max-height:96px!important;object-fit:contain!important;object-position:center!important;margin:0 auto!important;filter:drop-shadow(0 0 10px rgba(32,164,255,.16))}
      #meridian-release-status-row,.topbar .live,.topbar .version,.topbar #versionBadge,.topbar #meridian-runtime-badge,.top-actions,.logo-btn,#refreshTime{display:none!important}
      .bottom .inner{grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:2px!important;align-items:stretch!important}
      .bottom .nav{min-width:0!important;width:100%!important;padding:7px 0!important;font-size:7.5px!important;text-align:center!important}
      .bottom .nav span{font-size:13px!important;margin-bottom:3px!important}
      @media(max-width:650px){
        .topbar{margin-bottom:8px!important}
        #${BRAND_IMG_ID}{width:min(100%,700px)!important;max-height:74px!important}
        .bottom .inner{grid-template-columns:repeat(6,minmax(0,1fr))!important;padding-left:2px!important;padding-right:2px!important}
        .bottom .nav{font-size:7px!important;padding:7px 0!important}
        .bottom .nav span{font-size:12px!important}
      }
      @media(max-width:390px){
        #${BRAND_IMG_ID}{max-height:68px!important}
        .bottom .nav{font-size:6.6px!important}
        .bottom .nav span{font-size:11px!important}
      }
    `;
  }

  function installBrand(){
    const brand=document.querySelector('.topbar .brand');
    const brandline=brand?.querySelector('.brandline');
    if(!brand||!brandline)return false;
    let img=document.getElementById(BRAND_IMG_ID);
    if(!img){
      brandline.innerHTML='';
      img=document.createElement('img');
      img.id=BRAND_IMG_ID;
      img.alt='ACHI MERIDIAN';
      img.decoding='async';
      img.src=LOGO_SRC;
      brandline.appendChild(img);
    }else if(img.getAttribute('src')!==LOGO_SRC){
      img.src=LOGO_SRC;
    }
    brand.querySelectorAll('.live,#versionBadge,#meridian-runtime-badge,#meridian-release-status-row').forEach(el=>el.style.display='none');
    document.querySelector('.topbar .top-actions')?.setAttribute('aria-hidden','true');
    document.body?.setAttribute('data-v760-header-ready','true');
    return true;
  }

  function normalizeNav(){
    const inner=document.querySelector('.bottom .inner');
    if(!inner)return false;
    inner.style.setProperty('grid-template-columns','repeat(6,minmax(0,1fr))','important');
    return true;
  }

  function apply(){installStyle();installBrand();normalizeNav()}
  function start(){
    apply();
    const root=document.body;
    if(root&&typeof MutationObserver!=='undefined')new MutationObserver(apply).observe(root,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  addEventListener('pageshow',apply);
  addEventListener('resize',apply);
})();