// Inactive component: mount explicitly with the existing read-client factory.
// No network, credentials, storage or engine imports belong to this renderer.
import {buildBotOverviewModel} from './bot-overview-model.js?v=B14-M11';

const LABELS = {
  locked: ['Gesperrt', 'Verbinde den bestehenden Lesezugang, um deine Bots anzuzeigen.'],
  loading: ['Wird geladen', 'Der aktuelle Bot-Snapshot wird geprüft.'],
  fresh: ['Aktueller Snapshot', 'Nur lesend · Der Snapshot bestätigt keinen laufenden Bot-Prozess.'],
  stale: ['Daten veraltet', 'Botdetails werden bis zur nächsten aktuellen Abfrage ausgeblendet.'],
  unavailable: ['Nicht verfügbar', 'Botdaten konnten nicht verifiziert werden. Bitte erneut aktualisieren.']
};
const TYPES = {futures_grid:'Futures Grid', future_hedge_grid:'Futures Hedge Grid'};
const MISSING = 'Nicht verfügbar';
const number = value => typeof value === 'number' && Number.isFinite(value) && value !== 0 ? value : null;
const formatNumber = value => new Intl.NumberFormat('de-DE', {maximumSignificantDigits:10}).format(value);
function valueLabel(value, unit = '', positive = false) {
  const valid = number(value);
  return valid === null || (positive && valid < 0) ? MISSING : formatNumber(valid) + unit;
}
const ownLabel = (labels, key) => typeof key === 'string' && Object.hasOwn(labels,key) ? labels[key] : 'Unbekannt';
function projection(state, filters = {}) {
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
    const overview=buildBotOverviewModel(model,filters);
    if(overview.status!=='fresh')return {status:'unavailable',bots:[]};
    const sourceBots=new Map(model.bots.map(bot=>[bot.ref,bot]));
    const bots = overview.bots.map(row => {
      const bot=sourceBots.get(row.ref);
      if (typeof bot?.symbol !== 'string' || !/^[A-Z0-9][A-Z0-9_/-]{0,31}$/.test(bot.symbol)) throw new Error();
      return {symbol:bot.symbol, side:row.direction==='unknown'?'Unbekannt':row.direction[0].toUpperCase()+row.direction.slice(1),
        ref:row.ref,type:ownLabel(TYPES,bot.type),
        category:row.category==='coin-m'?'COIN-M':row.category==='linear'?'Linear':'Unbekannt',
        leverage:valueLabel(bot.metrics?.leverage,'×',true),
        investment:number(bot.metrics?.investmentUsd)>0 ? valueLabel(bot.metrics.investmentUsd,' USD/USDT',true) :
          (typeof bot.metrics?.investmentCurrency === 'string' && /^[A-Z0-9]{2,12}$/.test(bot.metrics.investmentCurrency) ? valueLabel(bot.metrics?.investmentAmount,' '+bot.metrics.investmentCurrency,true) : MISSING),
        pnl:valueLabel(row.pnl,' USD'),
        pnlTone:row.pnl === null ? null : row.pnl < 0 ? 'negative' : 'positive',
        pnlValue:row.pnl,leverageValue:row.leverage,
        lower:valueLabel(bot.metrics?.lower,'',true),upper:valueLabel(bot.metrics?.upper,'',true),
        liquidation:valueLabel(bot.metrics?.liquidationPrice,'',true),
        takeProfit:valueLabel(bot.metrics?.takeProfit,'',true),stopLoss:valueLabel(bot.metrics?.stopLoss,'',true)};
    });
    const losses=overview.losses.map(loss=>({ref:loss.ref,symbol:loss.symbol,direction:loss.direction,pnl:valueLabel(loss.pnl,' USD')}));
    return {status,count:overview.count,distribution:overview.distribution,bots,losses,
      snapshotAt:overview.snapshotAt,source:overview.source};
  } catch { return {status:'unavailable',bots:[]}; }
}
function element(document, tag, text) {
  const node=document.createElement(tag);
  if (text !== undefined) node.textContent=text;
  return node;
}

// Keep the empty live region attached before populating it, then retain its identity.
const regions = new WeakMap();
export function renderBotReadState(root, state, filters = {}) {
  const document=root.ownerDocument, data=projection(state,filters);
  let region=regions.get(root);
  if (!region || !root.contains(region.section)) {
    const section=element(document,'div'),status=element(document,'div'),details=element(document,'div');
    section.className='bot-read-state';
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    status.setAttribute('aria-atomic','true');
    section.append(status,details);
    root.replaceChildren(section);
    region={section,status,details,model:null,readIdentity:null,expanded:new Set()};regions.set(root,region);
  }
  const {section,status,details}=region;
  // A disclosure belongs to one validated snapshot, never to a future read.
  const hasPreviousIdentity=region.readIdentity!==undefined&&region.readIdentity!==null;
  const hasNextIdentity=state?.readIdentity!==undefined&&state?.readIdentity!==null;
  const sameRead=data.status==='fresh'&&(hasPreviousIdentity||hasNextIdentity
    ?hasPreviousIdentity&&hasNextIdentity&&region.readIdentity===state.readIdentity
    :region.model===state.model);
  if(sameRead){
    for(const card of details.querySelectorAll?.('.bot-card')||[]){
      const ref=card.id.slice('bot-card-'.length);
      if(card.getAttribute('open')!==null)region.expanded.add(ref);
      else region.expanded.delete(ref);
    }
  }else{
    region.expanded.clear();
    region.model=data.status==='fresh'?state.model:null;
    region.readIdentity=data.status==='fresh'&&hasNextIdentity?state.readIdentity:null;
  }
  section.setAttribute('data-state',data.status);
  status.replaceChildren(element(document,'strong',LABELS[data.status][0]),element(document,'p',LABELS[data.status][1]));
  details.replaceChildren();
  details.setAttribute('aria-busy',data.status==='loading'?'true':'false');
  if (data.status === 'fresh') {
    const stamp=element(document,'time',data.snapshotAt);
    stamp.setAttribute('datetime',data.snapshotAt);
    const source=element(document,'p','Snapshot-Zeit (UTC): ');source.append(stamp);details.append(source);
    details.append(element(document,'p',data.count + ' Bots im Snapshot'));
    const resultCount=element(document,'p',data.bots.length+' Treffer von '+data.count+' Bots');
    resultCount.setAttribute('role','status');resultCount.setAttribute('aria-live','polite');
    details.append(resultCount);
    const active=[];
    if(filters.query?.trim())active.push('Symbol '+filters.query.trim());
    if(filters.direction&&filters.direction!=='all')active.push('Richtung '+filters.direction);
    if(filters.category&&filters.category!=='all')active.push('Kontraktart '+filters.category);
    if(filters.sort&&filters.sort!=='symbol')active.push('Sortierung '+filters.sort);
    details.append(element(document,'p',active.length?'Aktive Auswahl: '+active.join(' · '):'Keine aktiven Filter'));
    if (!data.count) details.append(element(document,'p','Keine Bots in diesem Snapshot enthalten.'));
    else if (!data.bots.length) details.append(element(document,'p','Keine Bots entsprechen den Filtern.'));
    else {
      const list=element(document,'ul');list.className='bot-card-list';
      list.setAttribute('aria-label','Bots im aktuellen Snapshot');
      for (const [index,bot] of data.bots.entries()) {
        const item=element(document,'li'),card=element(document,'details'),summary=element(document,'summary');
        card.className='bot-card';
        card.id='bot-card-'+bot.ref;
        if(region.expanded.has(bot.ref))card.setAttribute('open','');
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

export function renderCommandBotOverview(root, data, onJump) {
  if (!root) return;
  const document=root.ownerDocument;
  root.replaceChildren();
  root.setAttribute('data-state',data.status);
  if(data.status!=='fresh'){
    const labels={locked:'Gesperrt',loading:'Wird geladen',stale:'Daten veraltet',unavailable:'Nicht verfügbar'};
    root.append(element(document,'p',labels[data.status]||'Nicht verfügbar'));
    return;
  }
  const sources={PIONEX_BOT_API:'Pionex Bot API',PIONEX_WALLET_BOT_DETAIL:'Pionex Wallet Botdetail'};
  root.append(element(document,'p','Lesestatus: aktueller Snapshot · Quelle: '+
    (Object.hasOwn(sources,data.source)?sources[data.source]:'Unbekannt')));
  root.append(element(document,'p',data.count+' Bots im Snapshot · nur lesend'));
  const stamp=element(document,'time',data.snapshotAt);
  stamp.setAttribute('datetime',data.snapshotAt);
  root.append(element(document,'p','Snapshot-Zeit (UTC): '),stamp);
  root.append(element(document,'p','Richtung: Long '+data.distribution.long+
    ' · Short '+data.distribution.short+' · Neutral '+data.distribution.neutral+
    ' · Unbekannt '+data.distribution.unknown));
  if(!data.losses.length)root.append(element(document,'p','Keine bestätigten negativen P/L-Werte.'));
  else{
    root.append(element(document,'p','P/L laut Quelle · keine Risikorangfolge.'));
    const losses=element(document,'ul');
    losses.setAttribute('aria-label','Größte ausgewiesene Verluste laut Quelle');
    for(const loss of data.losses){
      const direction=ownLabel({long:'Long',short:'Short',neutral:'Neutral'},loss.direction);
      const identity=loss.symbol+' · '+direction+' · Referenz '+loss.ref;
      const item=element(document,'li'),button=element(document,'button',
        identity+' · P/L laut Quelle: '+loss.pnl);
      button.setAttribute('type','button');
      button.setAttribute('aria-label',identity+' öffnen · P/L laut Quelle: '+loss.pnl);
      button.addEventListener('click',()=>onJump(loss.ref));
      item.append(button);losses.append(item);
    }
    root.append(losses);
  }
}

export function createBotReadView(root, {createClient,getToken,onSnapshot} = {}) {
  if (typeof createClient !== 'function') throw new Error('Botansicht nicht verfügbar');
  const document=root.ownerDocument, section=element(document,'section');
  section.className='bot-read-view';section.setAttribute('aria-label','Pionex Bots · nur lesend');
  const filterPanel=element(document,'div'),content=element(document,'div'),controls=element(document,'div');
  filterPanel.className='bot-overview-filters';
  const filterState={query:'',direction:'all',category:'all',sort:'symbol'};
  const search=element(document,'input');search.type='search';search.id='bot-symbol-search';
  search.setAttribute('aria-label','Symbol suchen');search.setAttribute('type','search');
  const searchLabel=element(document,'label','Symbol suchen');searchLabel.setAttribute('for','bot-symbol-search');
  filterPanel.append(searchLabel,search);
  function select(label,id,key,options){
    const wrapper=element(document,'div'),selectNode=element(document,'select');
    selectNode.id=id;selectNode.setAttribute('aria-label',label);
    const fieldLabel=element(document,'label',label);fieldLabel.setAttribute('for',id);
    for(const [value,text] of options){
      const option=element(document,'option',text);option.value=value;option.setAttribute('value',value);
      selectNode.append(option);
    }
    wrapper.append(fieldLabel,selectNode);filterPanel.append(wrapper);return selectNode;
  }
  const directionSelect=select('Richtung','bot-direction-filter','direction',[
    ['all','Alle Richtungen'],['long','Long'],['short','Short'],['neutral','Neutral'],['unknown','Unbekannt']]);
  const categorySelect=select('Kontraktart','bot-category-filter','category',[
    ['all','Alle Kontraktarten'],['coin-m','COIN-M'],['linear','Linear'],['unknown','Unbekannt']]);
  const sortSelect=select('Sortierung','bot-sort-filter','sort',[
    ['symbol','Symbol (A–Z)'],['leverage','Bestätigter Hebel'],['pnl','P/L laut Quelle']]);
  const reset=element(document,'button','Filter zurücksetzen');reset.setAttribute('type','button');
  reset.setAttribute('aria-label','Alle Botfilter zurücksetzen');filterPanel.append(reset);
  const returnSelection=element(document,'button','Zur vorherigen Auswahl zurück');
  returnSelection.setAttribute('type','button');returnSelection.hidden=true;filterPanel.append(returnSelection);
  const refresh=element(document,'button','Bots aktualisieren'),lock=element(document,'button','Botansicht sperren');
  refresh.id='bot-read-refresh';lock.id='bot-read-lock';
  refresh.setAttribute('type','button');lock.setAttribute('type','button');
  controls.append(refresh,lock);section.append(element(document,'h3','Meine Pionex Bots'),filterPanel,content,controls);
  root.replaceChildren(section);
  let disposed=false,client,action=0,latestState={status:'locked'},previousSelection=null;
  const clearPreviousSelection=()=>{previousSelection=null;returnSelection.hidden=true;};
  const applyFilters=selection=>{
    Object.assign(filterState,selection);
    search.value=filterState.query;directionSelect.value=filterState.direction;
    categorySelect.value=filterState.category;sortSelect.value=filterState.sort;
  };
  const resetFilterState=()=>{
    applyFilters({query:'',direction:'all',category:'all',sort:'symbol'});
  };
  const notifySnapshot=state=>{
    const data=projection(state);
    try{onSnapshot?.(data,jumpToBot);}catch{}
  };
  const sameRead=(previous,next)=>{
    if(previous?.status!=='fresh'||next?.status!=='fresh')return false;
    const hasPreviousIdentity=previous.readIdentity!==undefined&&previous.readIdentity!==null;
    const hasNextIdentity=next.readIdentity!==undefined&&next.readIdentity!==null;
    if(hasPreviousIdentity||hasNextIdentity)
      return hasPreviousIdentity&&hasNextIdentity&&previous.readIdentity===next.readIdentity;
    return previous.model===next.model;
  };
  const update=state=>{
    if(disposed)return;
    if(!sameRead(latestState,state)){
      clearPreviousSelection();resetFilterState();
    }
    latestState=state;
    let status=renderBotReadState(content,state,filterState);
    if(status!=='fresh'){
      clearPreviousSelection();
      latestState={status};
      resetFilterState();
      renderBotReadState(content,state,filterState);
    }
    filterPanel.hidden=status!=='fresh';
    refresh.setAttribute('aria-disabled',status==='loading'?'true':'false');
    notifySnapshot(state);
  };
  const updateFilters=()=>{
    if(disposed||latestState?.status!=='fresh')return;
    filterState.query=search.value;filterState.direction=directionSelect.value;
    filterState.category=categorySelect.value;filterState.sort=sortSelect.value;
    renderBotReadState(content,latestState,filterState);
  };
  const resetFilters=()=>{
    clearPreviousSelection();
    resetFilterState();updateFilters();
  };
  const returnToSelection=()=>{
    if(disposed||!previousSelection||latestState?.status!=='fresh')return;
    const selection=previousSelection;clearPreviousSelection();
    applyFilters(selection);updateFilters();search.focus?.();
  };
  const jumpToBot=ref=>{
    if(disposed||typeof ref!=='string'||latestState?.status!=='fresh'||
      !latestState.model?.bots?.some(bot=>bot.ref===ref))return;
    if(!previousSelection)previousSelection={...filterState};
    returnSelection.hidden=false;
    resetFilterState();updateFilters();
    const nav=document.querySelector?.('#nav [data-v="bots"]');
    nav?.click();
    const card=document.getElementById?.('bot-card-'+ref);
    if(!card)return;
    card.setAttribute('open','');
    const summary=card.querySelector?.('summary');
    summary?.focus();
    card.scrollIntoView?.({block:'nearest'});
  };
  search.addEventListener('input',updateFilters);
  directionSelect.addEventListener('change',updateFilters);
  categorySelect.addEventListener('change',updateFilters);
  sortSelect.addEventListener('change',updateFilters);
  reset.addEventListener('click',resetFilters);
  returnSelection.addEventListener('click',returnToSelection);
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
      search.removeEventListener('input',updateFilters);
      directionSelect.removeEventListener('change',updateFilters);
      categorySelect.removeEventListener('change',updateFilters);
      sortSelect.removeEventListener('change',updateFilters);
      reset.removeEventListener('click',resetFilters);
      returnSelection.removeEventListener('click',returnToSelection);
      clearPreviousSelection();
      latestState={status:'locked'};
      renderBotReadState(content,{status:'locked'});
      try {client.dispose();} catch {}
      notifySnapshot({status:'locked'});
      root.replaceChildren();
    }
  };
}
