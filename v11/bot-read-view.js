// Inactive component: mount explicitly with the existing read-client factory.
// No network, credentials, storage or engine imports belong to this renderer.
const LABELS = {
  locked: ['Gesperrt', 'Verbinde den bestehenden Lesezugang, um deine Bots anzuzeigen.'],
  loading: ['Wird geladen', 'Der aktuelle Bot-Snapshot wird geprüft.'],
  fresh: ['Aktueller Snapshot', 'Nur lesend · Der Snapshot bestätigt keinen laufenden Bot-Prozess.'],
  stale: ['Daten veraltet', 'Botdetails werden bis zur nächsten aktuellen Abfrage ausgeblendet.'],
  unavailable: ['Nicht verfügbar', 'Botdaten konnten nicht verifiziert werden. Bitte erneut aktualisieren.']
};
const SIDES = {LONG:'Long', SHORT:'Short', NEUTRAL:'Neutral'};
const TYPES = {futures_grid:'Futures Grid', future_hedge_grid:'Futures Hedge Grid'};
const CATEGORIES = {inverse:'COIN-M', linear:'Linear'};
const ownLabel = (labels, key) => typeof key === 'string' && Object.hasOwn(labels,key) ? labels[key] : 'Unbekannt';
function projection(state) {
  try {
    const status = typeof state?.status === 'string' && Object.hasOwn(LABELS,state.status) ? state.status : 'unavailable';
    if (status !== 'fresh') return {status, bots:[]};
    const model = state.model;
    if (model?.status !== 'FRESH_SNAPSHOT' || model.readOnly !== true || model.executionAllowed !== false ||
        !Array.isArray(model.bots) || model.bots.length > 100 ||
        typeof model.snapshotAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(model.snapshotAt) ||
        !Number.isFinite(Date.parse(model.snapshotAt))) return {status:'unavailable',bots:[]};
    const canonicalStamp=model.snapshotAt.includes('.') ? model.snapshotAt : model.snapshotAt.replace('Z','.000Z');
    if (new Date(model.snapshotAt).toISOString() !== canonicalStamp) return {status:'unavailable',bots:[]};
    const bots = model.bots.map(bot => {
      if (typeof bot?.symbol !== 'string' || !/^[A-Z0-9][A-Z0-9_/-]{0,31}$/.test(bot.symbol)) throw new Error();
      return {symbol:bot.symbol, side:ownLabel(SIDES,bot.side),
        type:ownLabel(TYPES,bot.type), category:ownLabel(CATEGORIES,bot.category)};
    });
    return {status,bots,snapshotAt:model.snapshotAt};
  } catch { return {status:'unavailable',bots:[]}; }
}
function element(document, tag, text) {
  const node=document.createElement(tag);
  if (text !== undefined) node.textContent=text;
  return node;
}

// Replaces only the status/data region; mount keeps focusable controls stable.
export function renderBotReadState(root, state) {
  const document=root.ownerDocument, data=projection(state);
  const section=element(document,'div');
  section.className='bot-read-state';
  section.setAttribute('data-state',data.status);
  const status=element(document,'div');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  status.setAttribute('aria-atomic','true');
  status.append(element(document,'strong',LABELS[data.status][0]),element(document,'p',LABELS[data.status][1]));
  section.append(status);
  if (data.status === 'fresh') {
    const stamp=element(document,'time',data.snapshotAt);
    stamp.setAttribute('datetime',data.snapshotAt);
    const source=element(document,'p','Snapshot-Zeit (UTC): ');source.append(stamp);section.append(source);
    section.append(element(document,'p',data.bots.length + ' Bots im Snapshot'));
    if (!data.bots.length) section.append(element(document,'p','Keine Bots in diesem Snapshot enthalten.'));
    else {
      const list=element(document,'ul');list.setAttribute('aria-label','Bots im aktuellen Snapshot');
      for (const bot of data.bots) {
        const item=element(document,'li');item.append(element(document,'strong',bot.symbol));
        item.append(element(document,'p','Richtung: '+bot.side+' · Typ: '+bot.type+' · Kategorie: '+bot.category));
        list.append(item);
      }
      section.append(list);
    }
  }
  root.replaceChildren(section);
  return data.status;
}

export function createBotReadView(root, {createClient,getToken} = {}) {
  if (typeof createClient !== 'function') throw new Error('Botansicht nicht verfügbar');
  const document=root.ownerDocument, section=element(document,'section');
  section.className='bot-read-view';section.setAttribute('aria-label','Pionex Bots · nur lesend');
  const content=element(document,'div'),controls=element(document,'div');
  const refresh=element(document,'button','Bots aktualisieren'),lock=element(document,'button','Botansicht sperren');
  refresh.setAttribute('type','button');lock.setAttribute('type','button');
  controls.append(refresh,lock);section.append(element(document,'h3','Meine Pionex Bots'),content,controls);
  root.replaceChildren(section);
  let disposed=false,client,action=0;
  const update=state=>{
    if(disposed)return;
    const status=renderBotReadState(content,state);
    refresh.setAttribute('aria-disabled',status==='loading'?'true':'false');
    content.setAttribute('aria-busy',status==='loading'?'true':'false');
  };
  update({status:'locked'});
  try {
    client=createClient({getToken,onChange:update});
    if (!client || ['refresh','lock','revalidate','dispose'].some(key=>typeof client[key]!=='function')) throw new Error();
  } catch {
    try {client?.dispose?.();} catch {}
    update({status:'unavailable'});
    disposed=true;
    refresh.disabled=true;lock.disabled=true;
    throw new Error('Botansicht nicht verfügbar');
  }
  const onRefresh=()=>{
    if(disposed || refresh.getAttribute('aria-disabled')==='true')return;
    const id=++action;
    try {Promise.resolve(client.refresh()).catch(()=>{if(id===action)update({status:'unavailable'});});}
    catch {update({status:'unavailable'});}
  };
  const onLock=()=>{
    if(disposed)return;
    action++;
    try {client.lock();} catch {}
    update({status:'locked'});
  };
  refresh.addEventListener('click',onRefresh);lock.addEventListener('click',onLock);
  return {
    revalidate(){
      if(disposed)return;
      try {client.revalidate();} catch {update({status:'unavailable'});}
    },
    dispose(){
      if(disposed)return;
      disposed=true;
      refresh.removeEventListener('click',onRefresh);lock.removeEventListener('click',onLock);
      try {client.dispose();} catch {}
      root.replaceChildren();
    }
  };
}
