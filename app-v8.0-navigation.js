/* MERIDIAN v8.0 R12 — deterministic five-item customer navigation with a real MORE view. */
(function(){
  'use strict';
  const VERSION='8.0',BUILD='8.0-20260905-R12';
  const ITEMS=[
    {key:'center',label:'CENTER',patterns:[/^CENTER$/i,/^LIVE$/i,/^DASHBOARD$/i],ids:['view-center','view-live','view-dashboard'],runtime:'center'},
    {key:'depot',label:'DEPOT',patterns:[/^DEPOT$/i],ids:['view-depot'],runtime:'depot'},
    {key:'trade',label:'TRADE',patterns:[/^TRADE$/i,/^DAY[- ]?TRADE$/i,/^GRID$/i],ids:['view-daytrade','view-trade'],runtime:'daytrade'},
    {key:'paper',label:'PAPER',patterns:[/^PAPER$/i],ids:['view-paper'],runtime:'paper'},
    {key:'more',label:'MORE',patterns:[],ids:['view-more'],runtime:'more'}
  ];
  const text=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim(),own=el=>!!el?.closest?.('#v8-bottom-nav');
  function legacyCandidates(){const roots=[...document.querySelectorAll('#primaryBottomNav,.bottom,.bottom-nav,nav,[class*="bottom"]')],set=new Set();for(const r of roots)for(const el of r.querySelectorAll('button,a,[role="button"],.nav'))if(!own(el))set.add(el);if(!set.size)for(const el of document.querySelectorAll('button,a,[role="button"],.nav'))if(!own(el))set.add(el);return [...set]}
  function findLegacy(patterns){const xs=legacyCandidates();for(const re of patterns){const hit=xs.find(el=>re.test(text(el)));if(hit)return hit}return null}
  function resolveView(item){for(const id of item?.ids||[]){const v=document.getElementById(id);if(v)return v}return null}
  function inferActive(){
    const bodyView=String(document.body?.dataset?.view||'').toLowerCase();
    if(/market|forecast|fcst|more/.test(bodyView))return 'more';if(/paper/.test(bodyView))return 'paper';if(/trade|grid|daytrade/.test(bodyView))return 'trade';if(/depot/.test(bodyView))return 'depot';if(/live|center|dashboard/.test(bodyView))return 'center';
    for(const item of ITEMS){const view=resolveView(item);if(!view)continue;try{const s=getComputedStyle(view);if(!view.classList.contains('hidden')&&s.display!=='none'&&s.visibility!=='hidden')return item.key}catch(_e){}}
    return 'center';
  }
  function markActive(key){document.querySelectorAll('#v8-bottom-nav button').forEach(b=>{const on=b.dataset.view===key;b.classList.toggle('active',on);b.setAttribute('aria-current',on?'page':'false')});window.MERIDIAN_V8_NAV_STATUS={version:VERSION,build:BUILD,active:key,items:ITEMS.map(x=>x.key),executionImpact:false,updatedAt:new Date().toISOString()}}
  function forceView(item){
    const target=resolveView(item);if(!target)return false;
    document.querySelectorAll('[id^="view-"]').forEach(v=>{const on=v===target;v.classList.toggle('hidden',!on);if(on){v.removeAttribute('hidden');v.style.removeProperty('display');v.style.removeProperty('visibility')}});
    document.getElementById('v8-more-overlay')?.remove();
    if(document.body)document.body.dataset.view=item.runtime;
    if(item.key!=='more'){try{if(typeof window.renderOne==='function')window.renderOne(item.runtime);else if(typeof renderOne==='function')renderOne(item.runtime)}catch(_e){}}
    markActive(item.key);window.dispatchEvent(new CustomEvent('meridian:v8-viewchange',{detail:{view:item.key,runtime:item.runtime,targetId:target.id}}));return true;
  }
  function route(key){const item=ITEMS.find(x=>x.key===key);if(!item)return false;if(key!=='more'){const legacy=findLegacy(item.patterns);if(legacy){try{legacy.click()}catch(_e){}}}const ok=forceView(item);if(!ok&&key!=='more'){const legacy=findLegacy(item.patterns);if(legacy){setTimeout(()=>markActive(key),30);return true}}return ok}
  function hideLegacyBottom(){const primary=document.getElementById('primaryBottomNav');if(primary)primary.classList.add('v8-legacy-bottom-hidden');document.querySelectorAll('.bottom,.bottom-nav').forEach(el=>{if(el.id!=='v8-bottom-nav'&&!el.closest('#v8-bottom-nav'))el.classList.add('v8-legacy-bottom-hidden')});document.documentElement.classList.add('v8-nav-ready')}
  function ensure(){css();let nav=document.getElementById('v8-bottom-nav');if(!nav){nav=document.createElement('nav');nav.id='v8-bottom-nav';nav.setAttribute('aria-label','MERIDIAN Hauptnavigation');nav.innerHTML=`<div class="v8-nav-inner">${ITEMS.map((x,i)=>`<button type="button" data-view="${x.key}" aria-label="${x.label}"><i aria-hidden="true">${i+1}</i><span>${x.label}</span></button>`).join('')}</div>`;document.body.appendChild(nav)}nav.querySelectorAll('button').forEach(b=>{b.onclick=e=>{e.preventDefault();e.stopPropagation();route(b.dataset.view)}});hideLegacyBottom();markActive(inferActive())}
  function css(){if(document.getElementById('v8-navigation-css'))return;const s=document.createElement('style');s.id='v8-navigation-css';s.textContent=`
    .v8-legacy-bottom-hidden{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}html.v8-nav-ready #primaryBottomNav{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;height:0!important;min-height:0!important;overflow:hidden!important}html.v8-nav-ready body>.bottom:not(#v8-bottom-nav),html.v8-nav-ready body>.bottom-nav:not(#v8-bottom-nav){display:none!important;visibility:hidden!important;pointer-events:none!important}html.v8-nav-ready #v8-customer-mode #v8-more-open{display:none!important}html.v8-nav-ready body{padding-bottom:calc(76px + env(safe-area-inset-bottom,0px))!important}
    #v8-bottom-nav{position:fixed;z-index:2147483646;left:0;right:0;bottom:0;padding:7px 10px calc(7px + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,rgba(2,8,13,.72),rgba(2,8,13,.98) 28%);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-top:1px solid rgba(39,119,162,.24);pointer-events:auto!important}.v8-nav-inner{max-width:760px;margin:0 auto;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;padding:4px;border:1px solid #17394e;border-radius:18px;background:#04101a;box-shadow:0 10px 30px rgba(0,0,0,.28)}#v8-bottom-nav button{min-width:0;min-height:48px;border:0;border-radius:13px;background:transparent;color:#70889a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:5px 2px;font:900 8px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.07em;touch-action:manipulation;pointer-events:auto!important}#v8-bottom-nav button i{width:17px;height:17px;display:grid;place-items:center;border:1px solid #274557;border-radius:6px;font-style:normal;font-size:7px;color:#698294;background:#07141e}#v8-bottom-nav button.active{color:#55c8ff;background:#071a27;box-shadow:inset 0 0 0 1px rgba(85,200,255,.14)}#v8-bottom-nav button.active i{border-color:#228fc2;color:#9de2ff;background:#082335}#v8-bottom-nav button[data-view="more"] i{font-size:0}#v8-bottom-nav button[data-view="more"] i:after{content:'•••';font-size:7px;letter-spacing:0}html.v8-nav-ready .v8-customer-screen{max-width:760px!important}
    @media(max-width:430px){#v8-bottom-nav{padding-left:7px;padding-right:7px;padding-top:5px}.v8-nav-inner{gap:3px;border-radius:16px;padding:3px}#v8-bottom-nav button{min-height:46px;font-size:7px;letter-spacing:.04em;gap:3px;border-radius:11px}#v8-bottom-nav button i{width:16px;height:16px}html.v8-nav-ready .v8-customer-screen{padding-left:10px!important;padding-right:10px!important;margin-top:8px!important}}@media(max-width:360px){#v8-bottom-nav button{font-size:6.4px}.v8-nav-inner{gap:2px}}
  `;document.head.appendChild(s)}
  let timer=null;function schedule(){clearTimeout(timer);timer=setTimeout(ensure,120)}
  function start(){ensure();if(typeof MutationObserver!=='undefined')new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-view','id']})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();addEventListener('pageshow',ensure);document.addEventListener('visibilitychange',()=>{if(!document.hidden)ensure()});setInterval(()=>{if(!document.hidden)hideLegacyBottom()},1500);
})();
