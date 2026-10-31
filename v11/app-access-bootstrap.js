import {appAccess} from './app-access.js?v=B16-M11-FIX7';

export function mountAppAccess(document,window,{access=appAccess}={}){
  const app=document.getElementById('app');
  const gate=document.getElementById('app-access-gate');
  const form=document.getElementById('app-access-form');
  const input=document.getElementById('app-access-password');
  const status=document.getElementById('app-access-status');
  const lockButton=document.getElementById('app-access-lock');
  const main=document.getElementById('app-main');
  if(!app||!gate||!form||!input||!status||!lockButton)return null;
  let disposed=false,lastStatus='locked',submissionGeneration=0;
  function render(state){
    if(disposed)return;
    if(state.status==='unlocked'&&!document.hidden){
      access.revalidateReaders?.();
      state={status:access.isUnlocked()?'unlocked':'locked'};
    }
    const unlocked=state.status==='unlocked';
    const visible=unlocked&&!document.hidden;
    app.hidden=!visible;
    gate.hidden=visible;
    if(state.status==='locked')input.value='';
    if(unlocked&&lastStatus!=='unlocked'&&visible)main?.focus?.({preventScroll:true});
    lastStatus=state.status;
    if(state.status==='locked')status.textContent='Gesperrt. Das Meridian-Passwort wird nicht gespeichert.';
    else if(state.status==='checking')status.textContent='Zugang wird geprüft.';
    else status.textContent='Zugang geprüft. Manuelle Datenabfragen bleiben getrennt.';
  }
  async function submit(event){
    event.preventDefault();
    if(disposed)return;
    const submission=++submissionGeneration;
    const value=input.value;
    input.value='';
    if(!value){status.textContent='Bitte das Meridian-Passwort eingeben.';return;}
    status.textContent='Zugang wird geprüft.';
    const result=await access.verify(value);
    if(disposed||submission!==submissionGeneration)return;
    if(result==='unlocked')status.textContent='Zugang geprüft. Manuelle Datenabfragen bleiben getrennt.';
    else if(result==='rejected')status.textContent='Passwort nicht akzeptiert. Bitte erneut versuchen.';
    else status.textContent='Zugang derzeit nicht verfügbar. Bitte Verbindung prüfen und erneut versuchen.';
  }
  function lock(){
    submissionGeneration++;
    access.lock();
    input.value='';
    try{input.focus({preventScroll:true});}catch{}
  }
  function visibility(){render({status:access.isUnlocked()?'unlocked':'locked'});}
  function focus(){render({status:access.isUnlocked()?'unlocked':'locked'});}
  function pagehide(){submissionGeneration++;input.value='';access.lock();}
  function pageshow(event){
    if(event?.persisted){submissionGeneration++;input.value='';access.lock();}
    render({status:access.isUnlocked()?'unlocked':'locked'});
  }
  function keydown(event){
    if(event.key==='Escape'&&!gate.hidden&&input.value){event.preventDefault();input.value='';}
  }
  form.addEventListener('submit',submit);
  lockButton.addEventListener('click',lock);
  document.addEventListener('visibilitychange',visibility);
  document.addEventListener('keydown',keydown);
  window.addEventListener('focus',focus);
  window.addEventListener('pagehide',pagehide);
  window.addEventListener('pageshow',pageshow);
  const unsubscribe=access.subscribe(render);
  render({status:access.isUnlocked()?'unlocked':'locked'});
  if(!document.hidden&&!access.isUnlocked())try{input.focus({preventScroll:true});}catch{}
  return {dispose(){
    if(disposed)return;
    submissionGeneration++;input.value='';
    access.lock();disposed=true;
    unsubscribe();
    form.removeEventListener('submit',submit);
    lockButton.removeEventListener('click',lock);
    document.removeEventListener('visibilitychange',visibility);
    document.removeEventListener('keydown',keydown);
    window.removeEventListener('focus',focus);
    window.removeEventListener('pagehide',pagehide);
    window.removeEventListener('pageshow',pageshow);
    app.hidden=true;gate.hidden=false;
  }};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')mountAppAccess(document,window);
