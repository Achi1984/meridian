import {getJson} from './data.js?v=8.0-r38';

const root=()=>document.getElementById('view-paper');
const num=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=2)=>num(v)==null?'—':Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
const usd=v=>num(v)==null?'—':`${Number(v)<0?'−':''}$${Math.abs(Math.round(Number(v))).toLocaleString('de-DE')}`;
const pct=v=>num(v)==null?'—':`${fmt(v,1)}%`;
const date=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('de-DE',{timeZone:'Europe/Vienna',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})};
const rate=(a,b)=>num(b)>0?`${fmt(num(a)/num(b)*100,1)}%`:'—';
const reasonLabel=x=>({WAIT_ENTRY_ZONE:'Wartet auf Entry-Zone',BASE_NOT_READY:'Baseline nicht READY',CONFIDENCE_LT_CAUTION:'Confidence unter CAUTION',MAX_OPEN_POSITIONS:'Max. Positionen erreicht',MAX_PORTFOLIO_RISK:'Portfolio-Risikolimit',SYMBOL_COOLDOWN:'Symbol-Cooldown',SAME_SYMBOL_POSITION_OPEN:'Position bereits offen'}[String(x||'').toUpperCase()]||String(x||'Keine Blockade').replaceAll('_',' '));
const gateLabel=x=>({MAX_DRAWDOWN:'Max Drawdown erreicht',MAX_DAILY_LOSS:'Tagesverlust-Limit',MAX_OPEN_POSITIONS:'Max. Positionen erreicht',MAX_PORTFOLIO_RISK:'Portfolio-Risikolimit',MAX_TRADES_PER_DAY:'Tageslimit erreicht'}[String(x||'').toUpperCase()]||reasonLabel(x));

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

const botNames={baseline:'BASELINE',shadow:'SHADOW · RETIRED',challenger:'CHALLENGER V2 · ELTERN-LEDGER',challengerV3:'CHALLENGER V3',regime:'REGIME · RETIRED'};
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
function botAnswer(key,bot={}){
  const total=bot.metrics||{},phase=key==='challengerV3'&&bot.learning?.phaseStarted?bot.learning.performance:null,m=phase||total,lock=bot.gateReasons?.[0]||null;
  const retired=bot.lifecycle==='RETIRED_NO_EDGE',parent=key==='challenger'&&bot.lifecycle==='PARENT PAUSED';
  const waiting=bot.enabled===false,state=retired?'AUSGEMUSTERT':parent?'VERSIEGELT':waiting?'WARTET':bot.riskLocked?'PAUSIERT':bot.openCount>0?'IM TRADE':'BEOBACHTET';
  const tone=waiting?'watch':bot.riskLocked?'danger':bot.openCount>0?'safe':'watch';
  const why=retired?'Neue Einstiege beendet · Historie erhalten':parent?'Abgeschlossene Referenz für V3':waiting?'Startet automatisch nach qualifiziertem V2-Stop':bot.riskLocked?`${gateLabel(lock||bot.lifecycle)} · DD ${fmt(total.maxDrawdownPct,2)}%`:bot.openCount>0?`${bot.openCount} offene Position${bot.openCount===1?'':'en'}`:`Kein Entry · ${bot.blocked??0}/${bot.evaluated??0} im letzten Scan geblockt${bot.reasons?.length?` · ${gateLabel(bot.reasons[0].reason)}`:''}`;
  return `<div class="paper-r26-bot"><div><span>${botNames[key]}</span><b class="tone-${tone}">${state}</b></div>${phase?'<small>Kostenphase · abgeschlossene Trades</small>':''}<strong>${usd(m.pnl)}${m.closedTrades>0?` · PF ${fmt(m.profitFactor,2)} · EXP ${usd(m.expectancy)}`:' · Noch keine abgeschlossenen Trades'}</strong>${phase?`<small>Gesamt inkl. Altphase und offener Bewertung ${usd(total.pnl)}</small>`:''}<small>${why}</small><small>Letzter Abschluss: ${date(bot.lastClosedAt)}</small></div>`;
}
function tradeHtml(t={}){
  const tone=(num(t.realized)||0)>0?'safe':(num(t.realized)||0)<0?'danger':'muted';
  const bot=t.bot==='challengerV3'?'V3':t.bot==='challenger'?'V2':'BASELINE';
  const r=t.risk||{};
  const riskLine=r.plannedRiskBudgetUsd!=null?`Budget inkl. Kosten ${usd(r.plannedRiskBudgetUsd)} (${fmt(r.riskPct,2)}%) · Ergebnis ${fmt(r.budgetResultR,2)} Budget-R`:`Stop-Risiko ${usd(r.plannedRiskUsd)} (${fmt(r.riskPct,2)}%) · Ergebnis ${fmt(r.netR,2)}R netto`;
  return `<div class="paper-r26-trade"><div><b>${bot} · ${esc(t.symbol)} ${esc(t.side)}</b><small>${date(t.closedAt)} · ${esc(t.exitReason)}</small><small>${riskLine}</small><details><summary>Ausführung prüfen</summary><small>${esc(r.decision)} · Einstieg ${fmt(r.entry,4)} · Stop ${fmt(r.stop,4)} · Ausstieg ${fmt(r.exit,4)}</small><small>Gebühren ${fmt(r.feesUsd,2)} USD · Ergebnis vor Gebühren ${fmt(r.grossR,2)} Stop-R</small><small>${esc(r.executionPolicyVersion||'Bisherige Positionsgröße')} · Stop-Risiko ohne Kosten ${usd(r.plannedRiskUsd)}</small></details></div><strong class="tone-${tone}">${usd(t.realized)}</strong></div>`;
}
function positionHtml(p={}){
  const budget=p.plannedRiskBudgetUsd!=null?`Budget inkl. Kosten ${usd(p.plannedRiskBudgetUsd)}`:`Stop-Risiko ${usd(p.plannedRiskUsd)}`;
  return `<div class="paper-r26-bot"><b>OFFEN · ${esc(p.symbol)} ${esc(p.side)}</b><small>Einstieg ${fmt(p.entry,4)} · Stop ${fmt(p.stop,4)}</small><small>${budget} (${fmt(p.riskPct,2)}%) · Laufend ${usd(p.unrealized)}</small><small>Eröffnet ${date(p.openedAt)} · Bewertung vom letzten Kursstand</small></div>`;
}
function renderAnswer(health={}){
  const el=root();if(!el||!health?.bots)return;
  let card=document.getElementById('paperAnswerR26');
  if(!card){card=document.createElement('section');card.id='paperAnswerR26';card.className='card paper-answer-r26';el.appendChild(card)}
  const e=health.engine||{},bots=health.bots||{},trades=health.recentTrades||[];
  const locked=[bots.baseline,bots.challenger,bots.challengerV3].filter(x=>x?.riskLocked).length,v3=bots.challengerV3||{};
  const learning=v3.learning||{},phase=learning.performance||{};
  const learningLabel={BUILDING:'AUFBAU',CHECKPOINT:'ZWISCHENPRÜFUNG',PROMISING_EARLY:'FRÜH POSITIV',PROMISING:'POSITIV · WEITER PRÜFEN',EXTEND:'WEITER BEOBACHTEN',WATCH:'BEOBACHTEN',RETIRE:'AUSMUSTERN'}[learning.status]||'AUFBAU';
  const verdict=v3.lifecycle==='RETIRED_NO_EDGE'?'V3 automatisch ausgemustert: nach belastbarer Stichprobe kein Netto-Edge.':v3.riskLocked?'V3 pausiert. Stop-Analyse gespeichert; nächste Änderung nur mit belegter Hypothese.':learning.phaseStarted?`${learningLabel} · ${phase.closedTrades??0}/${learning.targetClosedTrades??20} Trades · ${learning.reason||'Mit eingefrorenen Parametern. Erst prospektiv bewerten.'}`:'Kostenphase startet automatisch, sobald keine Altposition mehr offen ist; mit eingefrorenen Parametern. Erst prospektiv bewerten.';
  card.innerHTML=`<div class="paper-r26-head"><div><div class="eyebrow">PAPER · LERNZYKLUS</div><b>${v3.lifecycle==='RETIRED_NO_EDGE'?'V3 AUSGEMUSTERT':v3.riskLocked?'V3 PAUSIERT · STOP-ANALYSE':v3.enabled?'V3 GESTARTET · V2 BLEIBT VERSIEGELT':locked?`${locked} BOTS PAUSIERT · ANALYSE LÄUFT`:'BOTS BEOBACHTEN DEN MARKT'}</b></div><span class="tone-${e.running&&e.marketFresh?'safe':'danger'}">${e.running&&e.marketFresh?'ENGINE OK':'ENGINE CHECK'}</span></div>
    <div class="paper-r26-bots">${botAnswer('challengerV3',v3)}${botAnswer('challenger',bots.challenger)}</div>
    <div class="paper-r26-verdict"><span>KLARE ENTSCHEIDUNG</span><b>${verdict}</b></div>
    <small class="muted">${v3.lifecycle==='RETIRED_NO_EDGE'?'Kostenvariante beendet · Historie erhalten':health.executionPolicy?'Kostenvariante aktiv · Historie und Verlustgrenzen bleiben erhalten':v3.riskLocked?'Kostenvariante startet nicht bei aktiver Risikosperre':'Kostenvariante wartet auf ein Konto ohne offene Positionen'}</small>
    ${(health.openPositions||[]).map(positionHtml).join('')}
    <div class="paper-r26-title">LETZTE TRADES</div><div class="paper-r26-trades">${trades.length?trades.map(tradeHtml).join(''):'<small class="muted">Noch keine geschlossenen Trades verfügbar.</small>'}</div>`;
}
function renderExecutionAudit(audit,health={}){
  const el=root(); if(!el||!audit?.aggregateOnly)return;
  let card=document.getElementById('paperExecutionAuditR22');
  if(!card){card=document.createElement('details');card.id='paperExecutionAuditR22';card.className='card audit-r22 paper-disclosure';el.appendChild(card)}
  const ledgers=audit.ledgers||{},active=sumLedgers(ledgers,['baseline','challenger','challengerV3']),retired=sumLedgers(ledgers,['shadow','regime']);
  const attention=(num(active.materialLosses)||0)>0||(num(active.postStopReentries)||0)>0;
  card.innerHTML=`<summary><span>TECHNISCHE DIAGNOSE</span><b>Stop ${active.materialLosses}/${active.evaluableStops} · ${rate(active.materialLosses,active.evaluableStops)}</b></summary><div class="paper-disclosure-body"><div class="audit-r22-head"><div><div class="eyebrow">FULL LEDGER EXECUTION AUDIT</div><b>R27 · ${attention?'ACTIVE CHECK':'ACTIVE OK'}</b></div><span class="audit-r22-pill tone-${attention?'danger':'safe'}">READ ONLY</span></div>
    <div class="audit-r22-summary">
      ${metric('Aktive Trades',active.closedTrades)}
      ${metric('Stop-Verluste &gt;1,25R',`${active.materialLosses} / ${active.evaluableStops} · ${rate(active.materialLosses,active.evaluableStops)}`,(num(active.materialLosses)||0)>0?'danger':'safe')}
      ${metric('Re-Entries nach Stop',active.postStopReentries,(num(active.postStopReentries)||0)>0?'danger':'safe')}
      ${metric('Richtungs-Bündel',active.directionalMultiAssetBundles)}
    </div>
    <div class="audit-r22-list audit-r25-active">${['baseline','challenger','challengerV3'].map(key=>ledgerHtml(key,ledgers[key],health?.bots?.[key])).join('')}</div>
    <details class="audit-r25-retired"><summary><span>HISTORISCHE RETIRED-AUFFÄLLIGKEITEN</span><b>${retired.closedTrades} Trades · getrennt von aktiv</b></summary><div class="audit-r22-list">${['shadow','regime'].map(key=>ledgerHtml(key,ledgers[key])).join('')}</div></details>
    <div class="cohort-r18-foot">Vollständige PostgreSQL-Ledger · nur geschützte Aggregate · keine Strategie- oder Ausführungswirkung.</div></div>`;
}
let loading=false,cached=null;
function accept(payload){
  if(!payload)return;
  cached=payload;
  render(payload.deepDive);
  renderAnswer(payload.botHealth);
  renderExecutionAudit(payload.executionAudit,payload.botHealth);
}
async function hydrate(){
  const el=root(); if(!el||loading||(document.getElementById('paperCohortR18')&&document.getElementById('paperExecutionAuditR22')))return;
  if(cached){accept(cached);return}
  loading=true;
  // The main loader owns requests; disclosures must not trigger a duplicate full-ledger fetch.
  loading=false;
}
const observer=new MutationObserver(()=>{if(document.getElementById('app')?.dataset?.view==='paper')queueMicrotask(hydrate)});
if(root())observer.observe(root(),{childList:true,subtree:false});
document.getElementById('mainNav')?.addEventListener('click',e=>{if(e.target.closest('[data-route="paper"]'))setTimeout(hydrate,0)});
window.addEventListener('meridian:v8-tokenchange',()=>{cached=null;document.getElementById('paperAnswerR26')?.remove();document.getElementById('paperCohortR18')?.remove();document.getElementById('paperExecutionAuditR22')?.remove();hydrate()});
window.addEventListener('meridian:v8-paperdata',e=>accept(e.detail));
if(document.getElementById('app')?.dataset?.view==='paper')hydrate();
