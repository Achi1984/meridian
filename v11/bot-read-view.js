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
const MISSING = 'Nicht verfügbar';
const number = value => typeof value === 'number' && Number.isFinite(value) && value !== 0 ? value : null;
const formatNumber = value => new Intl.NumberFormat('de-DE', {maximumSignificantDigits:10}).format(value);
function valueLabel(value, unit = '', positive = false) {
  const valid = number(value);
  return valid === null || (positive && valid < 0) ? MISSING : formatNumber(valid) + unit;
}
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
    const bots = Array.from(model.bots, bot => {
      if (typeof bot?.symbol !== 'string' || !/^[A-Z0-9][A-Z0-9_/-]{0,31}$/.test(bot.symbol)) throw new Error();
      return {symbol:bot.symbol, side:ownLabel(SIDES,bot.side),
        ref: typeof bot.ref === 'string' && /^[a-f0-9]{20}$/.test(bot.ref) ? bot.ref : null,
        type:ownLabel(TYPES,bot.type), category:ownLabel(CATEGORIES,bot.category),
        leverage:valueLabel(bot.metrics?.leverage,'×',true),
        investment:number(bot.metrics?.investmentUsd)>0 ? valueLabel(bot.metrics.investmentUsd,' USD/USDT',true) :
          (typeof bot.metrics?.investmentCurrency === 'string' && /^[A-Z0-9]{2,12}$/.test(bot.metrics.investmentCurrency) ? valueLabel(bot.metrics.investmentAmount,' '+bot.metrics.investmentCurrency,true) : MISSING),
        pnl:valueLabel(bot.metrics?.pnlUsd,' USD'),
        pnlTone:number(bot.metrics?.pnlUsd) === null ? null : bot.metrics.pnlUsd < 0 ? 'negative' : 'positive',
        lower:valueLabel(bot.metrics?.lower,'',true),upper:valueLabel(bot.metrics?.upper,'',true),
        liquidation:valueLabel(bot.metrics?.liquidationPrice,'',true),
        takeProfit:valueLabel(bot.metrics?.takeProfit,'',true),stopLoss:valueLabel(bot.metrics?.stopLoss,'',true)};
    });
    return {status,bots,snapshotAt:model.snapshotAt};
  } catch { return {status:'unavailable',bots:[]}; }
}
function element(document, tag, text) {
  const node=document.createElement(tag);
  if (text !== undefined) node.textContent=text;
  return node;
}

// Keep the empty live region attached before populating it, then retain its identity.
const regions = new WeakMap();
export function renderBotReadState(root, state) {
  const document=root.ownerDocument, data=projection(state);
  let region=regions.get(root);
  if (!region || !root.contains(region.section)) {
    const section=element(document,'div'),status=element(document,'div'),details=element(document,'div');
    section.className='bot-read-state';
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    status.setAttribute('aria-atomic','true');
    section.append(status,details);
    root.replaceChildren(section);
    region={section,status,details};regions.set(root,region);
  }
  const {section,status,details}=region;
  section.setAttribute('data-state',data.status);
  status.replaceChildren(element(document,'strong',LABELS[data.status][0]),element(document,'p',LABELS[data.status][1]));
  details.replaceChildren();
  details.setAttribute('aria-busy',data.status==='loading'?'true':'false');
  if (data.status === 'fresh') {
    const stamp=element(document,'time',data.snapshotAt);
    stamp.setAttribute('datetime',data.snapshotAt);
    const source=element(document,'p','Snapshot-Zeit (UTC): ');source.append(stamp);details.append(source);
    details.append(element(document,'p',data.bots.length + ' Bots im Snapshot'));
    if (!data.bots.length) details.append(element(document,'p','Keine Bots in diesem Snapshot enthalten.'));
    else {
      const list=element(document,'ul');list.className='bot-card-list';
      list.setAttribute('aria-label','Bots im aktuellen Snapshot');
      for (const [index,bot] of data.bots.entries()) {
        const item=element(document,'li'),card=element(document,'details'),summary=element(document,'summary');
        card.className='bot-card';
        const heading=element(document,'span',bot.symbol+' · '+bot.side);heading.className='bot-card-heading';
        const identity=element(document,'span','Bot '+(index+1)+(bot.ref?' · Referenz '+bot.ref:''));
        identity.className='bot-card-reference';
        summary.append(heading,identity);
        const headline=element(document,'span');headline.className='bot-card-metrics';
        for (const [label,value] of [['Hebel',bot.leverage],['Kapital',bot.investment],['P/L laut Quelle',bot.pnl]]) {
          const group=element(document,'span'),amount=element(document,'strong',value);
          if(label==='P/L laut Quelle' && bot.pnlTone) amount.className='bot-pnl-'+bot.pnlTone;
          group.append(element(document,'span',label+': '),amount);headline.append(group);
        }
        summary.append(headline,element(document,'span','Details anzeigen / ausblenden'));
        const body=element(document,'div');body.className='bot-card-body';
        body.append(element(document,'p','Richtung: '+bot.side+' · Typ: '+bot.type+' · Kategorie: '+bot.category));
        const metrics=element(document,'dl');metrics.className='bot-card-metrics';
        for (const [label,value] of [
          ['Grid-Untergrenze',bot.lower],['Grid-Obergrenze',bot.upper],['Grid-Gewinn',MISSING],
          ['Liquidationspreis laut Quelle',bot.liquidation],['Risikopuffer',MISSING],
          ['Take-Profit',bot.takeProfit],['Stop-Loss',bot.stopLoss]]) {
          const group=element(document,'div');group.append(element(document,'dt',label),element(document,'dd',value));metrics.append(group);
        }
        body.append(element(document,'p','Preisgrenzen und TP/SL: Einheit von der Quelle nicht ausgewiesen. P/L kann je nach Quelle Gesamt- oder offenen Gewinn enthalten.'),metrics,element(document,'p','Nicht verfügbar: Die Quelle liefert keinen eindeutig bestätigten Wert. Auch Nullwerte bleiben unbestätigt, weil sie fehlende Angaben bedeuten können. Grid-Gewinn und Risikopuffer sind im Snapshot nicht enthalten. Fehlende TP/SL-Werte bestätigen keine deaktivierten Schutzaufträge.'));
        card.append(summary,body);item.append(card);list.append(item);
      }
      details.append(list);
    }
  }
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
