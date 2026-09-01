// MERIDIAN v7.39 — unified A/B/C/D Paper overview; presentation only.
(function(){
  'use strict';
  const n=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const fmt=(v,d=1)=>Number.isFinite(Number(v))?Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const money=v=>{const x=n(v);return `${x>0?'+':x<0?'−':''}$${Math.abs(x).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}`};
  const tone=v=>n(v)>0?'green':n(v)<0?'red':'muted';
  const pf=v=>n(v)>=99?'∞':fmt(v,2);

  function regime(){return window.MERIDIAN_CLOUD?.regimeV1||{};}
  function baseline(){return window.MERIDIAN_CLOUD?.paper||{};}
  function regimeCard(){
    const r=regime(),a=r.account||{},eq=n(a.equity,10000),start=n(a.startEquity,10000),p=eq-start;
    return `<div class="v731-compare-card regime"><span>ADAPTIVE STRATEGY SELECTOR</span><h4>REGIME V1</h4><div class="line"><span>Equity</span><b>$${eq.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div><div class="line"><span>P&L</span><b class="${tone(p)}">${money(p)}</b></div><div class="line"><span>Trades</span><b>${n(r.closedCount)}</b></div><div class="line"><span>WR / PF</span><b>${fmt(r.winRate,1)}% / ${pf(r.profitFactor)}</b></div><div class="line"><span>DD</span><b>${fmt(a.drawdownPct,2)}%</b></div><div class="line"><span>Open</span><b>${n(r.openCount)}</b></div></div>`;
  }
  function regimeDeltas(){
    const r=regime(),ra=r.account||{},b=baseline(),ba=b.account||{};
    const rp=n(ra.equity,10000)-n(ra.startEquity,10000),bp=n(ba.equity,10000)-n(ba.startEquity,10000);
    const dd=n(ra.drawdownPct)-n(ba.drawdownPct);
    const tradeDelta=n(r.closedCount)-(Array.isArray(b.trades)?b.trades.length:n(b.closedCount));
    return `<div><span>REGIME Δ P&L vs BASE</span><b class="${tone(rp-bp)}">${money(rp-bp)}</b></div><div><span>REGIME Δ DD</span><b class="${tone(-dd)}">${dd>0?'+':''}${fmt(dd,2)} %-Pkt.</b></div><div><span>REGIME Δ TRADES</span><b class="${tradeDelta<0?'amber':tradeDelta>0?'green':'muted'}">${tradeDelta>0?'+':''}${tradeDelta}</b></div>`;
  }
  function overviewVerdict(){
    const C=window.MERIDIAN_CLOUD||{},r=regime();
    const sh=n(C.shadow?.closedCount),ch=n(C.challenger?.closedCount),rg=n(r.closedCount);
    const ready=sh>=20&&ch>=20&&rg>=20;
    return `${ready?'REVIEW READY':'NO VERDICT'} · Shadow ${sh}/20 · Challenger ${ch}/20 · Regime ${rg}/20. Baseline bleibt Referenz; erst ab mindestens 20 abgeschlossenen Trades je Research-Bot wird bewertet.`;
  }
  function transform(html){
    const active=typeof window.meridianPaperBotTab==='function'?window.meridianPaperBotTab():window.MERIDIAN_PAPER_BOT_TAB;
    const t=document.createElement('template');t.innerHTML=html;
    const compareButton=[...t.content.querySelectorAll('#v731-paper-tabs button')].find(b=>(b.getAttribute('onclick')||'').includes("'compare'"));
    if(compareButton)compareButton.textContent='ÜBERSICHT';
    if(active!=='compare')return t.innerHTML;

    t.content.querySelectorAll('*').forEach(el=>{
      if(el.children.length===0&&el.textContent.includes('3 BOTS · 1 VERGLEICH'))el.textContent=el.textContent.replace('3 BOTS · 1 VERGLEICH','4 BOTS · 1 ÜBERSICHT');
      if(el.children.length===0&&el.textContent.trim()==='A/B/C BOT VERGLEICH')el.textContent='A/B/C/D BOT ÜBERSICHT';
    });

    const old=t.content.querySelector('.v738-regime-compare');if(old)old.remove();
    const grid=t.content.querySelector('.v731-compare-grid');
    if(grid&&!grid.querySelector('.v731-compare-card.regime'))grid.insertAdjacentHTML('beforeend',regimeCard());
    const deltas=t.content.querySelector('.v731-deltas');
    if(deltas&&!deltas.querySelector('[data-v739-regime-delta]')){
      const box=document.createElement('div');box.setAttribute('data-v739-regime-delta','1');box.style.display='contents';box.innerHTML=regimeDeltas();deltas.appendChild(box);
    }

    const verdict=[...t.content.querySelectorAll('div')].find(el=>el.children.length===0&&el.textContent.includes('Baseline bleibt Referenz'));
    if(verdict)verdict.textContent=overviewVerdict();
    const title=t.content.querySelector('.v731-section .v731-title span');
    const r=regime(),C=window.MERIDIAN_CLOUD||{};
    if(title&&t.content.querySelector('.v731-compare-grid'))title.textContent=(n(C.shadow?.closedCount)>=20&&n(C.challenger?.closedCount)>=20&&n(r.closedCount)>=20)?'REVIEW READY':'NO VERDICT';
    return t.innerHTML;
  }
  function install(){
    const cur=window.cloudPaperTradeView;if(typeof cur!=='function'||cur.__v739Wrapped)return;
    const raw=cur;const wrapped=function(){try{return transform(raw.apply(this,arguments))}catch(e){console.warn('MERIDIAN v7.39 overview',e);return raw.apply(this,arguments)}};
    wrapped.__v739Wrapped=true;wrapped.__v739Raw=raw;window.cloudPaperTradeView=wrapped;try{cloudPaperTradeView=wrapped}catch(_e){}
  }
  function style(){if(document.getElementById('v739-overview-style'))return;const s=document.createElement('style');s.id='v739-overview-style';s.textContent='.v731-compare-card.regime{border-color:#6f5bd3}.v731-compare-card.regime>span{color:#a996ff}#v731-paper-tabs button.compare.active{color:#e8b24a}@media(max-width:650px){.v731-compare-grid{grid-template-columns:1fr!important}}';document.head.appendChild(s)}
  function start(){style();install();try{if(document.body?.dataset?.view==='paper')renderOne('paper')}catch(_e){}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  setInterval(install,1000);
})();
