(function(){
  'use strict';
  const API=window.MERIDIAN_CLOUD_API||'https://p01--achi-meridian--ttvk44grdlp7.code.run';
  let state=null,loading=false;
  const n=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const fmt=(v,d=1)=>Number.isFinite(Number(v))?Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const money=v=>{const x=n(v);return `${x>0?'+':x<0?'−':''}$${Math.abs(x).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}`};
  const tone=v=>n(v)>0?'green':n(v)<0?'red':'muted';
  const pf=v=>n(v)>=99?'∞':fmt(v,2);
  function status(){return state||window.MERIDIAN_CLOUD?.regimeV1||{};}
  function view(){
    const r=status(),a=r.account||{},ev=Array.isArray(r.lastEvaluations)?r.lastEvaluations:[],op=Array.isArray(r.openPositions)?r.openPositions:[],tr=Array.isArray(r.recentClosed)?r.recentClosed:[];
    const pnl=n(a.equity,10000)-n(a.startEquity,10000),last=r.lastDecision||ev[0]||{};
    const rows=ev.slice(0,8).map(x=>`<div class="v731-row"><div><span>${x.regime||'—'}</span><b>${String(x.symbol||'').replace('USDT','')} ${x.side||'—'}</b><small>SCORE ${fmt(x.score,0)} · ${x.decision||'SKIP'} · RISK ${fmt(x.riskPct,2)}%</small></div><div><span>MODEL</span><b>${fmt(x.regimeQuality,0)} / ${fmt(x.entryQuality,0)} / ${fmt(x.momentumFit,0)}</b><small>REGIME / ENTRY / MOMENTUM</small></div></div>`).join('')||'<div class="muted">Regime-Auswertungen werden gesammelt.</div>';
    const open=op.map(x=>`<div class="v731-row"><div><span>OPEN</span><b>${String(x.symbol||'').replace('USDT','')} ${x.side}</b><small>${x.regimeType||x.regime||'—'} · SCORE ${fmt(x.regimeScore,0)}</small></div><div><span>RISK</span><b>${fmt(x.riskPct,2)}%</b><small>SL ${fmt(x.sl,4)} · TP1 ${fmt(x.tp1,4)}</small></div></div>`).join('')||'<div class="muted">Keine offenen Regime-Positionen.</div>';
    return `<div class="v731-bot-hero challenger"><div class="v731-hero-head"><div><span>ADAPTIVE STRATEGY SELECTOR</span><b>REGIME V1</b></div><i>RESEARCH ONLY</i></div><div class="v731-kpis"><div class="v731-kpi"><span>EQUITY</span><b>$${fmt(a.equity||10000,2)}</b></div><div class="v731-kpi"><span>P&L</span><b class="${tone(pnl)}">${money(pnl)}</b></div><div class="v731-kpi"><span>TRADES</span><b>${n(r.closedCount)}</b></div><div class="v731-kpi"><span>WR / PF</span><b>${fmt(r.winRate,1)}% / ${pf(r.profitFactor)}</b></div><div class="v731-kpi"><span>DD</span><b>${fmt(a.drawdownPct,2)}%</b></div><div class="v731-kpi"><span>OPEN</span><b>${n(r.openCount)}</b></div></div></div>
    <div class="v731-section"><div class="v731-title"><b>CURRENT REGIME DECISION</b><span>${last.regime||'COLLECTING'}</span></div><div class="v731-decision"><div class="v731-decision-head"><b>${last.symbol?String(last.symbol).replace('USDT','')+' '+(last.side||''):'NO SIGNAL'}</b><strong class="${last.decision==='TRADE'?'green':last.decision==='CAUTION'?'amber':'muted'}">${last.decision||'WAIT'}</strong></div><small>SCORE ${fmt(last.score,0)} · RISK ${fmt(last.riskPct,2)}% · ${Array.isArray(last.reasons)&&last.reasons.length?last.reasons.join(' · '):'SOFT REGIME SCORING'}</small></div></div>
    <div class="v731-section"><div class="v731-title"><b>REGIME SCANNER</b><span>TREND · RANGE · EXPANSION · CHOP</span></div>${rows}</div>
    <div class="v731-section"><div class="v731-title"><b>OPEN POSITIONS</b><span>${op.length}</span></div>${open}</div>
    <div class="v731-section"><div class="v731-title"><b>MODEL</b><span>${r.ruleset||'7.38-REGIME-V1'}</span></div><div class="v731-rules"><div class="v731-rule"><span>TREND</span><b>PULLBACK</b></div><div class="v731-rule"><span>RANGE</span><b>MEAN REVERSION</b></div><div class="v731-rule"><span>EXPANSION</span><b>MOMENTUM</b></div><div class="v731-rule"><span>CHOP</span><b>LOW RISK</b></div></div><div class="v731-audit-note">Eigener Research-Ledger. Keine Änderung an Baseline 6.2, Shadow V1 oder Challenger V2. Regime und Richtung sind adaptive Soft-Inputs; keine automatische Promotion.</div></div>`;
  }
  function compareBlock(){
    const r=status(),a=r.account||{},p=n(a.equity,10000)-n(a.startEquity,10000);
    return `<div class="v731-section v738-regime-compare"><div class="v731-title"><b>BOT D · REGIME V1</b><span>${n(r.closedCount)}/20 · NO VERDICT</span></div><div class="v731-compare-card challenger"><span>ADAPTIVE STRATEGY SELECTOR</span><h4>REGIME V1</h4><div class="line"><span>Equity</span><b>$${fmt(a.equity||10000,2)}</b></div><div class="line"><span>P&L</span><b class="${tone(p)}">${money(p)}</b></div><div class="line"><span>Trades</span><b>${n(r.closedCount)}</b></div><div class="line"><span>WR / PF</span><b>${fmt(r.winRate,1)}% / ${pf(r.profitFactor)}</b></div><div class="line"><span>DD</span><b>${fmt(a.drawdownPct,2)}%</b></div></div><div class="v731-audit-note">Bot D wird separat bewertet. Mindestreview: 20 abgeschlossene Trades; Trade-Frequenz und Opportunity Cost bleiben Teil des Urteils.</div></div>`;
  }
  async function refresh(){if(loading)return;loading=true;try{const r=await fetch(API+'/api/regime-v1',{cache:'no-store'});if(r.ok){state=await r.json();window.MERIDIAN_CLOUD=window.MERIDIAN_CLOUD||{};window.MERIDIAN_CLOUD.regimeV1=state;}}catch(_e){}finally{loading=false}}
  function install(){
    const cur=window.cloudPaperTradeView;if(typeof cur!=='function'||cur.__v738Wrapped)return;
    const raw=cur;const wrapped=function(){let html=raw.apply(this,arguments);try{const active=typeof window.meridianPaperBotTab==='function'?window.meridianPaperBotTab():window.MERIDIAN_PAPER_BOT_TAB;const tabsEnd=html.indexOf('</div>');if(html.includes('id="v731-paper-tabs"')&&!html.includes("meridianPaperSetBotTab('regime')")){html=html.slice(0,tabsEnd)+`<button class="regime ${active==='regime'?'active':''}" onclick="meridianPaperSetBotTab('regime')">REGIME V1</button>`+html.slice(tabsEnd);}if(active==='regime'){const i=html.indexOf('</div>');if(i>=0)html=html.slice(0,i+6)+view();}else if(active==='compare'){html=html.replace('3 BOTS · 1 VERGLEICH','4 BOTS · 1 VERGLEICH')+compareBlock();}}catch(e){console.warn('MERIDIAN v7.38 regime UI',e)}return html;};wrapped.__v738Wrapped=true;window.cloudPaperTradeView=wrapped;try{cloudPaperTradeView=wrapped}catch(_e){}
  }
  function style(){if(document.getElementById('v738-regime-style'))return;const s=document.createElement('style');s.id='v738-regime-style';s.textContent='#v731-paper-tabs button.regime.active{border-color:#6f5bd3;color:#a996ff}.v738-regime-compare{border-color:#413674}';document.head.appendChild(s)}
  function start(){style();install();refresh().then(()=>{try{if(document.body?.dataset?.view==='paper')renderOne('paper')}catch(_e){}})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  setInterval(install,1000);setInterval(()=>{if(!document.hidden)refresh()},10000);
})();
