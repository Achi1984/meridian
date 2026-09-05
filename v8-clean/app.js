import {loadCenter,loadDepot,loadTrade,hasReadToken,setReadToken} from './data.js';

const ROUTES=['center','depot','trade','paper','more'];
const $=s=>document.querySelector(s);
const fmtUsd=v=>Number.isFinite(Number(v))?'$'+Math.round(Number(v)).toLocaleString('de-DE'):'—';
const fmtPct=(v,d=1)=>Number.isFinite(Number(v))?Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d})+'%':'—';
const fmtPrice=v=>Number.isFinite(Number(v))?'$'+Number(v).toLocaleString('de-DE',{maximumFractionDigits:4}):'—';
const state={view:'center',center:null,depot:null,trade:null};

function setView(key){
  if(!ROUTES.includes(key))return;
  state.view=key;
  document.getElementById('app').dataset.view=key;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('is-active',v.dataset.view===key));
  document.querySelectorAll('#mainNav [data-route]').forEach(b=>{const on=b.dataset.route===key;b.classList.toggle('active',on);b.setAttribute('aria-current',on?'page':'false')});
  render(key);
  if(key==='center'&&!state.center)hydrateCenter();
  if(key==='depot'&&!state.depot)hydrateDepot();
  if(key==='trade'&&!state.trade)hydrateTrade();
}

function centerHtml(x){
  if(!x)return `<section class="hero"><div class="eyebrow">CENTER · WHAT MATTERS NOW</div><div class="hero-value">LÄDT…</div><p class="muted">Kanonische Daten werden geladen.</p></section>`;
  if(x.locked)return `<section class="hero"><div class="eyebrow">CENTER · PRIVATE DATA</div><div class="hero-value">LOCKED</div><p class="muted">Der Clean Rebuild verwendet bewusst nur den geschützten Private-Dashboard-Vertrag. Read Token einmalig in MORE verbinden.</p></section><section class="action"><span>ARCHITEKTUR</span><b>Keine Legacy-Renderer · keine versteckten Buttons · keine zweite Datenbasis</b></section>`;
  if(!x.ok)return `<section class="hero"><div class="eyebrow">CENTER · DATA STATUS</div><div class="hero-value">CHECK</div><p class="muted">${x.error||'Daten nicht verfügbar'}</p></section>`;
  const risk=x.risk||{state:'CHECK',tone:'muted',bot:null};
  return `<section class="hero"><div class="eyebrow">CENTER · WHAT MATTERS NOW</div><div class="hero-value">${fmtUsd(x.portfolioUsd)}</div><p class="muted">Portfolio · Markt · Risiko · nächste Aktion · beste Opportunity</p></section>
  <div class="grid2">
    <section class="metric"><span>MARKET</span><b>${x.market||'—'}</b><small>Eine Marktquelle; keine UI-Ableitung.</small></section>
    <section class="metric"><span>RISK</span><b class="tone-${risk.tone}">${risk.state}</b><small>${risk.bot?`${risk.bot.id} · ${risk.bot.buffer?.toFixed?.(2)??'—'}% Buffer`:'Keine belastbaren Botdaten'}</small></section>
  </div>
  <section class="action"><span>NEXT ACTION</span><b>${x.nextAction||'Keine Aktion'}</b></section>
  <section class="action"><span>BEST OPPORTUNITY</span><b>${x.opportunity?`${x.opportunity.symbol} ${x.opportunity.side||''}`:'NO READY SIGNAL'}</b><small>${x.opportunity?.confidence!=null?`Confidence ${x.opportunity.confidence}`:'Nur READY / TRADE / ENTRY wird angezeigt.'}</small></section>`;
}

function sparkline(points=[]){
  const xs=points.filter(p=>Number.isFinite(Number(p?.totalUsd)));
  if(xs.length<2)return `<div class="chart-empty">KANONISCHE HISTORIE WIRD AUFGEBAUT</div>`;
  const vals=xs.map(p=>Number(p.totalUsd)),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(1,max-min),w=320,h=116,pad=5;
  const coords=vals.map((v,i)=>{const x=pad+(w-pad*2)*(i/(vals.length-1));const y=pad+(h-pad*2)*(1-(v-min)/span);return `${x.toFixed(1)},${y.toFixed(1)}`}).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Portfolio Verlauf"><polyline points="${coords}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
}
function depotHtml(x){
  if(!x)return `<section class="hero depot-hero"><div class="eyebrow">DEPOT · VERMÖGEN</div><div class="hero-value">LÄDT…</div><p class="muted">Private Dashboard + kanonische Portfolio-Historie.</p></section>`;
  if(x.locked)return `<section class="hero depot-hero"><div class="eyebrow">DEPOT · PRIVATE DATA</div><div class="hero-value">LOCKED</div><p class="muted">Read Token in MORE verbinden. Kein Fallback auf alte DOM-Werte.</p></section>`;
  if(!x.ok)return `<section class="hero depot-hero"><div class="eyebrow">DEPOT · DATA STATUS</div><div class="hero-value">CHECK</div><p class="muted">${x.error||'Daten nicht verfügbar'}</p></section>`;
  const perf=x.history?.performance,tone=perf?.pct>0?'safe':perf?.pct<0?'danger':'muted';
  const rows=(x.topPositions||[]).map((p,i)=>`<div class="position-row"><div><b>${i+1}. ${p.symbol}</b><small>${p.venue}</small></div><div><b>${fmtUsd(p.value)}</b><small>${fmtPct(p.pct,1)}</small></div></div>`).join('')||'<div class="chart-empty">Keine Spot-Positionen verfügbar</div>';
  const historyNote=x.history?.mature?`1D · ${x.history.basis==='CASHFLOW_ADJUSTED'?'cashflow-bereinigt':'roh'} · ${x.history.source}`:`History Warm-up · ${Math.round((x.history?.coverageMs||0)/3600000)}h Abdeckung`;
  return `<section class="hero depot-hero"><div class="eyebrow">DEPOT · VERMÖGEN</div><div class="hero-value">${fmtUsd(x.totalUsd)}</div><p class="muted">Gesamt = Spot + Trading/Bots · eine kanonische Bewertungsbasis</p></section>
  <div class="depot-performance">
    <section class="metric perf-card"><span>1D</span><b class="tone-${tone}">${perf?fmtPct(perf.pct,2):'WARM-UP'}</b><small>${perf?`${fmtUsd(perf.deltaUsd)} · ${historyNote}`:historyNote}</small></section>
    <section class="chart-card">${sparkline(x.history?.points||[])}</section>
  </div>
  <div class="grid2 depot-split">
    <section class="metric"><span>SPOT</span><b>${fmtUsd(x.spotUsd)}</b><small>${fmtPct(x.spotPct,1)}</small></section>
    <section class="metric"><span>TRADING / BOTS</span><b>${fmtUsd(x.tradingUsd)}</b><small>${fmtPct(x.tradingPct,1)}</small></section>
  </div>
  <section class="card positions"><div class="eyebrow">TOP POSITIONEN</div>${rows}</section>`;
}

function tradeHtml(x){
  if(!x)return `<section class="hero trade-hero"><div class="eyebrow">TRADE · RISK FIRST</div><div class="hero-value">LÄDT…</div><p class="muted">Aktive Bots und Liquidationspuffer werden geladen.</p></section>`;
  if(x.locked)return `<section class="hero trade-hero"><div class="eyebrow">TRADE · PRIVATE DATA</div><div class="hero-value">LOCKED</div><p class="muted">Read Token in MORE verbinden. Keine Legacy-Risk-Karten werden ausgelesen.</p></section>`;
  if(!x.ok)return `<section class="hero trade-hero"><div class="eyebrow">TRADE · DATA STATUS</div><div class="hero-value">CHECK</div><p class="muted">${x.error||'Risikodaten nicht verfügbar'}</p></section>`;
  const risk=x.risk||{state:'CHECK',tone:'muted',bot:null};
  const b=x.criticalBot;
  const rows=(x.bots||[]).map(bot=>{
    const tone=Number.isFinite(bot.buffer)?bot.buffer<8?'danger':bot.buffer<12?'watch':'safe':'muted';
    const meta=[bot.side,bot.leverage!=null?`${bot.leverage}x`:null].filter(Boolean).join(' · ')||'—';
    return `<div class="bot-row"><div><b>${bot.id}</b><small>${meta}${bot.symbol?` · ${bot.symbol}`:''}</small></div><div><b class="tone-${tone}">${fmtPct(bot.buffer,2)}</b><small>LIQ ${fmtPrice(bot.liquidationPrice)}</small></div></div>`;
  }).join('')||'<div class="chart-empty">Keine aktiven Bot-Risikodaten verfügbar</div>';
  const target=risk.targetPct!=null?`Ziel ≥${risk.targetPct}% · fehlen ${fmtPct(risk.remainingPct,2)}`:'Kein Recovery-Ziel offen';
  return `<section class="hero trade-hero tone-border-${risk.tone}"><div class="eyebrow">TRADE · RISK FIRST</div><div class="trade-state tone-${risk.tone}">${risk.state}</div><p class="muted">${b?`${b.id} ist aktuell der kritischste Bot · ${fmtPct(b.buffer,2)} Buffer`:'Keine belastbaren Liquidationspuffer verfügbar'}</p></section>
  <div class="grid2 trade-metrics">
    <section class="metric"><span>KRITISCHSTER BOT</span><b>${b?.id||'—'}</b><small>${b?[b.side,b.leverage!=null?`${b.leverage}x`:null].filter(Boolean).join(' · '):'Keine Botdaten'}</small></section>
    <section class="metric"><span>TRADING EQUITY</span><b>${fmtUsd(x.tradingEquityUsd)}</b><small>${x.activeCount} aktive Bot${x.activeCount===1?'':'s'}</small></section>
  </div>
  <section class="action priority-action"><span>NEXT ACTION</span><b>${x.nextAction||'Risikodaten prüfen'}</b><small>${target}</small></section>
  <section class="card bots"><div class="eyebrow">AKTIVE BOTS · NACH BUFFER SORTIERT</div>${rows}</section>`;
}
function placeholder(title,sub){return `<section class="card placeholder"><div><div class="eyebrow">V8 CLEAN</div><b>${title}</b><small>${sub}</small></div></section>`}
function moreHtml(){return `<section class="card"><div class="eyebrow">MORE · SYSTEM & DETAILS</div><h2>Saubere Tiefe statt Legacy-Overlay</h2><p class="muted">Hier kommen Markt, Forecast, Scanner, Research, Diagnostik und Einstellungen als explizite Module hinein.</p><div class="row"><span>Private Data</span><b>${hasReadToken()?'VERBUNDEN':'LOCKED'}</b></div><button id="connectToken" class="action" type="button"><span>READ TOKEN</span><b>${hasReadToken()?'Token ersetzen':'Token verbinden'}</b></button></section>`}
function render(key){
  const root=document.getElementById(`view-${key}`);if(!root)return;
  if(key==='center')root.innerHTML=centerHtml(state.center);
  if(key==='depot')root.innerHTML=depotHtml(state.depot);
  if(key==='trade')root.innerHTML=tradeHtml(state.trade);
  if(key==='paper')root.innerHTML=placeholder('PAPER','Als nächstes: geschützte Ledgers + Research-Vergleich, weiterhin research-only.');
  if(key==='more')root.innerHTML=moreHtml();
  $('#connectToken')?.addEventListener('click',()=>{const t=prompt('MERIDIAN Read Token');if(t!==null){setReadToken(t);state.center=null;state.depot=null;state.trade=null;hydrateCenter();hydrateDepot();hydrateTrade();render('more')}});
}
async function hydrateCenter(){state.center=null;if(state.view==='center')render('center');state.center=await loadCenter();if(state.view==='center')render('center')}
async function hydrateDepot(){state.depot=null;if(state.view==='depot')render('depot');state.depot=await loadDepot();if(state.view==='depot')render('depot')}
async function hydrateTrade(){state.trade=null;if(state.view==='trade')render('trade');state.trade=await loadTrade();if(state.view==='trade')render('trade')}
function wire(){document.querySelectorAll('#mainNav [data-route]').forEach(b=>b.addEventListener('click',()=>{location.hash=b.dataset.route;setView(b.dataset.route)}));window.addEventListener('hashchange',()=>{const k=location.hash.slice(1);if(ROUTES.includes(k))setView(k)});}

wire();
setView(ROUTES.includes(location.hash.slice(1))?location.hash.slice(1):'center');
hydrateCenter();
setInterval(()=>{if(document.visibilityState!=='visible')return;if(state.view==='center')hydrateCenter();if(state.view==='depot')hydrateDepot();if(state.view==='trade')hydrateTrade()},30000);
