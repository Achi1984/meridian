/* MERIDIAN v7.65 R1 — Trade/Grid UI + risk-logic cleanup. Display-only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='7.65';
  const BUILD='7.65-20260905-R1';
  const rules=window.MERIDIAN_TRADE_RISK_V765;
  if(!rules)return;

  const text=el=>String(el?.textContent||'').trim();
  const leafs=root=>root?[...root.querySelectorAll('*')].filter(el=>el.children.length===0):[];
  const findLeaf=(root,re)=>leafs(root).find(el=>re.test(text(el)))||null;
  const numDe=s=>{
    const raw=String(s||'').replace(/\s/g,'').replace(/\$/g,'').replace(/%/g,'');
    if(!raw)return null;
    const norm=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g,'');
    const n=Number(norm.replace(/[^0-9+\-.]/g,''));
    return Number.isFinite(n)?n:null;
  };
  function ancestor(el,re,max=8){let n=el;for(let i=0;i<max&&n;i++,n=n.parentElement){if(re.test(text(n)))return n}return null}
  function findMetricContainer(root,labelRe){
    const l=findLeaf(root,labelRe);if(!l)return null;
    return ancestor(l,/.+/,2)||l.parentElement;
  }
  function valueLeaf(box,labelRe){
    if(!box)return null;
    return leafs(box).find(el=>!labelRe.test(text(el))&&/[%$0-9A-ZÄÖÜ≥+\-]/i.test(text(el)))||null;
  }
  function nearestCard(el){let n=el;for(let i=0;i<8&&n;i++,n=n.parentElement){const c=String(n.className||'');if(/card|panel|commander|next-action|grid-command/i.test(c))return n}return el?.parentElement||null}

  function primaryRisk(){
    const root=document.getElementById('view-trade')||document.body;
    const btc=findLeaf(root,/^BTC-S30$/i);
    const card=btc?nearestCard(btc):null;
    let buffer=null;
    if(card){
      const bLabel=findLeaf(card,/^PUFFER$/i);
      if(bLabel){const box=bLabel.parentElement;const candidates=leafs(box).filter(x=>x!==bLabel);for(const c of candidates){const n=numDe(text(c));if(n!=null){buffer=n;break}}}
    }
    if(buffer==null){
      const snap=window.MERIDIAN_PIONEX_SNAPSHOT?.activeBots?.['BTC-S30'];
      buffer=Number(snap?.pionexLiqBufferPct ?? snap?.calculatedLiqBufferPct);
    }
    return {root,buffer:Number.isFinite(buffer)?buffer:null,card};
  }

  function fixCommander(root,buffer){
    const head=findLeaf(root,/^GRID COMMANDER\b/i);if(!head)return;
    const card=nearestCard(head)||head.parentElement;
    const label=findLeaf(card,/^NÄCHSTES ZIEL$/i);if(!label)return;
    const box=label.parentElement;const value=valueLeaf(box,/^NÄCHSTES ZIEL$/i);
    if(value)value.textContent=rules.commanderTarget(buffer);
  }

  function fixNextAction(root,buffer){
    const head=findLeaf(root,/^NEXT ACTION\s*·\s*LIQUIDATION FIRST$/i);if(!head)return;
    const card=nearestCard(head)||ancestor(head,/\bLIQ\b[\s\S]*\bPUFFER\b/i,7);if(!card)return;
    const s=rules.recoveryState(buffer);
    const targetLabel=findLeaf(card,/^ZIEL$/i);
    if(targetLabel){const v=valueLeaf(targetLabel.parentElement,/^ZIEL$/i);if(v)v.textContent=s.target==null?'—':`≥${s.target.toFixed(2).replace('.',',')}%`;}
    const gapLabel=findLeaf(card,/^FEHLT$/i);
    if(gapLabel){const v=valueLeaf(gapLabel.parentElement,/^FEHLT$/i);if(v){v.textContent=s.gapText;v.classList.remove('green','red','amber');v.classList.add(s.buffer!=null&&s.buffer>=s.target?'green':'amber');}}
  }

  function liveBtcPrice(){
    try{
      const d=typeof DATA!=='undefined'?DATA:window.DATA;
      const candidates=[d?.livePrices?.BTC?.price,d?.livePrices?.BTCUSDT?.price,d?.market?.BTC?.price,d?.market?.BTCUSDT?.price,window.MERIDIAN_PIONEX_SNAPSHOT?.activeBots?.['BTC-S30']?.currentPrice];
      for(const v of candidates){const n=Number(v);if(Number.isFinite(n)&&n>0)return n}
    }catch(_e){}
    return null;
  }

  function fixFib(root){
    const head=findLeaf(root,/^FIB LEVELS$/i);if(!head)return;
    const section=ancestor(head,/FIB LEVELS[\s\S]*(?:23,6|23\.6)%/i,8)||head.parentElement?.parentElement;
    if(!section)return;
    const current=liveBtcPrice();if(!(current>0))return;
    const side=/BTC-S30[\s\S]*SHORT/i.test(text(root))?'SHORT':'LONG';
    const rows=[...section.querySelectorAll('.fib-row')];
    for(const row of rows){
      const pct=leafs(row).find(el=>/^\d{1,3}(?:[,.]\d)?%$/.test(text(el)));const money=leafs(row).find(el=>/^\$/.test(text(el)));
      if(!pct||!money)continue;
      const level=numDe(text(money));if(!(level>0))continue;
      const role=rules.fibRole({side,level,current});
      let tag=leafs(row).find(el=>/^(RESIST|SUPPORT|EXIT|MODEL|RISK|PROFIT|PIVOT)$/i.test(text(el)));
      if(!tag){tag=document.createElement('span');tag.className='tag';pct.parentElement?.appendChild(tag)}
      tag.textContent=role.role;
      tag.classList.remove('red','green','amber','cyan');tag.classList.add(role.tone);
    }
  }

  function compactTools(root){
    const patterns=[/^RISK SIMULATOR\s*·\s*DIAGNOSE$/i,/^WHAT-IF\s*·\s*DIAGNOSE$/i,/^BOT LIFECYCLE$/i,/^ERWEITERTE RISIKO-MODELLE$/i];
    const details=[];
    for(const re of patterns){const h=findLeaf(root,re);if(!h)continue;const d=h.closest('details')||nearestCard(h);if(d&&!details.includes(d))details.push(d)}
    if(details.length<3)return;
    const parents=new Map();for(const d of details){if(!d.parentElement)continue;parents.set(d.parentElement,(parents.get(d.parentElement)||0)+1)}
    const common=[...parents.entries()].sort((a,b)=>b[1]-a[1])[0];if(!common||common[1]<3)return;
    common[0].classList.add('v765-tools-grid');for(const d of details)d.classList.add('v765-tool-card');
  }

  function injectCss(){
    if(document.getElementById('v765-trade-risk-css'))return;
    const s=document.createElement('style');s.id='v765-trade-risk-css';s.textContent=`
      .v765-tools-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important;align-items:stretch!important}
      .v765-tools-grid>.v765-tool-card{margin:0!important;min-width:0!important;border:1px solid #17354f!important;border-radius:16px!important;background:#06111b!important;overflow:hidden!important}
      .v765-tools-grid>.v765-tool-card summary{min-height:112px!important;padding:14px!important;border:0!important;display:flex!important;flex-direction:column!important;justify-content:space-between!important;align-items:flex-start!important;gap:10px!important}
      .v765-tools-grid>.v765-tool-card summary>*{max-width:100%!important}
      @media(max-width:430px){.v765-tools-grid{gap:8px!important}.v765-tools-grid>.v765-tool-card summary{min-height:104px!important;padding:12px!important;font-size:11px!important}}
    `;document.head.appendChild(s);
  }

  let busy=false;
  function apply(){if(busy)return;busy=true;try{
    const {root,buffer}=primaryRisk();if(!root)return;
    injectCss();fixCommander(root,buffer);fixNextAction(root,buffer);fixFib(root);compactTools(root);
    window.MERIDIAN_TRADE_RISK_STATUS={version:rules.VERSION,build:BUILD,buffer,appliedAt:new Date().toISOString(),executionImpact:false};
  }finally{busy=false}}

  function stamp(){window.MERIDIAN_RELEASE_VERSION=VERSION;window.MERIDIAN_UI_VERSION=VERSION;window.MERIDIAN_RELEASE_BUILD=BUILD;window.__MERIDIAN_BUILD__=BUILD;const meta=document.querySelector('meta[name="meridian-build"]');if(meta)meta.content=BUILD;const badge=document.getElementById('versionBadge');if(badge)badge.textContent=`v${VERSION} · LIVE`;}
  function run(){stamp();apply();setTimeout(apply,120);setTimeout(apply,700)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
  new MutationObserver(()=>{clearTimeout(window.__v765TradeTimer);window.__v765TradeTimer=setTimeout(apply,70)}).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)run()});window.addEventListener('pageshow',run);setInterval(()=>{if(!document.hidden)apply()},2500);
})();
