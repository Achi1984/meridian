(function(){
  'use strict';

  const API=window.MERIDIAN_CLOUD_API||'https://p01--achi-meridian--ttvk44grdlp7.code.run';
  const CHECK_MS=30000;
  let busy=false;

  function expected(){
    return {
      version:String(window.MERIDIAN_RELEASE_VERSION||window.MERIDIAN_UI_VERSION||''),
      buildId:String(window.MERIDIAN_RELEASE_BUILD||window.__MERIDIAN_BUILD__||'')
    };
  }
  function style(){
    if(document.getElementById('meridian-runtime-style'))return;
    const s=document.createElement('style');
    s.id='meridian-runtime-style';
    s.textContent=`
      #meridian-runtime-badge{display:inline-flex;align-items:center;gap:5px;margin-left:6px;padding:6px 9px;border-radius:999px;border:1px solid #28445b;background:#07121c;color:#91a5b8;font:700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;white-space:nowrap;vertical-align:middle}
      #meridian-runtime-badge::before{content:'';width:7px;height:7px;border-radius:50%;background:#718096;box-shadow:0 0 8px currentColor}
      #meridian-runtime-badge[data-state='sync']{border-color:#0c8f69;color:#32dc9c;background:#041811}
      #meridian-runtime-badge[data-state='deploying']{border-color:#b87b08;color:#f4b942;background:#1b1303}
      #meridian-runtime-badge[data-state='error']{border-color:#a63d48;color:#ff6575;background:#1a080b}
      @media(max-width:600px){#meridian-runtime-badge{padding:5px 7px;font-size:9px;margin-left:4px}}
    `;
    document.head.appendChild(s);
  }
  function badge(){
    style();
    let el=document.getElementById('meridian-runtime-badge');
    if(el)return el;
    el=document.createElement('span');
    el.id='meridian-runtime-badge';
    el.dataset.state='deploying';
    el.textContent='CHECK';
    const anchor=document.getElementById('versionBadge');
    if(anchor?.parentElement)anchor.insertAdjacentElement('afterend',el);
    else document.body?.appendChild(el);
    return el;
  }
  function setState(state,label,detail,status){
    const el=badge();
    if(el){el.dataset.state=state;el.textContent=label;el.title=detail||label}
    window.MERIDIAN_RUNTIME_STATUS={state,label,detail,checkedAt:new Date().toISOString(),...(status||{})};
    try{document.body?.setAttribute('data-runtime-state',state)}catch(_e){}
  }
  async function getJson(url,timeoutMs=8000){
    const c=new AbortController();
    const t=setTimeout(()=>c.abort(),timeoutMs);
    try{
      const r=await fetch(url,{cache:'no-store',signal:c.signal});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }finally{clearTimeout(t)}
  }
  async function check(){
    if(busy)return;
    busy=true;
    try{
      const exp=expected();
      const h=await getJson(API+'/gateway-health?ts='+Date.now());
      const same=!!h?.ok&&String(h.version||'')===exp.version&&String(h.buildId||'')===exp.buildId;
      const privateOk=h?.privateData!==false;
      const shortSha=String(h?.deploymentSha||'').slice(0,7);
      const detail=`UI ${exp.version} / ${exp.buildId} · Gateway ${h?.version||'—'} / ${h?.buildId||'—'}${shortSha?' · '+shortSha:''}`;
      if(!same){
        setState('deploying','DEPLOYING',detail,{gateway:h,expected:exp});
      }else if(!privateOk){
        setState('error','STORE',detail+' · private store unavailable',{gateway:h,expected:exp});
      }else{
        setState('sync','SYNC',detail,{gateway:h,expected:exp});
      }
    }catch(e){
      setState('error','GATEWAY',String(e?.message||e),{error:String(e?.message||e),expected:expected()});
    }finally{busy=false}
  }

  function start(){badge();check()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
  addEventListener('pageshow',check);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
  setInterval(()=>{if(!document.hidden)check()},CHECK_MS);
})();
