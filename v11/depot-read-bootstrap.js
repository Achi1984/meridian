import {appAccess} from './app-access.js?v=B16-M11-FIX10';
import {createDepotReadClient} from './depot-read-client.js?v=B16-M11-FIX10';
import {createDepotReadView} from './depot-read-view.js?v=B16-M11-FIX10';
import {mountLedgerReview} from './ledger-review-view.js?v=B16-M11-FIX10';

// Mounting controls never starts a request. Only the view's manual refresh can read.
export function mountDepotReadAccess(document,window,{
  access=appAccess,createClient=createDepotReadClient,createView=createDepotReadView,createLedgerView=mountLedgerReview,
  pionexOnly=false,now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout
}={}){
  const root=document.getElementById('depot-read-root');
  if(!root)return null;
  let client,view,ledgerReview,unregister=()=>{},unsubscribe=()=>{},disposed=false,expiryTimer=null,expiryGeneration=0;
  function cancelExpiry(){
    expiryGeneration++;
    if(expiryTimer!==null){cancelSchedule(expiryTimer);expiryTimer=null;}
  }
  try{
    view=createView(root,{pionexOnly,commandRoot:document.getElementById('command-portfolio'),getToken:access.getToken,
      createClient:options=>{
        const reader=createClient({...options,pionexOnly,getToken:access.getToken,onChange:state=>{
          cancelExpiry();
          if(disposed)return;
          if(state.status==='locked'&&access.isUnlocked()){access.lock();return;}
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
    if(!pionexOnly)ledgerReview=createLedgerView(root,{access});
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

if(typeof document!=='undefined'&&typeof window!=='undefined')mountDepotReadAccess(document,window,{pionexOnly:true});

