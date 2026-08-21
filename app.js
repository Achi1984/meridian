
const state = {
  data: null,
  prices: {},
  changes: {},
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

function money(v,d=0){
  return '$'+Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
}
function eur(v){ return '≈ €'+Number(v).toLocaleString('de-DE',{maximumFractionDigits:0});}
function pct(v){ return (v>=0?'+':'−')+Math.abs(v).toFixed(1).replace('.',',')+'%';}
function shortQty(v){
  if(v>=1000) return v.toLocaleString('de-DE',{maximumFractionDigits:4});
  return v.toLocaleString('de-DE',{maximumFractionDigits:8});
}

async function load(){
  try {
    const r = await fetch('./data.json', {cache:'no-store'});
    if(!r.ok) throw new Error('data.json: HTTP '+r.status);
    state.data = await r.json();
    restoreSnapshot();
    renderAll();
    registerSW();
  } catch (err) {
    console.error('MERIDIAN startup failed', err);
    const el=document.getElementById('portfolioUsd');
    if(el) el.textContent='Datenfehler';
  }
}

function restoreSnapshot(){
  state.prices = {};
  for(const [venue,v] of Object.entries(state.data.venues)){
    for(const [coin,p] of Object.entries(v.positions||{})){
      if(!state.prices[coin] && p.qty) state.prices[coin] = p.value/p.qty;
    }
  }
  state.changes = {...state.data.fallbackChanges24h};
  state.lastUpdated = new Date(state.data.snapshotAt);
}

function currentValue(coin, pos){
  const px = state.prices[coin];
  return px && pos.qty ? pos.qty*px : pos.value;
}

function buildAggregates(){
  const assets = {};
  const venues = {};
  let total = 0;

  for(const [venueName,venue] of Object.entries(state.data.venues)){
    let vv = venue.cash || 0;
    for(const [coin,pos] of Object.entries(venue.positions||{})){
      const val = currentValue(coin,pos);
      vv += val;
      assets[coin] = (assets[coin]||0)+val;
    }
    venues[venueName]=vv;
    total += vv;
  }
  return {assets,venues,total};
}

function conic(items,colors){
  const total=items.reduce((s,x)=>s+x[1],0)||1;
  let cur=0,parts=[];
  items.forEach((x,i)=>{
    const p=x[1]/total*100;
    parts.push(`${colors[i]} ${cur.toFixed(3)}% ${(cur+p).toFixed(3)}%`);
    cur += p;
  });
  return `conic-gradient(${parts.join(',')})`;
}

function weighted24h(assets,total){
  let n=0,d=0;
  for(const [coin,val] of Object.entries(assets)){
    if(Number.isFinite(state.changes[coin])){
      n += val*state.changes[coin];
      d += val;
    }
  }
  const p = d?n/d:0;
  return {pct:p,usd:total*p/100};
}

function renderDepot(){
  const {assets,venues,total}=buildAggregates();
  const sorted=Object.entries(assets).sort((a,b)=>b[1]-a[1]);
  const day=weighted24h(assets,total);

  document.getElementById('portfolioUsd').textContent=money(total);
  document.getElementById('portfolioEur').textContent=eur(total*state.data.eurRate);
  document.getElementById('portfolio24h').textContent=`${pct(day.pct)} (24h)`;
  document.getElementById('portfolio24hUsd').textContent=`≈ ${day.usd>=0?'+':'−'}${money(Math.abs(day.usd))}`;
  document.getElementById('assetCount').textContent=sorted.length;
  document.getElementById('largestAsset').textContent=sorted.length?`${sorted[0][0]} ${(sorted[0][1]/total*100).toFixed(1)}%`:'—';

  // asset donut
  const shown=sorted.slice(0,5);
  const rest=sorted.slice(5).reduce((s,x)=>s+x[1],0);
  if(rest>0) shown.push(['REST',rest]);
  document.getElementById('assetDonut').style.background=conic(shown,assetColors);
  document.getElementById('assetDonutTotal').textContent=money(total);
  document.getElementById('assetLegend').innerHTML=shown.map((x,i)=>`
    <div class="legend-row"><span><i class="dot" style="background:${assetColors[i]}"></i>${x[0]}</span><b>${(x[1]/total*100).toFixed(1)}%</b></div>
  `).join('');

  // venue donut/cards
  const vi=Object.entries(venues);
  document.getElementById('venueDonut').style.background=conic(vi,vi.map(x=>venueColors[x[0]]));
  document.getElementById('venueLegend').innerHTML=vi.map(x=>`
    <div class="legend-row"><span><i class="dot" style="background:${venueColors[x[0]]}"></i>${x[0]}</span><b>${(x[1]/total*100).toFixed(1)}%</b></div>
  `).join('');
  document.getElementById('venueCards').innerHTML=vi.map(x=>`
    <div class="venue-card">
      <div class="venue-name"><i class="dot" style="background:${venueColors[x[0]]}"></i>${x[0]}</div>
      <div class="venue-value">${money(x[1])}</div>
      <div class="venue-share" style="color:${venueColors[x[0]]}">${(x[1]/total*100).toFixed(1)}%</div>
      <div class="bar"><i style="width:${(x[1]/total*100).toFixed(1)}%;background:${venueColors[x[0]]}"></i></div>
    </div>
  `).join('');

  // top5
  const dominant={};
  for(const [vn,v] of Object.entries(state.data.venues)){
    for(const [coin,p] of Object.entries(v.positions||{})){
      const val=currentValue(coin,p);
      if(!dominant[coin] || val>dominant[coin].value) dominant[coin]={venue:vn,value:val};
    }
  }
  document.getElementById('top5Body').innerHTML=sorted.slice(0,5).map((x,i)=>{
    const ch=state.changes[x[0]];
    return `<tr>
      <td>${i+1}</td><td><b>${x[0]}</b></td><td>${dominant[x[0]]?.venue||'—'}</td>
      <td>${money(x[1])}</td><td>${(x[1]/total*100).toFixed(1)}%</td>
      <td style="color:${ch==null?'var(--dim)':ch>=0?'var(--green)':'var(--red)'}">${ch==null?'—':pct(ch)}</td>
    </tr>`;
  }).join('');

  const moves=sorted.filter(x=>Number.isFinite(state.changes[x[0]])).map(x=>[x[0],state.changes[x[0]]]);
  const best=moves.length?moves.reduce((a,b)=>b[1]>a[1]?b:a):['—',0];
  const worst=moves.length?moves.reduce((a,b)=>b[1]<a[1]?b:a):['—',0];
  const vals=moves.map(x=>x[1]), mean=vals.reduce((a,b)=>a+b,0)/(vals.length||1);
  const vol=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/(vals.length||1));

  document.getElementById('mini24h').textContent=pct(day.pct);
  document.getElementById('mini24hUsd').textContent=(day.usd>=0?'+':'−')+money(Math.abs(day.usd));
  document.getElementById('bestCoin').textContent=best[0];
  document.getElementById('bestMove').textContent=pct(best[1]);
  document.getElementById('worstCoin').textContent=worst[0];
  document.getElementById('worstMove').textContent=pct(worst[1]);
  document.getElementById('volatility').textContent=vol.toFixed(2).replace('.',',')+'%';

  // details
  const rows=[];
  for(const [venueName,venue] of Object.entries(state.data.venues)){
    for(const [coin,p] of Object.entries(venue.positions||{})){
      rows.push(`<div class="position-row">
        <div><strong>${coin}</strong><br><small>${venueName}${p.label?' · '+p.label:''}</small></div>
        <div style="text-align:right"><strong>${money(currentValue(coin,p),2)}</strong><br><small>${shortQty(p.qty)} ${p.label||coin}</small></div>
      </div>`);
    }
  }
  document.getElementById('positionsList').innerHTML=rows.join('');

  const bots=state.data.venues.Pionex.bots||[];
  document.getElementById('botsList').innerHTML=bots.map(b=>`
    <div class="bot-card">
      <div class="bot-head"><strong>${b.name}</strong><span class="bot-tag">${b.side} ${b.leverage}x</span></div>
      <div class="bot-grid">
        <div class="bot-kpi"><span>Investition</span><b>${b.investment} USDT</b></div>
        <div class="bot-kpi"><span>Dyn. Margin</span><b>${b.dynamicMargin} USDT</b></div>
        <div class="bot-kpi"><span>Gesamt Profit</span><b style="color:var(--red)">${b.pnl} USDT</b></div>
        <div class="bot-kpi"><span>Grid Profit</span><b style="color:var(--green)">+${b.gridProfit}</b></div>
        <div class="bot-kpi"><span>Break-even</span><b>${money(b.breakEven,1)}</b></div>
        <div class="bot-kpi"><span>Liquidation</span><b>${money(b.liq,1)}</b></div>
      </div>
    </div>
  `).join('');
}

function renderMarket(){
  const {assets}=buildAggregates();
  const btc=state.changes.BTC||0;
  const regime=btc>2?'RISK-ON':btc<-2?'RISK-OFF':'NEUTRAL';
  document.getElementById('marketRegime').textContent=regime;
  document.getElementById('regimeDot').style.left=regime==='RISK-ON'?'82%':regime==='RISK-OFF'?'18%':'50%';

  const rows=Object.keys(assets).filter(c=>Number.isFinite(state.changes[c]))
    .sort((a,b)=>state.changes[b]-state.changes[a]).slice(0,12);
  document.getElementById('marketRadar').innerHTML=rows.map(c=>`
    <div class="radar-row"><div><strong>${c}</strong><br><small>${state.changes[c]>=3?'Momentum positiv':state.changes[c]<=-3?'Momentum negativ':'Neutral'}</small></div>
    <b style="color:${state.changes[c]>=0?'var(--green)':'var(--red)'}">${pct(state.changes[c])}</b></div>
  `).join('');
}

function renderBoden(){
  const b=state.data.boden;
  const valuation=Math.max(0,Math.min(100,100-((b.mvrv-0.5)/(3-0.5))*100));
  const capitulation=Math.max(0,Math.min(100,(75-b.fearGreed)/65*100));
  const holder=50;
  const timing=55;
  document.getElementById('nadirGrid').innerHTML=[
    ['Bewertung',valuation],['Kapitulation',capitulation],['Holder',holder],['Timing',timing]
  ].map(x=>`<div class="nadir-card"><span>${x[0]}</span><b>${Math.round(x[1])}/100</b></div>`).join('');
}

function renderTrade(){
  const d=state.data.daytrade;
  document.getElementById('tradeGrid').innerHTML=[
    ['BTC Preis',money(d.btcPrice)],['4H RSI',d.rsi4h],['1H RSI',d.rsi1h],['Funding',d.funding+'%'],
    ['OI','$'+d.oi+'B'],['VWAP',money(d.vwap)]
  ].map(x=>`<div class="trade-kpi"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');

  const checks=[
    ['Datenfrische','Snapshot · manuell prüfen','warn'],
    ['MTF-Konfluenz','bullish','pass'],
    ['Entry-Streckung',`4H RSI ${d.rsi4h} → überdehnt`,'fail'],
    ['Liquidationspuffer',money(d.liqAbove),'warn']
  ];
  document.getElementById('tradeChecks').innerHTML=checks.map(x=>`
    <div class="check-row"><span>${x[0]}</span><b style="color:${x[2]==='pass'?'var(--green)':x[2]==='fail'?'var(--red)':'var(--amber)'}">${x[1]}</b></div>
  `).join('');
}

function renderSettings(){
  const d=state.data;
  const rows=[
    ['Snapshot',new Date(d.snapshotAt).toLocaleString('de-DE')],
    ['Bitpanda','exakt · Screenshot'],
    ['OKX','exakt · Screenshot'],
    ['Ledger','exakt sichtbar · Screenshot'],
    ['Pionex','exakt · Screenshot']
  ];
  document.getElementById('dataStatus').innerHTML=rows.map(x=>`<div class="status-row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
  document.getElementById('updatedPill').textContent='↻ '+state.lastUpdated.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
}

function renderAll(){
  renderDepot();renderMarket();renderBoden();renderTrade();renderSettings();
}

async function refreshPrices(){
  const btn=document.getElementById('refreshPrices');
  btn.disabled=true;btn.textContent='Aktualisiere…';
  try{
    const ids=[...new Set(Object.values(cgMap))].join(',');
    const url=`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const res=await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const j=await res.json();
    for(const [coin,id] of Object.entries(cgMap)){
      if(j[id]?.usd) state.prices[coin]=j[id].usd;
      if(Number.isFinite(j[id]?.usd_24h_change)) state.changes[coin]=j[id].usd_24h_change;
    }
    state.lastUpdated=new Date();
    renderAll();
    btn.textContent='✓ Aktualisiert';
  }catch(e){
    btn.textContent='Fehler – Snapshot bleibt aktiv';
  }
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

function registerSW(){
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
}

document.getElementById('refreshPrices').addEventListener('click',refreshPrices);
document.getElementById('resetSnapshot').addEventListener('click',()=>{restoreSnapshot();renderAll()});
setupTabs();
load();
