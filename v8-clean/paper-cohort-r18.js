import {getJson} from './data.js';

const root=()=>document.getElementById('view-paper');
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const fmt=(v,d=2)=>num(v)==null?'—':Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
const usd=v=>num(v)==null?'—':`${Number(v)<0?'−':''}$${Math.abs(Math.round(Number(v))).toLocaleString('de-DE')}`;
const pct=v=>num(v)==null?'—':`${fmt(v,1)}%`;
const date=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('de-DE',{timeZone:'Europe/Vienna',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})};

function bestRows(map={},limit=3){
  return Object.entries(map)
    .map(([key,x])=>({key,challenger:x?.challenger||{},baseline:x?.baseline||{},delta:x?.delta||{}}))
    .filter(x=>num(x.challenger?.trades)>0)
    .sort((a,b)=>(num(b.delta?.expectancy)||-999)-(num(a.delta?.expectancy)||-999))
    .slice(0,limit);
}
function rowHtml(x){
  const c=x.challenger,d=x.delta;
  const tone=(num(c.expectancy)||0)>0?'safe':(num(c.expectancy)||0)<0?'danger':'muted';
  const adequate=c.adequate===true?'N OK':'N LOW';
  return `<div class="cohort-r18-row"><div><b>${x.key}</b><small>${adequate} · ${c.trades??0} trades</small></div><div><span class="tone-${tone}">EXP ${usd(c.expectancy)}</span><small>PF ${fmt(c.profitFactor,2)} · ΔEXP ${usd(d.expectancy)}</small></div></div>`;
}
function block(title,map){
  const rows=bestRows(map);
  return `<div class="cohort-r18-block"><div class="cohort-r18-title">${title}</div>${rows.length?rows.map(rowHtml).join(''):'<small class="muted">Noch keine belastbare Kohorte.</small>'}</div>`;
}
function render(deep){
  const el=root(); if(!el||!deep)return;
  let card=document.getElementById('paperCohortR18');
  if(!card){card=document.createElement('details');card.id='paperCohortR18';card.className='card cohort-r18 paper-disclosure';el.appendChild(card)}
  const sum=deep.summary||{},c=sum.challenger||{},b=sum.baseline||{};
  card.innerHTML=`<summary><span>COHORT DEEP DIVE</span><b>Side · Regime · Asset</b></summary><div class="paper-disclosure-body">
    <div class="cohort-r18-summary"><div><span>CHALLENGER</span><b>${usd(c.pnl)}</b><small>EXP ${usd(c.expectancy)} · PF ${fmt(c.profitFactor,2)}</small></div><div><span>BASELINE</span><b>${usd(b.pnl)}</b><small>EXP ${usd(b.expectancy)} · PF ${fmt(b.profitFactor,2)}</small></div></div>
    ${block('SIDE',deep.bySide)}${block('REGIME',deep.byRegime)}${block('ASSET',deep.bySymbol)}
    <div class="cohort-r18-foot">Research only · Kohorten mit n&lt;8 sind nicht promotionsfähig · keine automatische Ausführungswirkung.</div></div>`;
}

const botNames={baseline:'BASELINE',shadow:'SHADOW · RETIRED',challenger:'CHALLENGER V2',regime:'REGIME · RETIRED'};
function metric(label,value,tone=''){
  return `<div class="audit-r22-metric"><span>${label}</span><b class="${tone?`tone-${tone}`:''}">${value}</b></div>`;
}
function ledgerHtml(key,ledger={}){
  const stop=ledger.stopExecution||{},behavior=ledger.behavior||{};
  const bad=(num(stop.materialLosses)||0)>0||(num(behavior.postStopReentries)||0)>0;
  return `<details class="audit-r22-ledger">
    <summary><span><b>${botNames[key]||String(key).toUpperCase()}</b><small>${ledger.closedTrades??0} Trades · zuletzt ${date(ledger.lastClosedAt)} CET/CEST</small></span><span class="audit-r22-state tone-${bad?'danger':'safe'}">${bad?'CHECK':'OK'}</span></summary>
    <div class="audit-r22-section"><div class="cohort-r18-title">STOP-AUSFÜHRUNG</div><div class="audit-r22-grid">
      ${metric('&gt;1,25R',`${stop.materialLosses??0} / ${stop.evaluable??0}`,(num(stop.materialLosses)||0)>0?'danger':'safe')}
      ${metric('Ø Verlust',`${fmt(stop.averageActualLossR,3)}R`)}
      ${metric('Max Verlust',`${fmt(stop.maximumActualLossR,3)}R`)}
      ${metric('Ø Gebühren',`${fmt(stop.averageFeeR,3)}R`)}
      ${metric('Preis jenseits Stop',stop.priceBeyondStop??0)}
      ${metric('Max Abweichung',`${fmt(stop.maximumStopSlipBps,1)} bps`)}
    </div></div>
    <div class="audit-r22-section"><div class="cohort-r18-title">TRADEVERHALTEN</div><div class="audit-r22-grid">
      ${metric('Re-Entries nach Stop',behavior.postStopReentries??0,(num(behavior.postStopReentries)||0)>0?'danger':'safe')}
      ${metric('Schnelle Re-Entries',behavior.rapidSameDirectionReentries??0)}
      ${metric('Kürzester Abstand',num(behavior.minimumReentryMinutes)==null?'—':`${fmt(behavior.minimumReentryMinutes,1)} min`)}
      ${metric('Richtungs-Bündel',behavior.directionalMultiAssetBundles??0)}
      ${metric('Trades in Bündeln',behavior.tradesInsideBundles??0)}
      ${metric('Close-Cluster',behavior.closureClusters??0)}
    </div></div>
  </details>`;
}
function renderExecutionAudit(audit){
  const el=root(); if(!el||!audit?.aggregateOnly)return;
  let card=document.getElementById('paperExecutionAuditR22');
  if(!card){card=document.createElement('section');card.id='paperExecutionAuditR22';card.className='card audit-r22';el.appendChild(card)}
  const total=audit.total||{},ledgers=audit.ledgers||{};
  const attention=(num(total.materialLosses)||0)>0||(num(total.postStopReentries)||0)>0;
  card.innerHTML=`<div class="audit-r22-head"><div><div class="eyebrow">PAPER · FULL LEDGER EXECUTION AUDIT</div><b>R22 · ${attention?'EXECUTION CHECK':'UNAUFFÄLLIG'}</b></div><span class="audit-r22-pill tone-${attention?'danger':'safe'}">READ ONLY</span></div>
    <div class="audit-r22-summary">
      ${metric('Geschlossene Trades',total.closedTrades??0)}
      ${metric('Stop-Verluste &gt;1,25R',`${total.materialLosses??0} / ${total.evaluableStops??0}`,(num(total.materialLosses)||0)>0?'danger':'safe')}
      ${metric('Re-Entries nach Stop',total.postStopReentries??0,(num(total.postStopReentries)||0)>0?'danger':'safe')}
      ${metric('Richtungs-Bündel',total.directionalMultiAssetBundles??0)}
    </div>
    <div class="audit-r22-list">${Object.entries(ledgers).map(([key,value])=>ledgerHtml(key,value)).join('')}</div>
    <div class="cohort-r18-foot">Vollständige PostgreSQL-Ledger · nur geschützte Aggregate · beobachtete Zusammenhänge sind kein Kausalbeweis · keine Strategie- oder Ausführungswirkung.</div>`;
}
let loading=false;
async function hydrate(){
  const el=root(); if(!el||loading||(document.getElementById('paperCohortR18')&&document.getElementById('paperExecutionAuditR22')))return;
  loading=true;
  try{const a=await getJson('/api/research-analytics');render(a?.deepDive);renderExecutionAudit(a?.executionAudit)}catch(_e){}finally{loading=false}
}
const observer=new MutationObserver(()=>{if(document.getElementById('app')?.dataset?.view==='paper')queueMicrotask(hydrate)});
if(root())observer.observe(root(),{childList:true,subtree:false});
document.getElementById('mainNav')?.addEventListener('click',e=>{if(e.target.closest('[data-route="paper"]'))setTimeout(hydrate,0)});
window.addEventListener('meridian:v8-tokenchange',()=>{document.getElementById('paperCohortR18')?.remove();document.getElementById('paperExecutionAuditR22')?.remove();hydrate()});
if(document.getElementById('app')?.dataset?.view==='paper')hydrate();
