/* MERIDIAN v7.42 — compact two-row mobile header and logo presentation. */
(function(){
  'use strict';

  const STYLE_ID='meridian-v737-ui-style';
  const ROW_ID='meridian-release-status-row';

  function installStyle(){
    if(document.getElementById(STYLE_ID))return;
    const s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent=`
      .brand{min-width:0}
      #${ROW_ID}{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;margin-top:5px;min-height:20px;white-space:nowrap}
      #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge,#${ROW_ID} .live{margin:0!important;flex:0 0 auto}
      #${ROW_ID} .live{display:flex!important;align-items:center!important}
      .logo-btn{overflow:hidden!important;display:flex!important;align-items:center!important;justify-content:center!important}
      .logo-btn img{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;object-position:center!important;box-sizing:border-box!important;padding:3px!important}
      @media(max-width:650px){
        .topbar{grid-template-columns:minmax(0,1fr) auto!important;gap:8px!important;align-items:center!important;margin-bottom:7px!important}
        .brandline{display:block!important;min-width:0}
        .brandword{min-width:0;padding-top:0}
        .brandword .achi{font-size:25px!important;letter-spacing:5px!important;line-height:.94!important;white-space:nowrap!important}
        .brandword .meridian{font-size:10.5px!important;letter-spacing:3.8px!important;margin-top:3px!important;white-space:nowrap!important}
        #${ROW_ID}{gap:5px;margin-top:5px;min-height:18px;max-width:100%;overflow:visible}
        #${ROW_ID} .version{font-size:7.2px!important;line-height:1!important;padding:3px 6px!important}
        #${ROW_ID} #meridian-runtime-badge{font-size:7.2px!important;line-height:1!important;padding:3px 6px!important;gap:4px!important}
        #${ROW_ID} #meridian-runtime-badge::before{width:5px!important;height:5px!important}
        #${ROW_ID} .live{font-size:7.4px!important;letter-spacing:1px!important;line-height:1!important}
        #${ROW_ID} .live .dot,.dot{width:5px!important;height:5px!important;margin-right:4px!important}
        .top-actions{gap:5px!important;align-items:center!important;flex:0 0 auto!important}
        .logo-btn{width:50px!important;height:50px!important;flex:0 0 50px!important}
        .top-actions button:not(.logo-btn){transform:scale(.92);transform-origin:center}
      }
      @media(max-width:390px){
        .topbar{gap:6px!important}
        .brandword .achi{font-size:23px!important;letter-spacing:4.3px!important}
        .brandword .meridian{font-size:9.5px!important;letter-spacing:3.2px!important}
        #${ROW_ID}{gap:4px;margin-top:4px}
        #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge{font-size:6.8px!important;padding:3px 5px!important}
        #${ROW_ID} .live{font-size:6.8px!important;letter-spacing:.8px!important}
        .top-actions{gap:4px!important}
        .logo-btn{width:47px!important;height:47px!important;flex-basis:47px!important}
        .logo-btn img{padding:3px!important}
      }
      @media(min-width:651px){
        #${ROW_ID}{margin-top:6px}
      }
    `;
    document.head.appendChild(s);
  }

  function arrangeHeader(){
    installStyle();
    const brand=document.querySelector('.topbar .brand');
    const brandline=brand?.querySelector('.brandline');
    const version=document.getElementById('versionBadge');
    if(!brand||!brandline||!version)return false;

    let row=document.getElementById(ROW_ID);
    if(!row){
      row=document.createElement('div');
      row.id=ROW_ID;
      row.setAttribute('aria-label','MERIDIAN release runtime and dashboard status');
      brandline.insertAdjacentElement('afterend',row);
    }
    if(version.parentElement!==row)row.appendChild(version);
    const runtime=document.getElementById('meridian-runtime-badge');
    if(runtime&&runtime.parentElement!==row)row.appendChild(runtime);
    const live=brand.querySelector('.live')||document.querySelector('.topbar .live');
    if(live&&live.parentElement!==row)row.appendChild(live);
    document.body?.setAttribute('data-v742-header-ready','true');
    return true;
  }

  function start(){
    arrangeHeader();
    const root=document.querySelector('.topbar');
    if(root&&typeof MutationObserver!=='undefined'){
      const observer=new MutationObserver(()=>arrangeHeader());
      observer.observe(root,{childList:true,subtree:true});
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
  addEventListener('pageshow',arrangeHeader);
  addEventListener('resize',arrangeHeader);
})();