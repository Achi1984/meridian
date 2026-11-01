import {createDepotHistoryView} from './depot-history-view.js?v=B16-M11-FIX12';
import {publishDepotPortfolioState} from './depot-portfolio-state.js?v=B16-M11-FIX12';
// DOM text only. Neither credentials nor raw response bodies are rendered.
const LABELS={
  locked:['Gesperrt','App mit Meridian-Passwort öffnen, dann Depot manuell aktualisieren.'],
  not_loaded:['Noch nicht geladen','Depot manuell aktualisieren.'],
  loading:['Wird geladen','Die gespeicherte Depotbewertung wird geprüft.'],
  fresh:['Letzte vollständige Depotbewertung','Gespeicherter Snapshot · keine Live-Kurse oder aktuelle Kontovollständigkeit.'],
  stale:['Daten veraltet','Bewertung ausgeblendet. Bitte manuell aktualisieren.'],
  unavailable:['Nicht verfügbar','Keine verifizierbare Depotbewertung. Fehlende Daten sind nicht null.']
};
const REASONS={TRANSPORT:'nicht erreichbar',INCOMPLETE:'unvollständig',STALE:'veraltet',EMPTY:'keine vollständigen Bewertungen im Zeitraum'};
const diagnose=r=>r?[['Aktuell',r.current],['Kurse',r.prices],['Historie',r.history]].filter(([,v])=>Object.hasOwn(REASONS,v))
  .map(([k,v])=>k+': '+REASONS[v]).join(' · '):'';
const SOURCE_ISSUES={
  LEDGER_SOURCE_STALE:'Ledger-Bestandsquelle ist veraltet.',LEDGER_SOURCE_MISSING:'Aktuelle Ledger-Bestandsquelle fehlt.',
  LEDGER_SOURCE_INVALID:'Ledger-Bestandsquelle ist nicht prüfbar.',
  OKX_SOURCE_STALE:'OKX-Bewertungsquelle ist veraltet.',OKX_SOURCE_MISSING:'Aktuelle OKX-Bewertungsquelle fehlt.',
  OKX_SOURCE_INVALID:'OKX-Bewertungsquelle ist nicht prüfbar.',
  PIONEX_STALE_OR_UNTIMED:'Pionex-Gesamteigenkapital ist veraltet oder ohne gültigen Zeitpunkt.',
  PIONEX_SOURCE_MISSING:'Aktuelles Pionex-Gesamteigenkapital fehlt.',PIONEX_SOURCE_INVALID:'Pionex-Gesamteigenkapital ist nicht prüfbar.',
  PRICE_SOURCE_STALE:'Benötigte Bewertungskurse sind veraltet.',PRICE_SOURCE_INVALID:'Benötigte Bewertungskurse sind nicht prüfbar.',
  REQUIRED_PRICE_MISSING:'Mindestens ein benötigter Bewertungskurs fehlt oder ist nicht bestätigt.',
  VENUE_SOURCE_INVALID:'Eine Depotquelle ist nicht prüfbar.',CURRENT_SOURCE_INVALID:'Die aktuellen Depotdaten sind nicht prüfbar.',
  CURRENT_SOURCE_INCOMPLETE:'Die aktuellen Depotquellen sind unvollständig.',
  CURRENT_SNAPSHOT_EXPIRED:'Die geladene Bewertung ist inzwischen abgelaufen. Bitte Depot manuell aktualisieren.'
};
const sourceDetails=issues=>Array.isArray(issues)?[...new Set(issues)].slice(0,3)
  .filter(code=>typeof code==='string'&&Object.hasOwn(SOURCE_ISSUES,code)).map(code=>SOURCE_ISSUES[code]).join(' '):'';
const money=x=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'USD'}).format(x);
export function createDepotReadView(root,{getToken,createClient,commandRoot=null,pionexOnly=false,okxAggregate=false}={}){
  const document=root.ownerDocument;
  if(pionexOnly){
    const title=document.getElementById?.('depot-summary-heading');if(title)title.textContent='Pionex-Bewertung';
    const caption=title?.closest?.('section')?.querySelector?.('.caption');if(caption)caption.textContent='Nur Pionex wird in dieser Übersicht bewertet. Kein Gesamtvermögen.';
    const holdings=document.getElementById?.('depot-holdings-heading');if(holdings)holdings.textContent='Pionex-Bestände';
    const kicker=commandRoot?.querySelector?.('.card-kicker');if(kicker)kicker.textContent='PIONEX';
  }
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const controls=el('div'),refresh=el('button','Depot aktualisieren'),lock=el('button','Depot sperren');
  refresh.type=lock.type='button';controls.append(refresh,lock);
  const section=el('div'),status=el('div'),details=el('div');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  section.append(status,details);root.className='bot-read-view depot-read-view';root.replaceChildren(controls,section);
  const format=x=>pionexOnly?new Intl.NumberFormat('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(x)+' USD/USDT':money(x);
  let disposed=false,range='1d',lastHistory=null;
  const chartRoot=el('section');section.append(chartRoot);
  const chart=createDepotHistoryView(chartRoot,{pionexOnly,onRange:key=>{range=key;chart.render(lastHistory?.[range],range);}});
  const okxCard=okxAggregate?el('section'):null;
  if(okxCard){okxCard.className='card okx-aggregate';root.append(okxCard);}
  function renderOkx(state){
    if(!okxCard)return;
    okxCard.replaceChildren(el('h3','OKX · Gesamtbewertung'),el('p','Separater Börsenstand in USD. Nicht zum Pionex-Wert addiert; keine Einzelpositionen.'));
    const model=state?.okx,hidden=['locked','not_loaded','loading'].includes(state?.status);
    const valid=!hidden&&model?.status==='ready'&&model.source==='OKX_READ_API_ASSET_VALUATION'&&Number.isFinite(model.totalUsd)&&model.totalUsd>=0;
    const label=state?.status==='locked'?'App entsperren, um den gespeicherten OKX-Stand zu laden.':state?.status==='not_loaded'?'Noch nicht geladen. Depot aktualisieren lädt den gespeicherten Börsenstand.':state?.status==='loading'?'Gespeicherter OKX-Stand wird geladen.':model?.status==='stale'?'OKX-Stand veraltet. Bewertung ausgeblendet.':'Kein aktueller OKX-API-Stand verfügbar.';
    okxCard.append(el('p',valid?money(model.totalUsd):label));
    if(!hidden&&model?.source==='OKX_READ_API_ASSET_VALUATION'&&typeof model.sourceAt==='string')okxCard.append(el('p','Quelle: OKX Read API · Stand: '+model.sourceAt+' · nach 15 Minuten veraltet.'));
  }
  let rendered=false;
  function render(state){
    if(disposed)return;rendered=true;renderOkx(state);
    let kind=Object.hasOwn(LABELS,state?.status)?state.status:'unavailable';
    const m=state?.model;
    lastHistory=state?.history||null;chart.render(lastHistory?.[range],range);
    if(kind==='fresh'&&(m?.status!=='FRESH_SNAPSHOT'||m.readOnly!==true||m.executionAllowed!==false||
      !(pionexOnly?[m.totalUsd,m.tradingUsd]:[m.totalUsd,m.spotUsd,m.tradingUsd]).every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)||
      (pionexOnly&&m.source!=='SERVER_PIONEX_CURRENT')||typeof m.snapshotAt!=='string'||typeof m.sourceAt!=='string'))kind='unavailable';
    publishDepotPortfolioState(kind==='fresh'?{status:kind,model:m}:{status:kind});
    section.dataset.state=kind;
    const current=kind==='fresh'&&['SERVER_PORTFOLIO_CURRENT','SERVER_PIONEX_CURRENT'].includes(m?.source);
    if(commandRoot){
      const set=(selector,text)=>{const n=commandRoot.querySelector(selector);if(n)n.textContent=text;};
      set('.portfolio-value',kind==='fresh'?format(m.totalUsd):'—');
      const value=commandRoot.querySelector('.portfolio-value');
      value?.setAttribute('aria-label',kind==='fresh'?'Depotbewertung: '+format(m.totalUsd):'Portfoliowert unbekannt');
      set('.state-label',kind==='fresh'?'BEWERTUNG GELADEN':LABELS[kind][0].toUpperCase());
      set('.portfolio-description',kind==='fresh'?(current?(pionexOnly?'Serverseitige Pionex-Bewertung':'Serverseitige Depotbewertung'):'Gespeicherte Depotbewertung'):LABELS[kind][1]);
      const caption=kind==='fresh'?'Stand: '+new Date(m.snapshotAt).toLocaleString('de-AT')+' · '+(current?(pionexOnly?'Nur Pionex; kein Gesamtvermögen.':'Serverseitige Quellen; lokale Ergänzungen aus V10 fehlen.'):'Gespeicherter Snapshot; keine Live-Kurse.'):
        (kind==='unavailable'||kind==='stale')?diagnose(state?.reasons):'';
      set('.caption',caption);
      const captionNode=commandRoot.querySelector('.caption');
      if(captionNode)captionNode.hidden=!caption;
      set('[data-command-depot-status]',kind==='fresh'?'Bewertung geladen':LABELS[kind][0]);
      commandRoot.dataset.state=kind;
    }
    status.replaceChildren(el('strong',current?(pionexOnly?'Pionex-Bewertung':'Depotbewertung'):LABELS[kind][0]),el('p',current?(pionexOnly?'Nur bestätigtes Pionex-Eigenkapital in USD/USDT. Kein Gesamtvermögen.':'Aus serverseitigen Depotdaten. Lokale Ergänzungen aus V10 sind nicht enthalten.'):LABELS[kind][1]));
    if(kind==='unavailable'||kind==='stale'){
      const why=diagnose(state?.reasons);if(why)status.append(el('p',why));
      const sources=sourceDetails(state?.sourceIssues);if(sources)status.append(el('p',sources));
    }
    details.replaceChildren();details.setAttribute('aria-busy',String(kind==='loading'));
    if(kind!=='fresh')return;
    const total=el('p',format(m.totalUsd));total.className='depot-total';
    total.setAttribute('aria-label','Gesamtwert der Bewertung: '+format(m.totalUsd));details.append(total);
    const breakdown=el('dl');
    for(const [label,value] of [['Spot laut Depotquelle',m.spotUsd],['Pionex-Gesamteigenkapital',m.tradingUsd]])
      breakdown.append(el('dt',label),el('dd',money(value)));
    if(!pionexOnly)details.append(breakdown);
    for(const [label,value] of [['Bewertung (UTC)',m.snapshotAt],['Pionex-Quelle (UTC)',m.sourceAt]]){
      const line=el('p',label+': '),time=el('time',value);time.dateTime=value;line.append(time);details.append(line);
    }
    details.append(el('p',current&&pionexOnly?'Quelle: bestätigte Pionex-Bewertung aus serverseitigen Daten. Bot-Kapital und P/L werden nicht addiert.':current?'Quelle: serverseitige Depotdaten; soweit erforderlich mit öffentlichen Kursen bewertet. Zeitangabe zeigt die älteste verwendete Quelle; keine Bestätigung aller Konten.':'Quelle: gespeicherte Meridian-Depothistorie. Bestandsdetails und einzelne Börsenfristen sind hier nicht enthalten.'));
    if(m.excludedIncompletePoints>0)details.append(el('p','Die Historie enthält Datenlücken. Unvollständige Bewertungen wurden ausgelassen.'));
  }
  const client=createClient({getToken,onChange:render});
  const update=()=>client.refresh(),clear=()=>client.lock();
  refresh.addEventListener('click',update);lock.addEventListener('click',clear);
  client.revalidate();if(!rendered)render({status:'locked'});
  return {revalidate:()=>client.revalidate(),dispose(){if(disposed)return;client.dispose();
    render({status:'locked'});disposed=true;refresh.removeEventListener('click',update);lock.removeEventListener('click',clear);root.replaceChildren();}};
}


