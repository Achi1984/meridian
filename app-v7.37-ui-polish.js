/* MERIDIAN v7.44 — inline horizontal brand; redundant live/refresh controls removed. */
(function(){
  'use strict';

  const STYLE_ID='meridian-v737-ui-style';
  const ROW_ID='meridian-release-status-row';
  const BRAND_IMG_ID='meridian-horizontal-brand';

  function installStyle(){
    if(document.getElementById(STYLE_ID))return;
    const s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent=`
      .brand{min-width:0;width:100%}
      .brandline{min-width:0!important}
      #${BRAND_IMG_ID}{display:block;width:min(100%,560px);height:auto;max-height:64px}
      #${ROW_ID}{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;margin-top:2px;min-height:18px;white-space:nowrap}
      #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge,#${ROW_ID} .live{margin:0!important;flex:0 0 auto}
      #${ROW_ID} .live{display:flex!important;align-items:center!important}
      .top-actions{display:none!important}
      .logo-btn{display:none!important}
      @media(max-width:650px){
        .topbar{display:block!important;margin-bottom:4px!important}
        #${BRAND_IMG_ID}{width:100%;max-height:54px}
        #${ROW_ID}{gap:5px;margin-top:1px;min-height:17px;max-width:100%;overflow:visible}
        #${ROW_ID} .version{font-size:7.2px!important;line-height:1!important;padding:3px 6px!important}
        #${ROW_ID} #meridian-runtime-badge{font-size:7.2px!important;line-height:1!important;padding:3px 6px!important;gap:4px!important}
        #${ROW_ID} #meridian-runtime-badge::before{width:5px!important;height:5px!important}
        #${ROW_ID} .live{font-size:7.4px!important;letter-spacing:1px!important;line-height:1!important}
        #${ROW_ID} .live .dot,.dot{width:5px!important;height:5px!important;margin-right:4px!important}
      }
      @media(max-width:390px){
        #${BRAND_IMG_ID}{max-height:49px}
        #${ROW_ID}{gap:4px;margin-top:0}
        #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge{font-size:6.8px!important;padding:3px 5px!important}
        #${ROW_ID} .live{font-size:6.8px!important;letter-spacing:.8px!important}
      }
      @media(min-width:651px){#${ROW_ID}{margin-top:3px}}
    `;
    document.head.appendChild(s);
  }

  function installBrand(brandline){
    let svg=document.getElementById(BRAND_IMG_ID);
    if(!svg){
      brandline.innerHTML=`<svg id="${BRAND_IMG_ID}" viewBox="0 0 560 64" role="img" aria-label="ACHI MERIDIAN" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#55c7ff"/><stop offset="1" stop-color="#4d7cff"/></linearGradient></defs>
        <g transform="translate(3 4)">
          <path d="M28 2 51 54H42L35 38H21l-7 16H5L28 2Zm0 16-5 13h10l-5-13Z" fill="url(#mg)"/>
          <path d="M28 8 39 31 28 25 17 31 28 8Z" fill="#f4f7fb" opacity=".95"/>
          <circle cx="28" cy="31" r="2.8" fill="#55c7ff"/>
        </g>
        <text x="68" y="30" fill="#f4f7fb" font-family="system-ui,-apple-system,sans-serif" font-size="25" font-weight="800" letter-spacing="6">ACHI</text>
        <text x="69" y="51" fill="#20a4ff" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="800" letter-spacing="5">MERIDIAN</text>
      </svg>`;
      svg=document.getElementById(BRAND_IMG_ID);
    }
    return svg;
  }

  function arrangeHeader(){
    installStyle();
    const brand=document.querySelector('.topbar .brand');
    const brandline=brand?.querySelector('.brandline');
    const version=document.getElementById('versionBadge');
    if(!brand||!brandline||!version)return false;
    installBrand(brandline);
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
    const actions=document.querySelector('.topbar .top-actions');
    if(actions)actions.setAttribute('aria-hidden','true');
    document.body?.setAttribute('data-v744-header-ready','true');
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