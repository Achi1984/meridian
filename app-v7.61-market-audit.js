/* MERIDIAN v7.61 R12 — MARKET audit semantics only. No trading/research execution changes. */
(function(){
  'use strict';
  const VERSION='7.61';
  const BUILD='7.61-20260904-R12';

  function leafs(root){return root?[...root.querySelectorAll('*')].filter(el=>el.children.length===0):[]}
  function findLeaf(root,re){return leafs(root).find(el=>re.test(String(el.textContent||'').trim()))||null}
  function replaceExact(root,re,text){const el=findLeaf(root,re);if(el&&el.textContent!==text)el.textContent=text;return el}
  function ensureNote(anchor,key,text){
    if(!anchor)return;
    let note=anchor.parentElement?.querySelector(`[data-${key}]`);
    if(!note){
      note=document.createElement('div');
      note.dataset[key]='1';
      note.style.cssText='margin-top:6px;font:600 9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.07em;color:#7f95aa';
      anchor.insertAdjacentElement('afterend',note);
    }
    note.textContent=text;
  }
  function parseConfirmedDate(text){
    const m=String(text||'').match(/(20\d{2})[-/.](\d{2})[-/.](\d{2})/);
    if(!m)return NaN;
    return Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  }
  function decorateMarket(){
    const root=document.getElementById('view-market');
    if(!root)return;

    replaceExact(root,/^LIVE KURSE$/i,'MARKTKURSE');

    const nadirNow=replaceExact(root,/^NADIR NOW$/i,'MARKET CONTEXT NOW');
    if(nadirNow)ensureNote(nadirNow,'v761MarketContextNote','AKTUELLER MARKTKONTEXT · OHNE ON-CHAIN-BESTÄTIGUNG');

    const currentTitle=findLeaf(root,/^KEIN NADIR\s*·\s*RISK-ON\s*\/\s*ÜBERDEHNT$/i);
    if(currentTitle&&!/^MARKET CONTEXT:/i.test(currentTitle.textContent||''))currentTitle.textContent='MARKET CONTEXT: KEIN NADIR · RISK-ON / ÜBERDEHNT';

    const onchain=replaceExact(root,/^ON-CHAIN SNAPSHOT$/i,'ON-CHAIN NADIR · LAST VERIFIED');
    const confirmed=findLeaf(root,/^LAST CONFIRMED$/i);
    if(confirmed){
      let holder=confirmed.parentElement;
      const text=String(holder?.textContent||'');
      const t=parseConfirmedDate(text);
      const stale=Number.isFinite(t)&&(Date.now()-t)>7*86400000;
      confirmed.textContent=stale?'STALE · LAST VERIFIED':'LAST VERIFIED';
      if(stale)confirmed.style.color='#e6ad3a';
    }
    if(onchain)ensureNote(onchain,'v761OnchainNote','SEPARATER ON-CHAIN-SCORE · WIRD NICHT DURCH DEN CURRENT MARKET SCORE ERSETZT');

    const breadth=findLeaf(root,/^\s*\d+\s*\/\s*8\s*·\s*GATED\s*$/i);
    if(breadth&&!/ERFÜLLEN/i.test(breadth.textContent||''))breadth.textContent=String(breadth.textContent||'').replace(/\s*·\s*GATED\s*$/i,' ERFÜLLEN · GATED');

    const botRisk=findLeaf(root,/^HIGH\s*·\s*BTC-S30$/i);
    if(botRisk){
      const data=(()=>{try{return typeof DATA!=='undefined'?DATA:window.DATA}catch(_e){return window.DATA||null}})();
      const candidates=[
        data?.pionexRisk?.btcS30?.bufferPct,
        data?.pionexRisk?.bufferPct,
        data?.portfolio?.btcS30BufferPct,
        data?.risk?.btcS30?.bufferPct
      ].map(Number).filter(Number.isFinite);
      if(candidates.length){
        const p=candidates[0];
        botRisk.textContent=`BTC-S30 · ${p.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}% · ${p<8?'CRITICAL':p<10?'WATCH':'SAFE'}`;
      }
    }
  }

  function stamp(){
    window.MERIDIAN_RELEASE_VERSION=VERSION;
    window.MERIDIAN_UI_VERSION=VERSION;
    window.MERIDIAN_RELEASE_BUILD=BUILD;
    window.__MERIDIAN_BUILD__=BUILD;
    const meta=document.querySelector('meta[name="meridian-build"]');if(meta)meta.content=BUILD;
    const badge=document.getElementById('versionBadge');if(badge)badge.textContent=`v${VERSION} · LIVE`;
  }
  function apply(){stamp();decorateMarket();setTimeout(decorateMarket,50)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
  window.addEventListener('pageshow',apply);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)apply()});
  setInterval(()=>{if(!document.hidden)decorateMarket()},1500);
})();
