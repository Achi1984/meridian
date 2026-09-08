import {getJson} from './data.js?v=8.0-r25';

const root=()=>document.getElementById('view-paper');
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const fmt=(v,d=2)=>num(v)==null?'—':Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
const usd=v=>num(v)==null?'—':`${Number(v)<0?'−':''}$${Math.abs(Math.round(Number(v))).toLocaleString('de-DE')}`;
const pct=v=>num(v)==null?'—':`${fmt(v,1)}%`;
const date=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('de-DE',{timeZone:'Europe/Vienna',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})};
const rate=(a,b)=>num(b)>0?`${fmt(num(a)/num(b)*100,1)}%`:'—';
const reasonLabel=x=>({WAIT_ENTRY_ZONE:'Wartet auf Entry-Zone',BASE_NOT_READY:'Baseline nicht READY',CONFIDENCE_LT_CAUTION:'Confidence unter CAUTION',MAX_OPEN_POSITIONS:'Max. Positionen erreicht',MAX_PORTFOLIO_RISK:'Portfolio-Risikolimit',SYMBOL_COOLDOWN:'Symbol-Cooldown',SAME_SYMBOL_POSITION_OPEN:'Position bereits offen'}[String(x||'').toUpperCase()]||String(x||'Keine Blockade').replaceAll('_',' '));

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
function auditCause(ledger={}){
  const stop=ledger.stopExecution||{},behavior=ledger.behavior||{},parts=[];
  if(num(stop.materialLosses)>0)parts.push(`${rate(stop.materialLosses,stop.evaluable)} Stop-Verluste >1,25R`);
  if(num(behavior.postStopReentries)>0)parts.push(`${behavior.postStopReentries} Re-Entries nach Stop`);
  if(num(behavior.directionalMultiAssetBundles)>0)parts.push(`${behavior.directionalMultiAssetBundles} Richtungs-Bündel`);
  return parts.join(' · ')||'Keine Audit-Auffälligkeit';
}
function ledgerHtml(key,ledger={},health=null){
  const stop=ledger.stopExecution||{},behavior=ledger.behavior||{};
  const bad=(num(stop.materialLosses)||0)>0||(num(behavior.postStopReentries)||0)>0;
  return `<details class="audit-r22-ledger">
    <summary><span><b>${botNames[key]||String(key).toUpperCase()}</b><small>${ledger.closedTrades??0} Trades · zuletzt ${date(ledger.lastClosedAt)} CET/CEST</small><small class="audit-r25-cause">${auditCause(ledger)}</small>${health?`<small class="audit-r25-scan">Scan ${date(health.lastScanAt)} · ${health.blocked??0}/${health.evaluated??0} aktuell geblockt</small>`:''}</span><span class="audit-r22-state tone-${bad?'danger':'safe'}">${bad?'CHECK':'OK'}</span></summary>
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
function sumLedgers(ledgers={},keys=[]){
  const rows=keys.map(k=>ledgers[k]||{});
  return {closedTrades:rows.reduce((s,x)=>s+(num(x.closedTrades)||0),0),evaluableStops:rows.reduce((s,x)=>s+(num(x.stopExecution?.evaluable)||0),0),materialLosses:rows.reduce((s,x)=>s+(num(x.stopExecution?.materialLosses)||0),0),postStopReentries:rows.reduce((s,x)=>s+(num(x.behavior?.postStopReentries)||0),0),directionalMultiAssetBundles:rows.reduce((s,x)=>s+(num(x.behavior?.directionalMultiAssetBundles)||0),0)};
}
function healthHtml(health={}){
  const e=health.engine||{},b=health.bots||{},base=b.baseline||{},chall=b.challenger||{};
  const engineOk=health.available&&e.running&&e.marketFresh&&e.state==='RUNNING';
  const top=chall.reasons?.[0]||base.reasons?.[0]||null;
  return `<div class="audit-r25-health">
    ${metric('ENGINE',health.available?(engineOk?'RUNNING':'CHECK'):'UNBEKANNT',engineOk?'safe':health.available?'danger':'')}
    ${metric('MARKT',e.marketFresh?'FRESH':'CHECK',e.marketFresh?'safe':'danger')}
    ${metric('LETZTER SCAN',date(e.lastSignalScanAt))}
    ${metric('AKTUELL GEBLOCKT',`${chall.blocked??0} / ${chall.evaluated??0}`,(chall.blocked??0)>0?'watch':'safe')}
    <div class="audit-r25-reason"><span>HÄUFIGSTER AKTUELLER GRUND</span><b>${top?`${reasonLabel(top.reason)} · ${top.count}×`:'Keine Blockade im aktuellen Scan'}</b></div>
  </div>`;
}
function renderExecutionAudit(audit,health={}){
  const el=root(); if(!el||!audit?.aggregateOnly)return;
  let card=document.getElementById('paperExecutionAuditR22');
  if(!card){card=document.createElement('section');card.id='paperExecutionAuditR22';card.className='card audit-r22';el.appendChild(card)}
  const ledgers=audit.ledgers||{},active=sumLedgers(ledgers,['baseline','challenger']),retired=sumLedgers(ledgers,['shadow','regime']);
  const attention=(num(active.materialLosses)||0)>0||(num(active.postStopReentries)||0)>0;
  card.innerHTML=`<div class="audit-r22-head"><div><div class="eyebrow">PAPER · FULL LEDGER EXECUTION AUDIT</div><b>R25 · ${attention?'ACTIVE CHECK':'ACTIVE OK'} · BOT HEALTH</b></div><span class="audit-r22-pill tone-${attention?'danger':'safe'}">READ ONLY</span></div>
    ${healthHtml(health)}
    <div class="audit-r22-summary">
      ${metric('Aktive Trades',active.closedTrades)}
      ${metric('Stop-Verluste &gt;1,25R',`${active.materialLosses} / ${active.evaluableStops} · ${rate(active.materialLosses,active.evaluableStops)}`,(num(active.materialLosses)||0)>0?'danger':'safe')}
      ${metric('Re-Entries nach Stop',active.postStopReentries,(num(active.postStopReentries)||0)>0?'danger':'safe')}
      ${metric('Richtungs-Bündel',active.directionalMultiAssetBundles)}
    </div>
    <div class="audit-r22-list audit-r25-active">${['baseline','challenger'].map(key=>ledgerHtml(key,ledgers[key],health?.bots?.[key])).join('')}</div>
    <details class="audit-r25-retired"><summary><span>HISTORISCHE RETIRED-AUFFÄLLIGKEITEN</span><b>${retired.closedTrades} Trades · getrennt von aktiv</b></summary><div class="audit-r22-list">${['shadow','regime'].map(key=>ledgerHtml(key,ledgers[key])).join('')}</div></details>
    <div class="cohort-r18-foot">Vollständige PostgreSQL-Ledger · nur geschützte Aggregate · aktive Bots und versiegelte Retired-Ledger getrennt · „aktuell geblockt“ bezieht sich nur auf den aktuellen geschützten Scan · keine Strategie- oder Ausführungswirkung.</div>`;
}
let loading=false,cached=null;
function accept(payload){
  if(!payload)return;
  cached=payload;
  render(payload.deepDive);
  renderExecutionAudit(payload.executionAudit,payload.botHealth);
}
async function hydrate(){
  const el=root(); if(!el||loading||(document.getElementById('paperCohortR18')&&document.getElementById('paperExecutionAuditR22')))return;
  if(cached){accept(cached);return}
  loading=true;
  try{const analytics=await getJson('/api/research-analytics');if(!cached)accept(analytics)}catch(_e){}finally{loading=false}
}
const observer=new MutationObserver(()=>{if(document.getElementById('app')?.dataset?.view==='paper')queueMicrotask(hydrate)});
if(root())observer.observe(root(),{childList:true,subtree:false});
document.getElementById('mainNav')?.addEventListener('click',e=>{if(e.target.closest('[data-route="paper"]'))setTimeout(hydrate,0)});
window.addEventListener('meridian:v8-tokenchange',()=>{cached=null;document.getElementById('paperCohortR18')?.remove();document.getElementById('paperExecutionAuditR22')?.remove();hydrate()});
window.addEventListener('meridian:v8-paperdata',e=>accept(e.detail));
if(document.getElementById('app')?.dataset?.view==='paper')hydrate();
