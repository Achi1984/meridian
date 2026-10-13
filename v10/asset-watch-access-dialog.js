// One-use access input. Never persists or renders the entered credential.
export function createAssetWatchAccessDialog({document,submit}){
  let dialog=null,input=null;
  function clear(){if(input)input.value='';}
  function close(){clear();if(dialog?.open)dialog.close();}
  function open(){
    if(document.visibilityState==='hidden'||dialog?.open)return;
    if(!dialog){
      dialog=document.createElement('dialog');
      dialog.setAttribute('aria-label','Meridian-Lesezugang verwenden');
      dialog.setAttribute('style','box-sizing:border-box;max-width:min(32rem,calc(100vw - 2rem));max-height:calc(100dvh - 2rem);overflow:auto;border:1px solid #526b86;border-radius:16px;padding:24px;background:#101923;color:#eef4fa;font:inherit');
      dialog.innerHTML='<form><h2>Lesezugang verwenden</h2><p>Bestehendes Meridian-Lesepasswort für diese einzelne Aktion. Kein Börsen-API-Schlüssel und kein Asset-Watch-Link. Es wird nicht gespeichert.</p><label>Meridian-Lesepasswort <input type="password" autocomplete="off" style="box-sizing:border-box;display:block;width:100%;min-height:44px;margin-top:8px" required maxlength="4096"></label><p><button style="min-height:44px;margin:4px" type="submit" value="rotate">Link erstellen</button> <button style="min-height:44px;margin:4px" type="submit" value="revoke">Link widerrufen</button> <button style="min-height:44px;margin:4px" type="button" data-cancel>Abbrechen</button></p></form>';
      input=dialog.querySelector('input');
      dialog.querySelector('form').addEventListener('submit',event=>{
        event.preventDefault();
        const action=event.submitter?.value||'rotate';
        let credential=input.value.trim();clear();
        if(!credential||!['rotate','revoke'].includes(action)){credential='';return;}
        close();submit(action,credential);credential='';
      });
      dialog.querySelector('[data-cancel]').addEventListener('click',close);
      dialog.addEventListener('cancel',clear);
      // Native close events are queued; an earlier session must not clear a reopened one.
      dialog.addEventListener('close',()=>{if(!dialog.open)clear();});
      document.body.appendChild(dialog);
    }
    clear();dialog.showModal();input.focus();
  }
  return{open,close};
}
