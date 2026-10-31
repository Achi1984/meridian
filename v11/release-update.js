const ENTRIES=['app-access-bootstrap.js','bot-read-bootstrap.js','depot-read-bootstrap.js',
  'strategy-workspace-bootstrap.js','agent-status-bootstrap.js'];
const MAX_BYTES=128*1024;
const CHECK_INTERVAL_MS=60000;
const TIMEOUT_MS=5000;
const MARKER='m11build';

function releaseParts(value){
  const match=/^B([1-9]\d{0,3})-M11(?:-FIX([1-9]\d{0,3}))?$/.exec(value||'');
  return match?[Number(match[1]),Number(match[2]||0)]:null;
}

export function readReleaseSources(sources){
  if(!Array.isArray(sources)||sources.length!==ENTRIES.length)return null;
  const seen=new Set();let release=null;
  for(const source of sources){
    const match=/^\.\/([a-z-]+\.js)\?v=(B\d+-M11(?:-FIX\d+)?)$/.exec(source||'');
    if(!match||!ENTRIES.includes(match[1])||seen.has(match[1])||!releaseParts(match[2]))return null;
    seen.add(match[1]);
    if(release!==null&&release!==match[2])return null;
    release=match[2];
  }
  return release;
}

export function readReleaseHtml(html){
  if(typeof html!=='string'||html.length>MAX_BYTES||
    !html.includes('<meta name="meridian-ui-generation" content="11-preview">'))return null;
  // Read only the generated module declarations; never execute returned markup.
  const sources=[...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"\s*>/g)].map(match=>match[1]);
  return readReleaseSources(sources);
}

function newer(candidate,current){
  const next=releaseParts(candidate),loaded=releaseParts(current);
  return !!next&&!!loaded&&(next[0]>loaded[0]||(next[0]===loaded[0]&&next[1]>loaded[1]));
}

async function readHtml(response,signal){
  if(!response.ok||!/^text\/html(?:;|$)/i.test(response.headers?.get('content-type')||''))throw Error('unavailable');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))throw Error('unavailable');
  const reader=response.body?.getReader();
  if(!reader)throw Error('unavailable');
  const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,html='';
  const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      if(signal.aborted)throw Error('unavailable');
      const {done,value}=await reader.read();
      if(signal.aborted)throw Error('unavailable');
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES)throw Error('unavailable');
      html+=decoder.decode(value,{stream:true});
    }
    return html+decoder.decode();
  }finally{
    signal.removeEventListener('abort',cancel);cancel();
    try{reader.releaseLock();}catch{}
  }
}

export function createReleaseUpdate({currentRelease,currentUrl,fetchImpl=globalThis.fetch,
  now=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout,
  canReload=()=>false,navigate=()=>{},onUpdate=()=>{}}={}){
  const page=new URL(currentUrl),source=new URL('./index.html',page);
  source.search='';source.hash='';
  let pending=null,lastCheck=-Infinity,target=null,disposed=false,navigating=false;
  function applyUpdate({automatic=false}={}){
    if(disposed||navigating||!target)return false;
    if(automatic&&(!canReload()||page.searchParams.get(MARKER)===target))return false;
    const destination=new URL(page);destination.searchParams.set(MARKER,target);
    navigating=true;
    try{navigate(destination.href);return true;}
    catch{navigating=false;return false;}
  }
  function reconsider(){
    if(disposed||!target)return;
    if(!applyUpdate({automatic:true}))onUpdate(target);
  }
  async function check(){
    if(disposed||navigating||pending||now()-lastCheck<CHECK_INTERVAL_MS||
      !releaseParts(currentRelease)||!/^https?:$/.test(page.protocol)||typeof fetchImpl!=='function')return;
    lastCheck=now();
    const controller=new AbortController();pending=controller;
    let timer,onAbort;
    const aborted=new Promise((_,reject)=>{
      onAbort=()=>reject(Error('unavailable'));
      controller.signal.addEventListener('abort',onAbort,{once:true});
    });
    aborted.catch(()=>{});
    try{
      timer=schedule(()=>controller.abort(),TIMEOUT_MS);
      const operation=(async()=>{
        const response=await fetchImpl(source.href,{method:'GET',cache:'no-store',credentials:'omit',
          redirect:'error',referrerPolicy:'no-referrer',headers:{accept:'text/html'},signal:controller.signal});
        return readReleaseHtml(await readHtml(response,controller.signal));
      })();
      const release=await Promise.race([operation,aborted]);
      if(disposed||controller.signal.aborted)return;
      if(newer(release,currentRelease)){target=release;reconsider();}
    }catch{/* Offline, partial deployments and invalid responses leave the loaded UI usable. */}
    finally{
      if(timer!==undefined)cancelSchedule(timer);
      controller.signal.removeEventListener('abort',onAbort);
      if(pending===controller)pending=null;
    }
  }
  return Object.freeze({check,reconsider,applyUpdate,dispose(){
    disposed=true;pending?.abort();pending=null;
  }});
}

export function mountReleaseUpdate(document,window,{access,fetchImpl=window.fetch?.bind(window)}={}){
  const input=document.getElementById('app-access-password');
  const gate=document.getElementById('app-access-gate');
  if(!input||!gate?.parentNode||!access)return null;
  const currentRelease=readReleaseSources(Array.from(document.querySelectorAll('script[type="module"][src]'))
    .map(script=>script.getAttribute('src')));
  if(!currentRelease)return null;
  const notice=document.createElement('section');notice.id='release-update-notice';
  notice.className='container';notice.hidden=true;notice.setAttribute('aria-label','Meridian aktualisieren');
  const card=document.createElement('div');card.className='card';
  const message=document.createElement('p');message.setAttribute('role','status');
  message.textContent='Neue Meridian-Version verfügbar. Beim Aktualisieren wird die App gesperrt.';
  const button=document.createElement('button');button.id='release-update-button';button.type='button';
  button.className='app-access-lock';button.textContent='Jetzt aktualisieren';
  card.append(message,button);notice.append(card);gate.parentNode.insertBefore(notice,gate);
  let accessStatus='locked',disposed=false;
  const update=createReleaseUpdate({currentRelease,currentUrl:window.location.href,fetchImpl,
    canReload:()=>!document.hidden&&accessStatus==='locked'&&!input.value&&
      !document.activeElement?.isContentEditable&&
      !/^(TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||''),
    navigate:url=>window.location.replace(url),
    onUpdate:()=>{notice.hidden=false;}});
  const show=()=>{if(!document.hidden){update.reconsider();void update.check();}};
  const apply=()=>{update.applyUpdate();};
  // verify() publishes locked before checking. Never navigate from that intermediate
  // notification after the submit handler has cleared the password field.
  const unsubscribe=access.subscribe(state=>{accessStatus=state.status;});
  window.addEventListener('pageshow',show);
  window.addEventListener('focus',show);
  document.addEventListener('visibilitychange',show);
  button.addEventListener('click',apply);
  show();
  return {dispose(){
    if(disposed)return;disposed=true;unsubscribe();update.dispose();notice.hidden=true;
    window.removeEventListener('pageshow',show);window.removeEventListener('focus',show);
    document.removeEventListener('visibilitychange',show);button.removeEventListener('click',apply);notice.remove();
  }};
}
