/* MERIDIAN v7.65 R3 — canonical Paper Activity / Opportunity Cost owner. Display-only; execution unchanged. */
(function(){
  'use strict';
  const VERSION='7.65';
  const BUILD='7.65-20260905-R3';
  const TITLE='ACTIVITY / OPPORTUNITY COST';
  const text=el=>String(el?.textContent||'').trim();
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmt=(v,d=0)=>Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
  const money=v=>`${Number(v)>0?'+':Number(v)<0?'−':''}$${Math.abs(Number(v)||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const activeTab=()=>typeof window.meridianPaperBotTab==='function'?window.meridianPaperBotTab():window.MERIDIAN_PAPER_BOT_TAB;

  function cardStats(root,name){
    const c=[...root.querySelectorAll('.v731-compare-card')].find(x=>text(x.querySelector('h4'))===name);
    if(!c)return null;
    const line=label=>[...c.querySelectorAll('.line')].find(x=>text(x.querySelector('span')).toLowerCase()===label.toLowerCase());
    const parse=s=>{const x=String(s||'').replace(/\s|\$/g,'').replace(/−/g,'-');const n=x.includes(',')?Number(x.replace(/\./g,'').replace(',','.').match(/-?\d+(?:\.\d+)?/)?.[0]):Number(x.match(/-?\d+(?:\.\d+)?/)?.[0]);return Number.isFinite(n)?n:0};
    return {trades:parse(text(line('Trades')?.querySelector('b'))),pnl:parse(text(line('P&L')?.querySelector('b')))};
  }

  function fallbackRows(root){
    const b=cardStats(root,'BASELINE 6.2');
    if(!b||!b.trades)return '<div class="v765c-note">COVERAGE LIMITED · Vergleichsdaten noch nicht vollständig verfügbar.</div>';
    return ['SHADOW V1','CHALLENGER V2','REGIME V1'].map(name=>{
      const s=cardStats(root,name);
      if(!s)return `<div><span>${name}</span><b>NO SAMPLE</b><small>nicht verfügbar</small></div>`;
      const dt=s.trades-b.trades, dp=s.pnl-b.pnl, cov=b.trades?100*s.trades/b.trades:0;
      return `<div><span>${name}</span><b>${s.trades} vs ${b.trades} (${dt>0?'+':''}${dt})</b><small>P&L Δ ${money(dp)} · ${fmt(cov,0)}% Activity</small></div>`;
    }).join('');
  }

  function serverRows(s){
    const w=s?.commonWindow, led=w?.ledgers||{};
    if(!s?.coverageComplete||!w)return null;
    const b=led.baseline||{}, days=Math.max(num(w.days),1/24), base=num(b.closed);
    const row=(name,x)=>{const closed=num(x?.closed),ret=base?closed/base*100:0;return `<div><span>${name}</span><b>${closed} CLOSED</b><small>${fmt(closed/days,2)} TR/D · ${fmt(ret,0)}% vs Base</small></div>`};
    return row('BASELINE 6.2',b)+row('SHADOW V1',led.shadow)+row('CHALLENGER V2',led.challenger)+row('REGIME V1',led.regime);
  }

  function canonicalPanel(root){
    const s=window.MERIDIAN_ACTIVITY_SUMMARY;
    const full=serverRows(s);
    const status=full?'SERVER AGGREGATE':'COVERAGE LIMITED';
    const body=full||fallbackRows(root);
    return `<div id="meridian-paper-activity-canonical" class="v731-section v765c-activity"><div class="v731-title"><b>${TITLE}</b><span>v7.65 R3 · ${status}</span></div><div class="v765c-grid">${body}</div><div class="v765c-note">Eine kanonische Activity-Komponente. Keine Overfilter-, Avoided-Loser- oder Missed-Winner-Wertung ohne vollständige gemeinsame Server-Coverage.</div></div>`;
  }

  function activitySections(root){
    const out=[];
    for(const el of root.querySelectorAll('.v732-activity,.v733-activity,[data-v765-paper-activity],#meridian-paper-activity-canonical'))if(!out.includes(el))out.push(el);
    for(const h of root.querySelectorAll('b,h1,h2,h3,h4,span')){
      if(text(h).toUpperCase()!==TITLE)continue;
      const c=h.closest('.v731-section,.card,[class*="panel"],section,article')||h.parentElement?.parentElement;
      if(c&&!out.includes(c))out.push(c);
    }
    return out;
  }

  function transformHtml(html){
    if(activeTab()!=='compare')return html;
    const t=document.createElement('template');t.innerHTML=html;
    const sections=activitySections(t.content);
    const panelHtml=canonicalPanel(t.content);
    if(sections.length){
      const holder=document.createElement('div');holder.innerHTML=panelHtml;const panel=holder.firstElementChild;
      sections[0].before(panel);sections.forEach(x=>x.remove());
    }else t.content.appendChild(Object.assign(document.createElement('div'),{innerHTML:panelHtml}).firstElementChild);
    return t.innerHTML;
  }

  function lockWrapper(){
    const current=window.cloudPaperTradeView;
    if(typeof current!=='function'||current.__v765CanonicalWrapped)return;
    const raw=current;
    const wrapped=function(){return transformHtml(raw.apply(this,arguments))};
    /* Preserve every legacy install marker so periodic installers cannot alternate wrappers forever. */
    wrapped.__v732Wrapped=true;
    wrapped.__v733Wrapped=true;
    wrapped.__v741Wrapped=true;
    wrapped.__v765CanonicalWrapped=true;
    wrapped.__v765CanonicalRaw=raw;
    window.cloudPaperTradeView=wrapped;
    try{cloudPaperTradeView=wrapped}catch(_e){}
  }

  function sweepDom(){
    if(document.body?.dataset?.view!=='paper'||activeTab()!=='compare')return;
    const root=document.getElementById('view-paper')||document.body;
    const sections=activitySections(root);
    if(sections.length===1&&sections[0].id==='meridian-paper-activity-canonical')return;
    if(!sections.length)return;
    const holder=document.createElement('div');holder.innerHTML=canonicalPanel(root);const panel=holder.firstElementChild;
    sections[0].before(panel);sections.forEach(x=>x.remove());
    window.MERIDIAN_PAPER_ACTIVITY_STATUS={version:VERSION,build:BUILD,canonical:true,duplicatesRemoved:Math.max(0,sections.length-1),executionImpact:false,appliedAt:new Date().toISOString()};
  }

  function css(){if(document.getElementById('v765c-css'))return;const s=document.createElement('style');s.id='v765c-css';s.textContent='.v765c-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.v765c-grid>div{border:1px solid #17354f;border-radius:12px;padding:10px;background:#06111b}.v765c-grid span{display:block;color:#7f91a6;font-size:8px}.v765c-grid b{display:block;margin-top:5px;font-size:12px}.v765c-grid small{display:block;margin-top:5px;color:#7f91a6;font-size:8px;line-height:1.35}.v765c-note{margin-top:10px;color:#7f91a6;font-size:9px;line-height:1.45}@media(max-width:650px){.v765c-grid{grid-template-columns:1fr 1fr}}';document.head.appendChild(s)}
  function stamp(){window.MERIDIAN_RELEASE_VERSION=VERSION;window.MERIDIAN_UI_VERSION=VERSION;window.MERIDIAN_RELEASE_BUILD=BUILD;window.__MERIDIAN_BUILD__=BUILD;const b=document.getElementById('versionBadge');if(b)b.textContent=`v${VERSION} · LIVE`;}
  let timer;
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{lockWrapper();sweepDom()},60)}
  function start(){stamp();css();lockWrapper();sweepDom();setTimeout(schedule,200);setTimeout(schedule,900);new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  addEventListener('pageshow',()=>{lockWrapper();sweepDom()});document.addEventListener('visibilitychange',()=>{if(!document.hidden){lockWrapper();sweepDom()}});setInterval(()=>{if(!document.hidden){lockWrapper();sweepDom()}},3000);
})();
