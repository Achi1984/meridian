(function(){
  'use strict';

  const API=window.MERIDIAN_CLOUD_API||'https://p01--achi-meridian--ttvk44grdlp7.code.run';
  const CHECK_MS=30000;
  let busy=false;
  let localRelease=null;

  function fallbackExpected(){
    return {
      version:String(window.MERIDIAN_RELEASE_VERSION||window.MERIDIAN_UI_VERSION||''),
      buildId:String(window.MERIDIAN_RELEASE_BUILD||window.__MERIDIAN_BUILD__||''),
      engine:String(window.MERIDIAN_ENGINE_VERSION||''),
      ruleset:String(window.MERIDIAN_RULESET||'')
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
      #meridian-runtime-badge[data-state='wait']{border-color:#b87b08;color:#f4b942;background:#1b1303}
      #meridian-runtime-badge[data-state='check']{border-color:#28445b;color:#91a5b8;background:#07121c}
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
    el.dataset.state='check';
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
  async function expected(){
    try{
      const j=await getJson('version.json?runtime='+Date.now(),5000);
      const next={
        version:String(j?.version||j?.ui||''),
        buildId:String(j?.buildId||''),
        engine:String(j?.engine||''),
        ruleset:String(j?.ruleset||'')
      };
      if(next.version&&next.buildId)localRelease=next;
    }catch(_e){}
    return localRelease||fallbackExpected();
  }
  function sameField(a,b){
    const x=String(a||''),y=String(b||'');
    return !x||!y||x===y;
  }
  function compatibility(exp,h){
    const exact=!!h?.ok && String(h.version||'')===exp.version && String(h.buildId||'')===exp.buildId;
    const versionOk=!!h?.ok && String(h.version||'')===exp.version;
    const engineOk=sameField(exp.engine,h?.engine);
    const rulesetOk=sameField(exp.ruleset,h?.ruleset);
    return {exact,compatible:versionOk&&engineOk&&rulesetOk,versionOk,engineOk,rulesetOk};
  }
  async function check(){
    if(busy)return;
    busy=true;
    try{
      const exp=await expected();
      const h=await getJson(API+'/gateway-health?ts='+Date.now());
      const c=compatibility(exp,h);
      const privateOk=h?.privateData!==false;
      const shortSha=String(h?.deploymentSha||'').slice(0,7);
      const detail=`UI ${exp.version} / ${exp.buildId} · Gateway ${h?.version||'—'} / ${h?.buildId||'—'}${shortSha?' · '+shortSha:''}${c.exact?' · exact build':' · compatible build'}`;
      if(!h?.ok){
        setState('error','GATEWAY',detail,{gateway:h,expected:exp,compatibility:c});
      }else if(!c.compatible){
        setState('wait','SYNC WAIT',detail,{gateway:h,expected:exp,compatibility:c});
      }else if(!privateOk){
        setState('error','STORE',detail+' · private store unavailable',{gateway:h,expected:exp,compatibility:c});
      }else{
        setState('sync','SYNC',detail,{gateway:h,expected:exp,compatibility:c,exactBuild:c.exact});
      }
    }catch(e){
      setState('error','GATEWAY',String(e?.message||e),{error:String(e?.message||e),expected:localRelease||fallbackExpected()});
    }finally{busy=false}
  }

  window.MERIDIAN_RUNTIME_CHECK=check;
  window.MERIDIAN_RUNTIME_COMPATIBILITY=compatibility;
  function start(){badge();check()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
  addEventListener('pageshow',check);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
  setInterval(()=>{if(!document.hidden)check()},CHECK_MS);
})();
