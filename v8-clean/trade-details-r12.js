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
    coinQty:positive(b?.coinQty)??positive(b?.currentInvestmentCoin)??positive(b?.investmentCoin),
    gridCount:n(b?.gridCount)??n(b?.grids),
    rangeLow:positive(b?.rangeLow)??positive(b?.lowerPrice),
    rangeHigh:positive(b?.rangeHigh)??positive(b?.upperPrice),
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
function spotAtTp(data,bots){
  const spot=data?.portfolio?.assets||data?.portfolio?.holdings||data?.holdings||[];
  if(!Array.isArray(spot))return {total:0,rows:[]};
  const tpBySymbol=new Map(bots.filter(b=>Number.isFinite(b.tp)).map(b=>[b.symbol,b.tp]));
  const rows=spot.map(x=>{
    const symbol=String(x?.symbol||x?.asset||'').toUpperCase();
    const qty=positive(x?.quantity)??positive(x?.qty)??positive(x?.amount);
    const tp=tpBySymbol.get(symbol);
    const current=positive(data?.livePrices?.[symbol]?.price)??positive(x?.price);
    const valuation=Number.isFinite(qty)?qty*(tp||current||0):0;
    return {symbol,qty,tp:tp||null,current:current||null,valuation};
  }).filter(x=>x.qty&&x.valuation);
  return {total:rows.reduce((s,x)=>s+x.valuation,0),rows};
}
function hedgeAtTp(bots){
  const shorts=bots.filter(b=>b.side==='SHORT');
  const pnl=shorts.reduce((s,b)=>{
    if(!Number.isFinite(b.investment)||!Number.isFinite(b.current)||!Number.isFinite(b.tp))return s;
    return s;
  },0);
  return {count:shorts.length,pnl};
}
function coinCompounding(bots){
  const rows=bots.filter(b=>b.side==='LONG'&&Number.isFinite(b.coinQty)&&Number.isFinite(b.tp));
  if(!rows.length)return '';
  const body=rows.map(b=>{
    const bands=[0,.05,.10].map(x=>b.coinQty*(1+x));
    return `<div><span>${esc(b.symbol)} · ${b.leverage?b.leverage+'x':'LONG'}</span><b>${bands[0].toLocaleString('de-DE',{maximumFractionDigits:6})} → ${bands[1].toLocaleString('de-DE',{maximumFractionDigits:6})} → ${bands[2].toLocaleString('de-DE',{maximumFractionDigits:6})}</b><small>heute · Basis · volatiler Pfad · TP ${price(b.tp)}</small></div>`;
  }).join('');
  return `<details class="trade-r12-bot"><summary><div><b>COIN COMPOUNDING @ TP</b><small>Stückzahl-Projektion je Long-Bot</small></div><div class="trade-r12-summary-right"><strong>${rows.length}</strong><small>Assets/Bots</small></div></summary><div class="trade-r12-detail"><div class="trade-r12-grid">${body}</div><p class="trade-r12-hint">Basis/volatiler Pfad sind Szenariobänder (+5%/+10% Coin-Menge), keine garantierten Grid-Erträge. Sobald der private Backend-Verlauf ausgeführte Grids/Fees/Funding vollständig liefert, kann MERIDIAN die Bandbreite durch eine pfadbasierte COIN-M-Simulation ersetzen.</p></div></details>`;
}
function portfolioAtTp(data,bots){
  const longs=bots.filter(b=>b.side==='LONG'&&Number.isFinite(b.coinQty)&&Number.isFinite(b.tp));
  const botBase=longs.reduce((s,b)=>s+b.coinQty*b.tp,0);
  const spot=spotAtTp(data,bots);
  const base=botBase+spot.total;
  const rows=[['KONSERVATIV',0],['BASIS',.05],['VOLATILER GRID-PFAD',.10]];
  return `<details class="trade-r12-bot" open><summary><div><b>PORTFOLIO @ TP</b><small>Bots + erkannte Spot-Bestände</small></div><div class="trade-r12-summary-right"><strong>${usd(base,0)}</strong><small>vor Hedge-Anpassung</small></div></summary><div class="trade-r12-detail"><div class="trade-r12-grid"><div><span>BOT-COINS @ TP</span><b>${usd(botBase,0)}</b></div><div><span>SPOT @ BOT-TP</span><b>${usd(spot.total,0)}</b></div><div><span>BTC SHORT/HEDGE</span><b>${hedgeAtTp(bots).count} Positionen</b></div>${rows.map(([name,x])=>`<div><span>${name}</span><b>${usd(base+botBase*x,0)}</b><small>Grid-Band auf Bot-Anteil</small></div>`).join('')}</div><p class="trade-r12-hint">Spot-Coins werden mit ihrem Bot-TP bewertet, sofern vorhanden; sonst mit verfügbarem Livepreis. Hedge-PnL wird erst eingerechnet, wenn der private Backend-Datensatz Zielkurs/Positionsgröße eindeutig liefert. Keine Scheingenauigkeit.</p></div></details>`;
}
function tpProjection(bots){
  const rows=bots.filter(b=>b.side==='LONG'&&Number.isFinite(b.coinQty)&&Number.isFinite(b.tp));
  if(!rows.length)return '';
  const gross=rows.reduce((s,b)=>s+b.coinQty*b.tp,0);
  const scenarios=[['KONSERVATIV',0.00],['BASIS',0.05],['VOLATILER PFAD',0.10]];
  const cards=scenarios.map(([name,bonus])=>`<div><span>${name}</span><b>${usd(gross*(1+bonus),0)}</b><small>Coin-Basis + ${Math.round(bonus*100)}% Grid-Ertragsband*</small></div>`).join('');
  return `<details class="trade-r12-bot"><summary><div><b>TP PROJECTION</b><small>Long-Bots bis Take-Profit</small></div><div class="trade-r12-summary-right"><strong>${usd(gross,0)}</strong><small>Basiswert am TP</small></div></summary><div class="trade-r12-detail"><div class="trade-r12-grid">${cards}</div><p class="trade-r12-hint">*Szenarioband, keine Prognose. Tatsächlicher COIN-M Grid-Ertrag hängt vom Kurspfad, ausgeführten Grids, Gebühren und Funding ab. BTC-Hedges sowie externe Spot-Bestände werden separat bilanziert.</p></div></details>`;
}
function commander(bots){
  const states=bots.map(actionState);
  const longs=bots.filter(b=>b.side==='LONG').length,shorts=bots.filter(b=>b.side==='SHORT').length;
  const hold=states.filter(s=>s==='HOLD').length,watch=states.filter(s=>s==='WATCH PROFIT').length;
  const lock=states.filter(s=>s==='PROFIT LOCK CANDIDATE').length,risk=states.filter(s=>s==='RISK REVIEW').length;
  const unverified=states.filter(s=>s==='DATA UNVERIFIED').length;
  const verified=bots.filter((b,i)=>states[i]!=='DATA UNVERIFIED'&&Number.isFinite(b.buffer));
  const critical=verified.sort((a,b)=>a.buffer-b.buffer)[0]||null;
  const status=risk?'RISK REVIEW':lock?'PROFIT LOCK':watch?'WATCH PROFIT':unverified?'DATA CHECK':'HOLD';
  const criticalText=critical?`${critical.symbol} ${pct(critical.buffer)}`:'—';
  return `<div class="trade-r12-commander tone-border-${risk?'danger':watch||lock||unverified?'watch':'safe'}"><div class="eyebrow">BOT COMMANDER · 15M</div><div class="trade-r12-grid"><div><span>STATUS</span><b>${esc(status)}</b></div><div><span>EXPOSURE</span><b>${longs} Long · ${shorts} Hedge/Short</b></div><div><span>HOLD</span><b>${hold}</b></div><div><span>WATCH / LOCK</span><b>${watch} / ${lock}</b></div><div><span>RISK REVIEW</span><b>${risk}</b></div><div><span>DATA CHECK</span><b>${unverified}</b></div><div><span>ENGSTER LIQ-PUFFER</span><b>${esc(criticalText)}</b></div></div><p class="trade-r12-hint">TP-or-Invalidation · keine Aktion bei normalem Rauschen · nur bestätigte Statuswechsel</p></div>`;
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
    compact.innerHTML=`${commander(bots)}${portfolioAtTp(data,bots)}${coinCompounding(bots)}${tpProjection(bots)}<div class="eyebrow">AKTIVE BOTS · DETAILS AUF ABRUF</div><p class="trade-r12-hint">15m Monitor · TP-or-Invalidation · nur neue handlungsrelevante Statuswechsel · Current / BE / Liq / TP / Grid vs Trend</p>${bots.map(card).join('')}`;
  }catch(_e){/* keep canonical compact TRADE card intact on read failure */}
}

const observer=new MutationObserver(()=>queueMicrotask(enhance));
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
document.addEventListener('click',e=>{if(e.target.closest?.('[data-route="trade"]'))setTimeout(enhance,0)});
window.addEventListener('meridian:v8-tokenchange',()=>{cache={at:0,data:null};setTimeout(enhance,0)});
setTimeout(enhance,0);
