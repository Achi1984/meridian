import {createBotReadAccess} from './bot-read-access.js';
import {createDepotReadClient,parseDepotReadCredential} from './depot-read-client.js';
import {createDepotReadView} from './depot-read-view.js';

// Mounting controls never starts a request. Only the view's manual refresh can read.
export function mountDepotReadAccess(document, window, {
  createClient=createDepotReadClient, createView=createDepotReadView,
  now=Date.now, schedule=setTimeout, cancelSchedule=clearTimeout
}={}) {
  const root=document.getElementById('depot-read-root');
  const input=document.getElementById('depot-read-token');
  const provide=document.getElementById('depot-read-provide');
  const status=document.getElementById('depot-read-access-status');
  if (!root || !input || !provide || !status) return null;
  let client,view,disposed=false,expiryTimer=null,expiryGeneration=0,accessLockActive=false;
  function cancelExpiry(){
    expiryGeneration++;
    if(expiryTimer!==null){cancelSchedule(expiryTimer);expiryTimer=null;}
  }
  const access=createBotReadAccess({lock:()=>{
    accessLockActive=true;
    try {client?.lock();} finally {accessLockActive=false;}
  }});
  function clear() {
    cancelExpiry();
    input.value='';access.clear();
    status.textContent='Gesperrt. Der Lesezugang wird nicht gespeichert.';
  }
  try {
    view=createView(root,{commandRoot:document.getElementById('command-portfolio'),getToken:access.getToken,createClient:options=>{
      client=createClient({...options,onChange:state=>{
        cancelExpiry();
        if(disposed)return;
        // Server rejection revokes memory access too. Access-driven locks already
        // clear it and must not reenter provide()/clear() while their lock runs.
        if(state.status==='locked'&&!accessLockActive){clear();return;}
        options.onChange?.(state);
        if(state.status==='fresh'&&Number.isFinite(state.model?.expiresAt)){
          const generation=expiryGeneration;
          const delay=Math.max(0,state.model.expiresAt-now()+1);
          expiryTimer=schedule(()=>{
            if(disposed||generation!==expiryGeneration)return;
            expiryTimer=null;client.revalidate();
          },delay);
        }
      }});
      return {...client,lock:clear};
    }});
  } catch {
    clear();provide.disabled=true;input.disabled=true;
    status.textContent='Depotansicht nicht verfügbar. Bitte Seite neu laden.';
    return null;
  }
  function accept() {
    if(disposed)return;
    const value=input.value;input.value='';
    const accepted=access.provide(parseDepotReadCredential(value) ? value : null);
    status.textContent=accepted
      ? 'Lesezugang temporär übernommen. Erst „Depot aktualisieren“ prüft den Zugang.'
      : 'Zugang nicht übernommen. Bitte das Meridian-Lesepasswort verwenden. Asset-Watch-Links gelten nur für Bots.';
  }
  function visibility() {
    if(document.hidden)clear();else view.revalidate();
  }
  function focus(){view.revalidate();}
  function pagehide(){clear();}
  provide.addEventListener('click',accept);
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('focus',focus);
  window.addEventListener('pageshow',focus);
  window.addEventListener('pagehide',pagehide);
  clear();
  return {dispose(){
    if(disposed)return;disposed=true;
    provide.removeEventListener('click',accept);
    document.removeEventListener('visibilitychange',visibility);
    window.removeEventListener('focus',focus);
    window.removeEventListener('pageshow',focus);
    window.removeEventListener('pagehide',pagehide);
    clear();view.dispose();
  }};
}

if(typeof document!=='undefined' && typeof window!=='undefined')mountDepotReadAccess(document,window);
