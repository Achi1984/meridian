import {createLedgerManualClient} from './ledger-manual-client.js?v=B16-M11-FIX12';
import {parseLedgerManualText} from './ledger-manual-model.js?v=B16-M11-FIX12';
const messages={locked:'App entsperren, um Ledger-Bestände zu laden.',loading:'Ledger-Bestände und öffentliche Kurse werden geladen.',
  ready:'Manuell erfasste Mengen; keine automatische Wallet-Abfrage.',saving:'Ledger-Mengen werden gespeichert.',
  saved:'Gespeichert. Ledger neu laden, um den gespeicherten Stand mit aktuellen Kursen anzuzeigen.',
  unavailable:'Ledger-Stand nicht verfügbar. Pionex bleibt unabhängig.',conflict:'Depot wurde zwischenzeitlich geändert. Vor erneutem Speichern neu laden.',
  write_denied:'Schreibberechtigung nicht bestätigt. Neu laden und den separaten Schreibschlüssel prüfen.',
  write_unknown:'Speicherergebnis unbekannt. Nicht erneut senden; zuerst neu laden und gespeicherten Stand vergleichen.'};
export function mountLedgerManual(root,{access,createClient=createLedgerManualClient}={}){
  const doc=root.ownerDocument,el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const section=el('section'),status=el('p'),content=el('div'),load=el('button','Ledger laden / Kurse aktualisieren');
  section.className='card ledger-manual';status.setAttribute('role','status');load.type='button';
  const editor=el('details'),summary=el('summary','Ledger-Mengen erfassen oder ersetzen'),form=el('form');
  const quantities=el('textarea'),observed=el('input'),key=el('input'),save=el('button','Ledger-Mengen speichern');
  quantities.rows=8;quantities.name='ledger-holdings';quantities.setAttribute('aria-label','Ledger-Mengen: Symbol; Menge je Zeile');
  observed.type='datetime-local';observed.name='ledger-observed-at';observed.setAttribute('aria-label','Stand der manuell geprüften Ledger-Mengen');
  key.type='password';key.autocomplete='off';key.name='ledger-write-key';key.setAttribute('aria-label','Separater Meridian-Schreibschlüssel');
  save.type='submit';save.disabled=true;
  const field=(label,node)=>{const wrap=el('label',label);wrap.append(node);return wrap;};
  form.append(el('p','Ersetzt ausschließlich die Ledger-Mengen. Format je Zeile: SYMBOL;MENGE. Dezimalpunkt oder Dezimalkomma, keine Tausendertrennzeichen. Nullbestände sind erlaubt.'),
    field('Mengen',quantities),field('Bestandsstand (deine Ortszeit)',observed),
    field('Separater Schreibschlüssel (nicht das App-Passwort)',key),
    el('p','Der Schreibschlüssel wird nur für diesen Speichervorgang verwendet. Kurse werden nicht manuell gespeichert.'),save);
  editor.append(summary,form);section.append(el('h3','Ledger · manuelle Bestände'),
    el('p','Mengen bleiben bis zu deiner nächsten Aktualisierung unverändert. Die Bewertung nutzt aktuelle öffentliche USDT-Kurse; sie ist getrennt von Pionex und kein Gesamtvermögen.'),load,status,content,editor);root.append(section);
  let ready=false,disposed=false;
  const client=createClient({getToken:access.getToken,onLock:()=>access.lock(),onChange:s=>{
    if(disposed)return;ready=s.status==='ready';save.disabled=!ready;load.disabled=['loading','saving','locked'].includes(s.status);
    status.textContent=messages[s.status]||messages.unavailable;content.replaceChildren();
    if(s.status==='locked'){quantities.value='';observed.value='';key.value='';editor.open=false;}
    if(s.status==='saving')key.value='';
    if(!ready||!s.model)return;
    const m=s.model;content.append(el('p','Mengenstand: '+new Date(m.observedAt).toLocaleString('de-AT')));
    const list=el('ul');for(const row of m.holdings){
      list.append(el('li',row.symbol+': '+row.quantity+' · '+(row.value===null?'Bewertung nicht verfügbar':new Intl.NumberFormat('de-AT',{maximumFractionDigits:2,minimumFractionDigits:2}).format(row.value)+' USDT')));
    }content.append(list,el('p',m.total===null?'Ledger-Gesamtbewertung unvollständig; fehlende Kurse sind nicht null.':'Ledger-Bewertung: '+new Intl.NumberFormat('de-AT',{maximumFractionDigits:2,minimumFractionDigits:2}).format(m.total)+' USDT'));
    content.append(el('p',m.pricesAt?'Kursquelle: Binance Spot · abgerufen '+new Date(m.pricesAt).toLocaleString('de-AT')+'. Die Quelle liefert keinen eigenen Kurszeitpunkt; nach 3 Minuten wird die Bewertung ausgeblendet.':'Keine frischen vollständigen Bewertungskurse.'));
  }});
  const loadHandler=()=>client.load(),saveHandler=event=>{
    event.preventDefault();if(!ready)return;
    const date=new Date(observed.value),at=Number.isFinite(date.getTime())?date.toISOString():'';
    const snapshot=parseLedgerManualText(quantities.value,at);
    if(!snapshot){status.textContent='Mengen und Bestandszeit prüfen: eindeutige Symbole, nichtnegative Mengen und kein zukünftiger Zeitpunkt.';return;}
    if(!key.value.trim()){status.textContent='Separaten Schreibschlüssel eingeben.';return;}
    const writeKey=key.value;key.value='';client.save(snapshot,writeKey);
  };
  load.addEventListener('click',loadHandler);form.addEventListener('submit',saveHandler);
  const unregister=access.registerReader(()=>client.lock(),()=>client.revalidate());
  const unsubscribe=access.subscribe(s=>{if(s.status==='unlocked'){load.disabled=false;status.textContent='Ledger laden, bevor Mengen gespeichert werden.';}else client.lock();});
  load.disabled=!access.isUnlocked();status.textContent=load.disabled?messages.locked:'Ledger laden, bevor Mengen gespeichert werden.';
  return {dispose(){client.dispose();disposed=true;unregister();unsubscribe();load.removeEventListener('click',loadHandler);form.removeEventListener('submit',saveHandler);section.remove();}};
}
