/* MERIDIAN v7.46 — premium horizontal banner brand; redundant live/refresh controls removed. */
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
      .brandline{min-width:0!important;width:100%!important}
      #${BRAND_IMG_ID}{display:block;width:min(100%,760px);height:auto;max-height:72px;margin-left:auto;margin-right:auto;filter:drop-shadow(0 0 8px rgba(32,164,255,.14))}
      #${ROW_ID}{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:nowrap;margin:2px auto 0;min-height:18px;max-width:760px;width:100%;white-space:nowrap;text-align:center}
      #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge,#${ROW_ID} .live{margin:0!important;flex:0 0 auto}
      #${ROW_ID} .live{display:flex!important;align-items:center!important}
      .top-actions{display:none!important}
      .logo-btn{display:none!important}
      @media(max-width:650px){
        .topbar{display:block!important;margin-bottom:4px!important}
        #${BRAND_IMG_ID}{width:100%;max-height:60px}
        #${ROW_ID}{justify-content:center;gap:5px;margin:1px auto 0;min-height:17px;max-width:100%;overflow:visible}
        #${ROW_ID} .version{font-size:7.2px!important;line-height:1!important;padding:3px 6px!important}
        #${ROW_ID} #meridian-runtime-badge{font-size:7.2px!important;line-height:1!important;padding:3px 6px!important;gap:4px!important}
        #${ROW_ID} #meridian-runtime-badge::before{width:5px!important;height:5px!important}
        #${ROW_ID} .live{font-size:7.4px!important;letter-spacing:1px!important;line-height:1!important}
        #${ROW_ID} .live .dot,.dot{width:5px!important;height:5px!important;margin-right:4px!important}
      }
      @media(max-width:390px){
        #${BRAND_IMG_ID}{max-height:56px}
        #${ROW_ID}{justify-content:center;gap:4px;margin:0 auto}
        #${ROW_ID} .version,#${ROW_ID} #meridian-runtime-badge{font-size:6.8px!important;padding:3px 5px!important}
        #${ROW_ID} .live{font-size:6.8px!important;letter-spacing:.8px!important}
      }
      @media(min-width:651px){#${ROW_ID}{margin:3px auto 0}}
    `;
    document.head.appendChild(s);
  }

  function installBrand(brandline){
    let svg=document.getElementById(BRAND_IMG_ID);
    if(!svg){
      brandline.innerHTML=`<svg id="${BRAND_IMG_ID}" viewBox="0 0 980 112" role="img" aria-label="ACHI MERIDIAN" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="mbBlue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#56e4ff"/><stop offset=".45" stop-color="#159fff"/><stop offset="1" stop-color="#274dff"/></linearGradient>
          <linearGradient id="mbSilver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eef3f8"/><stop offset="1" stop-color="#9eabb9"/></linearGradient>
          <filter id="mbGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="mbSoftGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.4" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect x="5" y="9" width="970" height="94" rx="47" fill="#03070c" stroke="#125fa5" stroke-width="2"/>
        <rect x="10" y="14" width="960" height="84" rx="42" fill="none" stroke="url(#mbBlue)" stroke-width="2.5" opacity=".92" filter="url(#mbSoftGlow)"/>
        <g transform="translate(18 10)">
          <circle cx="46" cy="46" r="35" fill="none" stroke="url(#mbBlue)" stroke-width="5" opacity=".98" filter="url(#mbSoftGlow)"/>
          <path d="M46 5 L76 82 L46 62 L16 82 Z" fill="url(#mbSilver)"/>
          <path d="M46 31 L60 69 L46 59 L32 69 Z" fill="#06111f"/>
          <path d="M46 49 L50 59 L61 63 L50 67 L46 79 L42 67 L31 63 L42 59 Z" fill="#42ddff" filter="url(#mbGlow)"/>
        </g>
        <text x="116" y="72" fill="url(#mbSilver)" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="46" font-weight="760" letter-spacing="14">ACHI</text>
        <text x="390" y="72" fill="#19a9ff" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="40" font-weight="650" letter-spacing="12">MERIDIAN</text>
        <path d="M16 17 H510" stroke="#31cfff" stroke-width="1.2" opacity=".45"/><path d="M600 97 H955" stroke="#276fff" stroke-width="1.1" opacity=".32"/>
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
    document.body?.setAttribute('data-v746-header-ready','true');
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