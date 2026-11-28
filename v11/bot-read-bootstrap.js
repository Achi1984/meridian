import './paper-status.js?v=B20-M11-FIX6';
import {appAccess,refreshOnOpen} from './app-access.js?v=B20-M11-FIX6';
import {createBotReadClient} from './bot-read-client.js?v=B20-M11-FIX6';
import {createBotReadView,renderCommandBotOverview} from './bot-read-view.js?v=B20-M11-FIX6';

// Use the authenticated reader for visible Pionex snapshots.
export function mountBotReadAccess(document,window,{
  access=appAccess,createClient=createBotReadClient,createView=createBotReadView,
  now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout
}={}){
  const root=document.getElementById('bot-read-root');
  if(!root)return null;
  const commandRoot=document.getElementById('command-bot-overview');
  const commandStatus=document.getElementById('command-bots-status');
  let client,view,unregister=()=>{},unsubscribe=()=>{},disposed=false,expiryTimer=null,expiryGeneration=0;
  let stopAutoRefresh=()=>{},reading=false;
  function cancelExpiry(){
    expiryGeneration++;
    if(expiryTimer!==null){cancelSchedule(expiryTimer);expiryTimer=null;}
  }
  try{
    view=createView(root,{getToken:access.getToken,
      onSnapshot:(snapshot,jumpToBot)=>renderCommandBotOverview(commandRoot,snapshot,jumpToBot,commandStatus),
      createClient:options=>{
        const reader=createClient({...options,getToken:access.getToken,onChange:state=>{
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
    stopAutoRefresh=refreshOnOpen(document,access,['command', 'bots'],()=>{if(!reading)client?.refresh();},now);
  }catch{
    stopAutoRefresh();cancelExpiry();unregister();unsubscribe();
    try{client?.dispose();}catch{}
    root.textContent='Botansicht nicht verfügbar. Bitte Seite neu laden.';
    renderCommandBotOverview(commandRoot,{status:'unavailable'},null,commandStatus);
    return null;
  }
  return {dispose(){
    if(disposed)return;
    disposed=true;stopAutoRefresh();unsubscribe();access.lock();cancelExpiry();unregister();view.dispose();client=null;
  }};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')mountBotReadAccess(document,window);
