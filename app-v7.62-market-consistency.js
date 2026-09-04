/* MERIDIAN v7.62 R4 — MARKET render consistency only. No market, radar, Nadir or execution logic changes. */
(function(){
  'use strict';

  const VIEW_ID='view-market';
  let scheduled=false;
  let observer=null;

  function root(){return document.getElementById(VIEW_ID)}
  function leaves(scope){return scope?[...scope.querySelectorAll('*')].filter(el=>el.children.length===0):[]}
  function findLeaf(scope,re){return leaves(scope).find(el=>re.test(String(el.textContent||'').replace(/\s+/g,' ').trim()))||null}
  function text(el){return String(el?.textContent||'').replace(/\s+/g,' ').trim()}

  function replaceLabel(scope,re,next){
    for(const el of leaves(scope)){
      if(re.test(text(el)) && text(el)!==next)el.textContent=next;
    }
  }

  function ensureMarketLabels(scope){
    replaceLabel(scope,/^LIVE KURSE$/i,'MARKTKURSE');
    replaceLabel(scope,/^NADIR NOW$/i,'MARKET CONTEXT NOW');

    const title=findLeaf(scope,/^(?:MARKET CONTEXT:\s*)?KEIN NADIR\s*·\s*RISK-ON\s*\/\s*ÜBERDEHNT$/i);
    if(title && !/^MARKET CONTEXT:/i.test(text(title)))title.textContent='MARKET CONTEXT: KEIN NADIR · RISK-ON / ÜBERDEHNT';
  }

  function fixOnchainScore(scope){
    const anchor=findLeaf(scope,/^ON-CHAIN NADIR\s*·\s*LAST VERIFIED$/i) || findLeaf(scope,/^ON-CHAIN SNAPSHOT$/i);
    if(!anchor)return;
    let card=anchor;
    for(let i=0;i<5&&card?.parentElement;i++){
      const t=text(card);
      if(/ON-CHAIN/i.test(t)&&/KAPITULATION/i.test(t)){break}
      card=card.parentElement;
    }
    if(!card)return;
    const score=leaves(card).find(el=>/^\d{1,3}\s*\/\s*100$/.test(text(el)));
    if(!score)return;
    score.style.whiteSpace='nowrap';
    score.style.wordBreak='keep-all';
    score.style.overflowWrap='normal';
    score.style.minWidth='88px';
    score.style.flex='0 0 auto';
    score.style.textAlign='right';
    const parent=score.parentElement;
    if(parent){
      parent.style.minWidth='0';
      parent.style.alignItems='center';
    }
  }

  function number(v){
    const n=Number(String(v??'').replace(',','.'));
    return Number.isFinite(n)?n:NaN;
  }

  function dataBuffer(){
    const d=(()=>{try{return typeof DATA!=='undefined'?DATA:window.DATA}catch(_e){return window.DATA||null}})();
    const direct=[
      d?.pionexRisk?.btcS30?.bufferPct,
      d?.pionexRisk?.btcS30?.buffer,
      d?.pionexRisk?.bufferPct,
      d?.portfolio?.btcS30BufferPct,
      d?.risk?.btcS30?.bufferPct,
      d?.risk?.btcS30?.buffer
    ].map(number).find(Number.isFinite);
    if(Number.isFinite(direct))return direct;
    return NaN;
  }

  function domBuffer(){
    const body=String(document.body?.innerText||'');
    const patterns=[
      /BTC[-–]S30\s+([0-9]{1,2}[,.][0-9]{1,2})\s*%/i,
      /BTC[-–]S30[\s\S]{0,160}?PUFFER\s+([0-9]{1,2}[,.][0-9]{1,2})\s*%/i
    ];
    for(const re of patterns){
      const m=body.match(re);if(m){const n=number(m[1]);if(Number.isFinite(n))return n}
    }
    return NaN;
  }

  function fixBotRisk(scope){
    const el=findLeaf(scope,/^(?:HIGH\s*·\s*)?BTC[-–]S30(?:\s*·\s*[0-9,.]+%\s*·\s*(?:CRITICAL|WATCH|SAFE))?$/i)
      || findLeaf(scope,/^HIGH\s*·\s*BTC[-–]S30$/i);
    if(!el)return;
    const p=Number.isFinite(dataBuffer())?dataBuffer():domBuffer();
    if(!Number.isFinite(p))return;
    const status=p<8?'CRITICAL':p<10?'WATCH':'SAFE';
    el.textContent=`BTC-S30 · ${p.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}% · ${status}`;
    el.style.whiteSpace='nowrap';
  }

  function apply(){
    scheduled=false;
    const scope=root();
    if(!scope)return;
    ensureMarketLabels(scope);
    fixOnchainScore(scope);
    fixBotRisk(scope);
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(apply);
  }

  function install(){
    schedule();
    const scope=root();
    if(!scope)return;
    if(observer)observer.disconnect();
    observer=new MutationObserver(schedule);
    observer.observe(scope,{subtree:true,childList:true,characterData:true});
    setTimeout(schedule,80);
    setTimeout(schedule,350);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  window.addEventListener('pageshow',install);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)install()});
})();
