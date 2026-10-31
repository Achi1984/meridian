import {appAccess} from './app-access.js?v=B16-M11-FIX5';
import {createAgentStatusClient} from './agent-status-client.js?v=B16-M11-FIX5';
import {renderM11AgentStatus} from '../public/js/m11-agent-status.js';

export function mountAgentStatus(document,window,{
  access=appAccess,now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout,
  createClient=createAgentStatusClient
}={}){
  const root=document.getElementById('agent-status-root');
  if(!root)return null;
  let client,disposed=false,pageHidden=false,timer=null,generation=0,unregister=()=>{};
  function cancelExpiry(){
    generation++;
    if(timer!==null){cancelSchedule(timer);timer=null;}
  }
  function empty(unavailable=false){
    root.replaceChildren();
    root.textContent=unavailable?'Statusdaten nicht verfügbar.':'Keine verifizierten Statusdaten.';
  }
  function onChange(state){
    cancelExpiry();
    if(disposed)return;
    if(state.status!=='ready'){empty(state.status==='unavailable');return;}
    try{
      if(pageHidden||!access.isUnlocked())throw new Error('Status unavailable');
      renderM11AgentStatus(root,state.serializedDto,{now:()=>state.nowMs});
      if(state.nextExpiryAt!==null){
        const id=generation;
        timer=schedule(()=>{
          if(disposed||id!==generation)return;
          timer=null;
          client.revalidate();
        },Math.min(2147483647,Math.max(0,state.nextExpiryAt-now())));
      }
    }catch{
      cancelExpiry();empty(true);
      throw new Error('Status unavailable');
    }
  }
  function clear(reason='empty'){
    cancelExpiry();client?.clear(reason);empty(reason==='unavailable');
  }
  function acceptSnapshot(serializedDTO){
    if(disposed)return false;
    try{
      if(pageHidden||!access.isUnlocked()){clear('unavailable');return false;}
      return client.accept(serializedDTO);
    }catch{
      clear('unavailable');return false;
    }
  }
  function clearSnapshot(reason='empty'){
    if(disposed)return;
    clear(reason);
  }
  function revalidate(){
    if(disposed||pageHidden)return;
    if(!access.isUnlocked()){clear();return;}
    client?.revalidate();
  }
  function pagehide(){pageHidden=true;clear();}
  function pageshow(){pageHidden=false;}
  function dispose(){
    if(disposed)return;
    disposed=true;clear();
    unregister();client?.dispose();
    window.removeEventListener('pagehide',pagehide);
    window.removeEventListener('pageshow',pageshow);
  }
  empty();
  try{
    client=createClient({now,onChange});
    unregister=access.registerReader(clear,revalidate);
    window.addEventListener('pagehide',pagehide);
    window.addEventListener('pageshow',pageshow);
  }catch{
    dispose();empty(true);
    return null;
  }
  return Object.freeze({acceptSnapshot,clearSnapshot,dispose});
}

if(typeof document!=='undefined'&&typeof window!=='undefined')mountAgentStatus(document,window);
