import {createDepotHistoryView} from './depot-history-view.js';
// DOM text only. Neither credentials nor raw response bodies are rendered.
const LABELS={
  locked:['Gesperrt','Meridian-Lesepasswort übernehmen und anschließend manuell aktualisieren.'],
  loading:['Wird geladen','Die gespeicherte Depotbewertung wird geprüft.'],
  fresh:['Letzte vollständige Depotbewertung','Gespeicherter Snapshot · keine Live-Kurse oder aktuelle Kontovollständigkeit.'],
  stale:['Daten veraltet','Bewertung ausgeblendet. Bitte manuell aktualisieren.'],
  unavailable:['Nicht verfügbar','Keine verifizierbare Depotbewertung. Fehlende Daten sind nicht null.']
};
const money=x=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'USD'}).format(x);
export function createDepotReadView(root,{getToken,createClient}={}){
  const document=root.ownerDocument;
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const controls=el('div'),refresh=el('button','Depot aktualisieren'),lock=el('button','Depot sperren');
  refresh.type=lock.type='button';controls.append(refresh,lock);
  const section=el('div'),status=el('div'),details=el('div');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  section.append(status,details);root.className='bot-read-view depot-read-view';root.replaceChildren(controls,section);
  let disposed=false,range='1d',lastHistory=null;
  const chartRoot=el('section');section.append(chartRoot);
  const chart=createDepotHistoryView(chartRoot,{onRange:key=>{range=key;chart.render(lastHistory?.[range],range);}});
  function render(state){
    if(disposed)return;
    let kind=Object.hasOwn(LABELS,state?.status)?state.status:'unavailable';
    const m=state?.model;
    lastHistory=state?.history||null;chart.render(lastHistory?.[range],range);
    if(kind==='fresh'&&(m?.status!=='FRESH_SNAPSHOT'||m.readOnly!==true||m.executionAllowed!==false||
      ![m.totalUsd,m.spotUsd,m.tradingUsd].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)||
      typeof m.snapshotAt!=='string'||typeof m.sourceAt!=='string'))kind='unavailable';
    section.dataset.state=kind;
    const current=kind==='fresh'&&m?.source==='SERVER_PORTFOLIO_CURRENT';
    status.replaceChildren(el('strong',current?'Depotbewertung':LABELS[kind][0]),el('p',current?'Aus serverseitigen Depotdaten. Lokale Ergänzungen aus V10 sind nicht enthalten.':LABELS[kind][1]));
    details.replaceChildren();details.setAttribute('aria-busy',String(kind==='loading'));
    if(kind!=='fresh')return;
    const total=el('p',money(m.totalUsd));total.className='depot-total';
    total.setAttribute('aria-label','Gesamtwert der Bewertung: '+money(m.totalUsd));details.append(total);
    const breakdown=el('dl');
    for(const [label,value] of [['Spot laut Depotquelle',m.spotUsd],['Pionex-Gesamteigenkapital',m.tradingUsd]])
      breakdown.append(el('dt',label),el('dd',money(value)));
    details.append(breakdown);
    for(const [label,value] of [['Bewertung (UTC)',m.snapshotAt],['Pionex-Quelle (UTC)',m.sourceAt]]){
      const line=el('p',label+': '),time=el('time',value);time.dateTime=value;line.append(time);details.append(line);
    }
    details.append(el('p',current?'Quelle: serverseitige Depotdaten und öffentliche Kurse. Zeitangabe zeigt die älteste verwendete Quelle; keine Bestätigung aller Konten.':'Quelle: gespeicherte Meridian-Depothistorie. Bestandsdetails und einzelne Börsenfristen sind hier nicht enthalten.'));
    if(m.excludedIncompletePoints>0)details.append(el('p','Die Historie enthält Datenlücken. Unvollständige Bewertungen wurden ausgelassen.'));
  }
  const client=createClient({getToken,onChange:render});
  const update=()=>client.refresh(),clear=()=>client.lock();
  refresh.addEventListener('click',update);lock.addEventListener('click',clear);
  render({status:'locked'});
  return {revalidate:()=>client.revalidate(),dispose(){if(disposed)return;client.dispose();
    render({status:'locked'});disposed=true;refresh.removeEventListener('click',update);lock.removeEventListener('click',clear);root.replaceChildren();}};
}
