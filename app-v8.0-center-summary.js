/* MERIDIAN v8.0 R8 — customer-first CENTER command view. Presentation only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='8.0';
  const BUILD='8.0-20260905-R8';
  const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const money=v=>Number.isFinite(Number(v))?'$'+Number(v).toLocaleString('de-DE',{minimumFractionDigits:0,maximumFractionDigits:0}):'—';
  const first=(...xs)=>xs.find(v=>v!==undefined&&v!==null&&v!=='');
  function root(){return document.getElementById('view-live')||document.getElementById('view-dashboard')||document.getElementById('view-center')}
  function portfolio(){
    const c=window.MERIDIAN_PORTFOLIO_CANONICAL||{};
    let total=Number(first(c.totalUsd,c.total,c.currentTotalUsd));
    if(!Number.isFinite(total)){
      try{const p=window.DATA?.portfolio||{};total=Number(first(p.totalIncludingTrading,(Number(p.total)||0)+(Number(p.tradingCapitalTotal)||0),p.total))}catch(_e){}
    }
    return Number.isFinite(total)?total:null;
  }
  function canonicalRiskRows(){
    try{
      if(typeof canonicalBotStates==='function'){
        const xs=canonicalBotStates();
        if(Array.isArray(xs)&&xs.length)return xs.map(b=>({id:String(b?.id||b?.botId||b?.symbol||'BOT'),buffer:Number(b?.buffer ?? b?.verifiedBuffer ?? b?.liquidationDistancePct ?? b?.liveEstimate),status:String(b?.guard?.label||b?.management?.phase||b?.unified?.phase||'').toUpperCase()}));
      }
    }catch(_e){}
    return Object.entries(window.MERIDIAN_PIONEX_SNAPSHOT?.activeBots||{}).map(([id,b])=>({id,buffer:Number(first(b?.pionexLiqBufferPct,b?.calculatedLiqBufferPct,b?.liqBufferPct,b?.liquidationDistancePct)),status:String(first(b?.status,b?.riskState,'')).toUpperCase()}));
  }
  function risk(){
    const xs=canonicalRiskRows();
    const open=xs.filter(x=>!/PROTECTED/i.test(x.status)&&Number.isFinite(x.buffer)).sort((a,b)=>a.buffer-b.buffer);
    const c=open[0]||xs.filter(x=>Number.isFinite(x.buffer)).sort((a,b)=>a.buffer-b.buffer)[0]||null;
    if(!c)return {label:'CHECK',tone:'muted',bot:null,buffer:null,next:'Risikodaten prüfen'};
    if(/PROTECTED/i.test(c.status))return {label:'PROTECTED',tone:'green',bot:c.id,buffer:c.buffer,next:'Schutz aktiv · Liquidationspuffer weiter überwachen'};
    if(c.buffer<8)return {label:'DANGER',tone:'red',bot:c.id,buffer:c.buffer,next:`${c.id}: Buffer zuerst auf ≥8% bringen`};
    if(c.buffer<12)return {label:'WATCH',tone:'amber',bot:c.id,buffer:c.buffer,next:`${c.id}: Buffer auf SAFE ≥12% erhöhen`};
    return {label:'SAFE',tone:'green',bot:c.id,buffer:c.buffer,next:'Keine akute Liquidationsmaßnahme'};
  }
  function regime(){
    const r=window.MERIDIAN_CLOUD?.regimeV1||window.MERIDIAN_CLOUD?.regime||{};
    const d=window.DATA||{};
    const br=d.btcRegime||{};
    const v=first(r.currentRegime,r.marketRegime,r.selectedRegime,r.regime,r.state,d?.market?.regime,br.currentRegime,br.marketRegime,br.regime,br.state,br.label,br.name);
    return v?String(v).replace(/_/g,' ').toUpperCase():'—';
  }
  function opportunities(){
    const cloud=window.MERIDIAN_CLOUD||{};
    const pools=[cloud?.signals?.items,cloud?.signals?.opportunities,cloud?.scanner?.items,cloud?.opportunities,window.DATA?.scanner?.items,window.DATA?.opportunities].filter(Array.isArray);
    const xs=pools.flat().map(x=>({symbol:String(first(x?.symbol,x?.asset,x?.pair,'')).replace('USDT',''),side:String(first(x?.side,x?.direction,'')).toUpperCase(),status:String(first(x?.status,x?.decision,'')).toUpperCase(),confidence:Number(first(x?.confidence,x?.confidencePct,x?.score,x?.technicalScore))})).filter(x=>x.symbol);
    const ready=xs.filter(x=>/READY|TRADE|ENTRY/.test(x.status));
    return ready.sort((a,b)=>(Number.isFinite(b.confidence)?b.confidence:-1)-(Number.isFinite(a.confidence)?a.confidence:-1))[0]||null;
  }
  function toneForRegime(r){return /BULL|EXPANSION|TREND/.test(r)?'cyan':/BEAR/.test(r)?'red':/TRANSITION|RANGE|CHOP/.test(r)?'amber':'muted'}
  function ensure(){
    const r=root();if(!r)return;
    let host=r.querySelector(':scope > #v8-center-summary');
    if(!host){host=document.createElement('section');host.id='v8-center-summary';host.className='v8-customer-screen';r.prepend(host)}
    const p=portfolio(),rk=risk(),rg=regime(),opp=opportunities();
    host.innerHTML=`<div class="v8-center-hero ${rk.tone}"><span>CENTER · WHAT MATTERS NOW</span><div class="v8-center-value">${p==null?'PORTFOLIO —':money(p)}</div><small>Portfolio · Markt · Risiko · nächste Aktion · beste Opportunity</small></div><div class="v8-center-grid"><div class="v8-center-card"><span>MARKET</span><b class="${toneForRegime(rg)}">${rg}</b></div><div class="v8-center-card"><span>RISK</span><b class="${rk.tone}">${rk.label}</b><small>${rk.bot?`${rk.bot} · ${fmt(rk.buffer,2)}% Buffer`:'Keine belastbaren Bot-Daten'}</small></div><div class="v8-center-card wide"><span>NEXT ACTION</span><b>${rk.next}</b></div><div class="v8-center-card wide"><span>BEST OPPORTUNITY</span><b>${opp?`${opp.symbol}${opp.side?' · '+opp.side:''}`:'NO READY SIGNAL'}</b><small>${opp&&Number.isFinite(opp.confidence)?`Confidence ${fmt(opp.confidence,0)}`:'Nur belastbare Scanner-Daten werden gezeigt'}</small></div></div><button type="button" id="v8-center-details-toggle">DETAILS ANZEIGEN</button>`;
    const btn=host.querySelector('#v8-center-details-toggle');if(btn)btn.onclick=()=>{const open=r.classList.toggle('v8-center-details-open');btn.textContent=open?'DETAILS AUSBLENDEN':'DETAILS ANZEIGEN'};
    [...r.children].forEach(ch=>{if(ch!==host)ch.classList.add('v8-center-legacy')});
    window.MERIDIAN_V8_CENTER_STATUS={version:VERSION,build:BUILD,portfolioUsd:p,regime:rg,risk:rk.label,criticalBot:rk.bot,bestOpportunity:opp||null,riskSource:canonicalRiskRows().length?'CANONICAL_OR_SNAPSHOT':'NONE',executionImpact:false,updatedAt:new Date().toISOString()};
  }
  function css(){if(document.getElementById('v8-center-css'))return;const s=document.createElement('style');s.id='v8-center-css';s.textContent=`
    #view-live:not(.v8-center-details-open)>.v8-center-legacy,#view-dashboard:not(.v8-center-details-open)>.v8-center-legacy,#view-center:not(.v8-center-details-open)>.v8-center-legacy{display:none!important}
    #v8-center-summary{max-width:980px;margin:14px auto 90px;padding:0 14px;color:#eef5fb}.v8-center-hero{border:1px solid #1b4058;background:#06131e;border-radius:18px;padding:18px}.v8-center-hero.red{border-left:4px solid #ff5d62}.v8-center-hero.amber{border-left:4px solid #e8b24a}.v8-center-hero.green{border-left:4px solid #4bc27d}.v8-center-hero.muted{border-left:4px solid #526474}.v8-center-hero>span,.v8-center-card>span{display:block;color:#55c8ff;font-size:8px;letter-spacing:.12em;font-weight:800}.v8-center-value{margin-top:7px;font-size:30px;font-weight:900;line-height:1}.v8-center-hero>small{display:block;margin-top:8px;color:#8294a8;font-size:10px}.v8-center-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.v8-center-card{border:1px solid #17354f;background:#07121c;border-radius:14px;padding:13px}.v8-center-card.wide{grid-column:1/-1}.v8-center-card>b{display:block;margin-top:5px;font-size:13px}.v8-center-card>small{display:block;margin-top:5px;color:#8294a8;font-size:9px}.v8-center-card .red{color:#ff6d73}.v8-center-card .amber{color:#e8b24a}.v8-center-card .green{color:#4bc27d}.v8-center-card .cyan{color:#55c8ff}.v8-center-card .muted{color:#91a0ae}#v8-center-details-toggle{width:100%;margin-top:12px;padding:13px;border:1px solid #1c4a67;border-radius:13px;background:#071827;color:#55c8ff;font-size:10px;font-weight:800;letter-spacing:.09em}@media(max-width:650px){#v8-center-summary{padding:0 10px}.v8-center-value{font-size:26px}.v8-center-grid{grid-template-columns:1fr 1fr}.v8-center-card{padding:11px}}
  `;document.head.appendChild(s)}
  let busy=false,timer=null;function apply(){if(busy)return;busy=true;try{css();ensure()}finally{busy=false}}function schedule(){clearTimeout(timer);timer=setTimeout(apply,100)}
  function stamp(){window.MERIDIAN_RELEASE_VERSION=VERSION;window.MERIDIAN_UI_VERSION=VERSION;window.MERIDIAN_RELEASE_BUILD=BUILD;window.__MERIDIAN_BUILD__=BUILD;const badge=document.getElementById('versionBadge');if(badge)badge.textContent='v8.0 · LIVE'}
  function start(){stamp();apply();if(typeof MutationObserver!=='undefined')new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();addEventListener('pageshow',()=>{stamp();apply()});document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});setInterval(()=>{if(!document.hidden)apply()},3000);
})();
