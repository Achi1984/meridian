import {appAccess} from './app-access.js?v=B14-M11';
import {createDepotReadClient} from './depot-read-client.js?v=B14-M11';
import {createDepotReadView} from './depot-read-view.js?v=B14-M11';

// Mounting controls never starts a request. Only the view's manual refresh can read.
export function mountDepotReadAccess(document,window,{
  access=appAccess,createClient=createDepotReadClient,createView=createDepotReadView,
  now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout
}={}){
  const root=document.getElementById('depot-read-root');
  if(!root)return null;
  let client,view,unregister=()=>{},disposed=false,expiryTimer=null,expiryGeneration=0;
  function cancelExpiry(){
    expiryGeneration++;
    if(expiryTimer!==null){cancelSchedule(expiryTimer);expiryTimer=null;}
  }
  try{
    view=createView(root,{commandRoot:document.getElementById('command-portfolio'),getToken:access.getToken,
      createClient:options=>{
        const reader=createClient({...options,getToken:access.getToken,onChange:state=>{
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
  }catch{
    cancelExpiry();unregister();
    try{client?.dispose();}catch{}
    root.textContent='Depotansicht nicht verfügbar. Bitte Seite neu laden.';
    return null;
  }
  return {dispose(){
    if(disposed)return;
    disposed=true;access.lock();cancelExpiry();unregister();view.dispose();client=null;
  }};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')mountDepotReadAccess(document,window);
