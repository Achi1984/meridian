import {appAccess} from './app-access.js?v=B16-M11-FIX12';
import {createDepotReadClient} from './depot-read-client.js?v=B16-M11-FIX12';
import {createDepotReadView} from './depot-read-view.js?v=B16-M11-FIX12';
import {mountLedgerReview} from './ledger-review-view.js?v=B16-M11-FIX12';
import {mountLedgerManual} from './ledger-manual-view.js?v=B16-M11-FIX12';

// Mounting controls never starts a request. Only the view's manual refresh can read.
export function mountDepotReadAccess(document,window,{
  access=appAccess,createClient=createDepotReadClient,createView=createDepotReadView,createLedgerView=mountLedgerReview,
  pionexOnly=false,okxAggregate=false,ledgerManual=false,createLedgerManualView=mountLedgerManual,now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout
}={}){
  const root=document.getElementById('depot-read-root');
  if(!root)return null;
  let client,view,ledgerReview,unregister=()=>{},unsubscribe=()=>{},disposed=false,expiryTimer=null,expiryGeneration=0;
  function cancelExpiry(){
    expiryGeneration++;
    if(expiryTimer!==null){cancelSchedule(expiryTimer);expiryTimer=null;}
  }
  try{
    view=createView(root,{pionexOnly,okxAggregate,commandRoot:document.getElementById('command-portfolio'),getToken:access.getToken,
      createClient:options=>{
        const reader=createClient({...options,pionexOnly,okxAggregate,getToken:access.getToken,onChange:state=>{
          cancelExpiry();
          if(disposed)return;
          if(state.status==='locked'&&access.isUnlocked()){access.lock();return;}
          options.onChange?.(state);
          const expiries=[state.status==='fresh'?state.model?.expiresAt:null,state.okx?.status==='ready'?state.okx.expiresAt:null].filter(Number.isFinite);
          if(expiries.length){
            const generation=expiryGeneration;
            const delay=Math.max(0,Math.min(...expiries)-now()+1);
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
    if(ledgerManual)ledgerReview=createLedgerManualView(root,{access});
    else if(!pionexOnly)ledgerReview=createLedgerView(root,{access});
  }catch{
    cancelExpiry();unregister();unsubscribe();ledgerReview?.dispose();
    try{client?.dispose();}catch{}
    root.textContent='Depotansicht nicht verfügbar. Bitte Seite neu laden.';
    return null;
  }
  return {dispose(){
    if(disposed)return;
    disposed=true;unsubscribe();access.lock();cancelExpiry();unregister();ledgerReview?.dispose();view.dispose();client=null;
  }};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')mountDepotReadAccess(document,window,{pionexOnly:true,ledgerManual:true,okxAggregate:true});


