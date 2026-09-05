/* MERIDIAN v8.0 R5 — customer MORE hub. Presentation/navigation only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='8.0';
  const BUILD='8.0-20260905-R5';
  const text=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();

  function visible(el){
    if(!el)return false;
    try{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'}catch(_e){return true}
  }
  function navCandidates(){
    return [...document.querySelectorAll('button,[role="button"],a,.nav,.tab')].filter(visible);
  }
  function clickByLabel(patterns){
    const xs=navCandidates();
    for(const re of patterns){
      const hit=xs.find(el=>re.test(text(el)) && el.id!=='v8-more-open');
      if(hit){hit.click();return true}
    }
    return false;
  }
  function findTextTarget(patterns){
    const xs=[...document.querySelectorAll('h1,h2,h3,.section-title,.eyebrow,b,strong,summary,span')].filter(visible);
    for(const re of patterns){const hit=xs.find(el=>re.test(text(el)));if(hit)return hit}
    return null;
  }
  function openLegacyDetails(view){
    if(view==='paper')document.getElementById('view-paper')?.classList.add('v8-paper-details-open');
    if(view==='trade')document.getElementById('view-trade')?.classList.add('v8-trade-details-open');
    if(view==='center'){
      (document.getElementById('view-live')||document.getElementById('view-dashboard')||document.getElementById('view-center'))?.classList.add('v8-center-details-open');
    }
    if(view==='depot')document.getElementById('view-depot')?.classList.add('v8-depot-details-open');
  }
  function close(){document.getElementById('v8-more-overlay')?.classList.remove('open')}
  function open(){ensure();document.getElementById('v8-more-overlay')?.classList.add('open')}
  function route(kind){
    close();
    let ok=false,target=null;
    if(kind==='market') ok=clickByLabel([/^MARKT$/i,/^MARKET$/i]);
    else if(kind==='forecast') ok=clickByLabel([/^FCST$/i,/^FORECAST$/i,/FORECAST/i]);
    else if(kind==='scanner'){
      ok=clickByLabel([/^CENTER$/i,/^LIVE$/i]);openLegacyDetails('center');
      setTimeout(()=>{target=findTextTarget([/SCANNER/i,/OPPORTUNITY/i]);target?.scrollIntoView({block:'start'});},120);
    } else if(kind==='research'){
      ok=clickByLabel([/^PAPER$/i]);openLegacyDetails('paper');
      setTimeout(()=>{target=findTextTarget([/RESEARCH/i,/BACKTEST/i,/DECISION JOURNAL/i]);target?.scrollIntoView({block:'start'});},120);
    } else if(kind==='diagnostics'){
      ok=clickByLabel([/^PAPER$/i]);openLegacyDetails('paper');
      setTimeout(()=>{target=findTextTarget([/ENGINE\s*\/\s*DIAGNOSTIK/i,/DIAGNOSTIK/i,/RUNTIME/i]);target?.scrollIntoView({block:'start'});},120);
    }
    window.MERIDIAN_V8_MORE_STATUS={version:VERSION,build:BUILD,lastRoute:kind,routeResolved:!!ok,executionImpact:false,updatedAt:new Date().toISOString()};
  }
  function health(){
    const r=window.MERIDIAN_RUNTIME_STATUS||{};
    const state=String(r.state||r.status||r.gateway||'').toUpperCase();
    return /OK|LIVE|HEALTHY|READY/.test(state)?'LIVE':state||'CHECK';
  }
  function ensure(){
    css();
    let btn=document.getElementById('v8-more-open');
    if(!btn){
      btn=document.createElement('button');btn.id='v8-more-open';btn.type='button';btn.textContent='MORE';btn.onclick=open;
      const banner=document.getElementById('v8-customer-mode');
      if(banner)banner.appendChild(btn);else (document.querySelector('.top-actions')||document.body).appendChild(btn);
    }
    let ov=document.getElementById('v8-more-overlay');
    if(!ov){
      ov=document.createElement('div');ov.id='v8-more-overlay';ov.setAttribute('aria-hidden','true');document.body.appendChild(ov);
    }
    ov.innerHTML=`<div class="v8-more-sheet"><div class="v8-more-head"><div><span>MORE</span><b>DETAILS & TOOLS</b><small>Nur öffnen, wenn du tiefer einsteigen willst.</small></div><button type="button" id="v8-more-close">SCHLIESSEN</button></div><div class="v8-more-grid">
      <button data-route="market"><span>MARKT</span><b>Marktstruktur & Regime</b><small>Preise, Regime und Marktkontext.</small></button>
      <button data-route="forecast"><span>FORECAST</span><b>Outlook & Levels</b><small>Forecast, FIB und Zeithorizont.</small></button>
      <button data-route="scanner"><span>SCANNER</span><b>Opportunities</b><small>Signale und Setups im Detail.</small></button>
      <button data-route="research"><span>RESEARCH</span><b>Modelle & Backtests</b><small>OOS, Walk-forward und Decision Labs.</small></button>
      <button data-route="diagnostics"><span>DIAGNOSTIK</span><b>System & Daten</b><small>Runtime ${health()} · technische Checks.</small></button>
    </div><div class="v8-more-foot">Customer View bleibt bewusst kompakt. MORE enthält Tiefe, nicht zusätzliche Entscheidungen.</div></div>`;
    ov.onclick=e=>{if(e.target===ov)close()};
    ov.querySelector('#v8-more-close').onclick=close;
    ov.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>route(b.dataset.route));
  }
  function css(){
    if(document.getElementById('v8-more-css'))return;
    const s=document.createElement('style');s.id='v8-more-css';s.textContent=`
      #v8-more-open{border:1px solid #1c5775;background:#071827;color:#55c8ff;border-radius:999px;padding:7px 10px;font:800 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;white-space:nowrap}
      #v8-customer-mode #v8-more-open{margin-left:auto}
      #v8-more-overlay{position:fixed;inset:0;z-index:10050;display:none;align-items:flex-end;justify-content:center;background:rgba(0,5,9,.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:12px}
      #v8-more-overlay.open{display:flex}
      .v8-more-sheet{width:min(720px,100%);max-height:88vh;overflow:auto;border:1px solid #1c4a67;border-radius:22px;background:#04101a;padding:16px;box-shadow:0 22px 60px rgba(0,0,0,.45)}
      .v8-more-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.v8-more-head span{display:block;color:#55c8ff;font-size:8px;letter-spacing:.13em;font-weight:900}.v8-more-head b{display:block;margin-top:5px;font-size:18px}.v8-more-head small{display:block;margin-top:5px;color:#8294a8;font-size:9px}.v8-more-head button{border:1px solid #244c64;background:#071827;color:#9ab0c0;border-radius:999px;padding:8px 10px;font-size:8px;font-weight:900}
      .v8-more-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.v8-more-grid button{min-height:102px;text-align:left;border:1px solid #173e55;border-radius:15px;background:#07131d;color:#eef5fb;padding:13px}.v8-more-grid button:last-child{grid-column:1/-1}.v8-more-grid span{display:block;color:#55c8ff;font-size:7px;letter-spacing:.12em;font-weight:900}.v8-more-grid b{display:block;margin-top:6px;font-size:12px}.v8-more-grid small{display:block;margin-top:5px;color:#8194a7;font-size:8px;line-height:1.35}.v8-more-foot{margin-top:12px;padding-top:10px;border-top:1px solid #17354f;color:#71879a;font-size:8px;line-height:1.45}
      @media(max-width:520px){#v8-customer-mode{display:grid!important;grid-template-columns:1fr auto!important}#v8-customer-mode>span{grid-column:1/-1}.v8-more-grid{grid-template-columns:1fr}.v8-more-grid button:last-child{grid-column:auto}.v8-more-sheet{border-radius:20px 20px 12px 12px;padding:14px}}
    `;document.head.appendChild(s);
  }
  function start(){ensure();window.MERIDIAN_V8_MORE_STATUS={version:VERSION,build:BUILD,lastRoute:null,routeResolved:null,executionImpact:false,updatedAt:new Date().toISOString()}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();addEventListener('pageshow',ensure);
})();
