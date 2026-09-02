// MERIDIAN v7.40 — A/B/C/D Paper overview consistency using card-derived metrics; presentation only.
(function(){
  'use strict';
  const n=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const fmt=(v,d=1)=>Number.isFinite(Number(v))?Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const money=v=>{const x=n(v);return `${x>0?'+':x<0?'−':''}$${Math.abs(x).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}`};
  const tone=v=>n(v)>0?'green':n(v)<0?'red':'muted';
  const pf=v=>n(v)>=99?'∞':fmt(v,2);
  const numberFromText=(v,f=0)=>{const s=String(v||'').replace(/\s/g,'').replace(/\$/g,'').replace(/%/g,'').replace(/−/g,'-').replace(/\./g,'').replace(',','.');const m=s.match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):f;};

  function regime(){return window.MERIDIAN_CLOUD?.regimeV1||{};}
  function regimeCard(){
    const r=regime(),a=r.account||{},eq=n(a.equity,10000),start=n(a.startEquity,10000),p=eq-start;
    return `<div class="v731-compare-card regime"><span>ADAPTIVE STRATEGY SELECTOR</span><h4>REGIME V1</h4><div class="line"><span>Equity</span><b>$${eq.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div><div class="line"><span>P&L</span><b class="${tone(p)}">${money(p)}</b></div><div class="line"><span>Trades</span><b>${n(r.closedCount)}</b></div><div class="line"><span>WR / PF</span><b>${fmt(r.winRate,1)}% / ${pf(r.profitFactor)}</b></div><div class="line"><span>DD</span><b>${fmt(a.drawdownPct,2)}%</b></div><div class="line"><span>Open</span><b>${n(r.openCount)}</b></div></div>`;
  }
  function card(root,name){return [...root.querySelectorAll('.v731-compare-card')].find(x=>(x.querySelector('h4')?.textContent||'').trim()===name)||null;}
  function metric(c,label,f=0){if(!c)return f;const row=[...c.querySelectorAll('.line')].find(x=>(x.querySelector('span')?.textContent||'').trim().toLowerCase()===label.toLowerCase());return row?numberFromText(row.querySelector('b')?.textContent,f):f;}
  function cardStats(root,name){const c=card(root,name);return{pnl:metric(c,'P&L'),trades:metric(c,'Trades'),dd:metric(c,'DD'),card:c};}
  function regimeDeltas(root){
    const base=cardStats(root,'BASELINE 6.2'),rg=cardStats(root,'REGIME V1');
    const dp=rg.pnl-base.pnl,dd=rg.dd-base.dd,dt=rg.trades-base.trades;
    return `<div><span>REGIME Δ P&L vs BASE</span><b class="${tone(dp)}">${money(dp)}</b></div><div><span>REGIME Δ DD</span><b class="${tone(-dd)}">${dd>0?'+':''}${fmt(dd,2)} %-Pkt.</b></div><div><span>REGIME Δ TRADES</span><b class="${dt<0?'amber':dt>0?'green':'muted'}">${dt>0?'+':''}${dt}</b></div>`;
  }
  function overviewVerdict(root){
    const sh=cardStats(root,'SHADOW V1').trades,ch=cardStats(root,'CHALLENGER V2').trades,rg=cardStats(root,'REGIME V1').trades;
    const ready=sh>=20&&ch>=20&&rg>=20;
    return {ready,text:`${ready?'REVIEW READY':'NO VERDICT'} · Shadow ${sh}/20 · Challenger ${ch}/20 · Regime ${rg}/20. Baseline bleibt Referenz; erst ab mindestens 20 abgeschlossenen Trades je Research-Bot wird bewertet.`};
  }
  function fixPaperLabHeader(root){
    root.querySelectorAll('*').forEach(el=>{
      if(el.children.length!==0)return;
      let x=el.textContent;
      if(x.includes('3 BOTS · 1 VERGLEICH'))x=x.replace('3 BOTS · 1 VERGLEICH','4 BOTS · ÜBERSICHT');
      if(x.includes('3 BOTS · 1 ÜBERSICHT'))x=x.replace('3 BOTS · 1 ÜBERSICHT','4 BOTS · ÜBERSICHT');
      if(x.includes('BASELINE · SHADOW · CHALLENGER')&&!x.includes('REGIME'))x=x.replace('BASELINE · SHADOW · CHALLENGER','BASELINE · SHADOW · CHALLENGER · REGIME');
      el.textContent=x;
    });
  }
  function transform(html){
    const active=typeof window.meridianPaperBotTab==='function'?window.meridianPaperBotTab():window.MERIDIAN_PAPER_BOT_TAB;
    const t=document.createElement('template');t.innerHTML=html;
    const compareButton=[...t.content.querySelectorAll('#v731-paper-tabs button')].find(b=>(b.getAttribute('onclick')||'').includes("'compare'"));
    if(compareButton)compareButton.textContent='ÜBERSICHT';
    fixPaperLabHeader(t.content);
    if(active!=='compare')return t.innerHTML;

    t.content.querySelectorAll('*').forEach(el=>{if(el.children.length===0&&el.textContent.trim()==='A/B/C BOT VERGLEICH')el.textContent='A/B/C/D BOT ÜBERSICHT';});
    const old=t.content.querySelector('.v738-regime-compare');if(old)old.remove();
    const grid=t.content.querySelector('.v731-compare-grid');
    if(grid&&!grid.querySelector('.v731-compare-card.regime'))grid.insertAdjacentHTML('beforeend',regimeCard());
    const deltas=t.content.querySelector('.v731-deltas');
    if(deltas){const prior=deltas.querySelector('[data-v739-regime-delta]');if(prior)prior.remove();const box=document.createElement('div');box.setAttribute('data-v739-regime-delta','1');box.style.display='contents';box.innerHTML=regimeDeltas(t.content);deltas.appendChild(box);}

    const verdictData=overviewVerdict(t.content);
    const verdict=[...t.content.querySelectorAll('div')].find(el=>el.children.length===0&&el.textContent.includes('Baseline bleibt Referenz'));
    if(verdict)verdict.textContent=verdictData.text;
    const title=t.content.querySelector('.v731-section .v731-title span');
    if(title&&grid)title.textContent=verdictData.ready?'REVIEW READY':'NO VERDICT';
    return t.innerHTML;
  }
  function install(){
    const cur=window.cloudPaperTradeView;if(typeof cur!=='function'||cur.__v740Wrapped)return;
    const raw=cur.__v739Raw||cur;const wrapped=function(){try{return transform(raw.apply(this,arguments))}catch(e){console.warn('MERIDIAN v7.40 overview',e);return raw.apply(this,arguments)}};
    wrapped.__v740Wrapped=true;wrapped.__v739Raw=raw;window.cloudPaperTradeView=wrapped;try{cloudPaperTradeView=wrapped}catch(_e){}
  }
  function style(){if(document.getElementById('v739-overview-style'))return;const s=document.createElement('style');s.id='v739-overview-style';s.textContent='.v731-compare-card.regime{border-color:#6f5bd3}.v731-compare-card.regime>span{color:#a996ff}#v731-paper-tabs button.compare.active{color:#e8b24a}@media(max-width:650px){.v731-compare-grid{grid-template-columns:1fr!important}}';document.head.appendChild(s)}
  function start(){style();install();try{if(document.body?.dataset?.view==='paper')renderOne('paper')}catch(_e){}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  setInterval(install,1000);
})();
