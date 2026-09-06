import {getJson} from './data.js';

const root=()=>document.getElementById('view-paper');
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const fmt=(v,d=2)=>num(v)==null?'—':Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
const usd=v=>num(v)==null?'—':`${Number(v)<0?'−':''}$${Math.abs(Math.round(Number(v))).toLocaleString('de-DE')}`;
const pct=v=>num(v)==null?'—':`${fmt(v,1)}%`;

function bestRows(map={},limit=3){
  return Object.entries(map)
    .map(([key,x])=>({key,challenger:x?.challenger||{},baseline:x?.baseline||{},delta:x?.delta||{}}))
    .filter(x=>num(x.challenger?.trades)>0)
    .sort((a,b)=>(num(b.delta?.expectancy)||-999)-(num(a.delta?.expectancy)||-999))
    .slice(0,limit);
}
function rowHtml(x){
  const c=x.challenger,b=x.baseline,d=x.delta;
  const tone=(num(c.expectancy)||0)>0?'safe':(num(c.expectancy)||0)<0?'danger':'muted';
  const adequate=c.adequate===true?'N OK':'N LOW';
  return `<div class="cohort-r18-row"><div><b>${x.key}</b><small>${adequate} · ${c.trades??0} trades</small></div><div><span class="tone-${tone}">EXP ${usd(c.expectancy)}</span><small>PF ${fmt(c.profitFactor,2)} · ΔEXP ${usd(d.expectancy)}</small></div></div>`;
}
function block(title,map){
  const rows=bestRows(map);
  return `<div class="cohort-r18-block"><div class="cohort-r18-title">${title}</div>${rows.length?rows.map(rowHtml).join(''):'<small class="muted">Noch keine belastbare Kohorte.</small>'}</div>`;
}
function render(deep){
  const el=root(); if(!el||!deep)return;
  let card=document.getElementById('paperCohortR18');
  if(!card){card=document.createElement('section');card.id='paperCohortR18';card.className='card cohort-r18';el.appendChild(card)}
  const sum=deep.summary||{},c=sum.challenger||{},b=sum.baseline||{};
  card.innerHTML=`<div class="eyebrow">CHALLENGER V2 · COHORT DEEP DIVE</div>
    <div class="cohort-r18-summary"><div><span>CHALLENGER</span><b>${usd(c.pnl)}</b><small>EXP ${usd(c.expectancy)} · PF ${fmt(c.profitFactor,2)}</small></div><div><span>BASELINE</span><b>${usd(b.pnl)}</b><small>EXP ${usd(b.expectancy)} · PF ${fmt(b.profitFactor,2)}</small></div></div>
    ${block('SIDE',deep.bySide)}${block('REGIME',deep.byRegime)}${block('ASSET',deep.bySymbol)}
    <div class="cohort-r18-foot">Research only · Kohorten mit n&lt;8 sind nicht promotionsfähig · keine automatische Ausführungswirkung.</div>`;
}
let loading=false;
async function hydrate(){
  const el=root(); if(!el||loading||document.getElementById('paperCohortR18'))return;
  loading=true;
  try{const a=await getJson('/api/research-analytics');render(a?.deepDive)}catch(_e){}finally{loading=false}
}
const observer=new MutationObserver(()=>{if(document.getElementById('app')?.dataset?.view==='paper')queueMicrotask(hydrate)});
if(root())observer.observe(root(),{childList:true,subtree:false});
document.getElementById('mainNav')?.addEventListener('click',e=>{if(e.target.closest('[data-route="paper"]'))setTimeout(hydrate,0)});
window.addEventListener('meridian:v8-tokenchange',()=>{document.getElementById('paperCohortR18')?.remove();hydrate()});
if(document.getElementById('app')?.dataset?.view==='paper')hydrate();
