/* MERIDIAN v8.0 R12 — MORE is a real customer view, never an overlay. Presentation/navigation only. */
(function(){
  'use strict';
  const VERSION='8.0';
  const BUILD='8.0-20260905-R12';
  const text=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
  function visible(el){if(!el)return false;try{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'}catch(_e){return true}}
  function navCandidates(){return [...document.querySelectorAll('button,[role="button"],a,.nav,.tab')].filter(el=>!el.closest?.('#view-more')&&!el.closest?.('#v8-bottom-nav'))}
  function clickByLabel(patterns){const xs=navCandidates();for(const re of patterns){const hit=xs.find(el=>re.test(text(el)));if(hit){hit.click();return true}}return false}
  function findTextTarget(patterns){const xs=[...document.querySelectorAll('h1,h2,h3,.section-title,.eyebrow,b,strong,summary,span')].filter(visible);for(const re of patterns){const hit=xs.find(el=>re.test(text(el)));if(hit)return hit}return null}
  function openLegacyDetails(view){
    if(view==='paper')document.getElementById('view-paper')?.classList.add('v8-paper-details-open');
    if(view==='trade')(document.getElementById('view-daytrade')||document.getElementById('view-trade'))?.classList.add('v8-trade-details-open');
    if(view==='center')(document.getElementById('view-center')||document.getElementById('view-live')||document.getElementById('view-dashboard'))?.classList.add('v8-center-details-open');
    if(view==='depot')document.getElementById('view-depot')?.classList.add('v8-depot-details-open');
  }
  function route(kind){
    let ok=false,target=null;
    if(kind==='market')ok=clickByLabel([/^MARKT$/i,/^MARKET$/i]);
    else if(kind==='forecast')ok=clickByLabel([/^FCST$/i,/^FORECAST$/i,/FORECAST/i]);
    else if(kind==='scanner'){ok=clickByLabel([/^CENTER$/i,/^LIVE$/i]);openLegacyDetails('center');setTimeout(()=>{target=findTextTarget([/SCANNER/i,/OPPORTUNITY/i]);target?.scrollIntoView({block:'start'})},120)}
    else if(kind==='research'){ok=clickByLabel([/^PAPER$/i]);openLegacyDetails('paper');setTimeout(()=>{target=findTextTarget([/RESEARCH/i,/BACKTEST/i,/DECISION JOURNAL/i]);target?.scrollIntoView({block:'start'})},120)}
    else if(kind==='diagnostics'){ok=clickByLabel([/^PAPER$/i]);openLegacyDetails('paper');setTimeout(()=>{target=findTextTarget([/ENGINE\s*\/\s*DIAGNOSTIK/i,/DIAGNOSTIK/i,/RUNTIME/i]);target?.scrollIntoView({block:'start'})},120)}
    window.MERIDIAN_V8_MORE_STATUS={version:VERSION,build:BUILD,lastRoute:kind,routeResolved:!!ok,executionImpact:false,updatedAt:new Date().toISOString()};
  }
  function health(){const r=window.MERIDIAN_RUNTIME_STATUS||{},state=String(r.state||r.status||r.gateway||'').toUpperCase();return /OK|LIVE|HEALTHY|READY/.test(state)?'LIVE':state||'CHECK'}
  function ensureView(){
    css();
    let root=document.getElementById('view-more');
    if(!root){root=document.createElement('section');root.id='view-more';root.className='hidden';const main=document.querySelector('main');(main||document.body).appendChild(root)}
    root.innerHTML=`<section id="v8-more-screen" class="v8-customer-screen"><div class="v8-more-head"><span>MORE</span><b>DETAILS & TOOLS</b><small>Tiefe nur auf Abruf. Die Hauptansicht bleibt entscheidungsorientiert.</small></div><div class="v8-more-grid">
      <button data-route="market"><span>MARKT</span><b>Marktstruktur & Regime</b><small>Preise, Regime und Marktkontext.</small></button>
      <button data-route="forecast"><span>FORECAST</span><b>Outlook & Levels</b><small>Forecast, FIB und Zeithorizont.</small></button>
      <button data-route="scanner"><span>SCANNER</span><b>Opportunities</b><small>Signale und Setups im Detail.</small></button>
      <button data-route="research"><span>RESEARCH</span><b>Modelle & Backtests</b><small>OOS, Walk-forward und Decision Labs.</small></button>
      <button data-route="diagnostics"><span>DIAGNOSTIK</span><b>System & Daten</b><small>Runtime ${health()} · technische Checks.</small></button>
    </div><div class="v8-more-foot">MORE ist eine eigene v8-Ansicht. Legacy-Inhalte werden nur nach bewusster Auswahl geöffnet.</div></section>`;
    root.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>route(b.dataset.route));
    document.getElementById('v8-more-overlay')?.remove();
    document.getElementById('v8-more-open')?.remove();
    return root;
  }
  function css(){if(document.getElementById('v8-more-css'))return;const s=document.createElement('style');s.id='v8-more-css';s.textContent=`
    #view-more{width:100%}#v8-more-screen{max-width:760px;margin:8px auto 90px;padding:0 10px;color:#eef5fb}
    .v8-more-head{border:1px solid #1c4a67;border-radius:18px;background:#06131e;padding:18px}.v8-more-head>span{display:block;color:#55c8ff;font-size:9px;letter-spacing:.13em;font-weight:900}.v8-more-head>b{display:block;margin-top:7px;font-size:22px}.v8-more-head>small{display:block;margin-top:7px;color:#8294a8;font-size:10px;line-height:1.4}
    .v8-more-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}.v8-more-grid button{min-height:112px;text-align:left;border:1px solid #173e55;border-radius:15px;background:#07131d;color:#eef5fb;padding:14px}.v8-more-grid button:last-child{grid-column:1/-1}.v8-more-grid span{display:block;color:#55c8ff;font-size:8px;letter-spacing:.12em;font-weight:900}.v8-more-grid b{display:block;margin-top:7px;font-size:13px}.v8-more-grid small{display:block;margin-top:6px;color:#8194a7;font-size:9px;line-height:1.4}.v8-more-foot{margin-top:12px;color:#71879a;font-size:8px;line-height:1.45}
    @media(max-width:520px){.v8-more-grid{grid-template-columns:1fr}.v8-more-grid button:last-child{grid-column:auto}.v8-more-head{padding:15px}.v8-more-head>b{font-size:18px}}
  `;document.head.appendChild(s)}
  function start(){ensureView();window.MERIDIAN_V8_MORE_STATUS={version:VERSION,build:BUILD,lastRoute:null,routeResolved:null,executionImpact:false,updatedAt:new Date().toISOString()}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();addEventListener('pageshow',ensureView);window.addEventListener('meridian:v8-viewchange',e=>{if(e?.detail?.view==='more')ensureView()});
})();
