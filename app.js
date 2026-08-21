
const state = {
  data: null,
  prices: {},
  changes: {},
  priceMeta: {},
  lastUpdated: null
};

const cgMap = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', XRP:'ripple', SUI:'sui', ADA:'cardano',
  FET:'artificial-superintelligence-alliance', HBAR:'hedera-hashgraph', DOT:'polkadot',
  ATOM:'cosmos', NEAR:'near', AVAX:'avalanche-2', TAO:'bittensor',
  INJ:'injective-protocol', PEPE:'pepe', XLM:'stellar'
};

const assetColors = ['#f59e0b','#4a90e2','#35c9bf','#8b74d8','#5bbf8a','#768190'];
const venueColors = {Bitpanda:'#34c978',OKX:'#3f83f8',Ledger:'#9b82ff',Pionex:'#ef5350'};
const HISTORY_KEY='meridian_portfolio_history_v3';

function money(v,d=0){
  return '$'+Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
}
function eur(v){ return '≈ €'+Number(v).toLocaleString('de-DE',{maximumFractionDigits:0});}
function pct(v){ return (v>=0?'+':'−')+Math.abs(v).toFixed(1).replace('.',',')+'%';}
function shortQty(v){
  if(v>=1000) return v.toLocaleString('de-DE',{maximumFractionDigits:4});
  return v.toLocaleString('de-DE',{maximumFractionDigits:8});
}
function fmtTime(d){return d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});}
function ageLabel(ts){
  const mins=Math.round((Date.now()-new Date(ts).getTime())/60000);
  if(mins<2)return 'gerade eben';
  if(mins<60)return `${mins} min`;
  const h=Math.round(mins/60); if(h<48)return `${h} h`;
  return new Date(ts).toLocaleDateString('de-DE');
}

async function load(){
  try{
    const r=await fetch('./data.json?v=3',{cache:'no-store'});
    if(!r.ok)throw new Error('data.json HTTP '+r.status);
    state.data=await r.json();
    restoreSnapshot();
    renderAll();
    recordHistory();
    registerSW();
  }catch(err){
    console.error(err);
    document.getElementById('portfolioUsd').textContent='Datenfehler';
  }
}

function restoreSnapshot(){
  state.prices={}; state.priceMeta={};
  for(const [venueName,v] of Object.entries(state.data.venues)){
    for(const [coin,p] of Object.entries(v.positions||{})){
      if(!state.prices[coin] && p.qty){
        state.prices[coin]=(p.snapshotUnitPrice||p.value/p.qty);
        state.priceMeta[coin]={source:'Snapshot',updatedAt:p.snapshotAt||v.snapshotAt||state.data.snapshotAt};
      }
    }
  }
  state.changes={...state.data.fallbackChanges24h};
  state.lastUpdated=new Date(state.data.snapshotAt);
}

function priceFor(coin){ return state.prices[coin]||null; }
function currentValue(coin,pos){
  const px=priceFor(coin);
  return px && pos.qty ? pos.qty*px : (pos.snapshotValue ?? pos.value);
}

function buildAggregates(){
  const assets={},venues={}; let total=0,liveValue=0,snapshotValue=0;
  for(const [venueName,venue] of Object.entries(state.data.venues)){
    let vv=venue.cash||0;
    if(venue.cash) snapshotValue+=venue.cash;
    for(const [coin,pos] of Object.entries(venue.positions||{})){
      const val=currentValue(coin,pos);
      vv+=val; assets[coin]=(assets[coin]||0)+val;
      if(state.priceMeta[coin]?.source==='Live'){liveValue+=val}else{snapshotValue+=val}
    }
    venues[venueName]=vv; total+=vv;
  }
  return {assets,venues,total,liveValue,snapshotValue};
}

function weighted24h(assets,total){
  let n=0,d=0;
  for(const [coin,val] of Object.entries(assets)){
    if(Number.isFinite(state.changes[coin])){n+=val*state.changes[coin];d+=val;}
  }
  const p=d?n/d:0; return {pct:p,usd:total*p/100,coverage:total?d/total*100:0};
}

function conic(items,colors){
  const total=items.reduce((s,x)=>s+x[1],0)||1;let cur=0,parts=[];
  items.forEach((x,i)=>{const p=x[1]/total*100;parts.push(`${colors[i]} ${cur.toFixed(3)}% ${(cur+p).toFixed(3)}%`);cur+=p;});
  return `conic-gradient(${parts.join(',')})`;
}

function getHistory(){
  try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');}catch(e){return []}
}
function setHistory(h){localStorage.setItem(HISTORY_KEY,JSON.stringify(h.slice(-96)));}
function recordHistory(){
  const {total}=buildAggregates(); if(!total)return;
  let h=getHistory(); const now=Date.now();
  if(!h.length || now-h[h.length-1].t>10*60*1000){
    h.push({t:now,v:total}); setHistory(h);
  }
  renderHistory();
}
function renderHistory(){
  const h=getHistory();
  const line=document.getElementById('historyLine'),area=document.getElementById('historyArea'),label=document.getElementById('historyLabel');
  if(!line||!area)return;
  if(h.length<2){line.setAttribute('d','');area.setAttribute('d','');label.textContent='ab jetzt lokal aufgezeichnet';return;}
  const vals=h.map(x=>x.v), min=Math.min(...vals), max=Math.max(...vals), span=(max-min)||1;
  const pts=h.map((x,i)=>[i/(h.length-1)*320,82-(x.v-min)/span*70]);
  const d='M'+pts.map(p=>p.map(n=>n.toFixed(1)).join(' ')).join(' L');
  line.setAttribute('d',d);
  area.setAttribute('d',d+` L 320 90 L 0 90 Z`);
  const diff=h[h.length-1].v-h[0].v, pctv=diff/h[0].v*100;
  label.textContent=`${diff>=0?'+':'−'}${money(Math.abs(diff))} · ${pct(pctv)} seit ${new Date(h[0].t).toLocaleDateString('de-DE')}`;
}

function renderDepot(){
  const {assets,venues,total,liveValue}=buildAggregates();
  const sorted=Object.entries(assets).sort((a,b)=>b[1]-a[1]),day=weighted24h(assets,total);

  portfolioUsd.textContent=money(total); portfolioEur.textContent=eur(total*state.data.eurRate);
  portfolio24h.textContent=`${pct(day.pct)} (24h)`;
  portfolio24hUsd.textContent=`≈ ${day.usd>=0?'+':'−'}${money(Math.abs(day.usd))}`;
  assetCount.textContent=sorted.length;
  largestAsset.textContent=sorted.length?`${sorted[0][0]} ${(sorted[0][1]/total*100).toFixed(1)}%`:'—';
  const livePct=total?liveValue/total*100:0;
  coverageMetric.textContent=`${livePct.toFixed(0)}% live`;
  coverageMetric.className=livePct>80?'good':'warn';

  const shown=sorted.slice(0,5),rest=sorted.slice(5).reduce((s,x)=>s+x[1],0); if(rest>0)shown.push(['REST',rest]);
  assetDonut.style.background=conic(shown,assetColors); assetDonutTotal.textContent=money(total);
  assetLegend.innerHTML=shown.map((x,i)=>`<div class="legend-row"><span><i class="dot" style="background:${assetColors[i]}"></i>${x[0]}</span><b>${(x[1]/total*100).toFixed(1)}%</b></div>`).join('');

  const vi=Object.entries(venues);
  venueDonut.style.background=conic(vi,vi.map(x=>venueColors[x[0]]));
  venueLegend.innerHTML=vi.map(x=>`<div class="legend-row"><span><i class="dot" style="background:${venueColors[x[0]]}"></i>${x[0]}</span><b>${(x[1]/total*100).toFixed(1)}%</b></div>`).join('');
  venueCards.innerHTML=vi.map(x=>`<div class="venue-card"><div class="venue-name"><i class="dot" style="background:${venueColors[x[0]]}"></i>${x[0]}</div><div class="venue-value">${money(x[1])}</div><div class="venue-share" style="color:${venueColors[x[0]]}">${(x[1]/total*100).toFixed(1)}%</div><div class="bar"><i style="width:${(x[1]/total*100).toFixed(1)}%;background:${venueColors[x[0]]}"></i></div></div>`).join('');

  const dominant={};
  for(const [vn,v] of Object.entries(state.data.venues)){
    for(const [coin,p] of Object.entries(v.positions||{})){
      const val=currentValue(coin,p);
      if(!dominant[coin]||val>dominant[coin].value)dominant[coin]={venue:vn,value:val};
    }
  }
  top5Body.innerHTML=sorted.slice(0,5).map((x,i)=>{
    const ch=state.changes[x[0]];
    return `<tr><td>${i+1}</td><td><b>${x[0]}</b></td><td>${dominant[x[0]]?.venue||'—'}</td><td>${money(x[1])}</td><td>${(x[1]/total*100).toFixed(1)}%</td><td style="color:${ch==null?'var(--dim)':ch>=0?'var(--green)':'var(--red)'}">${ch==null?'—':pct(ch)}</td></tr>`;
  }).join('');

  const moves=sorted.filter(x=>Number.isFinite(state.changes[x[0]])).map(x=>[x[0],state.changes[x[0]]]);
  const best=moves.length?moves.reduce((a,b)=>b[1]>a[1]?b:a):['—',0],worst=moves.length?moves.reduce((a,b)=>b[1]<a[1]?b:a):['—',0];
  const vals=moves.map(x=>x[1]),mean=vals.reduce((a,b)=>a+b,0)/(vals.length||1),vol=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/(vals.length||1));
  mini24h.textContent=pct(day.pct); mini24hUsd.textContent=(day.usd>=0?'+':'−')+money(Math.abs(day.usd));
  bestCoin.textContent=best[0];bestMove.textContent=pct(best[1]);worstCoin.textContent=worst[0];worstMove.textContent=pct(worst[1]);volatility.textContent=vol.toFixed(2).replace('.',',')+'%';

  const rows=[];
  for(const [venueName,venue] of Object.entries(state.data.venues)){
    for(const [coin,p] of Object.entries(venue.positions||{})){
      const meta=state.priceMeta[coin]||{source:'Snapshot',updatedAt:p.snapshotAt};
      const cls=meta.source==='Live'?'live':'snapshot';
      rows.push(`<div class="position-row"><div class="position-meta"><strong>${coin}</strong><small>${venueName}${p.label?' · '+p.label:''}</small><span class="source-chip ${cls}">${meta.source} · ${ageLabel(meta.updatedAt)}</span></div><div class="position-right"><strong>${money(currentValue(coin,p),2)}</strong><br><small>${shortQty(p.qty)} ${p.label||coin}</small></div></div>`);
    }
  }
  positionsList.innerHTML=rows.join('');

  const bots=state.data.venues.Pionex.bots||[];
  botsList.innerHTML=bots.map(b=>`<div class="bot-card"><div class="bot-head"><strong>${b.name}</strong><span class="bot-tag">${b.side} ${b.leverage}x</span></div><div class="bot-grid"><div class="bot-kpi"><span>Investition</span><b>${b.investment} USDT</b></div><div class="bot-kpi"><span>Dyn. Margin</span><b>${b.dynamicMargin} USDT</b></div><div class="bot-kpi"><span>Gesamt Profit</span><b style="color:var(--red)">${b.pnl} USDT</b></div><div class="bot-kpi"><span>Grid Profit</span><b style="color:var(--green)">+${b.gridProfit}</b></div><div class="bot-kpi"><span>Break-even</span><b>${money(b.breakEven,1)}</b></div><div class="bot-kpi"><span>Liquidation</span><b>${money(b.liq,1)}</b></div></div></div>`).join('');
  renderHistory();
}

function renderMarket(){
  const {assets}=buildAggregates(),btc=state.changes.BTC||0,regime=btc>2?'RISK-ON':btc<-2?'RISK-OFF':'NEUTRAL';
  marketRegime.textContent=regime;regimeDot.style.left=regime==='RISK-ON'?'82%':regime==='RISK-OFF'?'18%':'50%';
  const rows=Object.keys(assets).filter(c=>Number.isFinite(state.changes[c])).sort((a,b)=>state.changes[b]-state.changes[a]).slice(0,12);
  marketRadar.innerHTML=rows.map(c=>`<div class="radar-row"><div><strong>${c}</strong><br><small>${state.changes[c]>=3?'Momentum positiv':state.changes[c]<=-3?'Momentum negativ':'Neutral'}</small></div><b style="color:${state.changes[c]>=0?'var(--green)':'var(--red)'}">${pct(state.changes[c])}</b></div>`).join('');
}

function renderBoden(){
  const b=state.data.boden,valuation=Math.max(0,Math.min(100,100-((b.mvrv-0.5)/(3-0.5))*100)),capitulation=Math.max(0,Math.min(100,(75-b.fearGreed)/65*100));
  nadirGrid.innerHTML=[['Bewertung',valuation],['Kapitulation',capitulation],['Holder',50],['Timing',55]].map(x=>`<div class="nadir-card"><span>${x[0]}</span><b>${Math.round(x[1])}/100</b></div>`).join('');
}

function renderTrade(){
  const d=state.data.daytrade;
  tradeGrid.innerHTML=[['BTC Preis',money(d.btcPrice)],['4H RSI',d.rsi4h],['1H RSI',d.rsi1h],['Funding',d.funding+'%'],['OI','$'+d.oi+'B'],['VWAP',money(d.vwap)]].map(x=>`<div class="trade-kpi"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
  const checks=[['Datenfrische','Snapshot · prüfen','warn'],['MTF-Konfluenz','bullish','pass'],['Entry-Streckung',`4H RSI ${d.rsi4h} → überdehnt`,'fail'],['Liquidationspuffer',money(d.liqAbove),'warn']];
  tradeChecks.innerHTML=checks.map(x=>`<div class="check-row"><span>${x[0]}</span><b style="color:${x[2]==='pass'?'var(--green)':x[2]==='fail'?'var(--red)':'var(--amber)'}">${x[1]}</b></div>`).join('');
}

function renderSettings(){
  const {total,liveValue}=buildAggregates();
  const rows=[
    ['App-Version',state.data.appVersion||'3.0.0'],
    ['Letzter Refresh',state.lastUpdated.toLocaleString('de-DE')],
    ['Live bewertet',`${(total?liveValue/total*100:0).toFixed(0)}%`],
    ['Bitpanda','Screenshot + Live-Kurse'],
    ['OKX','Screenshot + Live-Kurse'],
    ['Ledger','Screenshot + Live-Kurse'],
    ['Pionex','Snapshot gebundenes Kapital']
  ];
  dataStatus.innerHTML=rows.map(x=>`<div class="status-row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
  updatedPill.textContent='↻ '+fmtTime(state.lastUpdated);
}

function renderAll(){renderDepot();renderMarket();renderBoden();renderTrade();renderSettings();}

async function refreshPrices(){
  const btn=refreshPrices;btn.disabled=true;btn.textContent='Aktualisiere…';
  try{
    const ids=[...new Set(Object.values(cgMap))].join(',');
    const url=`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const res=await fetch(url,{cache:'no-store'}); if(!res.ok)throw new Error('HTTP '+res.status);
    const j=await res.json(); const now=new Date().toISOString();
    for(const [coin,id] of Object.entries(cgMap)){
      if(j[id]?.usd){state.prices[coin]=j[id].usd;state.priceMeta[coin]={source:'Live',updatedAt:now};}
      if(Number.isFinite(j[id]?.usd_24h_change))state.changes[coin]=j[id].usd_24h_change;
    }
    state.lastUpdated=new Date();renderAll();recordHistory();btn.textContent='✓ Aktualisiert';
  }catch(e){console.error(e);btn.textContent='Fehler – Snapshot aktiv';}
  setTimeout(()=>{btn.disabled=false;btn.textContent='Live-Kurse aktualisieren'},1800);
}

function setupTabs(){
  document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{
    const tab=btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('tab-'+tab).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(n=>n.classList.toggle('active',n.dataset.tab===tab));
    window.scrollTo({top:0,behavior:'smooth'});
  }));
}

function registerSW(){if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js?v=3').catch(()=>{});}

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('refreshPrices').addEventListener('click',refreshPrices);
  document.getElementById('resetSnapshot').addEventListener('click',()=>{restoreSnapshot();renderAll();recordHistory();});
  setupTabs();load();
});
