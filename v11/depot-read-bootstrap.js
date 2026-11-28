import {appAccess,refreshOnOpen} from './app-access.js?v=B20-M11-FIX6';
import {createDepotReadClient} from './depot-read-client.js?v=B20-M11-FIX6';
import {createDepotReadView} from './depot-read-view.js?v=B20-M11-FIX6';
import {mountLedgerReview} from './ledger-review-view.js?v=B20-M11-FIX6';
import {mountLedgerManual} from './ledger-manual-view.js?v=B20-M11-FIX6';

export function displayedPositionSize(row){
  const leg=row.side==='LONG'?row.sizeLong:row.sizeShort;
  if(row.positionSide==='BOTH')return Number.isFinite(row.netSize)?Math.abs(row.netSize):null;
  if(Number.isFinite(leg)&&leg!==0)return Math.abs(leg);
  return Number.isFinite(row.netSize)?Math.abs(row.netSize):leg;
}

function mountAccountPanels(doc,root,access,now){
  const el=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const command=doc.getElementById('view-command'),card=el('section'),value=el('strong','—'),note=el('p');
  card.className='card account-total';value.className='portfolio-value';
  card.append(el('h1','Gesamtvermögen'),value,note);
  command.prepend(card);command.classList.add('accounts-only');
  const sourceDetails=command.querySelector('.command-source-details');
  const context=command.querySelector('.command-context-details');
  const botOverview=command.querySelector('[aria-labelledby="command-bots-heading"]');
  for(const section of [botOverview,context,sourceDetails])if(section)root.after(section);
  const panel=el('section'),positions=el('div'),list=el('div'),form=el('form');
  panel.className='card account-trades';panel.append(el('h3','Pionex · Meine Trades'),positions,el('h4','Letzte Ausführungen'),form,list);
  const market=el('select'),symbol=el('input'),submit=el('button','Ausführungen laden');
  for(const [key,title] of [['spot','Spot'],['futures','Futures']]){
    const option=el('option',title);option.value=key;market.append(option);
  }
  market.setAttribute('aria-label','Pionex-Markt');symbol.setAttribute('aria-label','Handelspaar');
  symbol.value='BTC_USDT';symbol.required=true;submit.type='submit';form.append(market,symbol,submit);
  root.append(panel);
  let active=null,pionex=null,ledger=null,okx=null,expiry=null;
  const fmt=new Intl.NumberFormat('de-AT',{minimumFractionDigits:2,maximumFractionDigits:2});
  function render(){
    clearTimeout(expiry);
    const t=now(),missing=[];
    for(const [label,item] of [['Pionex',pionex],['Ledger',ledger],['OKX',okx]]){
      if(!item||item.until<t)missing.push(label);
    }
    value.textContent=missing.length?'—':fmt.format(pionex.value+ledger.value+okx.value)+' USD/USDT';
    note.textContent=missing.length?'Aktuelle Bewertung fehlt · '+missing.join(', '):'Pionex · Ledger · OKX';
    if(!missing.length)expiry=setTimeout(render,Math.max(1,Math.min(pionex.until,ledger.until,okx.until)-t+1));
  }
  function amount(x){return (typeof x==='number'||typeof x==='string'&&/^\d+(\.\d+)?$/.test(x))&&Number.isFinite(+x)&&+x>=0;}
  function snapshot(payload){
    const data=payload?.private===true?payload.data:null;
    const matches=(Array.isArray(data?.portfolio?.manualVenueBalances)?data.portfolio.manualVenueBalances:[])
      .filter(r=>String(r?.venue??r?.name).trim().toUpperCase()==='OKX'&&
        ['OKX_READ_API_ASSET_VALUATION','USER_CONFIRMED_PORTFOLIO_AUTHORITY'].includes(r.source));
    okx=null;
    if(matches.length===1){
      const r=matches[0],n=r.valueUsd??r.value??r.totalUsd??r.equityUsd,raw=r.updatedAt??r.snapshotAt??r.asOf;
      const at=typeof raw==='number'?raw:Date.parse(raw);
      if(amount(n)&&Number.isFinite(at)&&at<=now())okx={value:+n,until:at+86400000};
    }
    const a=data?.pionexAccount,rows=a?.futuresPositions;
    positions.replaceChildren(el('h4','Offene Futures-Positionen'));
    if(!Array.isArray(rows)||data?.pionexAccountSync?.status!=='OK')positions.append(el('p','Positionsdaten fehlen.'));
    else{
      const when=Date.parse(a.updatedAt??a.snapshotAt);
      positions.append(el('small',Number.isFinite(when)?'Stand '+new Date(when).toLocaleString('de-AT',{timeZone:'Europe/Vienna'})+' Wien':'Stand unbekannt'));
      const open=rows.filter(r=>[r.netSize,r.sizeLong,r.sizeShort].some(x=>Number.isFinite(x)&&x!==0));
      if(!open.length)positions.append(el('p','Keine offene Futures-Position in dieser Meldung.'));
      for(const r of open){
        const d=el('details'),summary=el('summary',r.symbol+' · '+r.side+' · PnL '+(Number.isFinite(r.unrealizedPnl)?fmt.format(r.unrealizedPnl):'—'));
        if(Number.isFinite(r.unrealizedPnl))summary.className=r.unrealizedPnl>0?'paper-gain':r.unrealizedPnl<0?'paper-loss':'';
        d.append(summary,el('p','Einstieg '+(r.avgPrice??'—')+' · Markpreis '+(r.markPrice??'—')+' · Hebel '+(r.leverage??'—')+' · Größe '+(displayedPositionSize(r)??'—')));
        positions.append(d);
      }
    }
    render();
  }
  function resetFills(){active?.abort();active=null;list.replaceChildren();}
  market.onchange=()=>{resetFills();symbol.value=market.value==='spot'?'BTC_USDT':'BTC_USDT_PERP';};
  symbol.oninput=resetFills;
  form.onsubmit=async e=>{
    e.preventDefault();resetFills();const token=access.getToken();if(!token)return;
    const pair=symbol.value.trim().toUpperCase(),venue=market.value;
    if(!/^[A-Z0-9]{1,20}_[A-Z0-9]{1,12}(?:_PERP)?$/.test(pair)){list.textContent='Handelspaar prüfen.';return;}
    const ctl=new AbortController();active=ctl;const timer=setTimeout(()=>ctl.abort(),12000);
    list.textContent='Ausführungen werden geladen …';
    try{
      const url='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/pionex-fills?'+new URLSearchParams({market:venue,symbol:pair});
      const resp=await fetch(url,{headers:{authorization:'Bearer '+token},credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:ctl.signal});
      if(active!==ctl||access.getToken()!==token)return;
      if(resp.status===401||resp.status===403){access.lock();return;}
      if(!resp.ok)throw Error();
      const data=await resp.json();
      if(active!==ctl||access.getToken()!==token)return;
      if(data.private!==true||data.symbol!==pair||data.market!==venue||!Array.isArray(data.fills))throw Error();
      list.replaceChildren(el('p',data.fills.length?'Jüngste Ausführungen · Herkunft manuell/Bot nicht bestätigt.':'Keine Ausführungen für dieses Handelspaar gemeldet.'));
      for(const f of data.fills){
        const d=el('details');
        d.append(el('summary',(f.side==='BUY'?'Kauf':'Verkauf')+' · '+pair+' · '+f.price),
          el('p',new Date(f.timestamp).toLocaleString('de-AT',{timeZone:'Europe/Vienna'})+' Wien · Menge '+f.size+' · Gebühr '+f.fee+' '+f.feeCoin));
        list.append(d);
      }
    }catch{if(active===ctl)list.textContent='Ausführungen nicht verfügbar. Handelspaar und Lesezugang prüfen.';}
    finally{clearTimeout(timer);if(active===ctl)active=null;}
  };
  render();
  return {snapshot,valuation(m){ledger=Number.isFinite(m?.total)?{value:m.total,until:m.priceExpiresAt??Infinity}:null;render();},
    update(state){pionex=state.status==='fresh'&&state.model?.source==='SERVER_PIONEX_CURRENT'?
      {value:state.model.totalUsd,until:state.model.expiresAt}:null;
      if(state.status==='locked'){resetFills();snapshot(null);ledger=null;okx=null;}
      render();},
    dispose(){resetFills();clearTimeout(expiry);card.remove();panel.remove();for(const section of [botOverview,context,sourceDetails])if(section)command.append(section);command.classList.remove('accounts-only');}};
}

// Use the authenticated reader for visible Pionex snapshots.
export function mountDepotReadAccess(document,window,{
  access=appAccess,createClient=createDepotReadClient,createView=createDepotReadView,createLedgerView=mountLedgerReview,
  pionexOnly=false,ledgerManual=false,createLedgerManualView=mountLedgerManual,now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout
}={}){
  const root=document.getElementById('depot-read-root');
  if(!root)return null;
  let client,view,ledgerReview,panels,unregister=()=>{},unsubscribe=()=>{},disposed=false,expiryTimer=null,expiryGeneration=0;
  let stopAutoRefresh=()=>{},reading=false;
  function cancelExpiry(){
    expiryGeneration++;
    if(expiryTimer!==null){cancelSchedule(expiryTimer);expiryTimer=null;}
  }
  try{
    view=createView(root,{pionexOnly,commandRoot:document.getElementById('command-portfolio'),getToken:access.getToken,
      createClient:options=>{
        const reader=createClient({...options,pionexOnly,onLedgerSnapshot:payload=>{panels?.snapshot(payload);ledgerReview?.loadFromDashboard?.(payload);},getToken:access.getToken,onChange:state=>{
          cancelExpiry();
          if(disposed)return;
          if(state.status==='locked'&&access.isUnlocked()){access.lock();return;}
          reading=state.status==='loading';
          options.onChange?.(state);panels?.update(state);
          if(state.status==='fresh'&&Number.isFinite(state.model?.expiresAt)){
            const generation=expiryGeneration;
            const delay=Math.max(0,state.model.expiresAt-now()+1);
            expiryTimer=schedule(()=>{
              if(disposed||generation!==expiryGeneration)return;
              expiryTimer=null;
              reader.revalidate();
              const tab=document.getElementById('nav')?.querySelector?.('[aria-current="page"]')?.dataset.v;
              if(ledgerManual&&!document.hidden&&access.isUnlocked()&&['command','depot'].includes(tab)&&!reading)void reader.refresh();
            },delay);
          }
        }});
        client=reader;
        unregister=access.registerReader(()=>reader.lock(),()=>view?.revalidate());
        return {...reader,lock:()=>access.lock(),dispose(){
          unregister();cancelExpiry();reader.dispose();
        }};
      }});
    unsubscribe=access.subscribe(s=>{if(!disposed&&s?.status==='unlocked')view?.revalidate();});
    stopAutoRefresh=refreshOnOpen(document,access,['command', 'depot', 'bots'],()=>{if(!reading)client?.refresh();},now);
    if(ledgerManual){
      if(document.getElementById('view-command')?.classList)panels=mountAccountPanels(document,root,access,now);
      ledgerReview=createLedgerManualView(root,{access,onValuation:m=>panels?.valuation(m)});

    }
    else if(!pionexOnly)ledgerReview=createLedgerView(root,{access});
  }catch{
    stopAutoRefresh();cancelExpiry();unregister();unsubscribe();ledgerReview?.dispose();panels?.dispose();
    try{client?.dispose();}catch{}
    root.textContent='Depotansicht nicht verfügbar. Bitte Seite neu laden.';
    return null;
  }
  return {dispose(){
    if(disposed)return;
    disposed=true;stopAutoRefresh();unsubscribe();access.lock();cancelExpiry();unregister();ledgerReview?.dispose();panels?.dispose();view.dispose();client=null;
  }};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')mountDepotReadAccess(document,window,{pionexOnly:true,ledgerManual:true});

