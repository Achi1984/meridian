import {loadCenter,hasReadToken,setReadToken} from './data.js';

const ROUTES=['center','depot','trade','paper','more'];
const $=s=>document.querySelector(s);
const fmtUsd=v=>Number.isFinite(Number(v))?'$'+Math.round(Number(v)).toLocaleString('de-DE'):'—';
const state={view:'center',center:null};

function setView(key){
  if(!ROUTES.includes(key))return;
  state.view=key;
  document.getElementById('app').dataset.view=key;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('is-active',v.dataset.view===key));
  document.querySelectorAll('#mainNav [data-route]').forEach(b=>{const on=b.dataset.route===key;b.classList.toggle('active',on);b.setAttribute('aria-current',on?'page':'false')});
  render(key);
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
function placeholder(title,sub){return `<section class="card placeholder"><div><div class="eyebrow">V8 CLEAN</div><b>${title}</b><small>${sub}</small></div></section>`}
function moreHtml(){return `<section class="card"><div class="eyebrow">MORE · SYSTEM & DETAILS</div><h2>Saubere Tiefe statt Legacy-Overlay</h2><p class="muted">Hier kommen Markt, Forecast, Scanner, Research, Diagnostik und Einstellungen als explizite Module hinein.</p><div class="row"><span>Private Data</span><b>${hasReadToken()?'VERBUNDEN':'LOCKED'}</b></div><button id="connectToken" class="action" type="button"><span>READ TOKEN</span><b>${hasReadToken()?'Token ersetzen':'Token verbinden'}</b></button></section>`}
function render(key){
  const root=document.getElementById(`view-${key}`);if(!root)return;
  if(key==='center')root.innerHTML=centerHtml(state.center);
  if(key==='depot')root.innerHTML=placeholder('DEPOT','Als nächstes: kanonischer Portfolio-Adapter + History, ohne Legacy-DOM.');
  if(key==='trade')root.innerHTML=placeholder('TRADE','Danach: Risk State + aktive Bots direkt aus einem Adaptervertrag.');
  if(key==='paper')root.innerHTML=placeholder('PAPER','Research bleibt getrennt; keine Ausführungsänderung.');
  if(key==='more')root.innerHTML=moreHtml();
  $('#connectToken')?.addEventListener('click',()=>{const t=prompt('MERIDIAN Read Token');if(t!==null){setReadToken(t);hydrateCenter();render('more')}});
}
async function hydrateCenter(){state.center=null;if(state.view==='center')render('center');state.center=await loadCenter();if(state.view==='center')render('center')}
function wire(){document.querySelectorAll('#mainNav [data-route]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.route)));window.addEventListener('hashchange',()=>{const k=location.hash.slice(1);if(ROUTES.includes(k))setView(k)});}

wire();
setView(ROUTES.includes(location.hash.slice(1))?location.hash.slice(1):'center');
hydrateCenter();
setInterval(()=>{if(document.visibilityState==='visible')hydrateCenter()},30000);
