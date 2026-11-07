import {createLedgerReviewClient} from './ledger-review-client.js?v=B16-M11-FIX12';
const TEXT={
  not_loaded:'Ledger-Mengen zur Prüfung laden. Noch keine Bestände bestätigt.',
  locked:'App entsperren, um gespeicherte Ledger-Mengen zu prüfen.',
  loading:'Gespeicherte Ledger-Mengen werden geladen.',
  saving:'Ledger-Bestätigung wird gespeichert.',
  invalid:'Keine vollständig prüfbaren Ledger-Mengen gespeichert. Bestätigung nicht möglich.',
  unavailable:'Ledger-Mengen konnten nicht geladen werden.',
  changed:'Bestände wurden zwischenzeitlich geändert. Bitte neu laden und erneut prüfen.',
  write_failed:'Speicherergebnis nicht bestätigt. Bitte neu laden und prüfen; keine automatische Wiederholung.'
};
export function mountLedgerReview(root,{access,createClient=createLedgerReviewClient}){
  const doc=root.ownerDocument,el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const section=el('section'),heading=el('h3','Ledger-Bestände bestätigen'),status=el('p'),list=el('ul');
  section.className='ledger-review';
  const load=el('button','Ledger-Mengen zur Prüfung laden'),confirm=el('button','Diese geprüften Ledger-Mengen bestätigen');
  load.type=confirm.type='button';confirm.hidden=true;
  status.setAttribute('role','status');
  section.append(heading,el('p','Vergleiche die gespeicherten Mengen mit deinem Ledger. Erst bestätigen, wenn alle angezeigten Mengen aktuell stimmen. Diese Aktion prüft keine Wallet automatisch.'),load,list,confirm,status);root.append(section);
  let disposed=false;
  const client=createClient({getToken:access.getToken,onLock:()=>access.lock(),onChange:state=>{
    if(disposed)return;
    const busy=state.status==='loading'||state.status==='saving';
    load.disabled=busy||state.status==='locked';confirm.disabled=busy;confirm.hidden=state.status!=='review';
    list.replaceChildren();
    if(state.status==='review'){
      for(const h of state.holdings)list.append(el('li',h.symbol+': '+String(h.quantity)));
      status.textContent='Gespeicherte Mengen – noch nicht bestätigt.';
    }else if(state.status==='confirmed'){
      status.textContent='Ledger bestätigt am '+new Date(state.updatedAt).toLocaleString('de-AT')+
        ' · gültig für 24 Stunden. Nur Ledger bestätigt; andere Depotquellen können weiterhin fehlen oder veraltet sein. Depotbewertung bei Bedarf manuell aktualisieren.';
    }else status.textContent=TEXT[state.status]||'Ledger-Mengen zur Prüfung laden.';
  }});
  const read=()=>client.load(),write=()=>client.confirm();
  load.addEventListener('click',read);confirm.addEventListener('click',write);
  const unregister=access.registerReader(()=>client.lock(),()=>client.revalidate());
  const unsubscribe=access.subscribe(s=>{if(s.status==='unlocked')client.revalidate();});
  client.revalidate();
  return {dispose(){client.dispose();disposed=true;unregister();unsubscribe();load.removeEventListener('click',read);confirm.removeEventListener('click',write);section.replaceChildren();section.remove?.();}};
}
