// MERIDIAN v8 R17 — TRADE detail data hygiene
// Read-only presentation layer. No order, margin, stop, sizing or execution writes.
import {getJson} from './data.js';

const CACHE_MS=15000;
let cache={at:0,data:null};

function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function positive(v){const x=n(v);return x!=null&&x>0?x:null}
function explicitNumber(obj,keys){
  for(const key of keys){
    if(!Object.prototype.hasOwnProperty.call(obj||{},key))continue;
    const raw=obj?.[key];
    if(raw===null||raw===undefined||raw==='')continue;
    const x=Number(raw);
    if(Number.isFinite(x))return x;
  }
  return null;
}
function present(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))}
function usd(v,d=0){return present(v)?'$'+Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—'}
function pct(v,d=2){return present(v)?Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d})+'%':'—'}
function price(v){
  if(!present(v))return '—';
  const x=Number(v),digits=x<1?4:x<100?2:1;
  return '$'+x.toLocaleString('de-DE',{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function tone(buffer){return !Number.isFinite(buffer)?'muted':buffer<8?'danger':buffer<12?'watch':'safe'}
function state(buffer){return !Number.isFinite(buffer)?'CHECK':buffer<8?'DANGER':buffer<12?'WATCH':'SAFE'}
function normalizeBot(b,data){
  const symbol=String(b?.symbol||b?.asset||'').toUpperCase();
  return {
    id:String(b?.id||b?.botId||b?.name||symbol||'BOT'),symbol,
    side:String(b?.side||b?.direction||'').toUpperCase(),
    leverage:n(b?.leverage)??n(b?.leverageX),
    buffer:n(b?.pionexLiqBufferPct)??n(b?.liqBufferPct)??n(b?.liquidationDistancePct),
    liq:positive(b?.pionexLiquidationPrice)??positive(b?.liquidationPrice)??positive(b?.liqPrice),
    be:positive(b?.breakEvenPrice)??positive(b?.breakevenPrice),
    current:positive(data?.livePrices?.[symbol]?.price)??positive(b?.currentPrice)??positive(b?.markPrice),
    pnl:explicitNumber(b,['pnlUsd','unrealizedPnlUsd','pnl']),
    investment:positive(b?.investmentUsd)??positive(b?.investedUsd)??positive(b?.marginUsd),
    tp:positive(b?.takeProfit)??positive(b?.tp)??positive(b?.takeProfitPrice),
    strategyStatus:String(b?.strategyStatus||b?.actionStatus||'').toUpperCase(),
    trendPnl:explicitNumber(b,['trendPnlUsd','trendPnl']),
    gridPnl:explicitNumber(b,['gridPnlUsd','gridProfitUsd','gridPnl']),
    support:positive(b?.support)??positive(b?.keySupport),
    resistance:positive(b?.resistance)??positive(b?.keyResistance),
    dataVerified:b?.dataVerified!==false,
    sourceSpreadPct:n(b?.sourceSpreadPct)
  };
}
async function privateData(){
  if(cache.data&&Date.now()-cache.at<CACHE_MS)return cache.data;
  const payload=await getJson('/api/private/dashboard');
  const data=payload?.data||payload;
  cache={at:Date.now(),data};
  return data;
}
function actionState(b){
  if(b.dataVerified===false||(Number.isFinite(b.sourceSpreadPct)&&b.sourceSpreadPct>0.5))return 'DATA UNVERIFIED';
  const explicit=['HOLD','WATCH PROFIT','PROFIT LOCK CANDIDATE','RISK REVIEW'].includes(b.strategyStatus)?b.strategyStatus:null;
  if(explicit)return explicit;
  if(Number.isFinite(b.buffer)&&b.buffer<12)return 'RISK REVIEW';
  return 'HOLD';
}
function actionText(b){
  const s=actionState(b);
  if(s==='DATA UNVERIFIED')return 'Kein Aktionssignal · Quellenabweichung >0,50% oder Daten nicht verifiziert';
  if(s==='HOLD')return 'TP-or-Invalidation · laufen lassen';
  if(s==='WATCH PROFIT')return 'Gewinn beobachten · kein automatischer Exit';
  if(s==='PROFIT LOCK CANDIDATE')return 'Profit-Lock prüfen · technische Bestätigung erforderlich';
  return 'Risiko prüfen · Liq-Puffer / Marktstruktur';
}
function ladder(buffer){
  const safe=Number.isFinite(buffer)&&buffer>=12,watch=Number.isFinite(buffer)&&buffer>=8;
  return `<div class="trade-r12-ladder" aria-label="Liquidationspuffer Leiter"><span class="danger ${!watch?'on':''}">DANGER &lt;8%</span><span class="watch ${watch&&!safe?'on':''}">WATCH 8–12%</span><span class="safe ${safe?'on':''}">SAFE ≥12%</span></div>`;
}
function safeText(b){
  if(!Number.isFinite(b.buffer))return 'Buffer-Daten prüfen';
  if(b.buffer>=12)return `SAFE · ${pct(b.buffer)} Buffer`;
  const missing=12-b.buffer;
  return `Noch ${missing.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})} Pkt Buffer bis SAFE`;
}
function card(b,index){
  const t=tone(b.buffer),action=actionState(b),meta=[b.side,b.leverage!=null?`${b.leverage}x`:null,b.symbol].filter(Boolean).join(' · ')||'—';
  return `<details class="trade-r12-bot tone-border-${t}"${index===0?' open':''}><summary><div><b>${esc(b.id)}</b><small>${esc(meta)}</small></div><div class="trade-r12-summary-right"><strong class="tone-${t}">${pct(b.buffer)}</strong><small>${state(b.buffer)}</small></div></summary><div class="trade-r12-detail">${ladder(b.buffer)}<div class="trade-r12-grid"><div><span>CURRENT</span><b>${price(b.current)}</b></div><div><span>BREAK-EVEN</span><b>${price(b.be)}</b></div><div><span>LIQ PRICE</span><b>${price(b.liq)}</b></div><div><span>PNL</span><b class="${Number(b.pnl)>0?'tone-safe':Number(b.pnl)<0?'tone-danger':''}">${usd(b.pnl,2)}</b></div><div><span>INVEST</span><b>${usd(b.investment,0)}</b></div><div><span>BUFFER</span><b class="tone-${t}">${pct(b.buffer)}</b></div><div><span>TP</span><b>${price(b.tp)}</b></div><div><span>GRID PNL</span><b>${usd(b.gridPnl,2)}</b></div><div><span>TREND PNL</span><b>${usd(b.trendPnl,2)}</b></div><div><span>SUPPORT</span><b>${price(b.support)}</b></div><div><span>RESISTANCE</span><b>${price(b.resistance)}</b></div></div><div class="trade-r12-safe ${t}"><span>${esc(action)}</span><b>${esc(actionText(b))}</b></div><div class="trade-r12-safe ${t}"><span>SAFE-PFAD</span><b>${safeText(b)}</b></div></div></details>`;
}
async function enhance(){
  const root=document.getElementById('view-trade');
  if(!root||!root.classList.contains('is-active'))return;
  const compact=root.querySelector('.card.bots');
  if(!compact||compact.dataset.r12==='1')return;
  try{
    const data=await privateData();
    if(!root.classList.contains('is-active'))return;
    const raw=Array.isArray(data?.pionexRisk?.bots)?data.pionexRisk.bots:[];
    const bots=raw.map(b=>normalizeBot(b,data)).sort((a,b)=>(Number.isFinite(a.buffer)?a.buffer:999)-(Number.isFinite(b.buffer)?b.buffer:999));
    if(!bots.length)return;
    compact.dataset.r12='1';
    compact.classList.add('trade-r12-host');
    compact.innerHTML=`<div class="eyebrow">AKTIVE BOTS · DETAILS AUF ABRUF</div><p class="trade-r12-hint">15m Monitor · TP-or-Invalidation · nur neue handlungsrelevante Statuswechsel · Current / BE / Liq / TP / Grid vs Trend</p>${bots.map(card).join('')}`;
  }catch(_e){/* keep canonical compact TRADE card intact on read failure */}
}

const observer=new MutationObserver(()=>queueMicrotask(enhance));
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
document.addEventListener('click',e=>{if(e.target.closest?.('[data-route="trade"]'))setTimeout(enhance,0)});
window.addEventListener('meridian:v8-tokenchange',()=>{cache={at:0,data:null};setTimeout(enhance,0)});
setTimeout(enhance,0);
