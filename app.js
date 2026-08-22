
const $=s=>document.querySelector(s);
const fmt=(n,d=0)=>new Intl.NumberFormat('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
let DATA=null,HISTORY={status:'browser-live',coins:{}},activeCoin='BTC',LAST_PRICE_UPDATE=null,PRICE_WS=null,UI_RENDER_TIMER=null,PORTFOLIO_SERIES=[],ACTIVE_PORTFOLIO_RANGE='1D',CASHFLOWS=[];
let FEED={ws:'OFFLINE',binanceRest:'UNKNOWN',coinGecko:'UNKNOWN',lastWsAt:null,lastRestAt:null,lastCgAt:null,lastError:null};

const CG_IDS={
 BTC:'bitcoin',ETH:'ethereum',SOL:'solana',XRP:'ripple',SUI:'sui',ADA:'cardano',
 FET:'fetch-ai',HBAR:'hedera-hashgraph',DOT:'polkadot',
 NEAR:'near',AVAX:'avalanche-2',ATOM:'cosmos',TAO:'bittensor',INJ:'injective-protocol',
 PEPE:'pepe',XLM:'stellar',VSN:'vision-3'
};
const BINANCE_PAIRS={
 BTC:'btcusdt',ETH:'ethusdt',SOL:'solusdt',XRP:'xrpusdt',SUI:'suiusdt',ADA:'adausdt',
 FET:'fetusdt',HBAR:'hbarusdt',DOT:'dotusdt',NEAR:'nearusdt',AVAX:'avaxusdt',ATOM:'atomusdt',
 TAO:'taousdt',INJ:'injusdt',PEPE:'pepeusdt',XLM:'xlmusdt'
};
const WS_STALE_MS=45000;
const REST_HEALTH_MS=15000;

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
async function loadCoinGeckoQuotes(symbols, onlyMissing=false){
 const ids=symbols.map(s=>CG_IDS[s]).filter(Boolean);
 if(!ids.length)return 0;
 try{
  const j=await fetchJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&price_change_percentage=24h`);
  const byId={};j.forEach(v=>byId[v.id]=v);let n=0;
  DATA.assetIcons=DATA.assetIcons||{}; DATA.livePrices=DATA.livePrices||{};
  symbols.forEach(sym=>{
   const v=byId[CG_IDS[sym]]; if(!v)return;
   if(v.image)DATA.assetIcons[sym]=v.image;
   const existing=DATA.livePrices[sym];
   if(!onlyMissing || !existing || quoteAgeMs(existing)>WS_STALE_MS){
    applyQuote(sym,v.current_price,v.price_change_percentage_24h,'CoinGecko REST','FALLBACK',Date.now(),false);n++;
   }
  });
  FEED.coinGecko='OK';FEED.lastCgAt=Date.now();return n;
 }catch(e){FEED.coinGecko='ERROR';FEED.lastError='CoinGecko: '+e.message;return 0}
}
function quoteAgeMs(q){return q?.updatedAt?Date.now()-q.updatedAt:Infinity}
function quoteStatus(q){
 if(!q)return 'MISSING';
 const age=quoteAgeMs(q);
 if(q.status==='LIVE' && age<=WS_STALE_MS)return 'LIVE';
 if(q.status==='LIVE' && age>WS_STALE_MS)return 'STALE';
 return q.status||'FALLBACK';
}
function applyQuote(sym,price,change24h,source,status='LIVE',ts=Date.now(),schedule=true){
 price=Number(price);change24h=Number(change24h);
 if(!Number.isFinite(price)||price<=0)return;
 DATA.livePrices=DATA.livePrices||{};
 DATA.livePrices[sym]={price,change24h:Number.isFinite(change24h)?change24h:(DATA.livePrices[sym]?.change24h||0),source,status,updatedAt:ts};
 LAST_PRICE_UPDATE=Math.max(LAST_PRICE_UPDATE||0,ts);
 if(schedule)scheduleLiveRender();
}
function scheduleLiveRender(){
 if(UI_RENDER_TIMER)return;
 UI_RENDER_TIMER=setTimeout(()=>{UI_RENDER_TIMER=null;recalcPortfolio();renderAll();updateHeaderFeedClock()},1000);
}
function updateHeaderFeedClock(){
 const el=$('#refreshTime');if(!el)return;
 const q=DATA?.livePrices?.BTC, age=q?.updatedAt?Math.max(0,Math.round((Date.now()-q.updatedAt)/1000)):null;
 el.innerHTML=q&&quoteStatus(q)==='LIVE'?`<span class="feed-dot"></span><span>LIVE</span><b>${age}s</b>`:`<span>↻</span><b>${new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</b>`;
}
async function refreshBinanceRest(symbols, force=false){
 const supported=symbols.filter(s=>BINANCE_PAIRS[s]); if(!supported.length)return 0;
 try{
  const params=encodeURIComponent(JSON.stringify(supported.map(s=>BINANCE_PAIRS[s].toUpperCase())));
  const rows=await fetchJSON(`https://api.binance.com/api/v3/ticker/24hr?symbols=${params}`);
  const byPair={};(Array.isArray(rows)?rows:[rows]).forEach(v=>byPair[String(v.symbol||'').toLowerCase()]=v);
  let n=0;
  supported.forEach(sym=>{
   const v=byPair[BINANCE_PAIRS[sym]];if(!v)return;
   const current=DATA.livePrices?.[sym];
   if(force || !current || quoteStatus(current)!=='LIVE'){
    applyQuote(sym,v.lastPrice,v.priceChangePercent,'Binance REST','LIVE',Date.now(),false);n++;
   }
  });
  FEED.binanceRest='OK';FEED.lastRestAt=Date.now(); if(n){recalcPortfolio();renderAll()} return n;
 }catch(e){FEED.binanceRest='ERROR';FEED.lastError='Binance REST: '+e.message;return 0}
}
function startBinanceWebSocket(symbols){
 const streams=symbols.filter(s=>BINANCE_PAIRS[s]).map(s=>BINANCE_PAIRS[s]+'@ticker');
 if(!streams.length || typeof WebSocket==='undefined')return;
 try{if(PRICE_WS)PRICE_WS.close()}catch(e){}
 const reverse={};Object.entries(BINANCE_PAIRS).forEach(([s,p])=>reverse[p]=s);
 try{
  PRICE_WS=new WebSocket('wss://stream.binance.com:9443/stream?streams='+streams.join('/'));
  PRICE_WS.onopen=()=>{FEED.ws='CONNECTED';FEED.lastError=null;scheduleLiveRender()};
  PRICE_WS.onmessage=ev=>{
   try{
    const msg=JSON.parse(ev.data), t=msg.data||msg, sym=reverse[String(t.s||'').toLowerCase()];
    if(!sym)return;
    FEED.ws='CONNECTED';FEED.lastWsAt=Date.now();
    applyQuote(sym,t.c,t.P,'Binance WebSocket','LIVE',Date.now(),true);
   }catch(e){}
  };
  PRICE_WS.onerror=()=>{FEED.ws='ERROR';FEED.lastError='WebSocket Fehler';scheduleLiveRender()};
  PRICE_WS.onclose=()=>{FEED.ws='DISCONNECTED';scheduleLiveRender();setTimeout(()=>startBinanceWebSocket(symbols),5000)};
 }catch(e){FEED.ws='ERROR';FEED.lastError=e.message}
}
async function refreshCurrentPortfolioPrices(){
 const symbols=[...new Set([...(DATA.portfolio.holdings||[]).map(x=>x.symbol),...(DATA.forecastCoins||[]),'PEPE','NEAR','DOT','HBAR','BTC','ETH','SOL','XRP'])];
 DATA.livePrices=DATA.livePrices||{};
 await refreshBinanceRest(symbols,true);
 await loadCoinGeckoQuotes(symbols,true);
 recalcPortfolio();
 startBinanceWebSocket(symbols);
 setInterval(async()=>{
  const wsFresh=FEED.lastWsAt && (Date.now()-FEED.lastWsAt)<WS_STALE_MS;
  if(!wsFresh)await refreshBinanceRest(symbols,true);
  const missing=symbols.filter(s=>!DATA.livePrices[s]||quoteStatus(DATA.livePrices[s])!=='LIVE');
  if(missing.length)await loadCoinGeckoQuotes(missing,true);
  recalcPortfolio();renderAll();updateHeaderFeedClock();
 },REST_HEALTH_MS);
 setInterval(updateHeaderFeedClock,1000);
}


function calcRSI(values,p=14){
 if(!Array.isArray(values)||values.length<p+1)return null;
 let g=0,l=0;
 for(let i=values.length-p;i<values.length;i++){const d=values[i]-values[i-1]; if(d>=0)g+=d; else l-=d}
 if(l===0)return 100;
 const rs=(g/p)/(l/p); return 100-(100/(1+rs));
}
function calcVWAP(klines){
 let pv=0,v=0;
 (klines||[]).forEach(k=>{const h=+k[2],l=+k[3],c=+k[4],vol=+k[5],tp=(h+l+c)/3;pv+=tp*vol;v+=vol});
 return v?pv/v:null;
}
async function refreshDayTradeTechnicals(){
 const d=DATA?.dayTrade;if(!d)return;
 try{
  const [k1,k4,prem,oi]=await Promise.all([
   fetchJSON('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=100'),
   fetchJSON('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=100'),
   fetchJSON('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
   fetchJSON('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT')
  ]);
  const c1=k1.map(k=>+k[4]), c4=k4.map(k=>+k[4]), price=+prem.markPrice||c1.at(-1);
  const r1=calcRSI(c1), r4=calcRSI(c4), vw=calcVWAP(k1.slice(-24));
  if(Number.isFinite(price)&&price>0)d.btcPrice=price;
  if(Number.isFinite(r1))d.rsi1h=r1;
  if(Number.isFinite(r4))d.rsi4h=r4;
  if(Number.isFinite(+prem.lastFundingRate))d.fundingPct=(+prem.lastFundingRate)*100;
  if(Number.isFinite(+oi.openInterest)&&price>0)d.oiB=(+oi.openInterest*price/1e9);
  if(Number.isFinite(vw))d.vwap=vw;
  d.technicalUpdatedAt=new Date().toISOString();
  d.status={btcPrice:'BROWSER LIVE',oiB:'BROWSER LIVE',rsi4h:'BROWSER LIVE',rsi1h:'BROWSER LIVE',fundingPct:'BROWSER LIVE',vwap:'BROWSER LIVE',fib:'MODEL / SNAPSHOT'};
  let score=50;
  if(d.rsi4h<70)score+=12; else if(d.rsi4h>78)score-=15;
  if(d.rsi1h<70)score+=8; else if(d.rsi1h>78)score-=8;
  if(Math.abs(d.fundingPct)<0.02)score+=8; else score-=8;
  d.gateScore=Math.max(0,Math.min(100,Math.round(score)));
  d.entryAllowed=d.gateScore>=70;
  d.decisionNote=d.entryAllowed?'ENTRY technisch möglich – Risiko/Positionierung trotzdem prüfen.':'NO ENTRY: technische Konfluenz reicht aktuell nicht für Gate ≥70.';
 }catch(e){
  d.technicalUpdatedAt=null;
 }
}

function recalcPortfolio(){
 const p=DATA.portfolio, hs=p.holdings||[];
 const priced=hs.map(h=>{
   const q=DATA.livePrices?.[h.symbol];
   const fb=DATA.priceFallbacks?.[h.symbol];
   const price=q?.price || fb?.price || 0;
   const priceSource=q?.price ? quoteStatus(q) : fb?.price ? 'SNAPSHOT' : 'MISSING';
   return {...h,price,priceSource,change24h:q?.change24h||0,priceProvider:q?.source||null,priceUpdatedAt:q?.updatedAt||null,value:h.quantity*price}
 });
 const liveSpotTotal=priced.reduce((a,h)=>a+h.value,0);
 if(!liveSpotTotal)return;

 const manualBalances=p.manualVenueBalances||[];
 const manualTotal=manualBalances.reduce((a,x)=>a+(Number(x.value)||0),0);
 const total=liveSpotTotal+manualTotal;

 const venues={};
 priced.forEach(h=>{venues[h.venue]=(venues[h.venue]||0)+h.value});
 manualBalances.forEach(x=>{venues[x.name]=(venues[x.name]||0)+(Number(x.value)||0)});

 p.total=total;
 recordPortfolioPoint(total);
 p.eurApprox=total*0.86;
 p.custodiansCount=Object.keys(venues).filter(k=>venues[k]>0).length;
 p.byVenue=Object.entries(venues).sort((a,b)=>b[1]-a[1]).map(([name,value])=>{
   const venueHoldings=priced.filter(h=>h.venue===name);
   const hasFallback=venueHoldings.some(h=>['SNAPSHOT','FALLBACK','STALE'].includes(h.priceSource));
   const hasMissing=venueHoldings.some(h=>h.priceSource==='MISSING');
   return {
     name,value,sharePct:value/total*100,
     source:manualBalances.some(x=>x.name===name)?'SNAPSHOT':hasMissing?'MISSING':hasFallback?'MIXED':'LIVE'
   }
 });

 const coins={};
 priced.forEach(h=>{
   let c=coins[h.symbol]||(coins[h.symbol]={symbol:h.symbol,value:0,quantity:0,venues:new Set(),change24h:h.change24h,priceSource:h.priceSource,price:h.price});
   c.value+=h.value;c.quantity+=h.quantity;c.venues.add(h.venue);
   if(h.priceSource!=='LIVE') c.priceSource=h.priceSource; c.priceProvider=h.priceProvider; c.priceUpdatedAt=h.priceUpdatedAt;
   if(h.price) c.price=h.price
 });
 const positions=Object.values(coins).sort((a,b)=>b.value-a.value);
 p.assetsCount=positions.length;
 p.largestPosition={symbol:positions[0].symbol,sharePct:positions[0].value/total*100};
 p.topPositions=positions.slice(0,5).map(x=>({
   symbol:x.symbol, venue:[...x.venues].join(' + '), value:x.value,
   sharePct:x.value/total*100, change24h:x.change24h, quantity:x.quantity, priceSource:x.priceSource, priceProvider:x.priceProvider, priceUpdatedAt:x.priceUpdatedAt, price:x.price
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
 try{
   const stamp=Date.now();
   DATA=await fetch('data.json?v='+stamp,{cache:'no-store'}).then(r=>{
     if(!r.ok)throw new Error('data.json HTTP '+r.status);
     return r.json();
   });
   try{loadPortfolioSeries()}catch(e){}
   $('#versionBadge').textContent='v'+DATA.appVersion+' · START';
   renderAll(); // snapshot must appear immediately, before any external API call
   updateHeaderFeedClock();

   // Live engines run independently and may fail without blanking the app.
   Promise.allSettled([refreshCurrentPortfolioPrices(),refreshDayTradeTechnicals()])
    .then(()=>{
      $('#versionBadge').textContent='v'+DATA.appVersion+' · LIVE';
      try{recalcPortfolio()}catch(e){}
      renderAll(); updateHeaderFeedClock();
    });

   loadCoinHistory(activeCoin).then(()=>renderForecast()).catch(()=>renderForecast());
 }catch(e){
   console.error('MERIDIAN BOOT ERROR',e);
   $('#versionBadge').textContent='v5.0.5 · ERROR';
   const main=document.querySelector('main');
   if(main)main.innerHTML=`<section><div class="card render-fallback"><div class="eyebrow">BOOT FEHLER</div><div class="forecast-main">DATA.JSON NICHT GELADEN</div><p class="footer-note">${String(e&&e.message||e)}</p></div></section>`;
 }
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
function snapshotBadge(label='SNAPSHOT'){return `<span class="snapshot-badge">${label}</span>`}
function sourceBadge(src){
 if(src==='LIVE') return liveBadge('LIVE');
 if(src==='FALLBACK') return `<span class="fallback-badge">FALLBACK</span>`;
 if(src==='STALE') return `<span class="stale-badge">STALE</span>`;
 if(src==='MIXED') return snapshotBadge('MIXED');
 if(src==='MISSING') return `<span class="missing-badge">FEHLT</span>`;
 return snapshotBadge('SNAPSHOT');
}
function ageText(ts){if(!ts)return 'kein Live-Zeitstempel';const s=Math.max(0,Math.round((Date.now()-ts)/1000));return s<60?`vor ${s} Sek.`:`vor ${Math.round(s/60)} Min.`}
function feedHealth(){
 const q=DATA?.livePrices?.BTC; const st=quoteStatus(q);
 return {status:st,age:q?.updatedAt?Math.max(0,Math.round((Date.now()-q.updatedAt)/1000)):null,source:q?.source||'—'};
}


function portfolioHistoryKey(){return 'meridian_portfolio_history_v2'}
function cashflowKey(){return 'meridian_cashflows_v1'}
function activeRangeKey(){return 'meridian_portfolio_active_range_v1'}
function loadPortfolioSeries(){
 try{PORTFOLIO_SERIES=JSON.parse(localStorage.getItem(portfolioHistoryKey())||'[]').filter(x=>Array.isArray(x)&&x.length>=2&&Number.isFinite(+x[0])&&Number.isFinite(+x[1])).map(x=>[+x[0],+x[1]])}catch(e){PORTFOLIO_SERIES=[]}
 try{CASHFLOWS=JSON.parse(localStorage.getItem(cashflowKey())||'[]').filter(x=>x&&Number.isFinite(+x.ts)&&Number.isFinite(+x.amount)).map(x=>({ts:+x.ts,amount:+x.amount,note:x.note||'',type:x.type||(+x.amount>=0?'deposit':'withdrawal')}))}catch(e){CASHFLOWS=[]}
 try{ACTIVE_PORTFOLIO_RANGE=localStorage.getItem(activeRangeKey())||'1D'}catch(e){ACTIVE_PORTFOLIO_RANGE='1D'}
}
function savePortfolioSeries(){try{localStorage.setItem(portfolioHistoryKey(),JSON.stringify(PORTFOLIO_SERIES))}catch(e){}}
function saveCashflows(){try{localStorage.setItem(cashflowKey(),JSON.stringify(CASHFLOWS))}catch(e){}}
function recordPortfolioPoint(value){
 if(!Number.isFinite(value)||value<=0)return;
 const now=Date.now(),last=PORTFOLIO_SERIES.at(-1);
 if(!last||now-last[0]>=15000){PORTFOLIO_SERIES.push([now,value]);PORTFOLIO_SERIES=PORTFOLIO_SERIES.filter(x=>x[0]>=now-370*86400000);savePortfolioSeries()}
}
function addCashflow(amount,note=''){
 amount=+amount;if(!Number.isFinite(amount)||amount===0)return false;
 CASHFLOWS.push({ts:Date.now(),amount,note:note||'',type:amount>=0?'deposit':'withdrawal'});CASHFLOWS.sort((a,b)=>a.ts-b.ts);saveCashflows();renderAll();return true;
}
function deleteCashflow(ts){CASHFLOWS=CASHFLOWS.filter(x=>x.ts!==+ts);saveCashflows();renderAll()}
function setPortfolioRange(r){ACTIVE_PORTFOLIO_RANGE=r;try{localStorage.setItem(activeRangeKey(),r)}catch(e){}renderAll()}
function rangeMs(r){return ({'1D':86400000,'1W':7*86400000,'1M':30*86400000,'6M':182*86400000,'1Y':365*86400000})[r]||86400000}
function resampleSeries(series,maxPts=180){if(series.length<=maxPts)return series;const out=[],bucket=Math.ceil(series.length/maxPts);for(let i=0;i<series.length;i+=bucket){const g=series.slice(i,i+bucket);out.push(g[Math.floor(g.length/2)])}return out}
function cashflowBetween(startTs,endTs){return CASHFLOWS.filter(x=>x.ts>startTs&&x.ts<=endTs).reduce((s,x)=>s+x.amount,0)}
function performanceSince(startTs,currentValue){const first=PORTFOLIO_SERIES.find(x=>x[0]>=startTs)||PORTFOLIO_SERIES[0];if(!first)return {abs:0,pct:0,base:currentValue,cashflow:0};const cf=cashflowBetween(first[0],Date.now()),marketPnl=currentValue-first[1]-cf,pct=first[1]?marketPnl/first[1]*100:0;return {abs:marketPnl,pct,base:first[1],cashflow:cf}}
function portfolioChart(){
 const p=DATA.portfolio,now=Date.now(),startTs=now-rangeMs(ACTIVE_PORTFOLIO_RANGE);let pts=PORTFOLIO_SERIES.filter(x=>x[0]>=startTs);if(pts.length<2)pts=[[now-60000,p.total],[now,p.total]];pts=resampleSeries(pts,180);
 const vals=pts.map(x=>x[1]),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(max-min,max*.001),w=720,h=210,pad=8;
 const path=pts.map((x,i)=>{const X=pad+i*(w-2*pad)/Math.max(1,pts.length-1),Y=pad+(max-x[1])*(h-2*pad)/span;return `${i?'L':'M'}${X.toFixed(1)},${Y.toFixed(1)}`}).join(' ');
 const perf=performanceSince(startTs,p.total),cf=perf.cashflow,cashflowText=Math.abs(cf)>0.005?`${cf>=0?'+':''}$${fmt(cf,0)} Cashflow`:'kein Cashflow';
 return `<div class="portfolio-chart"><div class="chart-head"><div><span>${ACTIVE_PORTFOLIO_RANGE} PERFORMANCE · CASHFLOW-BEREINIGT</span><b class="${perf.abs>=0?'green':'red'}">${perf.abs>=0?'+':''}$${fmt(perf.abs,0)} · ${perf.pct>=0?'+':''}${fmt(perf.pct,2)}%</b></div><small>${cashflowText}</small></div><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Gesamtportfolio Performance Chart"><defs><linearGradient id="blueArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#20a4ff" stop-opacity=".36"/><stop offset="100%" stop-color="#20a4ff" stop-opacity="0"/></linearGradient><filter id="blueGlow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="${path} L${w-pad},${h} L${pad},${h} Z" fill="url(#blueArea)"/><path d="${path}" fill="none" stroke="#20a4ff" stroke-width="5" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" filter="url(#blueGlow)"/></svg><div class="chart-range">${['1D','1W','1M','6M','1Y'].map(r=>`<button class="${r===ACTIVE_PORTFOLIO_RANGE?'active':''}" onclick="setPortfolioRange('${r}')">${r}</button>`).join('')}</div></div>`;
}
function cashflowPanel(){
 const recent=CASHFLOWS.slice().sort((a,b)=>b.ts-a.ts).slice(0,6);
 return card(`<div class="section-head"><div class="section-title">PERFORMANCE & CASHFLOWS</div><span class="section-note">${CASHFLOWS.length} Einträge</span></div><div class="cashflow-explainer">Einzahlungen und Auszahlungen verändern den Depotwert, werden aber aus der Performanceberechnung herausgerechnet.</div><div class="cashflow-actions"><button onclick="promptCashflow(1)">+ EINZAHLUNG</button><button onclick="promptCashflow(-1)">− AUSZAHLUNG</button></div>${recent.length?recent.map(x=>`<div class="cashflow-row"><div><b>${x.amount>=0?'Einzahlung':'Auszahlung'}</b><small>${new Date(x.ts).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}${x.note?' · '+x.note:''}</small></div><span class="${x.amount>=0?'green':'red'}">${x.amount>=0?'+':''}$${fmt(x.amount,2)}</span><button onclick="deleteCashflow(${x.ts})">×</button></div>`).join(''):'<p class="footer-note">Noch keine Cashflows erfasst.</p>'}`,'cashflow-card');
}
function promptCashflow(sign){const raw=prompt(sign>0?'Einzahlung in USD eingeben:':'Auszahlung in USD eingeben:');if(raw===null)return;const val=Math.abs(parseFloat(String(raw).replace(',','.')));if(!Number.isFinite(val)||val<=0)return alert('Ungültiger Betrag');const note=prompt('Notiz (optional):')||'';addCashflow(sign*val,note)}

function riskClass(score){return score<30?'red':score<60?'amber':'green'}
function botStatusBadge(b){
 const s=(b.recommendation||'').toUpperCase();
 const cls=s.includes('KRIT')?'red':s.includes('BEOB')?'amber':'green';
 return `<span class="tag ${cls}">${b.recommendation||'—'}</span>`;
}
function commandRisk(){
 const p=DATA.portfolio,r=DATA.pionexRisk||{},fh=feedHealth();
 let score=28,reasons=[];
 if((r.riskLevel||'').toUpperCase()==='HIGH'){score+=18;reasons.push('Pionex Bot-Risiko HIGH')}
 const critical=(r.bots||[]).filter(b=>(b.recommendation||'').toUpperCase().includes('KRIT'));
 if(critical.length){score+=18;reasons.push(`${critical.length} kritischer Bot`)}
 const tight=(r.bots||[]).filter(b=>Number.isFinite(b.liquidationDistancePct)&&b.liquidationDistancePct<30);
 if(tight.length){score+=12;reasons.push(`${tight.map(b=>b.symbol).join('/')} Liq.-Puffer <30%`)}
 if((p.largestPosition?.sharePct||0)>=20){score+=8;reasons.push(`${p.largestPosition.symbol} Konzentration ${fmt(p.largestPosition.sharePct,1)}%`)}
 if(fh.status!=='LIVE'){score+=10;reasons.push('Livefeed nicht vollständig live')}
 score=Math.min(100,score);
 return {score,label:score>=75?'HOCH':score>=50?'ERHÖHT':'NORMAL',reasons};
}
function commandCenter(){
 const p=DATA.portfolio,r=DATA.pionexRisk||{},m=DATA.btcRegime||{},fh=feedHealth(),risk=commandRisk();
 const perf=performanceSince(Date.now()-86400000,p.total);
 const hasHist=PORTFOLIO_SERIES.length>2;
 const dayPct=hasHist?perf.pct:(p.performance24hPct||0), dayAbs=hasHist?perf.abs:(p.performance24hUsd||0);
 const critical=(r.bots||[]).find(b=>(b.recommendation||'').toUpperCase().includes('KRIT'));
 const hbar=(r.bots||[]).find(b=>b.symbol==='HBAR'),xrp=(r.bots||[]).find(b=>b.symbol==='XRP');
 const hedgeCapitalPct=r.longCapital?100*(r.shortCapital||0)/r.longCapital:0;
 const focus=[];
 if(critical)focus.push({tone:'red',title:`${critical.symbol} ${critical.side}: KRITISCH PRÜFEN`,text:critical.reason||'Risikoposition prüfen.'});
 if(hbar&&Number.isFinite(hbar.liquidationDistancePct))focus.push({tone:hbar.liquidationDistancePct<30?'amber':'green',title:`HBAR Long · Liq.-Puffer ${fmt(hbar.liquidationDistancePct,1)}%`,text:`Grid ${fmt(hbar.rangeLow,2)}–${fmt(hbar.rangeHigh,2)} · ${hbar.recommendation}`});
 if(xrp)focus.push({tone:'green',title:`XRP Long · ${xrp.recommendation}`,text:`Break-even ${fmt(xrp.breakEven,4)} · Liq.-Puffer ${fmt(xrp.liquidationDistancePct,1)}%`});
 if(m.label)focus.push({tone:'cyan',title:`Regime: ${m.label}`,text:m.risk||'Marktregime als Filter für neue Risiken.'});
 const botRows=(r.bots||[]).map(b=>`<div class="cc-bot-row"><div><b>${b.symbol} ${b.side}</b><small>${b.leverage||'—'}x · ${b.recommendation||'—'}</small></div><span class="${(b.recommendation||'').includes('KRIT')?'red':(b.recommendation||'').includes('BEOB')?'amber':'green'}">${Number.isFinite(b.totalProfitPct)?(b.totalProfitPct>=0?'+':'')+fmt(b.totalProfitPct,2)+'%':'—'}</span></div>`).join('');
 return `<div class="cc-hero">
   <div class="cc-kicker">COMMAND CENTER ${liveBadge(fh.status==='LIVE'?'LIVE':fh.status)}</div>
   <div class="cc-value-row"><div><div class="cc-total">$${fmt(p.total)}</div><div class="cc-eur">≈ €${fmt(p.eurApprox)}</div></div><div class="cc-day ${dayPct>=0?'green':'red'}"><b>${dayPct>=0?'+':''}${fmt(dayPct,2)}%</b><small>${dayAbs>=0?'+':''}$${fmt(dayAbs,0)} · 24H</small></div></div>
   ${portfolioChart()}
 </div>`+
 `<div class="cc-grid">
   <div class="cc-tile"><span>MERIDIAN RISK</span><b class="${risk.score>=75?'red':risk.score>=50?'amber':'green'}">${risk.score}/100</b><small>${risk.label}</small></div>
   <div class="cc-tile"><span>MARKTREGIME</span><b class="cyan">${m.label||DATA.market.regime}</b><small>Score ${m.score||'—'}/100</small></div>
   <div class="cc-tile"><span>BOT-KAPITAL</span><b>$${fmt(r.botCapital||0)}</b><small>${r.riskLevel||'—'} risk</small></div>
   <div class="cc-tile"><span>HEDGE-KAPITAL</span><b class="amber">${fmt(hedgeCapitalPct,1)}%</b><small>Short vs. Long Bot-Kapital*</small></div>
 </div>`+
 card(`<div class="section-head"><div class="section-title">HEUTE BEACHTEN</div><span class="section-note">Priorisiert</span></div>${focus.slice(0,4).map((x,i)=>`<div class="focus-row ${x.tone}"><div class="focus-num">${i+1}</div><div><b>${x.title}</b><small>${x.text}</small></div></div>`).join('')}<p class="footer-note">*Hedge-Kapital ist keine echte Delta-Hedge-Quote. BTC-Short-Notional/Liquidationspreis ist weiterhin nicht verifiziert.</p>`,'cc-focus-card')+
 card(`<div class="section-head"><div class="section-title">BOT WATCH</div><span class="section-note">Pionex Snapshot</span></div>${botRows}<div class="cc-exposure"><span>Bekannte 5x Long-Kapazität</span><b>$${fmt(r.knownLeveragedLongCapacity||0)}</b></div>`,'cc-bot-card')+
 card(`<div class="section-head"><div class="section-title">DATA HEALTH</div><span class="section-note">Transparenz</span></div><div class="cc-health"><div><span class="feed-dot"></span><b>BTC Livefeed</b></div><strong class="${fh.status==='LIVE'?'green':'amber'}">${fh.status} · ${fh.age??'—'}s</strong></div><div class="cc-health"><div><span class="status-dot snapshot"></span><b>Pionex Bots</b></div><strong class="amber">SNAPSHOT 09:12</strong></div><div class="cc-health"><div><span class="status-dot snapshot"></span><b>NADIR</b></div><strong class="amber">MODEL SNAPSHOT</strong></div>`,'cc-health-card')+
 `<button class="cc-open-depot" onclick="document.querySelector('.nav[data-view=depot]').click()">DEPOT & POSITIONEN ÖFFNEN →</button>`;
}
function depot(){
 const p=DATA.portfolio, r=DATA.pionexRisk||{}, ex=DATA.exposure||{};
 const venueCards=p.byVenue.map(v=>metric(
   v.name,
   `$${fmt(v.value,0)}<div class="${v.name==='Pionex'?'amber':'green'} venue-share">${fmt(v.sharePct,1)}%</div><div class="venue-source">${sourceBadge(v.source)}</div>`
 )).join('');
 const topRows=p.topPositions.map(x=>`
   <div class="position-row position-click" onclick="openAssetDetail('${x.symbol}')">
     ${coinIcon(x.symbol)}
     <div class="position-asset">
       <div class="position-symbol">${x.symbol}</div>
       <div class="position-venue">${x.venue} ${sourceBadge(x.priceSource||'LIVE')}</div>
       <div class="position-qty">${fmt(x.quantity, x.quantity<1?6:2)} ${x.symbol}</div>
       <div class="position-price">Kurs $${fmt(x.price, x.price<1?4:2)}</div>
     </div>
     <div class="position-value"><b>$${fmt(x.value)}</b><small>${fmt(x.sharePct,1)}% Anteil</small></div>
     <div class="position-change ${x.change24h<0?'red':''}">${x.change24h>=0?'+':''}${fmt(x.change24h,1)}%</div>
   </div>`).join('');
 const botCards=(r.bots||[]).map(b=>{
   const liq=Number.isFinite(b.liquidation)?`$${fmt(b.liquidation,b.symbol==='HBAR'?5:b.symbol==='XRP'?4:0)}`:'nicht verifiziert';
   const pnl=Number.isFinite(b.totalProfitUsdt)?`${fmt(b.totalProfitUsdt,2)} USDT`:Number.isFinite(b.totalProfitPct)?`${fmt(b.totalProfitPct,2)}%`:'—';
   return `<div class="pionex-bot">
    <div class="pionex-bot-head"><div><b>${b.symbol} ${b.side}</b><small>${b.name} · ${b.leverage||'—'}x</small></div>${botStatusBadge(b)}</div>
    <div class="pionex-grid">
      <div><span>Kapital</span><b>${fmt(b.investment,2)} USDT</b></div>
      <div><span>P&L</span><b class="${(b.totalProfitPct||0)<0?'red':'green'}">${pnl}</b></div>
      <div><span>Range</span><b>${Number.isFinite(b.rangeLow)?fmt(b.rangeLow,b.symbol==='HBAR'?2:1)+'–'+fmt(b.rangeHigh,b.symbol==='HBAR'?2:1):'—'}</b></div>
      <div><span>Grids</span><b>${b.grids||b.orders||'—'}</b></div>
      <div><span>Liq.</span><b class="red">${liq}</b></div>
      <div><span>Liq.-Puffer</span><b class="amber">${Number.isFinite(b.liquidationDistancePct)?fmt(b.liquidationDistancePct,1)+'%':'—'}</b></div>
    </div>
    <div class="bot-reason">${b.reason||''}</div>
   </div>`;
 }).join('');
 return card(`<div class="hero">
      <div class="eyebrow">GESAMTPORTFOLIO</div>
      <div class="portfolio-value-line"><div><div class="big">$${fmt(p.total)}</div><div class="sub">≈ €${fmt(p.eurApprox)}</div></div><div class="portfolio-live">${liveBadge('LIVE')}<small>Gesamtwert</small></div></div>
      ${portfolioChart()}
      <div class="grid2 portfolio-summary">
        ${metric('ASSETS',p.assetsCount)}${metric('VERWAHRSTELLEN',p.custodiansCount)}
        ${metric('GRÖSSTE POSITION',p.largestPosition.symbol+' '+fmt(p.largestPosition.sharePct,1)+'%')}
        ${metric('DATENMODUS',`Hybrid ${liveBadge('LIVE')}`,'green')}
      </div>
    </div>`,'hero')+
    donutVenue()+
    `<div class="section-title venue-title">WERT NACH BÖRSE / WALLET</div>`+
    `<div class="grid2 venue-grid">${venueCards}</div>`+
    card(`<div class="section-head"><div class="section-title">TOP 5 SPOT-POSITIONEN</div><span class="section-note">${liveBadge('LIVE')} ohne Futures-Doppelzählung</span></div>${topRows}`,'positions-card')+
    card(`<div class="section-head"><div class="section-title">FUTURES & EXPOSURE</div><span class="section-note">${snapshotBadge('09:12')}</span></div>
      <div class="grid2 pionex-summary">
        ${metric('PIONEX KONTO','$'+fmt(r.accountValue,2),'amber')}
        ${metric('BOT-KAPITAL','$'+fmt(r.botCapital,2))}
        ${metric('LONG-KAPITAL','$'+fmt(r.longCapital,2),'green')}
        ${metric('SHORT-HEDGE','$'+fmt(r.shortCapital,2),'red')}
        ${metric('5x LONG CAPACITY','$'+fmt(r.knownLeveragedLongCapacity,0),'amber')}
        ${metric('BIAS',r.netDirection||'—','amber')}
      </div>
      <div class="exposure-callout"><b>${r.riskLevel||'—'} RISK</b><span>${r.riskNote||''}</span></div>
      <div class="pionex-bots">${botCards}</div>
      <p class="footer-note">Pionex-Kontowert ist bereits im Gesamtportfolio enthalten. Futures-Bot-Kapital wird hier nur als Risiko-/Exposure-Layer dargestellt und nicht nochmals addiert.</p>
    `,'pionex-card')+
    cashflowPanel()+
    `<div class="grid2 performance-grid">${metric('24H SPOT-PERF.',(p.performance24hPct>=0?'+':'')+fmt(p.performance24hPct,1)+'%<div class="muted perf-sub">'+(p.performance24hUsd>=0?'+':'')+'$'+fmt(p.performance24hUsd)+'</div>',p.performance24hPct>=0?'green':'red')}${metric('BEST PERFORMER',p.bestPerformer.symbol+'<div class="muted perf-sub">'+(p.bestPerformer.change24h>=0?'+':'')+fmt(p.bestPerformer.change24h,1)+'%</div>')}${metric('WORST PERFORMER',p.worstPerformer.symbol+'<div class="muted perf-sub">'+fmt(p.worstPerformer.change24h,1)+'%</div>')}${metric('VOLATILITÄT',fmt(p.volatility24hPct,2)+'%<div class="muted perf-sub">24h Streuung</div>')}</div>`;
}
function assetDetail(sym){
 const hs=(DATA.portfolio.holdings||[]).filter(h=>h.symbol===sym);
 const q=DATA.livePrices?.[sym], fb=DATA.priceFallbacks?.[sym];
 const price=q?.price||fb?.price||0, source=q?.price?quoteStatus(q):fb?.price?'SNAPSHOT':'MISSING';
 const qty=hs.reduce((a,h)=>a+Number(h.quantity||0),0), value=qty*price;
 const venues=hs.map(h=>({name:h.venue,qty:Number(h.quantity||0),value:Number(h.quantity||0)*price}));
 const age=q?.updatedAt?Math.max(0,Math.round((Date.now()-q.updatedAt)/1000)):null;
 const f=forecast(sym);
 return `<div class="detail-overlay" onclick="if(event.target===this)closeAssetDetail()"><div class="asset-detail">
   <div class="detail-head"><button class="detail-close" onclick="closeAssetDetail()">←</button><div>${coinIcon(sym)} <b>${sym}</b></div><span>${sourceBadge(source)}</span></div>
   <div class="detail-price">$${fmt(price,price<1?4:2)}</div><div class="detail-fresh">${source==='LIVE'?`${q?.source||'Livefeed'} · vor ${age??0} Sek.`:'Preisquelle: '+source}</div>
   <div class="grid2">${metric('GESAMTMENGE',fmt(qty,qty<1?6:2)+' '+sym)}${metric('POSITIONSWERT','$'+fmt(value))}${metric('24H',(q?.change24h>=0?'+':'')+fmt(q?.change24h||0,1)+'%',(q?.change24h||0)>=0?'green':'red')}${metric('VERWAHRSTELLEN',venues.length)}</div>
   <div class="section-title detail-section">VERTEILUNG</div>${venues.map(v=>`<div class="row"><span>${v.name}<small class="detail-qty">${fmt(v.qty,v.qty<1?6:2)} ${sym}</small></span><b>$${fmt(v.value)}</b></div>`).join('')}
   ${f.ready?`<div class="section-title detail-section">FORECAST</div><div class="grid2">${metric('RISK',f.risk+'/100',f.risk>75?'red':'amber')}${metric('RSI',fmt(f.dailyRsi,1))}${metric('90T',(f.ret90>=0?'+':'')+fmt(f.ret90,1)+'%')}${metric('CONFIDENCE',f.confidence+'/100','cyan')}</div>`:'<p class="footer-note">Forecast-Historie wird beim Öffnen des Forecast-Tabs geladen.</p>'}
   <button class="tab active detail-forecast-btn" onclick="closeAssetDetail();document.querySelector('.nav[data-view=forecast]').click();selectCoin('${sym}')">IM FORECAST ÖFFNEN</button>
 </div></div>`;
}
window.openAssetDetail=async sym=>{document.body.insertAdjacentHTML('beforeend',assetDetail(sym));try{await loadCoinHistory(sym);if(sym!=='BTC')await loadCoinHistory('BTC')}catch(e){};const el=document.querySelector('.detail-overlay');if(el)el.outerHTML=assetDetail(sym)};
window.closeAssetDetail=()=>document.querySelector('.detail-overlay')?.remove();
function market(){
 const m=DATA.market,b=DATA.btcRegime||{},mac=DATA.macro||{},s=DATA.verifiedMarketSnapshot||{},r=DATA.pionexRisk||{},fh=feedHealth();
 const liveSyms=['BTC','ETH','SOL','XRP'];
 const liveRows=liveSyms.map(sym=>{
  const q=DATA.livePrices?.[sym], snap=s.prices?.[sym];
  const price=q?.price??snap?.price, ch=q?.change24h??snap?.change24hPct, st=q?quoteStatus(q):'SNAPSHOT';
  const provider=q?.source||'Referenz-Snapshot'; const ts=q?.updatedAt;
  return `<div class="live-market-row"><div><b>${sym}</b> ${sourceBadge(st)}<small>${provider} · ${ts?ageText(ts):'Fallback'}</small></div><div><b>$${fmt(price,price<10?4:2)}</b><span class="${ch>=0?'green':'red'}">${ch>=0?'+':''}${fmt(ch,2)}%</span></div></div>`;
 }).join('');
 const radar=(DATA.portfolio.topPositions.concat([{symbol:'PEPE',change24h:25},{symbol:'NEAR',change24h:9.1},{symbol:'DOT',change24h:7.5},{symbol:'HBAR',change24h:6.4}])).sort((a,b)=>b.change24h-a.change24h);
 return card(`<div class="market-hero"><div><div class="eyebrow">MARKTREGIME ${snapshotBadge('MODEL')}</div><div class="forecast-main" style="font-size:27px">${b.label||m.regime}</div><div class="sub">${b.risk||'BTC als Filter'}</div><div class="bar"><i style="width:${b.score||76}%"></i></div></div></div>`)+
 `<div class="grid2">${metric('FEAR & GREED',(s.crypto?.fearGreed??'—')+' '+(s.crypto?.fearGreedLabel||''),'amber')}${metric('BTC DOM.',fmt(s.crypto?.btcDominancePct||0,2)+'%','cyan')}${metric('TOTAL CAP','$'+fmt(s.crypto?.totalMarketCapT||0,2)+'T')}${metric('BTC 7T','+'+fmt(s.crypto?.btc7dPct||0,2)+'%','green')}</div>`+
 card(`<div class="section-title">LIVE FEED HEALTH</div><div class="feed-health ${fh.status.toLowerCase()}"><b>${sourceBadge(fh.status)} ${fh.source}</b><span>${fh.age==null?'noch kein Tick':fh.age+'s alt'}</span></div><div class="row"><span>Binance WebSocket</span><b class="${FEED.ws==='CONNECTED'?'green':'amber'}">${FEED.ws}</b></div><div class="row"><span>Binance REST</span><b>${FEED.binanceRest}</b></div><div class="row"><span>CoinGecko Fallback</span><b>${FEED.coinGecko}</b></div><p class="footer-note">LIVE wird nur angezeigt, wenn tatsächlich ein aktueller API-/WebSocket-Kurs vorliegt. Nach 45 Sekunden ohne Update wird der Status STALE/FALLBACK.</p>`)+
 card(`<div class="section-head"><div class="section-title">LIVE KURSE</div><span class="section-note">WebSocket → REST → CoinGecko</span></div>${liveRows}`)+
 card(`<div class="section-title">PORTFOLIO-IMPLIKATION</div><div class="row"><span>Spot-Regime</span><b class="green">RISK-ON</b></div><div class="row"><span>Futures-Bias</span><b class="amber">${r.netDirection||'—'}</b></div><div class="row"><span>Bot-Risiko</span><b class="red">${r.riskLevel||'—'}</b></div><p class="footer-note">Live-Kurse fließen automatisch in Depotwerte und Positionsanteile ein. Futures-Snapshotdaten bleiben davon getrennt.</p>`)+
 card(`<div class="section-title">MACRO ${snapshotBadge('VERIFIED SNAPSHOT')}</div><div class="row"><span>Fed Funds</span><b>${mac.fedFunds||'—'}</b></div><div class="row"><span>US CPI / Core</span><b>${fmt(mac.cpiHeadlineYoY,1)}% / ${fmt(mac.cpiCoreYoY,1)}%</b></div><div class="row"><span>Arbeitslosenquote</span><b>${fmt(mac.unemploymentPct,1)}%</b></div><div class="row"><span>US 10Y</span><b>${fmt(mac.us10yPct,3)}%</b></div><p class="footer-note">${mac.summary||''}</p>`)+
 card(`<div class="section-title">RADAR <span class="muted" style="float:right;font-size:9px">LIVE / FALLBACK</span></div>${radar.map(x=>{const q=DATA.livePrices?.[x.symbol],ch=q?.change24h??x.change24h;return `<div class="asset-row">${coinIcon(x.symbol)}<div><div class="asset-name">${x.symbol}</div><div class="asset-desc">${q?q.source:'Momentum'}</div></div><div>${q?sourceBadge(quoteStatus(q)):''}</div><div class="asset-change ${ch<0?'red':''}">${ch>=0?'+':''}${fmt(ch,1)}%</div></div>`}).join('')}`);
}
function bottomView(){
 const n=DATA.nadir,c=n.currentVerifiedContext||{},q=DATA.livePrices?.BTC,btc=q?.price||c.btcPrice||0;
 return card(`<div class="eyebrow">NADIR 2.1 ${snapshotBadge('MODEL')}</div><div class="forecast-main">${n.label}</div><div class="sub">Bewertung · Kapitulation · Holder · Timing</div><p class="footer-note">${n.note||''}</p>`)+
 card(`<div class="section-title">MARKTKONTEXT</div><div class="grid2">${metric('BTC','$'+fmt(btc)+(q?'<div class="data-state">'+sourceBadge(quoteStatus(q))+'</div>':''))}${metric('BTC 7T','+'+fmt(c.btc7dPct||0,2)+'%','green')}${metric('FEAR & GREED',c.fearGreed||'—','amber')}${metric('BTC DOM.',fmt(c.btcDominancePct||0,2)+'%')}</div>`)+
 card(`<div class="row"><span class="eyebrow">NADIR GESAMTSCORE</span><span class="score amber">${n.score}/100</span></div><div class="bar"><i style="width:${n.score}%"></i></div><p class="muted">${snapshotBadge('LAST CONFIRMED')} ${n.snapshotAt||''}</p>`)+
 `<div class="grid2">${metric('BEWERTUNG',n.valuation+'/100')}${metric('KAPITULATION',n.capitulation+'/100')}${metric('HOLDER',n.holder+'/100')}${metric('TIMING',n.timing+'/100')}</div>`+
 card(`<div class="section-title">BTC BODEN-SZENARIEN ${snapshotBadge('MODEL')}</div>${Object.entries(n.btcScenarios).map(([k,v])=>`<div class="row"><span class="${k==='Base Case'?'amber':''}">${k}</span><b class="${k==='Base Case'?'amber':''}">${v}</b></div>`).join('')}`);
}
function stateLabel(v){return (v||'').includes('LIVE')?liveBadge('LIVE'):snapshotBadge('SNAPSHOT')}
function dayTrade(){
 const d=DATA.dayTrade, st=d.status||{};
 return card(`<div class="eyebrow">DAY-TRADE 2.2</div><div class="forecast-main">${d.entryAllowed?'ENTRY FREIGEGEBEN':'ENTRY NICHT FREIGEGEBEN'}</div><div class="sub">${d.decisionNote||'Bias ≠ Ausführung'}</div><div class="row"><b>GATE SCORE</b><b class="${d.entryAllowed?'green':'amber'}">${d.gateScore}/100</b></div><div class="bar"><i style="width:${d.gateScore}%"></i></div>`)+
 `<div class="grid2">${metric('BTC PREIS','$'+fmt(d.btcPrice)+'<div class="data-state">'+stateLabel(st.btcPrice)+'</div>')}${metric('OPEN INTEREST','$'+fmt(d.oiB,2)+'B<div class="data-state">'+stateLabel(st.oiB)+'</div>')}${metric('4H RSI',fmt(d.rsi4h,2)+'<div class="data-state">'+stateLabel(st.rsi4h)+'</div>')}${metric('1H RSI',fmt(d.rsi1h,2)+'<div class="data-state">'+stateLabel(st.rsi1h)+'</div>')}${metric('FUNDING',fmt(d.fundingPct,4)+'%<div class="data-state">'+stateLabel(st.fundingPct)+'</div>')}${metric('24H VWAP','$'+fmt(d.vwap)+'<div class="data-state">'+stateLabel(st.vwap)+'</div>')}</div>`+
 card(`<div class="section-title">LIVE-DATEN ENGINE</div><div class="row"><span>Quelle</span><b>Binance Futures Browser API</b></div><div class="row"><span>Letzter Technik-Refresh</span><b>${d.technicalUpdatedAt?new Date(d.technicalUpdatedAt).toLocaleTimeString('de-DE'):'Fallback aktiv'}</b></div><div class="row"><span>Gate</span><b>${d.entryAllowed?'≥70 · erfüllt':'<70 · blockiert'}</b></div><p class="footer-note">Wenn Binance im Browser blockiert ist, bleiben die zuletzt bestätigten Snapshot-Werte sichtbar und werden nicht als live ausgegeben.</p>`)+
 card(`<div class="section-title">FIB LEVELS ${snapshotBadge('MODEL')}</div>${d.fib.levels.map(l=>`<div class="row fib-row"><span>${fmt(l.ratio,1)}%<br><span class="tag ${l.tag==='RESIST'?'red':l.tag==='SUPPORT'?'green':'cyan'}">${l.tag}</span></span><b>$${fmt(l.price)}</b><span class="muted">${l.price>d.btcPrice?'-':'+'}${fmt(Math.abs((l.price/d.btcPrice-1)*100),1)}%</span></div>`).join('')}`);
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
   card(`<div class="section-title">SZENARIEN</div><div class="scenario-grid"><div><span>BEAR</span><b>$${fmt(f.low,activeCoin==='PEPE'?8:2)}</b></div><div><span>BASE</span><b class="cyan">$${fmt(f.high,activeCoin==='PEPE'?8:2)}</b></div><div><span>BULL</span><b class="green">$${fmt(f.fib[1],activeCoin==='PEPE'?8:2)}</b></div></div><p class="footer-note">Bear = 90T Low · Base = 90T High · Bull = 1,618 FIB. Modellzonen, keine Garantie.</p>`)+
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

function gridQuote(sym){
 const q=(typeof LIVE_QUOTES!=='undefined'&&LIVE_QUOTES[sym])||{};
 return +q.price||0;
}
function gridBot(sym){
 return ((DATA&&DATA.pionexRisk&&DATA.pionexRisk.bots)||[]).find(b=>b.symbol===sym)||null;
}
function gridFmt(v,sym){
 if(!Number.isFinite(+v))return '—';
 if(sym==='HBAR')return fmt(+v,5);
 if(sym==='XRP')return fmt(+v,4);
 return fmt(+v,2);
}
function fibFromBot(sym){
 const b=gridBot(sym); if(!b)return null;
 const px=gridQuote(sym)||+b.currentPrice||+b.createdPrice||0;
 const hi=+b.takeProfit||+b.rangeHigh||px;
 let lo=+b.rangeLow||(+b.liquidation||px*.75);
 // Use bot range as stable swing proxy until a dedicated swing engine is reintroduced.
 if(!(hi>lo)){lo=px*.8}
 const span=hi-lo;
 const fib={
   f236:hi-span*.236,
   f382:hi-span*.382,
   f500:hi-span*.500,
   f618:hi-span*.618,
   f786:hi-span*.786,
   ext1272:hi+span*.272
 };
 const entryLow=fib.f618, entryHigh=fib.f500;
 const rangeLow=fib.f786, rangeHigh=hi;
 let state='WAIT';
 if(px>=entryLow&&px<=entryHigh) state='START ZONE';
 else if(px>entryHigh&&px<=fib.f382) state='WATCH';
 else if(px>=hi) state='TP HIT';
 else if(px<fib.f786) state='NEW RANGE';
 else state='WAIT';
 return {b,px,hi,lo,fib,entryLow,entryHigh,rangeLow,rangeHigh,state};
}
function gridVisual(g,sym){
 const top=g.hi,bottom=g.lo,span=Math.max(top-bottom,1e-12);
 const levels=[
  ['TP/HIGH',g.hi],['0.236',g.fib.f236],['0.382',g.fib.f382],
  ['0.500',g.fib.f500],['0.618',g.fib.f618],['0.786',g.fib.f786],['LOW',g.lo]
 ];
 const ptop=Math.max(1,Math.min(98,(top-g.px)/span*100));
 return `<div class="grid-fib-chart">
   <div class="grid-entry-band" style="top:${(top-g.entryHigh)/span*100}%;height:${(g.entryHigh-g.entryLow)/span*100}%"><span>PREFERRED ENTRY 0.500–0.618</span></div>
   ${levels.map(([n,v])=>`<div class="grid-fib-line ${n==='0.500'||n==='0.618'?'preferred':''}" style="top:${(top-v)/span*100}%"><span>${n}</span><b>$${gridFmt(v,sym)}</b></div>`).join('')}
   <div class="grid-price-line" style="top:${ptop}%"><i></i><b>$${gridFmt(g.px,sym)}</b></div>
 </div>`;
}
function gridStatusClass(s){
 return s==='START ZONE'?'green':s==='TP HIT'?'green':s==='NEW RANGE'?'red':'amber';
}
function gridView(){
 const syms=['HBAR','XRP'];
 const cards=syms.map(sym=>{
   const g=fibFromBot(sym);
   if(!g)return card(`<div class="section-title">${sym}</div><p class="footer-note">Botdaten fehlen.</p>`);
   const b=g.b;
   return card(`<div class="section-head"><div><div class="section-title">${sym} COIN-M LONG</div><div class="section-note">Pionex ${snapshotBadge('SNAPSHOT')}</div></div><span class="tag ${gridStatusClass(g.state)}">${g.state}</span></div>
    ${gridVisual(g,sym)}
    <div class="grid2">
      ${metric('LIVE PREIS','$'+gridFmt(g.px,sym),'green')}
      ${metric('BOT TP','$'+gridFmt(g.hi,sym))}
      ${metric('ENTRY ZONE','$'+gridFmt(g.entryLow,sym)+'–$'+gridFmt(g.entryHigh,sym),'cyan')}
      ${metric('NÄCHSTE RANGE','$'+gridFmt(g.rangeLow,sym)+'–$'+gridFmt(g.rangeHigh,sym),'amber')}
      ${metric('TP2 · 1.272','$'+gridFmt(g.fib.ext1272,sym))}
      ${metric('HEBEL',String(b.leverage||'—')+'×')}
    </div>
    <p class="footer-note">Range-Basis in v5.0.5: bestehende Bot-Range/TP + Livepreis. Dedizierte Swing-Erkennung kommt erst in einem separaten Build.</p>`);
 }).join('');
 return card(`<div class="eyebrow">FIB GRID ENGINE ${liveBadge('LIVE PRICE')}</div><div class="forecast-main">NEXT COIN-M RANGE</div><div class="sub">HBAR + XRP · isoliertes Modul auf stabiler v5.0.4-Basis</div>`)+cards;
}

function settings(){
 const cached=DATA.forecastCoins.filter(c=>loadCache(c)).length,r=DATA.pionexRisk||{},fh=feedHealth();
 return card(`<div class="section-title">LIVE DATA STATUS</div><div class="row"><span>App-Version</span><b>${DATA.appVersion}</b></div><div class="row"><span>Build</span><b>${DATA.build}</b></div><div class="row"><span>BTC Feed</span><b>${sourceBadge(fh.status)} ${fh.source}</b></div><div class="row"><span>Feed-Alter</span><b>${fh.age==null?'—':fh.age+' Sek.'}</b></div><div class="row"><span>WebSocket</span><b class="${FEED.ws==='CONNECTED'?'green':'amber'}">${FEED.ws}</b></div><div class="row"><span>Binance REST</span><b>${FEED.binanceRest}</b></div><div class="row"><span>CoinGecko</span><b>${FEED.coinGecko}</b></div><div class="row"><span>Day-Trade Technik</span><b>${DATA.dayTrade.technicalUpdatedAt?'Browser Live':'Fallback/Snapshot'}</b></div><div class="row"><span>Pionex</span><b>${r.status||'—'} · 09:12</b></div><div class="row"><span>History-Cache</span><b>${cached}/${DATA.forecastCoins.length}</b></div><div class="row"><span>Portfolio-Historie</span><b>${PORTFOLIO_SERIES.length} Punkte</b></div><div class="row"><span>Cashflows</span><b>${CASHFLOWS.length} Einträge</b></div>`)+
 card(`<div class="section-title">v4.9.3 LIVE STREAM</div><div class="row"><span>Primärfeed</span><b class="green">Binance WebSocket</b></div><div class="row"><span>Fallback 1</span><b>Binance REST · 15s Health</b></div><div class="row"><span>Fallback 2</span><b>CoinGecko REST</b></div><div class="row"><span>Portfolio-Recalc</span><b class="green">automatisch</b></div><div class="row"><span>Statuslogik</span><b class="green">LIVE / STALE / FALLBACK / SNAPSHOT</b></div><div class="row"><span>UI Drosselung</span><b>max. 1 Refresh/Sek.</b></div>`)+
 card(`<div class="section-title">WEG ZU v5.0</div><div class="row"><span>Pionex Bot Auto-Sync</span><b class="amber">API nötig</b></div><div class="row"><span>On-Chain NADIR</span><b class="amber">Quelle/API nötig</b></div><div class="row"><span>BTC-Short Liq./Notional</span><b class="red">frische Bot-Daten nötig</b></div><p class="footer-note">Live-Spotpreise sind jetzt von Snapshotdaten getrennt. Wenn alle Livequellen ausfallen, zeigt MERIDIAN ausdrücklich FALLBACK oder SNAPSHOT statt LIVE.</p><button onclick="location.reload()" class="tab active" style="width:100%;margin-top:16px">FEEDS NEU VERBINDEN</button>`);
}
function renderError(view,e){
 console.error('MERIDIAN view error',view,e);
 return card(`<div class="eyebrow">VIEW FEHLER · ${view.toUpperCase()}</div><div class="forecast-main">MODUL ISOLIERT</div><p class="footer-note">${String(e&&e.message||e||'Unbekannter Fehler')}</p><button class="tab active" onclick="location.reload()" style="width:100%;margin-top:12px">NEU LADEN</button>`);
}
function safeRender(selector,view,fn){
 try{
   const el=$(selector); if(!el)return;
   el.innerHTML=fn();
 }catch(e){
   const el=$(selector); if(el)el.innerHTML=renderError(view,e);
 }
}
function renderOne(view){
 const map={
  center:['#view-center',commandCenter],
  depot:['#view-depot',depot],
  market:['#view-market',market],
  bottom:['#view-bottom',bottomView],
  daytrade:['#view-daytrade',dayTrade],
  grid:['#view-grid',gridView],
  forecast:['#view-forecast',null],
  settings:['#view-settings',settings]
 };
 const item=map[view]; if(!item)return;
 const el=$(item[0]); if(!el)return;
 try{
   if(view==='forecast') renderForecast();
   else el.innerHTML=item[1]();
   el.dataset.rendered='1';
 }catch(e){
   console.error('MERIDIAN render error',view,e);
   el.innerHTML='<div class="card render-fallback"><div class="eyebrow">VIEW FEHLER · '+view.toUpperCase()+
     '</div><div class="forecast-main">MODULFEHLER</div><p class="footer-note">'+
     String(e&&e.message||e)+'</p></div>';
 }
}
function renderAll(){
 ['center','depot','market','bottom','daytrade','grid','forecast','settings'].forEach(renderOne);
}
function openView(view,button){
 document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));
 if(button)button.classList.add('active');
 document.querySelectorAll('main>section').forEach(x=>x.classList.add('hidden'));
 const el=$('#view-'+view);
 if(!el)return;
 // Critical fix: render the requested view at click-time, not only during boot.
 renderOne(view);
 el.classList.remove('hidden');
 window.scrollTo({top:0,behavior:'smooth'});
 if(view==='forecast') selectCoin(activeCoin);
}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>openView(b.dataset.view,b));
$('#settingsBtn').onclick=()=>openView('settings',null);
/* v5.0.4 lazy view recovery: service worker disabled during recovery */
load();
