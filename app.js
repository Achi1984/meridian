
const $=s=>document.querySelector(s);
const fmt=(n,d=0)=>new Intl.NumberFormat('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
let DATA=null,HISTORY={status:'browser-live',coins:{}},activeCoin='BTC';

const CG_IDS={
 BTC:'bitcoin',ETH:'ethereum',SOL:'solana',XRP:'ripple',SUI:'sui',ADA:'cardano',
 FET:'artificial-superintelligence-alliance',HBAR:'hedera-hashgraph',DOT:'polkadot',
 NEAR:'near',AVAX:'avalanche-2',ATOM:'cosmos',TAO:'bittensor',INJ:'injective-protocol',
 PEPE:'pepe',XLM:'stellar',VSN:'vision'
};
const HALVINGS=[
 new Date('2012-11-28T00:00:00Z').getTime(),
 new Date('2016-07-09T00:00:00Z').getTime(),
 new Date('2020-05-11T00:00:00Z').getTime(),
 new Date('2024-04-20T00:00:00Z').getTime()
];
const NEXT_HALVING_EST=new Date('2028-04-01T00:00:00Z').getTime();
const COIN_LAG_DAYS={BTC:0,ETH:14,SOL:28,XRP:35,SUI:42,ADA:35,FET:28,HBAR:35,DOT:35,NEAR:28,AVAX:28,ATOM:35,TAO:28,INJ:28,PEPE:42,XLM:35,VSN:42};

async function fetchJSON(url, timeout=12000){
 const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),timeout);
 try{
  const r=await fetch(url,{cache:'no-store',signal:ctrl.signal,headers:{'accept':'application/json'}});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return await r.json();
 } finally {clearTimeout(t)}
}
function cacheKey(sym){return 'meridian_history_'+sym+'_v3'}
function loadCache(sym){
 try{
  const x=JSON.parse(localStorage.getItem(cacheKey(sym))||'null');
  if(x?.candles?.length) return x;
 }catch(e){}
 return null;
}
function saveCache(sym,obj){
 try{localStorage.setItem(cacheKey(sym),JSON.stringify(obj))}catch(e){}
}
async function loadCoinHistory(sym,force=false){
 if(HISTORY.coins[sym]?.candles?.length && !force) return HISTORY.coins[sym];
 const cached=loadCache(sym);
 if(cached && !force){
   const age=Date.now()-(cached.savedAt||0);
   if(age<6*3600*1000){HISTORY.coins[sym]=cached;return cached}
 }
 const id=CG_IDS[sym]; if(!id) throw new Error('Kein Mapping');
 const url=`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`;
 try{
   const j=await fetchJSON(url);
   const candles=(j.prices||[]).map(([t,p])=>[t,p,p,p,p,0]);
   if(candles.length<30) throw new Error('Zu wenig Historie');
   const obj={source:'CoinGecko Browser',count:candles.length,candles,savedAt:Date.now()};
   HISTORY.coins[sym]=obj; saveCache(sym,obj); return obj;
 }catch(err){
   if(cached){HISTORY.coins[sym]=cached;return cached}
   throw err;
 }
}
async function refreshCurrentPortfolioPrices(){
 const symbols=[...new Set([
   ...(DATA.portfolio.holdings||[]).map(x=>x.symbol),
   ...(DATA.forecastCoins||[]),
   'PEPE','NEAR','DOT','HBAR'
 ])];
 const ids=symbols.map(s=>CG_IDS[s]).filter(Boolean);
 if(!ids.length) return;
 try{
   const j=await fetchJSON(
     `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&price_change_percentage=24h`
   );
   const byId={}; j.forEach(v=>byId[v.id]=v);
   DATA.livePrices={};
   DATA.assetIcons={};
   symbols.forEach(sym=>{
     const id=CG_IDS[sym], v=byId[id];
     if(v){
       DATA.livePrices[sym]={price:v.current_price,change24h:v.price_change_percentage_24h};
       if(v.image) DATA.assetIcons[sym]=v.image;
     }
   });
   recalcPortfolio();
 }catch(e){
   DATA.assetIcons=DATA.assetIcons||{};
 }
}

function recalcPortfolio(){
 const p=DATA.portfolio, hs=p.holdings||[];
 const priced=hs.map(h=>{const q=DATA.livePrices?.[h.symbol];return {...h,price:q?.price||0,change24h:q?.change24h||0,value:h.quantity*(q?.price||0)}});
 const liveSpotTotal=priced.reduce((a,h)=>a+h.value,0);
 if(!liveSpotTotal)return;

 const manualBalances=p.manualVenueBalances||[];
 const manualTotal=manualBalances.reduce((a,x)=>a+(Number(x.value)||0),0);
 const total=liveSpotTotal+manualTotal;

 const venues={};
 priced.forEach(h=>{venues[h.venue]=(venues[h.venue]||0)+h.value});
 manualBalances.forEach(x=>{venues[x.name]=(venues[x.name]||0)+(Number(x.value)||0)});

 p.total=total;
 p.eurApprox=total*0.86;
 p.custodiansCount=Object.keys(venues).filter(k=>venues[k]>0).length;
 p.byVenue=Object.entries(venues).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({
   name,value,sharePct:value/total*100,
   source:manualBalances.some(x=>x.name===name)?'SNAPSHOT':'LIVE'
 }));

 const coins={};
 priced.forEach(h=>{
   let c=coins[h.symbol]||(coins[h.symbol]={symbol:h.symbol,value:0,quantity:0,venues:new Set(),change24h:h.change24h});
   c.value+=h.value;c.quantity+=h.quantity;c.venues.add(h.venue)
 });
 const positions=Object.values(coins).sort((a,b)=>b.value-a.value);
 p.assetsCount=positions.length;
 p.largestPosition={symbol:positions[0].symbol,sharePct:positions[0].value/total*100};
 p.topPositions=positions.slice(0,5).map(x=>({
   symbol:x.symbol, venue:[...x.venues].join(' + '), value:x.value,
   sharePct:x.value/total*100, change24h:x.change24h, quantity:x.quantity
 }));

 p.performance24hPct=positions.reduce((a,x)=>a+(x.value/liveSpotTotal)*x.change24h,0);
 p.performance24hUsd=liveSpotTotal*(p.performance24hPct/100);
 const sorted=[...positions].sort((a,b)=>b.change24h-a.change24h);
 if(sorted.length){
   p.bestPerformer={symbol:sorted[0].symbol,change24h:sorted[0].change24h};
   p.worstPerformer={symbol:sorted.at(-1).symbol,change24h:sorted.at(-1).change24h}
 }
}

async function load(){
 const stamp=Date.now();
 DATA=await fetch('data.json?v='+stamp,{cache:'no-store'}).then(r=>r.json());
 await refreshCurrentPortfolioPrices();
 $('#versionBadge').textContent='v'+DATA.appVersion+' · '+DATA.build.slice(-4);
 $('#refreshTime').textContent='↻ '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
 renderAll();
 loadCoinHistory(activeCoin).then(()=>renderForecast()).catch(()=>renderForecast());
}
function card(inner,cls=''){return `<div class="card ${cls}">${inner}</div>`}
function coinIcon(sym){
 const img=DATA?.assetIcons?.[sym];
 if(img){
   return `<span class="coin-icon coin-real"><img src="${img}" alt="${sym}" loading="lazy" onerror="this.parentElement.classList.remove('coin-real');this.remove();this.parentElement.textContent='${sym==='BTC'?'₿':sym.slice(0,2)}'"></span>`;
 }
 return `<span class="coin-icon coin-${sym}">${sym==='BTC'?'₿':sym.slice(0,2)}</span>`;
}
function metric(label,value,cls=''){return `<div class="metric"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`}
function venueGradient(vs){let at=0;const cs=['#22aaff','#4a90ff','#9b7cff','#ff5b5b'];return 'conic-gradient('+vs.map((v,i)=>{const a=at;at+=v.sharePct;return `${cs[i%cs.length]} ${a}% ${at}%`}).join(',')+')'}
function donutVenue(){
 const p=DATA.portfolio;
 return card(`<div class="section-title">BÖRSE / WALLET</div><div class="grid2"><div style="position:relative"><div class="donut" style="background:${venueGradient(p.byVenue)}"></div><div class="donut-label">100%<small class="muted">Verteilung</small></div></div><div>${p.byVenue.map(v=>`<div class="row"><span>● ${v.name}</span><b>${fmt(v.sharePct,1)}%</b></div>`).join('')}</div></div>`);
}
function liveBadge(label='LIVE'){return `<span class="live-badge"><span class="live-dot"></span>${label}</span>`}
function snapshotBadge(){return `<span class="snapshot-badge">SNAPSHOT</span>`}

function depot(){
 const p=DATA.portfolio, r=DATA.pionexRisk;
 const venueCards=p.byVenue.map(v=>metric(
   v.name,
   `$${fmt(v.value)}<div class="${v.name==='Pionex'?'amber':'green'} venue-share">${fmt(v.sharePct,1)}%</div><div class="venue-source">${v.source==='SNAPSHOT'?snapshotBadge():liveBadge()}</div>`
 )).join('');

 const topRows=p.topPositions.map(x=>`
   <div class="position-row">
     ${coinIcon(x.symbol)}
     <div class="position-asset">
       <div class="position-symbol">${x.symbol}</div>
       <div class="position-venue">${x.venue} ${liveBadge()}</div>
       <div class="position-qty">${fmt(x.quantity, x.quantity<1?6:2)} ${x.symbol}</div>
     </div>
     <div class="position-value">
       <b>$${fmt(x.value)}</b>
       <small>${fmt(x.sharePct,1)}% Anteil</small>
     </div>
     <div class="position-change ${x.change24h<0?'red':''}">${x.change24h>=0?'+':''}${fmt(x.change24h,1)}%</div>
   </div>`).join('');

 const botCards=(r.bots||[]).map(b=>`
   <div class="pionex-bot">
     <div class="pionex-bot-head">
       <div><b>${b.name}</b><small>${b.side} · ${b.leverage}x</small></div>
       <div class="red">${fmt(b.totalProfit,2)} USDT</div>
     </div>
     <div class="pionex-grid">
       <div><span>Invest.</span><b>${fmt(b.investment,0)} USDT</b></div>
       <div><span>Grid</span><b class="green">+${fmt(b.gridProfit,2)}</b></div>
       <div><span>Trend</span><b class="red">${fmt(b.trendPnl,2)}</b></div>
       <div><span>Dyn. Margin</span><b>${fmt(b.dynamicMargin,2)}</b></div>
       <div><span>Liq.</span><b class="red">$${fmt(b.liquidation,1)}</b></div>
       <div><span>Abstand</span><b class="amber">${fmt(b.liquidationDistancePct,2)}%</b></div>
     </div>
     <div class="pionex-meta">Range $${fmt(b.rangeLow,1)}–$${fmt(b.rangeHigh,1)} · Funding ${fmt(b.fundingPct,4)}% · BE $${fmt(b.breakEven,1)}</div>
   </div>`).join('');

 return card(`<div class="hero">
      <div class="eyebrow">GESAMTPORTFOLIO</div>
      <div class="big">$${fmt(p.total)}</div><div class="sub">≈ €${fmt(p.eurApprox)}</div>
      <div class="grid2 portfolio-summary">
        ${metric('ASSETS',p.assetsCount)}${metric('VERWAHRSTELLEN',p.custodiansCount)}
        ${metric('GRÖSSTE POSITION',p.largestPosition.symbol+' '+fmt(p.largestPosition.sharePct,1)+'%')}
        ${metric('DATENMODUS',`iPhone ${liveBadge('LIVE')}`,'green')}
      </div>
    </div>`,'hero')+
    donutVenue()+
    `<div class="section-title venue-title">WERT NACH BÖRSE / WALLET</div>`+
    `<div class="grid2 venue-grid">${venueCards}</div>`+
    card(`<div class="section-head"><div class="section-title">TOP 5 POSITIONEN</div><span class="section-note">${liveBadge('LIVE')} nach Wert sortiert</span></div>${topRows}`,'positions-card')+
    `<div class="grid2 performance-grid">${metric('24H PERFORMANCE',(p.performance24hPct>=0?'+':'')+fmt(p.performance24hPct,1)+'%<div class="muted perf-sub">'+(p.performance24hUsd>=0?'+':'')+'$'+fmt(p.performance24hUsd)+'</div>',p.performance24hPct>=0?'green':'red')}${metric('BEST PERFORMER',p.bestPerformer.symbol+'<div class="muted perf-sub">'+(p.bestPerformer.change24h>=0?'+':'')+fmt(p.bestPerformer.change24h,1)+'%</div>')}${metric('WORST PERFORMER',p.worstPerformer.symbol+'<div class="muted perf-sub">'+fmt(p.worstPerformer.change24h,1)+'%</div>')}${metric('VOLATILITÄT',fmt(p.volatility24hPct,2)+'%<div class="muted perf-sub">24h Streuung</div>')}</div>`+
    card(`<div class="section-head"><div class="section-title">PIONEX FUTURES RISK</div><span class="section-note">SNAPSHOT</span></div>
      <div class="grid2 pionex-summary">
        ${metric('KONTOWERT','$'+fmt(r.accountValue,2),'amber')}
        ${metric('GESAMT BOT P&L',fmt(r.botPnl,2)+' USDT','red')}
        ${metric('DYN. MARGIN',fmt(r.dynamicMargin,2)+' USDT')}
        ${metric('NÄCHSTE LIQ.','$'+fmt(r.nextLiquidation,1)+'<div class="red perf-sub">'+fmt(r.liquidationDistancePct,2)+'%</div>','red')}
      </div>
      <div class="pionex-bots">${botCards}</div>
      <p class="footer-note">Pionex-Hauptkonto ist in der Depotverteilung enthalten. Futures-Risiko bleibt separat ausgewiesen.</p>
    `,'pionex-card');
}
function market(){
 const m=DATA.market;
 const radar=(DATA.portfolio.topPositions.concat([{symbol:'PEPE',change24h:25},{symbol:'NEAR',change24h:9.1},{symbol:'DOT',change24h:7.5},{symbol:'HBAR',change24h:6.4}])).sort((a,b)=>b.change24h-a.change24h);
 return card(`<div class="market-hero"><div><div class="eyebrow">MARKTREGIME</div><div class="forecast-main" style="font-size:30px">RISK-ON</div><div class="sub">BTC als Filter für Altcoin-Signale</div><div class="bar"><i style="width:82%"></i></div></div></div>`)+
 `<div class="grid2">${metric('MARKTBREITE',m.breadth,'cyan')}${metric('Ø 24H','+'+fmt(m.avg24hPct,1)+'%','cyan')}${metric('LEADER',m.leader.symbol+' +'+fmt(m.leader.change24h,1)+'%')}${metric('LAGGARD',m.laggard.symbol+' '+fmt(m.laggard.change24h,1)+'%','red')}</div>`+
 card(`<div class="section-title">RADAR <span class="muted" style="float:right;font-size:9px">24H MOMENTUM</span></div>${radar.map(x=>`<div class="asset-row">${coinIcon(x.symbol)}<div><div class="asset-name">${x.symbol}</div><div class="asset-desc">Momentum positiv</div></div><div></div><div class="asset-change">${x.change24h>=0?'+':''}${fmt(x.change24h,1)}%</div></div>`).join('')}`);
}
function bottomView(){
 const n=DATA.nadir;
 return card(`<div class="eyebrow">NADIR 2.0</div><div class="forecast-main">${n.label}</div><div class="sub">Bewertung · Kapitulation · Holder · Timing</div>`)+
 card(`<div class="row"><span class="eyebrow">NADIR GESAMTSCORE</span><span class="score amber">${n.score}/100</span></div><div class="bar"><i style="width:${n.score}%"></i></div><p class="muted">Akkumulations-Regime · gemischte Evidenz</p>`)+
 `<div class="grid2">${metric('BEWERTUNG',n.valuation+'/100')}${metric('KAPITULATION',n.capitulation+'/100')}${metric('HOLDER',n.holder+'/100')}${metric('TIMING',n.timing+'/100')}</div>`+
 card(`<div class="section-title">BTC BODEN-SZENARIEN</div>${Object.entries(n.btcScenarios).map(([k,v])=>`<div class="row"><span class="${k==='Base Case'?'amber':''}">${k}</span><b class="${k==='Base Case'?'amber':''}">${v}</b></div>`).join('')}`);
}
function dayTrade(){
 const d=DATA.dayTrade;
 return card(`<div class="eyebrow">DAY-TRADE 2.0</div><div class="forecast-main">${d.entryAllowed?'ENTRY FREIGEGEBEN':'ENTRY NICHT FREIGEGEBEN'}</div><div class="sub">Bias ≠ Ausführung · Indikatoren</div><div class="row"><b>GATE SCORE</b><b class="amber">${d.gateScore}/100</b></div><div class="bar"><i style="width:${d.gateScore}%"></i></div>`)+
 `<div class="grid2">${metric('BTC PREIS','$'+fmt(d.btcPrice))}${metric('4H RSI',fmt(d.rsi4h,2)+'<div class="red" style="font-size:13px">überdehnt</div>')}${metric('1H RSI',fmt(d.rsi1h,2)+'<div class="amber" style="font-size:13px">erhöht</div>')}${metric('FUNDING',fmt(d.fundingPct,4)+'%<div class="green" style="font-size:13px">OK</div>')}${metric('OI','$'+fmt(d.oiB,2)+'B')}${metric('VWAP','$'+fmt(d.vwap))}</div>`+
 card(`<div class="section-title">FIB LEVELS <span class="muted" style="float:right;font-size:13px">$${fmt(d.fib.low)} → $${fmt(d.fib.high)}</span></div>${d.fib.levels.map(l=>`<div class="row fib-row"><span>${fmt(l.ratio,1)}%<br><span class="tag ${l.tag==='RESIST'?'red':l.tag==='SUPPORT'?'green':'cyan'}">${l.tag}</span></span><b>$${fmt(l.price)}</b><span class="muted">${l.price>d.btcPrice?'-':'+'}${fmt(Math.abs((l.price/d.btcPrice-1)*100),1)}%</span></div>`).join('')}`)+
 card(`<div class="section-title">TRADE GATE</div><div class="row"><span>Datenfrische</span><b class="green">Browser Live</b></div><div class="row"><span>MTF-Konfluenz</span><b class="green">bullish</b></div><div class="row"><span>Entry-Streckung</span><b class="red">4H RSI ${fmt(d.rsi4h,2)} → stark überdehnt</b></div><div class="row"><span>Liquidationspuffer</span><b class="amber">$${fmt(d.liquidationBuffer)}</b></div>`);
}
function closes(symbol){
 const c=HISTORY?.coins?.[symbol]?.candles||[];
 return c.map(x=>({t:x[0],o:x[1],h:x[2],l:x[3],c:x[4]})).filter(x=>Number.isFinite(x.c));
}
function rsi(vals,p=14){
 if(vals.length<p+1)return null;let g=0,l=0;
 for(let i=vals.length-p;i<vals.length;i++){const d=vals[i]-vals[i-1];if(d>=0)g+=d;else l-=d}
 if(l===0)return 100; const rs=(g/p)/(l/p); return 100-(100/(1+rs));
}
function cycleClock(sym){
 const now=Date.now(), last=HALVINGS.at(-1), span=NEXT_HALVING_EST-last;
 let pct=Math.max(0,Math.min(100,(now-last)/span*100));
 const lag=COIN_LAG_DAYS[sym]||0;
 const estimatedPeak=new Date(last+(548+lag)*86400000);
 const daysFromPeak=Math.round((now-estimatedPeak.getTime())/86400000);
 let phase='POST-HALVING EXPANSION';
 if(daysFromPeak>-90 && daysFromPeak<90) phase='PEAK WINDOW';
 else if(daysFromPeak>=90) phase='LATE CYCLE / RESET';
 return {pct,phase,estimatedPeak,daysFromPeak,lag};
}
function forecast(symbol){
 const arr=closes(symbol), btc=closes('BTC');
 if(arr.length<90)return {ready:false,cycle:cycleClock(symbol)};
 const vals=arr.map(x=>x.c), last=vals.at(-1), look=vals.slice(-90), low=Math.min(...look), high=Math.max(...look);
 const pos=(last-low)/(high-low||1)*100;
 const dailyRsi=rsi(vals);
 const fib=[1.272,1.618,2.0].map(m=>high+(high-low)*(m-1));
 const ret90=(last/vals[Math.max(0,vals.length-91)]-1)*100;
 let rel=null,lag=null;
 if(symbol!=='BTC' && btc.length>90){
   const bv=btc.map(x=>x.c), br=(bv.at(-1)/bv[Math.max(0,bv.length-91)]-1)*100; rel=ret90-br;
   const peakIndex=a=>{let mi=0,m=-Infinity; a.forEach((v,i)=>{if(v>m){m=v;mi=i}});return mi}
   lag=peakIndex(look)-peakIndex(bv.slice(-90));
 }
 const risk=Math.round(Math.max(0,Math.min(100,(dailyRsi??50)*0.55+pos*0.45)));
 const confidence=Math.round(Math.max(35,Math.min(92,55+(arr.length>=300?12:0)+(symbol==='BTC'?8:0)+(Math.abs(ret90)>10?7:0))));
 return {ready:true,last,low,high,pos,dailyRsi,ret90,rel,lag,risk,confidence,fib,count:arr.length,cycle:cycleClock(symbol)};
}
function renderForecast(){
 const f=forecast(activeCoin), coins=DATA.forecastCoins;
 let body=card(`<div class="forecast-head"><div><div class="eyebrow">ACHI MERIDIAN FORECAST 1.2</div><div class="forecast-main">COIN CYCLE<br>FORECAST</div><div class="sub">FIB · Rotation · Relative Strength · Cycle Timing</div></div><div class="confidence"><div class="muted">CONFIDENCE</div><div class="score cyan">${f.ready?f.confidence:'—'}</div></div></div><p class="footer-note">Direkt im iPhone-Browser · Blue Edition · keine GitHub Action nötig.</p>`);
 body+=`<div class="tabs">${coins.map(c=>`<button class="tab ${c===activeCoin?'active':''}" onclick="selectCoin('${c}')">${c}</button>`).join('')}</div>`;
 if(!f.ready){
   body+=card(`<div class="loading">Lade ${activeCoin}-Historie direkt auf dem iPhone…</div><div class="row"><span>Zyklusphase</span><b class="cyan">${f.cycle.phase}</b></div><div class="row"><span>Coin-Offset</span><b>+${f.cycle.lag} Tage</b></div><button class="tab active" onclick="forceCoin('${activeCoin}')" style="width:100%;margin-top:16px">DATEN NEU LADEN</button><p class="footer-note">Die Daten werden lokal auf dem iPhone gespeichert. Beim nächsten Öffnen sind sie sofort verfügbar.</p>`);
 }else{
   body+=card(`<div class="forecast-price-card"><div class="eyebrow">${activeCoin}</div><div class="big forecast-price">$${fmt(f.last, activeCoin==='PEPE'?8:2)}</div><div class="grid2">${metric('LOCAL TOP-RISK',f.risk+'/100',f.risk>75?'red':f.risk>55?'amber':'green')}${metric('REL. STÄRKE VS BTC',f.rel==null?'BTC Basis':(f.rel>=0?'+':'')+fmt(f.rel,1)+'%')}${metric('DAILY RSI',f.dailyRsi?fmt(f.dailyRsi,1):'—')}${metric('90T MOMENTUM',(f.ret90>=0?'+':'')+fmt(f.ret90,1)+'%')}</div><div class="bar"><i style="width:${Math.max(3,Math.min(100,f.pos))}%"></i></div><p class="muted">Position im 90T Swing: ${fmt(f.pos,1)}%</p></div>`)+
   card(`<div class="section-title">ZYKLUS-UHR</div><div class="row"><span>Phase</span><b class="cyan">${f.cycle.phase}</b></div><div class="row"><span>Halving-Zyklus</span><b>${fmt(f.cycle.pct,1)}%</b></div><div class="bar"><i style="width:${f.cycle.pct}%"></i></div><div class="row"><span>Coin-spezifischer Modell-Offset</span><b>+${f.cycle.lag} Tage</b></div><div class="row"><span>Modell-Peakfenster Mitte</span><b>${f.cycle.estimatedPeak.toLocaleDateString('de-DE')}</b></div>`)+
   card(`<div class="section-title">MACRO CYCLE WINDOW</div><div class="row"><span>90T Peak-Lag vs BTC</span><b>${f.lag==null?'—':(f.lag>=0?'+':'')+f.lag+' Tage'}</b></div><p class="footer-note">Der dynamische Lag wird aus den lokalen 90T-Hochs berechnet; der Modell-Offset ist die längerfristige Zyklusannahme.</p>`)+
   card(`<div class="section-title">90T SWING</div><div class="grid2">${metric('LOW','$'+fmt(f.low,activeCoin==='PEPE'?8:2))}${metric('HIGH','$'+fmt(f.high,activeCoin==='PEPE'?8:2))}</div><div class="row"><span>Position im Swing</span><b>${fmt(f.pos,1)}%</b></div>`)+
   card(`<div class="section-title">FIB TARGET CLUSTER</div>${[1.272,1.618,2.0].map((m,i)=>`<div class="row"><span>${m} EXT</span><b class="cyan">$${fmt(f.fib[i],activeCoin==='PEPE'?8:2)}</b></div>`).join('')}<p class="footer-note">Targets aus dem aktuellen 90T-Swing; keine Prognosegarantie.</p>`)+
   card(`<div class="section-title">MODELL-INTERPRETATION</div><div class="scenario"><b>${f.risk>75?'Späte / überdehnte Phase':f.risk>55?'Fortgeschrittene Expansion':'Frühe bis mittlere Expansion'}</b><p class="muted">Confidence ${f.confidence}/100 · ${f.count} Tagespunkte · Momentum ${fmt(f.ret90,1)}%.</p></div><button class="tab active" onclick="forceCoin('${activeCoin}')" style="width:100%;margin-top:16px">HISTORIE AKTUALISIEREN</button>`);
 }
 $('#view-forecast').innerHTML=body;
}
window.selectCoin=async c=>{activeCoin=c;renderForecast();try{await loadCoinHistory(c); if(c!=='BTC')await loadCoinHistory('BTC');}catch(e){}renderForecast()}
window.forceCoin=async c=>{try{await loadCoinHistory(c,true); if(c!=='BTC')await loadCoinHistory('BTC',true);}catch(e){alert('Live-Historie konnte nicht geladen werden. Cache wird verwendet, falls vorhanden.')}renderForecast()}
function settings(){
 const cached=DATA.forecastCoins.filter(c=>loadCache(c)).length;
 return card(`<div class="section-title">DATENSTATUS</div><div class="row"><span>App-Version</span><b>${DATA.appVersion}</b></div><div class="row"><span>Build</span><b>${DATA.build}</b></div><div class="row"><span>Datenmodus</span><b class="green">iPhone Browser</b></div><div class="row"><span>Lokaler History-Cache</span><b>${cached}/${DATA.forecastCoins.length}</b></div>`)+
 card(`<div class="section-title">SYSTEM</div><div class="row"><span>GitHub Actions</span><b class="green">nicht nötig</b></div><div class="row"><span>Historie</span><b>direkt pro Coin</b></div><div class="row"><span>Speicher</span><b>localStorage</b></div><button onclick="location.reload()" class="tab active" style="width:100%;margin-top:16px">APP NEU LADEN</button>`)+
 card(`<div class="section-title">BEWERTUNGSLOGIK</div><div class="row"><span>Live Asset</span><b>Browser API</b></div><div class="row"><span>Fallback</span><b>lokaler Cache</b></div><div class="row"><span>Forecast</span><b>365T History + FIB + RSI + Relative Strength + Cycle Clock</b></div><div class="row"><span>Zyklus-Uhr</span><b>Halving-Zeitmodell + Coin Offset</b></div>`);
}
function renderAll(){
 $('#view-depot').innerHTML=depot();
 $('#view-market').innerHTML=market();
 $('#view-bottom').innerHTML=bottomView();
 $('#view-daytrade').innerHTML=dayTrade();
 renderForecast();
 $('#view-settings').innerHTML=settings();
}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{
 document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active')); b.classList.add('active');
 document.querySelectorAll('main>section').forEach(x=>x.classList.add('hidden'));
 $('#view-'+b.dataset.view).classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'});
 if(b.dataset.view==='forecast') selectCoin(activeCoin);
});
$('#settingsBtn').onclick=()=>document.querySelector('.nav[data-view="settings"]').click();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
load();
