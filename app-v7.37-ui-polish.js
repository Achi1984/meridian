/* MERIDIAN v7.41 — collision-safe mobile header and logo presentation. */
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
      #${ROW_ID}{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px;min-height:22px}
      #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge{margin-left:0!important;flex:0 0 auto}
      .logo-btn{overflow:hidden!important;display:flex!important;align-items:center!important;justify-content:center!important}
      .logo-btn img{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;object-position:center!important;box-sizing:border-box!important;padding:3px!important}
      @media(max-width:650px){
        .topbar{grid-template-columns:minmax(0,1fr) auto!important;gap:10px!important;align-items:center!important;margin-bottom:12px!important}
        .brandline{display:block!important;min-width:0}
        .brandword{min-width:0;padding-top:1px}
        .brandword .achi{font-size:27px!important;letter-spacing:5.6px!important;line-height:.96!important;white-space:nowrap!important}
        .brandword .meridian{font-size:11px!important;letter-spacing:4.2px!important;margin-top:4px!important;white-space:nowrap!important}
        #${ROW_ID}{gap:5px;margin-top:8px;min-height:19px;max-width:100%}
        #${ROW_ID} .version{font-size:7.5px!important;line-height:1!important;padding:3px 7px!important}
        #${ROW_ID} #meridian-runtime-badge{font-size:7.5px!important;line-height:1!important;padding:3px 7px!important;gap:4px!important}
        #${ROW_ID} #meridian-runtime-badge::before{width:5px!important;height:5px!important}
        .live{margin-top:7px!important;font-size:8.5px!important;letter-spacing:1.4px!important;line-height:1.1!important}
        .dot{width:6px!important;height:6px!important;margin-right:5px!important}
        .top-actions{gap:7px!important;align-items:center!important;flex:0 0 auto!important}
        .logo-btn{width:56px!important;height:56px!important;flex:0 0 56px!important}
      }
      @media(max-width:390px){
        .topbar{gap:7px!important}
        .brandword .achi{font-size:25px!important;letter-spacing:4.8px!important}
        .brandword .meridian{font-size:10px!important;letter-spacing:3.6px!important}
        #${ROW_ID}{gap:4px;margin-top:7px}
        #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge{font-size:7px!important;padding:3px 5px!important}
        .top-actions{gap:5px!important}
        .logo-btn{width:52px!important;height:52px!important;flex-basis:52px!important}
        .logo-btn img{padding:4px!important}
      }
      @media(min-width:651px){
        #${ROW_ID}{margin-top:7px}
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
      row.setAttribute('aria-label','MERIDIAN release and runtime status');
      brandline.insertAdjacentElement('afterend',row);
    }
    if(version.parentElement!==row)row.appendChild(version);
    const runtime=document.getElementById('meridian-runtime-badge');
    if(runtime&&runtime.parentElement!==row)row.appendChild(runtime);
    document.body?.setAttribute('data-v741-header-ready','true');
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