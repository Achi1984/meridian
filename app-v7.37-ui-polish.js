/* MERIDIAN v7.37 — collision-safe mobile header status layout. */
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
      #${ROW_ID}{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px;min-height:22px}
      #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge{margin-left:0!important;flex:0 0 auto}
      @media(max-width:650px){
        .topbar{grid-template-columns:minmax(0,1fr) auto!important;gap:8px!important;align-items:start!important;margin-bottom:11px!important}
        .brandline{display:block!important;min-width:0}
        .brandword{min-width:0}
        .brandword .achi{font-size:25px!important;letter-spacing:5px!important;line-height:.94!important}
        .brandword .meridian{font-size:10px!important;letter-spacing:3.8px!important;margin-top:3px!important}
        #${ROW_ID}{gap:5px;margin-top:6px;min-height:18px;max-width:100%}
        #${ROW_ID} .version{font-size:7.5px!important;line-height:1!important;padding:3px 6px!important}
        #${ROW_ID} #meridian-runtime-badge{font-size:7.5px!important;line-height:1!important;padding:3px 6px!important;gap:4px!important}
        #${ROW_ID} #meridian-runtime-badge::before{width:5px!important;height:5px!important}
        .live{margin-top:6px!important;font-size:8px!important;letter-spacing:1.2px!important;line-height:1.1!important}
        .dot{width:6px!important;height:6px!important;margin-right:5px!important}
        .top-actions{gap:6px!important;align-items:flex-start!important}
        .logo-btn{width:52px!important;height:52px!important}
      }
      @media(max-width:390px){
        .brandword .achi{font-size:24px!important;letter-spacing:4.4px!important}
        .brandword .meridian{font-size:9.5px!important;letter-spacing:3.3px!important}
        #${ROW_ID}{gap:4px}
        #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge{font-size:7px!important;padding:3px 5px!important}
        .logo-btn{width:49px!important;height:49px!important}
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
    document.body?.setAttribute('data-v737-header-ready','true');
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
