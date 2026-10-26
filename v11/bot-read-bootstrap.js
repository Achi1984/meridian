import {createBotReadAccess} from './bot-read-access.js?v=B13';
import {createBotReadClient} from './bot-read-client.js?v=B13';
import {createBotReadView,renderCommandBotOverview} from './bot-read-view.js?v=B13';

// Mounting controls never starts a request. Only the view's manual refresh can read.
export function mountBotReadAccess(document, window, {
  createClient=createBotReadClient, createView=createBotReadView,
  now=Date.now, schedule=setTimeout, cancelSchedule=clearTimeout
}={}) {
  const root=document.getElementById('bot-read-root');
  const input=document.getElementById('bot-read-token');
  const provide=document.getElementById('bot-read-provide');
  const status=document.getElementById('bot-read-access-status');
  const commandRoot=document.getElementById('command-bot-overview');
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
    view=createView(root,{getToken:access.getToken,
      onSnapshot:(snapshot,jumpToBot)=>renderCommandBotOverview(commandRoot,snapshot,jumpToBot),
      createClient:options=>{
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
    status.textContent='Botansicht nicht verfügbar. Bitte Seite neu laden.';
    return null;
  }
  function accept() {
    if(disposed)return;
    const value=input.value;input.value='';
    const accepted=access.provide(value);
    status.textContent=accepted
      ? 'Lesezugang temporär übernommen. Erst „Bots aktualisieren“ prüft den Zugang.'
      : 'Zugang nicht übernommen. Bitte einen bestehenden Asset-Watch-Freigabelink oder das Meridian-Lesepasswort verwenden.';
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

if(typeof document!=='undefined' && typeof window!=='undefined')mountBotReadAccess(document,window);
