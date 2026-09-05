/* MERIDIAN v8.0 R8 — customer-first TRADE summary. Presentation only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='8.0';
  const BUILD='8.0-20260905-R8';
  const text=el=>String(el?.textContent||'').trim();
  const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const num=s=>{const x=String(s||'').replace(/\s/g,'').replace(/%/g,'').replace(/−/g,'-').replace(/\./g,'').replace(',','.');const m=x.match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
  const root=()=>document.getElementById('view-trade');
  const leafs=r=>r?[...r.querySelectorAll('*')].filter(el=>el.children.length===0):[];
  const findLeaf=(r,re)=>leafs(r).find(el=>re.test(text(el)))||null;
  function nearestCard(el){let n=el;for(let i=0;i<9&&n;i++,n=n.parentElement){const c=String(n.className||'');if(/card|panel|bot|grid|commander/i.test(c))return n}return el?.parentElement||null}
  function bufferFromCard(card){if(!card)return null;const lab=findLeaf(card,/^PUFFER$/i);if(!lab)return null;const vals=leafs(lab.parentElement||card).filter(x=>x!==lab).map(x=>num(text(x))).filter(Number.isFinite);return vals.length?vals[0]:null}
  function canonicalBots(){
    try{
      if(typeof canonicalBotStates!=='function')return [];
      const rows=canonicalBotStates();
      if(!Array.isArray(rows))return [];
      return rows.map(b=>({
        id:String(b?.id||b?.botId||b?.symbol||'BOT'),
        side:String(b?.side||b?.direction||'').toUpperCase()||'—',
        leverage:Number(b?.leverage||b?.leverageX||b?.x),
        buffer:Number(b?.buffer ?? b?.verifiedBuffer ?? b?.liquidationDistancePct ?? b?.liveEstimate),
        status:String(b?.guard?.label||b?.management?.phase||b?.unified?.phase||b?.status||'').toUpperCase()
      })).filter(b=>b.id);
    }catch(_e){return []}
  }
  function snapshotBots(){
    const active=window.MERIDIAN_PIONEX_SNAPSHOT?.activeBots;
    if(!active||typeof active!=='object')return [];
    return Object.entries(active).map(([id,b])=>({
      id,
      side:String(b?.side||b?.direction||'').toUpperCase()||'—',
      leverage:Number(b?.leverage||b?.leverageX||b?.x),
      buffer:Number(b?.pionexLiqBufferPct ?? b?.calculatedLiqBufferPct ?? b?.liqBufferPct ?? b?.liquidationDistancePct),
      status:String(b?.status||b?.riskState||'').toUpperCase()
    }));
  }
  function domBots(r){
    const known=['BTC-S30','BTC-L100','BTC-L20','HBAR-L3','HBAR-L5','XRP-L5'];
    return known.map(id=>{const h=findLeaf(r,new RegExp('^'+id+'$','i'));if(!h)return null;const c=nearestCard(h);const raw=text(c);return {id,side:/SHORT/i.test(raw)?'SHORT':/LONG/i.test(raw)?'LONG':'—',leverage:(raw.match(/(\d+)x/i)||[])[1],buffer:bufferFromCard(c),status:/CRITICAL/i.test(raw)?'CRITICAL':/DANGER/i.test(raw)?'DANGER':/TIGHT|WATCH/i.test(raw)?'WATCH':/PROTECTED/i.test(raw)?'PROTECTED':/SAFE/i.test(raw)?'SAFE':'—'};}).filter(Boolean);
  }
  function bots(r){const c=canonicalBots();if(c.length)return c;const s=snapshotBots();return s.length?s:domBots(r)}
  function state(buffer,status=''){
    const st=String(status||'').toUpperCase();
    if(/PROTECTED/.test(st))return {label:'PROTECTED',tone:'green',target:'Schutz aktiv · Liquidationspuffer weiter überwachen'};
    if(!Number.isFinite(Number(buffer)))return {label:'CHECK DATA',tone:'muted',target:'Puffer verifizieren'};
    const b=Number(buffer);
    if(b<8)return {label:'DANGER',tone:'red',target:'Puffer zuerst auf ≥8% bringen'};
    if(b<12)return {label:'WATCH',tone:'amber',target:'Puffer auf SAFE ≥12% erhöhen'};
    return {label:'SAFE',tone:'green',target:'Keine akute Liquidationsmaßnahme'};
  }
  function critical(xs){
    const unprotected=xs.filter(x=>!/PROTECTED/i.test(String(x.status||''))&&Number.isFinite(Number(x.buffer))).sort((a,b)=>Number(a.buffer)-Number(b.buffer));
    if(unprotected.length)return unprotected[0];
    return xs.filter(x=>Number.isFinite(Number(x.buffer))).sort((a,b)=>Number(a.buffer)-Number(b.buffer))[0]||xs[0]||null;
  }
  function botRow(b){const s=state(b.buffer,b.status);return `<div class="v8-trade-row ${s.tone}"><div><b>${b.id}</b><span>${b.side}${Number.isFinite(Number(b.leverage))?' · '+fmt(b.leverage,0)+'x':''}</span></div><div><small>PUFFER</small><b>${Number.isFinite(Number(b.buffer))?fmt(b.buffer,2)+'%':'—'}</b></div><div><small>STATUS</small><b>${s.label}</b></div></div>`}
  function ensureSummary(r){
    if(!r||r.id!=='view-trade')return;
    let host=r.querySelector(':scope > #v8-trade-summary');
    if(!host){host=document.createElement('section');host.id='v8-trade-summary';host.className='v8-customer-screen';r.prepend(host)}
    const xs=bots(r);const c=critical(xs);const s=state(c?.buffer,c?.status);
    host.innerHTML=`<div class="v8-trade-head ${s.tone}"><span>TRADE · RISK PRIORITY</span><b>${s.label}</b><small>${c?`${c.id} ist aktuell der kritischste Bot · Buffer ${Number.isFinite(Number(c.buffer))?fmt(c.buffer,2)+'%':'—'}`:'Keine belastbaren Bot-Risikodaten gefunden.'}</small><div class="v8-next"><span>NEXT ACTION</span><b>${s.target}</b></div></div><div class="v8-trade-list">${xs.length?xs.map(botRow).join(''):'<div class="v8-trade-empty">Keine aktiven Bots erkannt.</div>'}</div><button type="button" id="v8-trade-details-toggle">DETAILS ANZEIGEN</button>`;
    const btn=host.querySelector('#v8-trade-details-toggle');if(btn)btn.onclick=()=>{const open=r.classList.toggle('v8-trade-details-open');btn.textContent=open?'DETAILS AUSBLENDEN':'DETAILS ANZEIGEN'};
    [...r.children].forEach(ch=>{if(ch!==host)ch.classList.add('v8-trade-legacy')});
    window.MERIDIAN_V8_TRADE_STATUS={version:VERSION,build:BUILD,criticalBot:c?.id||null,buffer:Number.isFinite(Number(c?.buffer))?Number(c.buffer):null,state:s.label,botCount:xs.length,source:canonicalBots().length?'CANONICAL_BOT_STATES':snapshotBots().length?'PIONEX_SNAPSHOT':'TRADE_DOM',executionImpact:false,updatedAt:new Date().toISOString()};
  }
  function css(){if(document.getElementById('v8-trade-css'))return;const s=document.createElement('style');s.id='v8-trade-css';s.textContent=`
    #view-trade:not(.v8-trade-details-open)>.v8-trade-legacy{display:none!important}
    #v8-trade-summary{max-width:980px;margin:14px auto 90px;padding:0 14px;color:#eef5fb}
    .v8-trade-head{border:1px solid #1b4058;background:#06131e;border-radius:18px;padding:18px}.v8-trade-head.red{border-left:4px solid #ff5d62}.v8-trade-head.amber{border-left:4px solid #e8b24a}.v8-trade-head.green{border-left:4px solid #4bc27d}.v8-trade-head.muted{border-left:4px solid #526474}
    .v8-trade-head>span{display:block;color:#55c8ff;font-size:9px;letter-spacing:.13em;font-weight:800}.v8-trade-head>b{display:block;margin-top:7px;font-size:26px;line-height:1}.v8-trade-head>small{display:block;margin-top:8px;color:#8ea0b2;font-size:11px}
    .v8-next{margin-top:14px;padding-top:12px;border-top:1px solid #17354f}.v8-next span{display:block;color:#71859a;font-size:8px;letter-spacing:.1em}.v8-next b{display:block;margin-top:5px;font-size:13px}
    .v8-trade-list{display:grid;gap:8px;margin-top:12px}.v8-trade-row{display:grid;grid-template-columns:1.6fr .8fr .8fr;gap:8px;align-items:center;padding:12px;border:1px solid #17354f;border-radius:14px;background:#07121c}.v8-trade-row.red{border-left:3px solid #ff5d62}.v8-trade-row.amber{border-left:3px solid #e8b24a}.v8-trade-row.green{border-left:3px solid #4bc27d}.v8-trade-row.muted{border-left:3px solid #526474}
    .v8-trade-row>div:first-child span{display:block;margin-top:3px;color:#8294a8;font-size:8px}.v8-trade-row small{display:block;color:#71859a;font-size:7px;letter-spacing:.08em}.v8-trade-row b{font-size:11px}.v8-trade-empty{padding:14px;border:1px solid #17354f;border-radius:14px;color:#8294a8}
    #v8-trade-details-toggle{width:100%;margin-top:12px;padding:13px;border:1px solid #1c4a67;border-radius:13px;background:#071827;color:#55c8ff;font-size:10px;font-weight:800;letter-spacing:.09em}
    @media(max-width:650px){#v8-trade-summary{padding:0 10px}.v8-trade-head>b{font-size:22px}.v8-trade-row{grid-template-columns:1.45fr .8fr .8fr;padding:10px 9px;gap:5px}.v8-trade-row b{font-size:10px}}
  `;document.head.appendChild(s)}
  let busy=false,timer=null;
  function apply(){if(busy)return;const r=root();if(!r)return;busy=true;try{css();ensureSummary(r)}finally{busy=false}}
  function schedule(){clearTimeout(timer);timer=setTimeout(apply,100)}
  function stamp(){window.MERIDIAN_RELEASE_VERSION=VERSION;window.MERIDIAN_UI_VERSION=VERSION;window.MERIDIAN_RELEASE_BUILD=BUILD;window.__MERIDIAN_BUILD__=BUILD;const badge=document.getElementById('versionBadge');if(badge)badge.textContent='v8.0 · LIVE'}
  function start(){stamp();apply();if(typeof MutationObserver!=='undefined'){new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true})}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  addEventListener('pageshow',()=>{stamp();apply()});document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});setInterval(()=>{if(!document.hidden)apply()},3000);
})();
