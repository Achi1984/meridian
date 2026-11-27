import {appAccess,refreshOnOpen} from './app-access.js?v=B20-M11-FIX6';
import {createDepotReadClient} from './depot-read-client.js?v=B20-M11-FIX6';
import {createDepotReadView} from './depot-read-view.js?v=B20-M11-FIX6';
import {mountLedgerReview} from './ledger-review-view.js?v=B20-M11-FIX6';
import {mountLedgerManual} from './ledger-manual-view.js?v=B20-M11-FIX6';

// Use the authenticated reader for visible Pionex snapshots.
export function mountDepotReadAccess(document,window,{
  access=appAccess,createClient=createDepotReadClient,createView=createDepotReadView,createLedgerView=mountLedgerReview,
  pionexOnly=false,ledgerManual=false,createLedgerManualView=mountLedgerManual,now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout
}={}){
  const root=document.getElementById('depot-read-root');
  if(!root)return null;
  let client,view,ledgerReview,unregister=()=>{},unsubscribe=()=>{},disposed=false,expiryTimer=null,expiryGeneration=0;
  let stopAutoRefresh=()=>{},reading=false;
  function cancelExpiry(){
    expiryGeneration++;
    if(expiryTimer!==null){cancelSchedule(expiryTimer);expiryTimer=null;}
  }
  try{
    view=createView(root,{pionexOnly,commandRoot:document.getElementById('command-portfolio'),getToken:access.getToken,
      createClient:options=>{
        const reader=createClient({...options,pionexOnly,onLedgerSnapshot:payload=>ledgerReview?.loadFromDashboard?.(payload),getToken:access.getToken,onChange:state=>{
          cancelExpiry();
          if(disposed)return;
          if(state.status==='locked'&&access.isUnlocked()){access.lock();return;}
          reading=state.status==='loading';
          options.onChange?.(state);
          if(state.status==='fresh'&&Number.isFinite(state.model?.expiresAt)){
            const generation=expiryGeneration;
            const delay=Math.max(0,state.model.expiresAt-now()+1);
            expiryTimer=schedule(()=>{
              if(disposed||generation!==expiryGeneration)return;
              expiryTimer=null;reader.revalidate();
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
      ledgerReview=createLedgerManualView(root,{access});

    }
    else if(!pionexOnly)ledgerReview=createLedgerView(root,{access});
  }catch{
    stopAutoRefresh();cancelExpiry();unregister();unsubscribe();ledgerReview?.dispose();
    try{client?.dispose();}catch{}
    root.textContent='Depotansicht nicht verfügbar. Bitte Seite neu laden.';
    return null;
  }
  return {dispose(){
    if(disposed)return;
    disposed=true;stopAutoRefresh();unsubscribe();access.lock();cancelExpiry();unregister();ledgerReview?.dispose();view.dispose();client=null;
  }};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')mountDepotReadAccess(document,window,{pionexOnly:true,ledgerManual:true});

