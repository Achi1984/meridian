// MERIDIAN v8 R10 — Depot chart range + high/low overlay
// Presentation/read-only enhancement. No execution or portfolio-contract changes.
const API_BASE=(window.MERIDIAN_V8_CONFIG?.apiBase||'').replace(/\/$/,'');
const TOKEN_KEY='meridian.v8.readToken';
const RANGE_MS={"4h":4*60*60*1000,"1d":24*60*60*1000,"1w":7*24*60*60*1000};
const RANGE_LABEL={"4h":"4H","1d":"1T","1w":"1W"};
const cache=new Map();

function token(){
  try{return String(localStorage.getItem(TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||'').trim()}catch(_e){return ''}
}
function usd(v){return Number.isFinite(Number(v))?'$'+Math.round(Number(v)).toLocaleString('de-DE'):'—'}
function cleanPoints(raw,range){
  const now=Date.now(),cut=now-RANGE_MS[range];
  return (Array.isArray(raw?.points)?raw.points:[])
    .map(p=>({t:Number(p?.timestamp),v:Number(p?.totalUsd)}))
    .filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.v)&&p.t>=cut)
    .sort((a,b)=>a.t-b.t);
}
async function history(range){
  const backendRange=range==='1w'?'1w':'1d';
  const key=`${backendRange}:${Math.floor(Date.now()/60000)}`;
  let raw=cache.get(key);
  if(!raw){
    const t=token();
    const r=await fetch(`${API_BASE}/api/private/portfolio-history?range=${backendRange}`,{cache:'no-store',headers:{accept:'application/json',...(t?{authorization:`Bearer ${t}`}:{})}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    raw=await r.json(); cache.clear(); cache.set(key,raw);
  }
  return cleanPoints(raw,range);
}
function chartSvg(points){
  if(points.length<2)return '<div class="chart-empty depot-r10-empty">KANONISCHE HISTORIE WIRD AUFGEBAUT</div>';
  const vals=points.map(p=>p.v),lo=Math.min(...vals),hi=Math.max(...vals),span=Math.max(1,hi-lo),w=360,h=150,padX=14,padY=20;
  const xy=points.map((p,i)=>({x:padX+(w-padX*2)*(i/(points.length-1)),y:padY+(h-padY*2)*(1-(p.v-lo)/span),v:p.v}));
  const path=xy.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const hiIndex=vals.indexOf(hi),loIndex=vals.indexOf(lo),hp=xy[hiIndex],lp=xy[loIndex];
  const highLabelY=Math.max(13,hp.y-9),lowLabelY=Math.min(h-5,lp.y+16);
  return `<svg class="depot-r10-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Portfolio Verlauf mit Hoch und Tief">
    <path class="depot-r10-line" d="${path}" fill="none" vector-effect="non-scaling-stroke"/>
    <circle class="depot-r10-point high" cx="${hp.x.toFixed(1)}" cy="${hp.y.toFixed(1)}" r="3.2" vector-effect="non-scaling-stroke"/>
    <circle class="depot-r10-point low" cx="${lp.x.toFixed(1)}" cy="${lp.y.toFixed(1)}" r="3.2" vector-effect="non-scaling-stroke"/>
    <text class="depot-r10-label high" x="${Math.min(w-76,Math.max(4,hp.x-34)).toFixed(1)}" y="${highLabelY.toFixed(1)}">HIGH ${usd(hi)}</text>
    <text class="depot-r10-label low" x="${Math.min(w-72,Math.max(4,lp.x-30)).toFixed(1)}" y="${lowLabelY.toFixed(1)}">LOW ${usd(lo)}</text>
  </svg>`;
}
function rangeStats(points){
  if(points.length<2)return {hi:null,lo:null,delta:null,pct:null};
  const vals=points.map(p=>p.v),first=vals[0],last=vals.at(-1),delta=last-first;
  return {hi:Math.max(...vals),lo:Math.min(...vals),delta,pct:first?delta/first*100:null};
}
function pct(v){return Number.isFinite(v)?`${v>=0?'+':''}${v.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}%`:'—'}
function controls(selected){return `<div class="depot-r10-toolbar" role="group" aria-label="Chart Zeitraum">${['4h','1d','1w'].map(r=>`<button type="button" data-chart-range="${r}" class="${r===selected?'active':''}">${RANGE_LABEL[r]}</button>`).join('')}</div>`}
async function paint(host,range='1d'){
  host.dataset.chartRange=range;
  host.innerHTML=`${controls(range)}<div class="depot-r10-stage"><div class="chart-empty">LÄDT…</div></div><div class="depot-r10-meta"></div>`;
  try{
    const points=await history(range);
    if(host.dataset.chartRange!==range)return;
    const s=rangeStats(points);
    host.querySelector('.depot-r10-stage').innerHTML=chartSvg(points);
    host.querySelector('.depot-r10-meta').innerHTML=`<span>HIGH <b>${usd(s.hi)}</b></span><span>LOW <b>${usd(s.lo)}</b></span><span>${RANGE_LABEL[range]} <b class="${Number(s.pct)>=0?'up':'down'}">${pct(s.pct)}</b></span>`;
    host.querySelectorAll('[data-chart-range]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.chartRange!==host.dataset.chartRange)paint(host,b.dataset.chartRange)}));
  }catch(e){
    host.querySelector('.depot-r10-stage').innerHTML='<div class="chart-empty depot-r10-empty">HISTORIE NICHT VERFÜGBAR</div>';
    host.querySelector('.depot-r10-meta').textContent=String(e?.message||e);
    host.querySelectorAll('[data-chart-range]').forEach(b=>b.addEventListener('click',()=>paint(host,b.dataset.chartRange)));
  }
}
function enhance(){
  const depot=document.getElementById('view-depot');
  if(!depot||!depot.classList.contains('is-active'))return;
  const card=depot.querySelector('.chart-card');
  if(!card||card.dataset.r10Chart==='1')return;
  card.dataset.r10Chart='1'; card.classList.add('depot-r10-chart');
  paint(card,'1d');
}
const observer=new MutationObserver(()=>queueMicrotask(enhance));
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
document.addEventListener('click',e=>{if(e.target.closest?.('[data-route="depot"]'))setTimeout(enhance,0)});
window.addEventListener('meridian:v8-tokenchange',()=>cache.clear());
setTimeout(enhance,0);
