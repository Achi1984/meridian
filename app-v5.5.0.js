
const $=s=>document.querySelector(s);
const fmt=(n,d=0)=>new Intl.NumberFormat('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
let DATA=null,HISTORY={status:'browser-live',coins:{}},activeCoin='BTC',LAST_PRICE_UPDATE=null,PRICE_WS=null,UI_RENDER_TIMER=null,PORTFOLIO_SERIES=[],ACTIVE_PORTFOLIO_RANGE='1D',CASHFLOWS=[];
let APP_CODE_VERSION='5.6.0';
let APP_RELEASE='5.6.0 · DESIGN SYSTEM 2.0';
let FEED={ws:'OFFLINE',binanceRest:'UNKNOWN',coinGecko:'UNKNOWN',lastWsAt:null,lastRestAt:null,lastCgAt:null,lastError:null};
let GRID_SWINGS={},GRID_LOADING={},GRID_ENGINE_STATUS={};

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
  d.status={btcPrice:'BROWSER LIVE · BINANCE FUTURES',oiB:'BROWSER LIVE · BINANCE BTCUSDT CONTRACT OI',rsi4h:'BROWSER LIVE · BINANCE FUTURES',rsi1h:'BROWSER LIVE · BINANCE FUTURES',fundingPct:'BROWSER LIVE · BINANCE BTCUSDT',vwap:'BROWSER LIVE · BINANCE FUTURES 1H',fib:'MODEL'};
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
   const [dataRes, versionRes]=await Promise.all([
     fetch('data.json?v='+stamp,{cache:'no-store'}),
     fetch('version.json?v='+stamp,{cache:'no-store'})
   ]);
   if(!dataRes.ok)throw new Error('data.json HTTP '+dataRes.status);
   DATA=await dataRes.json();
   let runtimeVersion={version:'5.1.9a'};
   if(versionRes.ok){
     try{runtimeVersion=await versionRes.json()}catch(e){}
   }
   APP_CODE_VERSION=runtimeVersion.version||'5.1.9a';
   APP_RELEASE=APP_CODE_VERSION+' · ACTION ENGINE';
   DATA.appVersion=APP_CODE_VERSION;
   try{loadPortfolioSeries()}catch(e){}
   $('#versionBadge').textContent='v'+APP_CODE_VERSION+' · LIVE';
   renderAll(); // snapshot must appear immediately, before any external API call
   updateHeaderFeedClock();

   // Live engines run independently and may fail without blanking the app.
   Promise.allSettled([refreshCurrentPortfolioPrices(),refreshDayTradeTechnicals()])
    .then(()=>{
      $('#versionBadge').textContent='v'+APP_CODE_VERSION+' · LIVE';
      try{recalcPortfolio()}catch(e){}
      renderAll(); updateHeaderFeedClock();
      refreshGridEngine(false).catch(()=>{});
    });

   loadCoinHistory(activeCoin).then(()=>renderForecast()).catch(()=>renderForecast());
 }catch(e){
   console.error('MERIDIAN BOOT ERROR',e);
   $('#versionBadge').textContent='v'+APP_CODE_VERSION+' · ERROR';
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

function clamp100(v){return Math.max(0,Math.min(100,Math.round(v)))}
function decisionTone(action){
 if(action==='REDUCE'||action==='NO TRADE')return 'red';
 if(action==='GRID ENTRY'||action==='ACCUMULATE')return 'green';
 return 'amber';
}
function decisionEngine(){
 const risk=commandRisk(), f=forecast('BTC'), fs=forecastState(f);
 const d=DATA.dayTrade||{}, n=DATA.nadir||{}, reg=DATA.btcRegime||{};
 const hbarG=fibFromSwing('HBAR'), xrpG=fibFromSwing('XRP');
 const hbarA=hbarG?botAction(hbarG):null, xrpA=xrpG?botAction(xrpG):null;

 // MASTER: protect capital when model/top risk and leverage stress are elevated.
 let masterAction='HOLD', masterConf=58, masterReasons=[];
 if(risk.score>=80){masterAction='REDUCE';masterConf+=15;masterReasons.push(`MERIDIAN Risk ${risk.score}/100`)}
 if(fs?.label==='DISTRIBUTION RISK'){masterAction='REDUCE';masterConf+=10;masterReasons.push(`BTC ${fs.label}`)}
 if((DATA.pionexRisk?.riskLevel||'').toUpperCase()==='HIGH'){masterConf+=6;masterReasons.push('Bot-Risiko HIGH')}
 if((reg.label||'').includes('SHORT-SQUEEZE')){masterConf+=4;masterReasons.push('Short-Squeeze / Überdehnung')}
 masterConf=clamp100(masterConf);

 // BTC SPOT: reduce only when late-cycle risk is high; otherwise hold.
 let btcAction='HOLD', btcConf=60, btcReasons=[];
 if(f?.ready&&f.risk>=80&&f.pos>=90){
   btcAction='REDUCE'; btcConf=clamp100(64+(f.risk-80)*.6+(f.pos-90)*.7);
   btcReasons.push(`Top-Risk ${f.risk}/100`, `90T-Swing ${fmt(f.pos,1)}%`);
 } else if(f?.ready&&f.pos<45&&f.ret90<0&&n.score>=65){
   btcAction='ACCUMULATE'; btcConf=70; btcReasons.push('Reset/Reakkumulation',`NADIR ${n.score}/100`);
 } else {
   btcReasons.push(f?.ready?`State ${fs.label}`:'Forecast lädt');
 }

 // DAY TRADE: hard gate.
 const dayAction=d.entryAllowed&&(+d.gateScore||0)>=70?'GRID ENTRY':'NO TRADE';
 const dayConf=clamp100(dayAction==='NO TRADE'?70+(70-(+d.gateScore||0))*.4:65+(+d.gateScore-70)*.6);
 const dayReasons=[`Gate ${d.gateScore||0}/100`, d.entryAllowed?'Entry Flag aktiv':'Entry Flag blockiert'];

 // NADIR: accumulation only if model + current context are supportive.
 const ctx=n.currentVerifiedContext||{};
 let nadirAction='HOLD', nadirConf=58, nadirReasons=[];
 if(+n.score>=70 && (+ctx.fearGreed||50)<=35){
   nadirAction='ACCUMULATE';nadirConf=clamp100(65+(+n.score-70)*.6);nadirReasons.push(`NADIR ${n.score}/100`,`Fear & Greed ${ctx.fearGreed}`);
 } else {
   nadirReasons.push(`NADIR Snapshot ${n.score}/100`);
   if((+ctx.fearGreed||0)>=65)nadirReasons.push(`Fear & Greed ${ctx.fearGreed} = kein Kapitulationsumfeld`);
 }

 function gridDecision(sym,g,a){
   if(!g||!a)return {symbol:sym,action:'NO TRADE',confidence:45,reasons:['4H-Swing lädt']};
   let action='HOLD';
   if(a.label==='ADD ZONE')action='GRID ENTRY';
   else if(a.label==='NO ADD'||a.label==='RANGE SHIFT')action='NO TRADE';
   else if(a.label==='TP HIT')action='REDUCE';
   else action='HOLD';
   let confidence=gridConfidence(g);
   const reasons=[a.reason,`4H Swing ${fmt(g.ampPct,1)}%`,`Frequenz ${g.frequency||'—'}/100`];
   return {symbol:sym,action,confidence:clamp100(confidence),reasons};
 }
 const hbar=gridDecision('HBAR',hbarG,hbarA), xrp=gridDecision('XRP',xrpG,xrpA);

 // Scanner: only greenlight when score and FIB state agree.
 const scans=['SOL','ETH','PEPE'].map(sym=>{
   const g=fibFromSwing(sym);
   if(!g)return {symbol:sym,action:'NO TRADE',confidence:40,reasons:['Scanner lädt']};
   const sc=scannerScore(g,sym);
   const action=(g.state==='START ZONE'&&sc>=82&&risk.score<80)?'GRID ENTRY':'NO TRADE';
   return {symbol:sym,action,confidence:clamp100(sc),reasons:[`Scanner ${sc}/100`,`State ${g.state}`]};
 });
 return {
   master:{action:masterAction,confidence:masterConf,reasons:masterReasons},
   btc:{action:btcAction,confidence:btcConf,reasons:btcReasons},
   day:{action:dayAction,confidence:dayConf,reasons:dayReasons},
   nadir:{action:nadirAction,confidence:nadirConf,reasons:nadirReasons},
   hbar,xrp,scans
 };
}
function decisionRow(label,obj){
 const tone=decisionTone(obj.action);
 return `<div class="decision-row"><div><b>${label}</b><small>${(obj.reasons||[]).slice(0,2).join(' · ')}</small></div><div class="decision-side"><span class="decision-action ${tone}">${obj.action}</span><strong>${obj.confidence}/100</strong></div></div>`;
}
function decisionPanel(){
 const x=decisionEngine(), tone=decisionTone(x.master.action);
 return card(`<div class="section-head"><div><div class="section-title">DECISION ENGINE 1.0</div><div class="section-note">Forecast · NADIR · Day-Trade · Grid · Risk</div></div><span class="tag cyan">MODEL</span></div>
   <div class="decision-master ${tone}">
     <div><span>MASTER ACTION</span><b>${x.master.action}</b><small>${x.master.reasons.join(' · ')||'Keine dominante Risikoabweichung'}</small></div>
     <strong>${x.master.confidence}<small>/100</small></strong>
   </div>
   ${decisionRow('BTC SPOT',x.btc)}
   ${decisionRow('DAY-TRADE',x.day)}
   ${decisionRow('NADIR / AKKUMULATION',x.nadir)}
   ${decisionRow('HBAR 5x BOT',x.hbar)}
   ${decisionRow('XRP 5x BOT',x.xrp)}
   <div class="decision-scanner">${x.scans.map(s=>`<span>${s.symbol} <b class="${decisionTone(s.action)}">${s.action}</b> ${s.confidence}</span>`).join('')}</div>
   <p class="footer-note">Modellentscheidung, keine Auto-Ausführung. Pionex-Botdaten bleiben Snapshot; unbekannte Liquidationsdaten werden nicht geschätzt.</p>`,'decision-card');
}


function signalEngine(){
 try{
  const d=DATA.dayTrade||{}, out=[], gate=Number(d.gateScore)||0;
  const add=(p,t,x,s)=>out.push({p,t,x,s});
  add(gate>=70?'NOW':gate>=60?'WATCH':'WAIT','DAY-TRADE GATE',`Gate ${gate}/100`,gate);
  const regime=(DATA.market&&DATA.market.regime)||(DATA.btcRegime&&DATA.btcRegime.label)||'';
  const rs=Number(DATA.btcRegime&&DATA.btcRegime.score)||0;
  if(regime) add(rs>=80?'NOW':'WATCH','MARKTREGIME',regime,rs||76);
  const btc=Number(d.btcPrice)||0, lv=d.fib&&Array.isArray(d.fib.levels)?d.fib.levels:[];
  const r=lv.filter(x=>x.tag==='RESIST').map(x=>Number(x.price)).filter(Boolean).sort((a,b)=>a-b)[0];
  if(btc&&r){const z=(r/btc-1)*100;if(z<=0)add('NOW','BTC BREAKOUT','Resistance überschritten',90);else if(z<=1.5)add('WATCH','BTC BREAKOUT',`${z.toFixed(1).replace('.',',')}% bis Resistance`,82);}
  const rank={NOW:0,WATCH:1,WAIT:2}; return out.sort((a,b)=>rank[a.p]-rank[b.p]||b.s-a.s).slice(0,5);
 }catch(e){console.warn('Signal Engine isolated',e);return[]}
}
function signalPanel(){
 try{
  const s=signalEngine(); if(!s.length)return'';
  const c={NOW:'red',WATCH:'amber',WAIT:'muted'};
  return card(`<div class="section-title">ACTIVE SIGNALS <span class="tag cyan">ENGINE 1.0</span></div>${s.map(x=>`<div class="row"><span><b class="${c[x.p]}">${x.p}</b> · ${x.t}<br><span class="muted">${x.x}</span></span><b>${x.s||'—'}</b></div>`).join('')}<p class="footer-note">Priorisierung aus vorhandenen MERIDIAN-Daten · keine Order-Ausführung.</p>`);
 }catch(e){return''}
}


function confluenceEngine(){
 try{
  const x=decisionEngine(), d=DATA.dayTrade||{}, risk=commandRisk();
  const reg=(DATA.btcRegime&&DATA.btcRegime.label)||(DATA.market&&DATA.market.regime)||'—';
  const botRisk=((DATA.pionexRisk&&DATA.pionexRisk.riskLevel)||'').toUpperCase();
  const shortPnl=Number(DATA.pionex&&DATA.pionex.btcShortPnlPct);
  const shortCritical=Number.isFinite(shortPnl)&&shortPnl<=-70;

  // Normalize module outputs into the user-facing action vocabulary.
  const norm=a=>{
    a=(a||'').toUpperCase();
    if(a==='GRID ENTRY'||a==='ACCUMULATE')return 'ADD';
    if(a==='REDUCE')return 'REDUCE';
    if(a==='HEDGE')return 'HEDGE';
    if(a==='NO TRADE')return 'WATCH';
    return 'HOLD';
  };

  const modules=[
    {name:'MASTER RISK', action:norm(x.master.action), confidence:x.master.confidence, reasons:x.master.reasons||[]},
    {name:'BTC SPOT', action:norm(x.btc.action), confidence:x.btc.confidence, reasons:x.btc.reasons||[]},
    {name:'DAY-TRADE', action:norm(x.day.action), confidence:x.day.confidence, reasons:x.day.reasons||[]},
    {name:'HBAR BOT', action:norm(x.hbar.action), confidence:x.hbar.confidence, reasons:x.hbar.reasons||[]},
    {name:'XRP BOT', action:norm(x.xrp.action), confidence:x.xrp.confidence, reasons:x.xrp.reasons||[]}
  ];

  // Risk-first weighting: capital protection outranks opportunity signals.
  const weight={REDUCE:4,HEDGE:3,WATCH:2,HOLD:1,ADD:0};
  let posture='HOLD';
  if(risk.score>=80 || x.master.action==='REDUCE') posture='REDUCE';
  else if(risk.score>=68 || (+d.gateScore||0)<70) posture='WATCH';

  // HEDGE is only allowed when risk is elevated AND the existing short is not already critically stressed.
  if(posture!=='REDUCE' && risk.score>=72 && !shortCritical && botRisk!=='HIGH') posture='HEDGE';

  // ADD requires broad agreement, low enough total risk and a valid trade/grid trigger.
  const addVotes=modules.filter(m=>m.action==='ADD' && m.confidence>=70).length;
  if(risk.score<70 && (+d.gateScore||0)>=70 && addVotes>=2) posture='ADD';

  const conflicts=modules.filter(m=>m.action!==posture && m.action!=='HOLD').length;
  let score=Math.round(
    46 +
    Math.min(25, risk.score*.22) +
    Math.min(15, (x.master.confidence||0)*.12) +
    (posture==='REDUCE'?8:posture==='WATCH'?4:posture==='ADD'?6:3) -
    Math.min(12, conflicts*2)
  );
  score=Math.max(35,Math.min(96,score));

  const headline={
    REDUCE:'RISIKO REDUZIEREN',
    HEDGE:'HEDGE PRÜFEN',
    WATCH:'BEOBACHTEN / NICHT ERHÖHEN',
    ADD:'ADD FREIGABE',
    HOLD:'HALTEN'
  }[posture];

  const why=[];
  if(risk.score>=80)why.push(`MERIDIAN Risk ${risk.score}/100`);
  if((reg||'').includes('SHORT-SQUEEZE'))why.push('Short-Squeeze / Überdehnung');
  if((+d.gateScore||0)<70)why.push(`Day-Gate ${d.gateScore||0}/100 blockiert`);
  if(botRisk==='HIGH')why.push('Bot-Risiko HIGH');
  if(shortCritical)why.push('BTC-Short bereits kritisch gestresst');
  if(!why.length)why.push('Keine dominante Risikoabweichung');

  return {posture,headline,score,modules,why,shortCritical,regime:reg};
 }catch(e){
  console.warn('Confluence Engine isolated',e);
  return {posture:'WATCH',headline:'DATEN PRÜFEN',score:40,modules:[],why:['Confluence-Modul Fallback'],shortCritical:false,regime:'—'};
 }
}
function confluencePanel(){
 try{
  const c=confluenceEngine();
  const tone={REDUCE:'red',HEDGE:'amber',WATCH:'amber',ADD:'green',HOLD:'cyan'}[c.posture]||'amber';
  const rows=c.modules.map(m=>`<div class="row"><span><b>${m.name}</b><br><span class="muted">${(m.reasons||[]).slice(0,1).join('')||'—'}</span></span><b class="${m.action==='REDUCE'?'red':m.action==='ADD'?'green':m.action==='WATCH'?'amber':'cyan'}">${m.action} · ${m.confidence}/100</b></div>`).join('');
  return card(`<div class="section-head"><div><div class="section-title">CONFLUENCE ENGINE 1.0</div><div class="section-note">TRADE + GRID + FCST + RISK</div></div><span class="tag cyan">MODEL</span></div>
    <div class="decision-master ${tone}">
      <div><span>CENTRAL ACTION</span><b>${c.headline}</b><small>${c.why.join(' · ')}</small></div>
      <strong>${c.score}<small>/100</small></strong>
    </div>
    ${rows}
    <p class="footer-note">Konfluenz priorisiert Kapitalrisiko vor neuen Entries. Kein automatisches Trading; Snapshot-/unverifizierte Botdaten bleiben entsprechend gekennzeichnet.</p>`,'decision-card');
 }catch(e){return''}
}


function actionEngine(){
 try{
  const c=confluenceEngine(), d=DATA.dayTrade||{}, r=DATA.pionexRisk||{}, risk=commandRisk();
  const bots=r.bots||[];
  const hbar=bots.find(b=>b.symbol==='HBAR');
  const xrp=bots.find(b=>b.symbol==='XRP');
  const critical=bots.find(b=>(b.recommendation||'').toUpperCase().includes('KRIT'));
  const items=[];
  const push=(priority,tone,target,action,reason,confidence,source)=>{
    items.push({priority,tone,target,action,reason,confidence:Math.max(0,Math.min(100,Math.round(confidence||0))),source});
  };

  // 1) Existing BTC short: never suggest adding risk when the position is already critically stressed.
  if(critical && critical.symbol==='BTC'){
    push(1,'red','BTC SHORT','FREEZE / LIQ-DATEN PRÜFEN',
      'Kein Aufstocken und kein automatisches Schließen. Position ist stark gestresst; Liquidationspreis zuerst frisch verifizieren.',
      96,'Pionex Snapshot');
  } else if(c.shortCritical){
    push(1,'red','BTC SHORT','FREEZE / PRÜFEN',
      'Short-Stress ist kritisch. Keine zusätzliche Hedge-Position ohne verifizierte Liquidationsdaten.',
      92,'Risk Engine');
  }

  // 2) HBAR leveraged bot.
  if(hbar){
    const lp=Number(hbar.liquidationDistancePct);
    if(Number.isFinite(lp) && lp < 30){
      push(2,'amber','HBAR 5x','NO ADD',
        `Liquidationspuffer nur ${fmt(lp,1)}%. Bestehenden Bot beobachten; kein zusätzliches Long-Risiko.`,
        88,'Pionex Snapshot');
    } else {
      push(3,'amber','HBAR 5x','HOLD / WATCH',
        'Bestehenden Bot halten, aber neue Long-Exposition nur bei klarerem Retracement.',
        72,'Pionex Snapshot');
    }
  }

  // 3) XRP leveraged bot.
  if(xrp){
    const lp=Number(xrp.liquidationDistancePct);
    push(3,'cyan','XRP 5x','HOLD',
      `Bestehenden Bot halten${Number.isFinite(lp)?`; Liq.-Puffer ${fmt(lp,1)}%`:''}. Für neuen Bot auf Retracement warten.`,
      82,'Pionex Snapshot');
  }

  // 4) Day trade gate.
  const gate=Number(d.gateScore)||0;
  if(gate < 70){
    push(2,'amber','DAY-TRADE','BLOCKED',
      `Gate ${gate}/100. Keine neue Intraday-Position, bis die technische Konfluenz ≥70 erreicht.`,
      Math.max(70,100-gate/2),'Live Technik');
  } else {
    push(4,'green','DAY-TRADE','READY / MANUELL PRÜFEN',
      `Gate ${gate}/100. Setup technisch freigegeben; Ausführung bleibt manuell.`,
      gate,'Live Technik');
  }

  // 5) Spot / portfolio risk.
  if(risk.score >= 80){
    push(2,'red','SPOT / PORTFOLIO','KEINE NEUEN KÄUFE',
      `MERIDIAN Risk ${risk.score}/100. Bestehende Positionen nicht aggressiv ausbauen; Kapitalreserve priorisieren.`,
      Math.min(96,risk.score+7),'Cross-Risk');
  } else if(risk.score >= 70){
    push(4,'amber','SPOT / PORTFOLIO','WATCH',
      `MERIDIAN Risk ${risk.score}/100. Nur selektiv und klein aufstocken.`,
      risk.score,'Cross-Risk');
  }

  // 6) Market regime informs, but does not override the concrete risk actions above.
  const reg=(DATA.btcRegime&&DATA.btcRegime.label)||(DATA.market&&DATA.market.regime)||'—';
  if((reg||'').includes('SHORT-SQUEEZE')){
    push(5,'cyan','MARKTREGIME','RISK-ON, ABER NICHT JAGEN',
      'Momentum bleibt positiv, gleichzeitig ist das Setup nach dem Squeeze überdehnungsgefährdet.',
      Number(DATA.btcRegime&&DATA.btcRegime.score)||76,'Regime Model');
  }

  // De-duplicate by target, keeping the highest-priority action.
  const seen=new Set();
  const queue=items.sort((a,b)=>a.priority-b.priority||b.confidence-a.confidence).filter(x=>{
    if(seen.has(x.target)) return false;
    seen.add(x.target); return true;
  }).slice(0,6);

  const central = risk.score>=80 ? 'RISIKO NICHT ERHÖHEN'
    : gate<70 ? 'WARTEN / KEIN NEUER TRADE'
    : c.headline;
  const centralTone = risk.score>=80 ? 'red' : gate<70 ? 'amber' : ({REDUCE:'red',WATCH:'amber',ADD:'green',HOLD:'cyan'}[c.posture]||'cyan');
  const centralScore = Math.max(c.score||0, risk.score>=80?88:0, gate<70?76:0);

  return {central,centralTone,centralScore,queue,risk:risk.score,gate};
 }catch(e){
  console.warn('Action Engine isolated',e);
  return {central:'DATEN PRÜFEN',centralTone:'amber',centralScore:40,queue:[],risk:0,gate:0};
 }
}
function actionQueuePanel(){
 try{
  const a=actionEngine();
  const rows=a.queue.map((x,i)=>`
   <div class="actionq-row ${x.tone}">
    <div class="actionq-num">${i+1}</div>
    <div class="actionq-main">
      <div class="actionq-top"><b>${x.target}</b><span class="actionq-action ${x.tone}">${x.action}</span></div>
      <small>${x.reason}</small>
      <div class="actionq-meta"><span>${x.source}</span><strong>${x.confidence}/100</strong></div>
    </div>
   </div>`).join('');
  return card(`<div class="section-head"><div><div class="section-title">ACTION ENGINE 1.0</div><div class="section-note">konkret · priorisiert · keine Auto-Ausführung</div></div><span class="tag cyan">MODEL</span></div>
    <div class="decision-master ${a.centralTone}">
      <div><span>CENTRAL ACTION</span><b>${a.central}</b><small>Risk ${a.risk}/100 · Day-Gate ${a.gate}/100</small></div>
      <strong>${a.centralScore}<small>/100</small></strong>
    </div>
    <div class="actionq">${rows||'<div class="muted">Keine priorisierte Aktion.</div>'}</div>
    <p class="footer-note">ACTION ENGINE fasst Confluence, Bot-Watch, Day-Trade und Spot-Risiko in einer Queue zusammen. Snapshot-/unverifizierte Botdaten bleiben ausdrücklich gekennzeichnet.</p>`,'decision-card action-engine-card');
 }catch(e){return''}
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
 card(`<div class="section-title">CROSS-RISK ENGINE <span class="tag amber">MODEL</span></div><div class="grid2">${metric('SPOT KONZENTRATION',((DATA.portfolio?.topPositions?.[0]?.share||21.4))+'%')}${metric('5x LONG CAPACITY','$'+fmt(DATA.pionex?.longCapacity||5642,0),'amber')}${metric('SHORT STRESS',DATA.pionex?.btcShortPnlPct!=null?fmt(DATA.pionex.btcShortPnlPct,1)+'%':'~−98%','red')}${metric('REGIME',DATA.btcRegime?.label||DATA.market?.regime||'—','cyan')}</div><p class="footer-note">Risiko wird gemeinsam betrachtet: Spot-Konzentration + gehebelte Long-Bots + Short-Hedge-Stress. Bot-Kapital wird nicht doppelt zum Portfolio addiert.</p>`)+
 actionQueuePanel()+
 card(`<div class="section-head"><div class="section-title">DATA HEALTH</div><span class="section-note">Transparenz</span></div><div class="cc-health"><div><span class="feed-dot"></span><b>BTC Livefeed</b></div><strong class="${fh.status==='LIVE'?'green':'amber'}">${fh.status} · ${fh.age??'—'}s</strong></div><div class="cc-health"><div><span class="status-dot snapshot"></span><b>Pionex Bots</b></div><strong class="amber">SNAPSHOT 09:12</strong></div><div class="cc-health"><div><span class="status-dot snapshot"></span><b>NADIR</b></div><strong class="amber">MODEL SNAPSHOT</strong></div>`,'cc-health-card')+
 `<button class="cc-open-depot" onclick="document.querySelector('.nav[data-view=depot]').click()">DEPOT & POSITIONEN ÖFFNEN →</button>`+card(`<div class="section-head"><div class="section-title">COIN-M SCANNER</div><span class="section-note">GRID ENGINE 1.2</span></div>${['SOL','ETH','PEPE'].map(sym=>{const g=fibFromSwing(sym);if(!g)return `<div class="row"><span>${sym}</span><b>LÄDT</b></div>`;const sc=scannerScore(g,sym);return `<div class="row"><span>${sym} · ${g.state}</span><b class="${sc>=82?'green':sc>=72?'amber':'red'}">${sc}/100</b></div>`}).join('')}<p class="footer-note">Details und nächste FIB-Range im GRID-Tab.</p>`);
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

function currentNadirContext(){
 const n=DATA.nadir||{}, c=n.currentVerifiedContext||{}, q=DATA.livePrices?.BTC||{};
 const fg=Number(c.fearGreed), mom=Number(c.btc7dPct), dom=Number(c.btcDominancePct);
 let score=10;
 if(Number.isFinite(fg)) score+=Math.max(0,50-fg)*1.4;
 if(Number.isFinite(mom)) score+=Math.max(0,-mom)*2.2;
 if(Number.isFinite(dom)&&dom>62) score+=Math.min(12,(dom-62)*2);
 score=Math.max(0,Math.min(100,Math.round(score)));
 let label='NEUTRAL / KEIN NADIR';
 let cls='amber';
 if(score>=70){label='KAPITULATIONS-NÄHE';cls='green'}
 else if(score>=45){label='BODEN-KONTEXT BAUT SICH AUF';cls='amber'}
 else if((Number.isFinite(fg)&&fg>=65)||(Number.isFinite(mom)&&mom>=10)){label='KEIN NADIR · RISK-ON / ÜBERDEHNT';cls='red'}
 const drivers=[];
 if(Number.isFinite(fg))drivers.push(`Fear & Greed ${fg}`);
 if(Number.isFinite(mom))drivers.push(`BTC 7T ${mom>=0?'+':''}${fmt(mom,2)}%`);
 if(Number.isFinite(dom))drivers.push(`BTC Dom. ${fmt(dom,2)}%`);
 return {score,label,cls,drivers,btc:q.price||c.btcPrice||0};
}

function bottomView(){
 const n=DATA.nadir,c=n.currentVerifiedContext||{},q=DATA.livePrices?.BTC,btc=q?.price||c.btcPrice||0,now=currentNadirContext();
 return card(`<div class="eyebrow">NADIR 2.2 ${snapshotBadge('MODEL')}</div><div class="forecast-main">${n.label}</div><div class="sub">Bewertung · Kapitulation · Holder · Timing</div><p class="footer-note">${n.note||''}</p>`)+
 card(`<div class="section-title">CURRENT NADIR CONTEXT <span class="tag ${now.cls}">MODEL NOW</span></div><div class="forecast-main ${now.cls}" style="font-size:22px">${now.label}</div><div class="row"><span>Current Context Score</span><b class="${now.cls}">${now.score}/100</b></div><div class="bar"><i style="width:${now.score}%"></i></div><p class="footer-note">${now.drivers.join(' · ')}. Dieser Context-Score nutzt nur aktuelle Markt-/Momentumdaten und ersetzt NICHT den On-Chain-NADIR-Snapshot.</p>`)+
 card(`<div class="section-title">MARKTKONTEXT</div><div class="grid2">${metric('BTC','$'+fmt(btc)+(q?'<div class="data-state">'+sourceBadge(quoteStatus(q))+'</div>':''))}${metric('BTC 7T',(Number(c.btc7dPct)>=0?'+':'')+fmt(c.btc7dPct||0,2)+'%',Number(c.btc7dPct)>=0?'green':'red')}${metric('FEAR & GREED',c.fearGreed||'—','amber')}${metric('BTC DOM.',fmt(c.btcDominancePct||0,2)+'%')}</div>`)+
 card(`<div class="row"><span class="eyebrow">NADIR GESAMTSCORE</span><span class="score amber">${n.score}/100</span></div><div class="bar"><i style="width:${n.score}%"></i></div><p class="muted">${snapshotBadge('LAST CONFIRMED')} ${n.snapshotAt||''}</p><p class="footer-note">Der historische Gesamtscore bleibt unverändert, bis frische On-Chain-/Kapitulationsdaten verifiziert sind.</p>`)+
 `<div class="grid2">${metric('BEWERTUNG',n.valuation+'/100')}${metric('KAPITULATION',n.capitulation+'/100')}${metric('HOLDER',n.holder+'/100')}${metric('TIMING',n.timing+'/100')}</div>`+
 card(`<div class="section-title">BTC BODEN-SZENARIEN ${snapshotBadge('MODEL')}</div>${Object.entries(n.btcScenarios).map(([k,v])=>`<div class="row"><span class="${k==='Base Case'?'amber':''}">${k}</span><b class="${k==='Base Case'?'amber':''}">${v}</b></div>`).join('')}`);
}
function stateLabel(v){return (v||'').includes('LIVE')?liveBadge('LIVE'):snapshotBadge('SNAPSHOT')}
function dayTrade(){
 const d=DATA.dayTrade, st=d.status||{};
 return card(`<div class="eyebrow">DAY-TRADE 2.2</div><div class="forecast-main">${d.entryAllowed?'ENTRY FREIGEGEBEN':'ENTRY NICHT FREIGEGEBEN'}</div><div class="sub">${d.decisionNote||'Bias ≠ Ausführung'}</div><div class="row"><b>GATE SCORE</b><b class="${d.entryAllowed?'green':'amber'}">${d.gateScore}/100</b></div><div class="bar"><i style="width:${d.gateScore}%"></i></div>`)+
 `<div class="grid2">${metric('BTC PREIS','$'+fmt(d.btcPrice)+'<div class="data-state">'+stateLabel(st.btcPrice)+'</div>')}${metric('BTCUSDT OI','$'+fmt(d.oiB,2)+'B<div class="data-state">'+stateLabel(st.oiB)+'</div>')}${metric('4H RSI',fmt(d.rsi4h,2)+'<div class="data-state">'+stateLabel(st.rsi4h)+'</div>')}${metric('1H RSI',fmt(d.rsi1h,2)+'<div class="data-state">'+stateLabel(st.rsi1h)+'</div>')}${metric('FUNDING',fmt(d.fundingPct,4)+'%<div class="data-state">'+stateLabel(st.fundingPct)+'</div>')}${metric('24H VWAP','$'+fmt(d.vwap)+'<div class="data-state">'+stateLabel(st.vwap)+'</div>')}</div>`+
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
 const pct=Math.max(0,Math.min(100,(now-last)/span*100));
 const lag=COIN_LAG_DAYS[sym]||0;
 const referencePeak=new Date(last+(548+lag)*86400000);
 const daysFromReference=Math.round((now-referencePeak.getTime())/86400000);
 let structural='POST-HALVING · LATE';
 if(pct<25)structural='POST-HALVING · EARLY';
 else if(pct<50)structural='POST-HALVING · MID';
 else if(pct<75)structural='POST-HALVING · LATE';
 else structural='PRE-HALVING / RESET';
 return {pct,phase:structural,referencePeak,daysFromReference,lag};
}


function altRotationBlock(){
 const a=DATA.altRotation||{}, coins=a.coins||{}, g=a.marketGate||{};
 return card(`<div class="section-title">ALTCOIN CYCLE ROTATION <span class="tag cyan">3.2 MODEL</span></div>
 <div class="rotation-state"><span>BROAD ROTATION</span><b class="amber">${g.state||'—'}</b></div>
 <div class="rotation-gates">
   <div><span>BTC.D</span><b>&lt;55% + falling</b></div>
   <div><span>ETH/BTC</span><b>→ 0.048+</b></div>
   <div><span>ALT INDEX</span><b>≥75</b></div>
 </div>
 <p class="footer-note">${g.rule||''}</p>
 <div class="section-title" style="margin-top:20px">ROTATION MAP</div>
 ${(a.rotationPhases||[]).map(p=>`<div class="rotation-row"><span class="rotation-num">${p.phase}</span><div><b>${p.name}</b><small>${p.assets}</small></div><div class="rotation-window">${p.window}<small>${p.state}</small></div></div>`).join('')}
 <div class="section-title" style="margin-top:22px">COIN PEAK WINDOWS</div>
 ${Object.entries(coins).map(([s,c])=>`<div class="coin-cycle-row"><b>${s}</b><span>BTC + ${c.lag}</span><span>${c.beta}</span><strong>${c.peakWindow}</strong><i>${c.rotationScore}/100</i></div>`).join('')}
 <p class="footer-note">${a.note||''}</p>`);
}

function macroPriceTimeBlock(){
 const m=DATA.macroForecast||{};
 const z=m.btcZones||{};
 const zone=(name,o,cls)=>o?`<div class="macro-zone ${cls}"><div class="eyebrow">${o.label||name}</div><div class="macro-range">$${fmt(o.low)}–$${fmt(o.high)}</div></div>`:'';
 return (card(`<div class="section-title">MACRO PRICE × TIME <span class="tag cyan">3.1 MODEL</span></div>
   <div class="macro-window"><span>NEXT MAJOR PEAK WINDOW</span><b>${m.peakWindow?.from||'—'} → ${m.peakWindow?.to||'—'}</b></div>
   <div class="macro-confidence">WINDOW CONFIDENCE <b>${m.peakWindow?.confidence||'—'}/100</b></div>
   <p class="footer-note">Nicht mit dem 90T-Swing verwechseln: Die folgenden Zonen sind langfristige BTC-Cycle-Szenarien.</p>
   <div class="macro-zones">${zone('BEAR',z.bear,'bear')}${zone('BASE',z.base,'base')}${zone('BULL',z.bull,'bull')}</div>
   <div class="section-title" style="margin-top:20px">ACTIVATION GATES</div>
   <div class="row"><span>TIME</span><b>2029 Q2–2030 Q1</b></div>
   <div class="row"><span>STRUCTURE</span><b>NEW ATH + HH</b></div>
   <div class="row"><span>REGIME</span><b>NO CONFIRMED DISTRIBUTION</b></div>
   <p class="footer-note">${m.note||''}</p>`)) + altRotationBlock();
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

function forecastState(f){
 if(!f?.ready)return {label:'DATEN LADEN',cls:'amber',score:0};
 let score=Math.round(Math.max(0,Math.min(100,f.risk*.6+f.pos*.25+Math.max(0,f.ret90)*.15)));
 let label='EXPANSION',cls='green';
 if(f.risk>=80&&f.pos>=85){label='DISTRIBUTION RISK';cls='red'}
 else if(f.risk>=65||f.pos>=75){label='LATE EXPANSION';cls='amber'}
 else if(f.ret90<0&&f.pos<45){label='RESET / REACCUMULATION';cls='cyan'}
 return {label,cls,score};
}
function forecastWindow(f){
 const span=f.high-f.low;
 const r382=f.high-span*.382, r618=f.high-span*.618;
 return {
   breakout:f.high,
   confirm:f.high*1.01,
   pullbackHigh:r382,
   pullbackLow:r618,
   invalidate:r618,
   t1:f.fib[0],
   t2:f.fib[1]
 };
}


function cycle40Config(sym){
 const m=DATA.macroForecast||{}, a=DATA.altRotation?.coins?.[sym]||{};
 const peak=sym==='BTC' ? `${m.peakWindow?.from||'2029 Q2'}–${m.peakWindow?.to||'2030 Q1'}` : (a.peakWindow||'2029 Q2–2030 Q3');
 return {peak,beta:String(a.beta|| (sym==='BTC'?'BASE':'MODEL')).toUpperCase(),lag:a.lag||'0w',rotationScore:a.rotationScore|| (sym==='BTC'?90:60)};
}
function cycle40Timing(){
 const now=Date.now();
 const q=(y,m,d=1)=>new Date(Date.UTC(y,m-1,d)).getTime();
 let phase='RESET / RE-ACCUMULATION',cls='cyan',timeScore=12,next='PRE-HALVING ACCUMULATION';
 if(now>=q(2027,7)&&now<q(2028,7)){phase='PRE-HALVING ACCUMULATION';cls='cyan';timeScore=22;next='HALVING / EARLY EXPANSION'}
 else if(now>=q(2028,7)&&now<q(2029,4)){phase='EXPANSION WINDOW';cls='green';timeScore=48;next='PEAK-WINDOW WATCH'}
 else if(now>=q(2029,4)&&now<q(2030,4)){phase='MAJOR PEAK WINDOW';cls='amber';timeScore=88;next='DISTRIBUTION / EXIT CONFIRMATION'}
 else if(now>=q(2030,4)){phase='LATE CYCLE / RESET WATCH';cls='red';timeScore=72;next='RESET / RE-ACCUMULATION'}
 const daysToHalving=Math.round((NEXT_HALVING_EST-now)/86400000);
 return {phase,cls,timeScore,next,daysToHalving,peakActive:phase==='MAJOR PEAK WINDOW'};
}
function cycle40Envelope(sym,f){
 const cfg=cycle40Config(sym), m=DATA.macroForecast||{}, z=m.btcZones||{};
 if(sym==='BTC' && z.base){return {bearLow:z.bear?.low,bearHigh:z.bear?.high,baseLow:z.base.low,baseHigh:z.base.high,bullLow:z.bull?.low,bullHigh:z.bull?.high,source:'MACRO PRICE × TIME 3.1'}}
 const anchor=f?.high||f?.last||0;
 const beta=cfg.beta;
 const mult=beta.includes('VERY HIGH')?[1.5,2.6,4.5]:beta.includes('HIGH')?[1.4,2.3,3.7]:beta.includes('MEDIUM')?[1.3,2.0,3.0]:[1.25,1.8,2.6];
 return {bearLow:anchor*1.05,bearHigh:anchor*mult[0],baseLow:anchor*mult[0],baseHigh:anchor*mult[1],bullLow:anchor*mult[1],bullHigh:anchor*mult[2],source:'STRUCTURE × BETA ENVELOPE'};
}
function cycle40Exit(sym,f,state){
 const timing=cycle40Timing(), cfg=cycle40Config(sym);
 const btc=forecast('BTC');
 const prev=Number(DATA.macroForecast?.previousPeak?.price||126198);
 const macroStructure=btc?.ready && btc.last>prev*1.02;
 const structureScore=macroStructure?75:20;
 const localHeat=Math.round(Math.max(0,Math.min(100,(f?.risk||0)*.65+(f?.pos||0)*.35)));
 const momentumExhaustion=Math.round(Math.max(0,Math.min(100,((f?.dailyRsi||50)-55)*2.2 + Math.max(0,f?.ret90||0)*.35)));
 const relativeWeak=sym==='BTC'?25:Math.round(Math.max(0,Math.min(100,50-(f?.rel||0)*2)));
 const cycleRisk=Math.round(Math.max(0,Math.min(100,timing.timeScore*.45+structureScore*.20+momentumExhaustion*.15+relativeWeak*.10+localHeat*.10)));
 let stage='HOLD CYCLE',action='NO CYCLE EXIT',cls='green';
 if(cycleRisk>=88){stage='EXIT',action='E4 · FINAL REDUCE',cls='red'}
 else if(cycleRisk>=78){stage='DISTRIBUTE',action='E3 · REDUCE',cls='red'}
 else if(cycleRisk>=66){stage='DE-RISK',action='E2 · TRIM',cls='amber'}
 else if(cycleRisk>=52){stage='PREPARE',action='E1 · WATCH / SMALL TRIM',cls='amber'}
 const cycleGate=timing.peakActive && macroStructure;
 if(!cycleGate && cycleRisk>=66){action='LOCAL DE-RISK ONLY · CYCLE EXIT LOCKED'}
 return {timing,cfg,cycleRisk,stage,action,cls,localHeat,momentumExhaustion,relativeWeak,structureScore,macroStructure,cycleGate};
}
function forecast40Confidence(f,x){
 if(!f?.ready)return 0;
 let c=48;
 if(f.count>=300)c+=12;
 if(x.macroStructure)c+=8;
 if(x.timing.peakActive)c+=10;
 if(Math.abs(f.ret90)>=8)c+=5;
 if(x.cfg.rotationScore>=75)c+=5;
 return Math.max(35,Math.min(90,Math.round(c)));
}
function forecast40Roadmap(x){
 const items=[
  ['NOW',x.timing.phase,x.timing.cls],
  ['2027','ACCUMULATION','cyan'],
  ['APR 2028','HALVING','cyan'],
  ['2028 H2–2029 H1','EXPANSION','green'],
  ['2029 Q2–2030 Q1','BTC PEAK WINDOW','amber']
 ];
 return `<div class="cycle-roadmap">${items.map((a,i)=>`<div class="cycle-roadmap-item ${i===0?'active':''}"><span>${a[0]}</span><b class="${a[2]}">${a[1]}</b></div>`).join('')}</div>`;
}
function renderForecast(){
 const f=forecast(activeCoin), coins=DATA.forecastCoins;
 const state=forecastState(f), fw=f.ready?forecastWindow(f):null;
 const x=f.ready?cycle40Exit(activeCoin,f,state):null;
 const env=f.ready?cycle40Envelope(activeCoin,f):null;
 const conf=f.ready?forecast40Confidence(f,x):0;
 let body=card(`<div class="forecast-head"><div><div class="eyebrow">ACHI MERIDIAN FORECAST 4.0</div><div class="forecast-main">TIME × STRUCTURE<br>× EXIT</div><div class="sub">TACTICAL NOW · NEXT CYCLE · EXIT ENGINE 2.0</div></div><div class="confidence"><div class="muted">CONFIDENCE</div><div class="score cyan">${f.ready?conf:'—'}</div></div></div><p class="footer-note">90T-Ziele sind taktisch. Das nächste große Cycle-Peak-Fenster wird zeitlich separat bewertet.</p>`);
 body+=`<div class="tabs">${coins.map(c=>`<button class="tab ${c===activeCoin?'active':''}" onclick="selectCoin('${c}')">${c}</button>`).join('')}</div>`;
 if(!f.ready){
   body+=card(`<div class="loading">Lade ${activeCoin}-Historie direkt auf dem iPhone…</div><button class="tab active" onclick="forceCoin('${activeCoin}')" style="width:100%;margin-top:16px">DATEN NEU LADEN</button>`);
 }else{
   const dec=activeCoin==='PEPE'?8:(f.last<1?4:2);
   body+=card(`<div class="forecast-price-card"><div class="eyebrow">${activeCoin}</div><div class="big forecast-price">$${fmt(f.last,dec)}</div><div class="grid2">${metric('LOCAL HEAT',x.localHeat+'/100',x.localHeat>80?'red':x.localHeat>65?'amber':'green')}${metric('CYCLE EXIT RISK',x.cycleRisk+'/100',x.cycleRisk>77?'red':x.cycleRisk>51?'amber':'green')}${metric('DAILY RSI',f.dailyRsi?fmt(f.dailyRsi,1):'—')}${metric('90T MOMENTUM',(f.ret90>=0?'+':'')+fmt(f.ret90,1)+'%')}</div></div>`);

   body+=card(`<div class="section-title">1 · TACTICAL NOW <span class="tag cyan">90T</span></div><div class="scenario-grid"><div><span>SWING LOW</span><b>$${fmt(f.low,dec)}</b></div><div><span>BREAKOUT</span><b class="cyan">$${fmt(f.high,dec)}</b></div><div><span>TACTICAL T2</span><b class="green">$${fmt(f.fib[1],dec)}</b></div></div><div class="row"><span>Position im 90T Swing</span><b>${fmt(f.pos,1)}%</b></div><div class="forecast-separation"><b>LOCAL ≠ CYCLE TOP</b><span>Hoher RSI / 90T-Top-Risk kann taktisch überhitzt sein, ohne dass das nächste Makro-Cycle-Top aktiv ist.</span></div>`);

   body+=card(`<div class="section-title">2 · CYCLE CLOCK <span class="tag ${x.timing.cls}">LIVE MODEL</span></div><div class="cycle-master"><span>AKTUELLE MAKRO-PHASE</span><strong class="${x.timing.cls}">${x.timing.phase}</strong><b>${x.timing.daysToHalving>0?x.timing.daysToHalving+' Tage bis Halving':'Halving-Fenster überschritten'}</b></div>${forecast40Roadmap(x)}<div class="row"><span>Nächster Zustandswechsel</span><b>${x.timing.next}</b></div><div class="row"><span>${activeCoin} Major Peak Window</span><b class="green">${x.cfg.peak}</b></div><div class="row"><span>Cycle Exit Gate</span><b class="${x.cycleGate?'red':'green'}">${x.cycleGate?'AKTIV':'LOCKED'}</b></div><p class="footer-note">Cycle-Exit wird erst scharf, wenn Zeitfenster UND Makrostruktur bestätigen. Kalender allein reicht nicht.</p>`);

   body+=card(`<div class="section-title">3 · NEXT CYCLE ENVELOPE <span class="tag amber">MODEL · NOT ACTIVE</span></div><div class="cycle-envelope"><div><span>DEFENSIVE</span><b>$${fmt(env.bearLow,dec)}–$${fmt(env.bearHigh,dec)}</b></div><div><span>BASE</span><b class="cyan">$${fmt(env.baseLow,dec)}–$${fmt(env.baseHigh,dec)}</b></div><div><span>HIGH-BETA</span><b class="green">$${fmt(env.bullLow,dec)}–$${fmt(env.bullHigh,dec)}</b></div></div><div class="row"><span>Modellquelle</span><b>${env.source}</b></div><div class="row"><span>Aktivierung</span><b>TIME + ATH/HH + REGIME</b></div><p class="footer-note">Langfristige Szenario-Zonen, keine aktuellen Targets. Sie ersetzen ausdrücklich nicht die 90T-FIB-Ziele.</p>`);

   body+=card(`<div class="section-title">4 · EXIT ENGINE 2.0 <span class="tag ${x.cls}">${x.stage}</span></div><div class="exit-master"><span>CYCLE EXIT RISK</span><b class="${x.cls}">${x.cycleRisk}/100</b><strong class="${x.cls}">${x.action}</strong></div><div class="grid2 exit-inputs">${metric('TIME',x.timing.timeScore+'/100')}${metric('STRUCTURE',x.structureScore+'/100')}${metric('MOMENTUM',x.momentumExhaustion+'/100')}${metric('RELATIVE WEAKNESS',x.relativeWeak+'/100')}</div>${(DATA.forecast40?.exitTranches||DATA.forecast33?.exitTranches||[]).map(t=>`<div class="row"><span>${t.name} · ${t.pct}%</span><b>${t.trigger}</b></div>`).join('')}<p class="footer-note">Wichtig: LOCAL HEAT und CYCLE EXIT RISK sind getrennt. Ein taktisch heißer Markt kann im Makro-Cycle weiterhin weit vor dem Exit-Fenster liegen.</p>`);

   body+=card(`<div class="section-title">5 · TRIGGER MATRIX</div><div class="trigger-grid"><div><span class="green">UNLOCKS</span><b>Peak Window aktiv</b><b>BTC neues Makro-ATH + HH</b><b>Liquidität / Breadth bestätigt</b></div><div><span class="red">RISK FLAGS</span><b>Momentum-Divergenz</b><b>Relative Stärke bricht</b><b>Distribution + Strukturbruch</b></div></div><div class="row"><span>Aktueller Makro-ATH Gate</span><b class="${x.macroStructure?'green':'amber'}">${x.macroStructure?'BESTÄTIGT':'NICHT BESTÄTIGT'}</b></div>`);

   body+=card(`<div class="section-title">TACTICAL FORWARD WINDOW <span class="tag cyan">CONDITIONAL</span></div><div class="row"><span>Breakout</span><b>$${fmt(fw.breakout,dec)}</b></div><div class="row"><span>Bestätigung</span><b>Close &gt; $${fmt(fw.confirm,dec)}</b></div><div class="row"><span>Pullback</span><b>$${fmt(fw.pullbackLow,dec)}–$${fmt(fw.pullbackHigh,dec)}</b></div><div class="row"><span>T1 / T2</span><b class="cyan">$${fmt(fw.t1,dec)} / $${fmt(fw.t2,dec)}</b></div>`);
   body+=altRotationBlock();
   body+=card(`<button class="tab active" onclick="forceCoin('${activeCoin}')" style="width:100%">HISTORIE AKTUALISIEREN</button>`);
 }
 $('#view-forecast').innerHTML=body;
}
window.selectCoin=async c=>{activeCoin=c;renderForecast();try{await loadCoinHistory(c); if(c!=='BTC')await loadCoinHistory('BTC');}catch(e){}renderForecast()}
window.forceCoin=async c=>{try{await loadCoinHistory(c,true); if(c!=='BTC')await loadCoinHistory('BTC',true);}catch(e){alert('Live-Historie konnte nicht geladen werden. Cache wird verwendet, falls vorhanden.')}renderForecast()}


function gridQuote(sym){
 const q=(DATA&&DATA.livePrices&&DATA.livePrices[sym])||{};
 return +q.price||0;
}
function gridChange24h(sym){
 const q=(DATA&&DATA.livePrices&&DATA.livePrices[sym])||{};
 return +q.change24h||+q.change24hPct||0;
}
function gridBot(sym){
 return ((DATA&&DATA.pionexRisk&&DATA.pionexRisk.bots)||[]).find(b=>b.symbol===sym)||null;
}
function gridFmt(v,sym){
 if(!Number.isFinite(+v))return '—';
 if(sym==='PEPE')return fmt(+v,8);
 if(sym==='HBAR')return fmt(+v,5);
 if(sym==='XRP')return fmt(+v,4);
 if(sym==='SOL')return fmt(+v,2);
 if(sym==='ETH'||sym==='BTC')return fmt(+v,0);
 return fmt(+v,3);
}
function gridPair(sym){
 const x=BINANCE_PAIRS&&BINANCE_PAIRS[sym];
 return x?x.toUpperCase():null;
}
function atrFromKlines(ks,p=14){
 if(!Array.isArray(ks)||ks.length<p+1)return null;
 const tr=[];
 for(let i=1;i<ks.length;i++){
   const h=+ks[i][2],l=+ks[i][3],pc=+ks[i-1][4];
   tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
 }
 return tr.slice(-p).reduce((a,b)=>a+b,0)/p;
}
function detectBullSwing(ks){
 if(!Array.isArray(ks)||ks.length<25)return null;
 const rows=ks.map((k,i)=>({i,t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4]}));
 const look=rows.slice(-120);
 const pivH=[],pivL=[],n=3;
 for(let i=n;i<look.length-n;i++){
   const r=look[i], win=look.slice(i-n,i+n+1);
   if(r.h===Math.max(...win.map(x=>x.h)))pivH.push(r);
   if(r.l===Math.min(...win.map(x=>x.l)))pivL.push(r);
 }
 let high=pivH.at(-1)||look.reduce((a,b)=>b.h>a.h?b:a,look[0]);
 let lows=pivL.filter(x=>x.i<high.i);
 let low=lows.at(-1);
 if(!low){
   const before=look.filter(x=>x.i<high.i);
   low=before.length?before.reduce((a,b)=>b.l<a.l?b:a,before[0]):look[0];
 }
 // If latest detected high is too old, use the highest high after the most recent meaningful low.
 const recentLow=pivL.at(-1);
 if(recentLow && recentLow.i>high.i){
   const after=look.filter(x=>x.i>recentLow.i);
   if(after.length){
     const h2=after.reduce((a,b)=>b.h>a.h?b:a,after[0]);
     if(h2.h>recentLow.l*1.03){low=recentLow;high=h2}
   }
 }
 if(!(high.h>low.l))return null;
 return {low:low.l,high:high.h,lowTs:low.t,highTs:high.t,candles:look};
}
function gridFrequency(ks,atr){
 if(!ks?.length||!atr)return 0;
 const x=ks.slice(-72);
 let moves=0, reversals=0,lastDir=0;
 x.forEach(k=>{
   const o=+k[1],c=+k[4],d=c-o,dir=Math.sign(d);
   if(Math.abs(d)>=atr*.35)moves++;
   if(lastDir&&dir&&dir!==lastDir)reversals++;
   if(dir)lastDir=dir;
 });
 return Math.round(Math.min(100,(moves/x.length)*55+(reversals/Math.max(1,x.length-1))*90));
}
async function loadGridSwing(sym,force=false){
 if(GRID_SWINGS[sym]&&!force)return GRID_SWINGS[sym];
 if(GRID_LOADING[sym])return GRID_LOADING[sym];
 const pair=gridPair(sym);
 GRID_LOADING[sym]=(async()=>{
   const errors=[];
   GRID_ENGINE_STATUS[sym]={state:'LOADING',source:'—',error:null,updatedAt:Date.now()};
   try{
     if(!pair)throw new Error('Kein Binance Pair');

     // 1) Binance Futures is preferred because the strategy itself is futures/grid based
     try{
       const ks=await fetchJSON(`https://fapi.binance.com/fapi/v1/klines?symbol=${pair}&interval=4h&limit=180`,10000);
       const sw=detectBullSwing(ks);
       if(!sw)throw new Error('Swing nicht erkannt');
       const atr=atrFromKlines(ks,14), px=gridQuote(sym)||+ks.at(-1)[4], freq=gridFrequency(ks,atr);
       GRID_SWINGS[sym]={...sw,atr,price:px,frequency:freq,source:'Binance Futures 4H',updatedAt:Date.now()};
       GRID_ENGINE_STATUS[sym]={state:'LIVE',source:'Binance Futures 4H',error:null,updatedAt:Date.now()};
       return GRID_SWINGS[sym];
     }catch(e){errors.push('Futures: '+e.message)}

     // 2) Spot 4H as secondary exchange source
     try{
       const ks=await fetchJSON(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=4h&limit=180`,10000);
       const sw=detectBullSwing(ks);
       if(!sw)throw new Error('Swing nicht erkannt');
       const atr=atrFromKlines(ks,14), px=gridQuote(sym)||+ks.at(-1)[4], freq=gridFrequency(ks,atr);
       GRID_SWINGS[sym]={...sw,atr,price:px,frequency:freq,source:'Binance Spot 4H',updatedAt:Date.now()};
       GRID_ENGINE_STATUS[sym]={state:'LIVE',source:'Binance Spot 4H',error:errors.join(' | '),updatedAt:Date.now()};
       return GRID_SWINGS[sym];
     }catch(e){errors.push('Spot: '+e.message)}

     // 3) CoinGecko cached/daily fallback
     try{
       const h=await loadCoinHistory(sym,true);
       const cs=(h?.candles||[]).slice(-120);
       const fake=cs.map(x=>[x[0],x[1],x[2]||x[1],x[3]||x[1],x[4]||x[1],0]);
       const sw=detectBullSwing(fake);
       if(!sw)throw new Error('Fallback Swing fehlt');
       GRID_SWINGS[sym]={...sw,atr:null,price:gridQuote(sym)||+fake.at(-1)[4],frequency:45,source:'CoinGecko Daily',updatedAt:Date.now()};
       GRID_ENGINE_STATUS[sym]={state:'FALLBACK',source:'CoinGecko Daily',error:errors.join(' | '),updatedAt:Date.now()};
       return GRID_SWINGS[sym];
     }catch(e){errors.push('CoinGecko: '+e.message)}

     // 4) Existing bot range only as last resort
     const b=gridBot(sym),px=gridQuote(sym)||+b?.currentPrice||0;
     if(b){
       GRID_SWINGS[sym]={low:+b.rangeLow||px*.8,high:+b.takeProfit||+b.rangeHigh||px*1.2,atr:null,price:px,frequency:35,source:'Bot Range Fallback',updatedAt:Date.now()};
       GRID_ENGINE_STATUS[sym]={state:'FALLBACK',source:'Bot Range Fallback',error:errors.join(' | '),updatedAt:Date.now()};
       return GRID_SWINGS[sym];
     }
     throw new Error(errors.join(' | ')||'Keine Datenquelle');
   }catch(e){
     GRID_ENGINE_STATUS[sym]={state:'ERROR',source:'—',error:e.message,updatedAt:Date.now()};
     return null;
   }finally{
     delete GRID_LOADING[sym];
   }
 })();
 return GRID_LOADING[sym];
}
async function refreshGridEngine(force=false){
 const syms=['HBAR','XRP','SOL','ETH','PEPE'];
 await Promise.allSettled(syms.map(s=>loadGridSwing(s,force)));
 try{renderOne('grid');renderOne('center')}catch(e){}
}
function fibFromSwing(sym){
 const s=GRID_SWINGS[sym],b=gridBot(sym);
 if(!s){
   // immediate safe fallback while the async 4H engine is loading
   const px=gridQuote(sym)||+b?.currentPrice||0;
   if(!px)return null;
   const low=+b?.rangeLow||px*.78,high=+b?.takeProfit||+b?.rangeHigh||px*1.22;
   return buildGridFib(sym,{low,high,price:px,frequency:0,source:'LOADING / FALLBACK'},b);
 }
 return buildGridFib(sym,s,b);
}
function buildGridFib(sym,s,b=null){
 const px=gridQuote(sym)||+s.price||0,lo=+s.low,hi=+s.high;
 if(!(hi>lo)||!px)return null;
 const span=hi-lo;
 const fib={
   f236:hi-span*.236,
   f382:hi-span*.382,
   f500:hi-span*.500,
   f618:hi-span*.618,
   f786:hi-span*.786,
   ext1272:hi+span*.272,
   ext1618:hi+span*.618
 };
 const entryLow=fib.f618,entryHigh=fib.f500,rangeLow=fib.f786,rangeHigh=hi;
 let state='WAIT';
 if(px>=hi)state='TP HIT';
 else if(px>=entryLow&&px<=entryHigh)state='START ZONE';
 else if(px>entryHigh&&px<=fib.f382)state='WATCH';
 else if(px<fib.f786)state='NEW RANGE';
 const atrPct=s.atr&&px?s.atr/px*100:null;
 const ampPct=(hi/lo-1)*100;
 return {sym,b,px,lo,hi,fib,entryLow,entryHigh,rangeLow,rangeHigh,state,source:s.source||'—',
   atr:s.atr||null,atrPct,frequency:s.frequency||0,ampPct,updatedAt:s.updatedAt||null};
}
function gridVisual(g,sym){
 const top=g.hi,bottom=g.lo,span=Math.max(top-bottom,1e-12);
 const levels=[
  ['HIGH',g.hi],['0.236',g.fib.f236],['0.382',g.fib.f382],
  ['0.500',g.fib.f500],['0.618',g.fib.f618],['0.786',g.fib.f786],['LOW',g.lo]
 ];
 const ptop=Math.max(1,Math.min(98,(top-g.px)/span*100));
 return `<div class="grid-fib-chart">
   <div class="grid-entry-band" style="top:${(top-g.entryHigh)/span*100}%;height:${(g.entryHigh-g.entryLow)/span*100}%"><span>PREFERRED ENTRY 0.500–0.618</span></div>
   ${levels.map(([n,v])=>`<div class="grid-fib-line ${n==='0.500'||n==='0.618'?'preferred':''}" style="top:${Math.max(0,Math.min(100,(top-v)/span*100))}%"><span>${n}</span><b>$${gridFmt(v,sym)}</b></div>`).join('')}
   <div class="grid-price-line" style="top:${ptop}%"><i></i><b>$${gridFmt(g.px,sym)}</b></div>
 </div>`;
}
function gridStatusClass(s){
 return ['START ZONE','TP HIT'].includes(s)?'green':s==='NEW RANGE'?'red':'amber';
}
function gridConfidence(g){
 let x=50;
 if(g.source==='Binance 4H')x+=20;
 if(g.ampPct>=12)x+=10;
 if(g.frequency>=55)x+=10;
 if(g.atrPct&&g.atrPct>=1)x+=5;
 return Math.max(35,Math.min(95,Math.round(x)));
}
function scannerScore(g,sym){
 const liq={SOL:95,ETH:100,PEPE:72}[sym]||70;
 const vol=Math.min(100,(g.atrPct||1.5)*28);
 const range=Math.min(100,g.ampPct*3);
 const freq=g.frequency||45;
 const fib=g.state==='START ZONE'?95:g.state==='WATCH'?80:65;
 const funding=65,rsiScore=65;
 return Math.round(freq*.25+vol*.20+range*.20+liq*.15+fib*.10+funding*.05+rsiScore*.05);
}
function scannerLeverage(sym){return sym==='PEPE'?'2× max.':'3× max.'}
function scannerGrids(sym,g){
 const base=sym==='PEPE'?160:sym==='SOL'?120:100;
 return Math.round(base*Math.max(.75,Math.min(1.3,(g.frequency||50)/55)));
}

function botAction(g){
 const b=g?.b||{}, buffer=+b.liquidationDistancePct;
 if(!g)return {label:'WAIT',cls:'amber',reason:'Keine belastbaren Swing-Daten'};
 if(g.state==='TP HIT')return {label:'TP HIT',cls:'green',reason:'TP/Swing-High erreicht → Gewinn sichern und neue Range abwarten'};
 if(g.state==='NEW RANGE')return {label:'RANGE SHIFT',cls:'red',reason:'Preis unter 0,786 → bestehenden Swing nicht mehr für neuen Long-Grid verwenden'};
 if(Number.isFinite(buffer)&&buffer<30){
   if(g.state==='START ZONE')return {label:'NO ADD',cls:'red',reason:`FIB-Zone erreicht, aber Liq.-Puffer nur ${fmt(buffer,1)}%`};
   return {label:'NO ADD',cls:'red',reason:`Liq.-Puffer ${fmt(buffer,1)}% → kein zusätzliches Long-Risiko`};
 }
 if(g.state==='START ZONE')return {label:'ADD ZONE',cls:'green',reason:'0,500–0,618 Retracement + ausreichender bekannter Liq.-Puffer'};
 if(g.state==='WATCH')return {label:'WATCH',cls:'amber',reason:'Preis nähert sich bevorzugter Entry-Zone'};
 return {label:'HOLD',cls:'green',reason:'Bestehenden Bot halten; für neuen Bot auf Retracement warten'};
}
function gridSourceBadge(sym){
 const st=GRID_ENGINE_STATUS[sym];
 if(!st)return snapshotBadge('LÄDT');
 if(st.state==='LIVE')return liveBadge('4H LIVE');
 if(st.state==='FALLBACK')return snapshotBadge('FALLBACK');
 return `<span class="tag red">ERROR</span>`;
}

function botGridCard(sym){
 const g=fibFromSwing(sym);
 if(!g)return card(`<div class="section-title">${sym}</div><p class="footer-note">Swing-Daten werden geladen …</p>`);
 const b=g.b||{}, action=botAction(g), st=GRID_ENGINE_STATUS[sym];
 return card(`<div class="section-head"><div><div class="section-title">${sym} COIN-M LONG</div><div class="section-note">Pionex ${snapshotBadge('SNAPSHOT')} · ${gridSourceBadge(sym)} ${g.source}</div></div><span class="tag ${action.cls}">${action.label}</span></div>
   ${gridVisual(g,sym)}
   <div class="grid2">
     ${metric('LIVE PREIS','$'+gridFmt(g.px,sym),'green')}
     ${metric('4H SWING','$'+gridFmt(g.lo,sym)+' → $'+gridFmt(g.hi,sym))}
     ${metric('ENTRY 0.5–0.618','$'+gridFmt(g.entryLow,sym)+'–$'+gridFmt(g.entryHigh,sym),'cyan')}
     ${metric('NEXT RANGE','$'+gridFmt(g.rangeLow,sym)+'–$'+gridFmt(g.rangeHigh,sym),'amber')}
     ${metric('TP1 / TP2','$'+gridFmt(g.hi,sym)+' / $'+gridFmt(g.fib.ext1272,sym))}
     ${metric('LIQ.-PUFFER',Number.isFinite(+b.liquidationDistancePct)?fmt(+b.liquidationDistancePct,1)+'%':'—',Number.isFinite(+b.liquidationDistancePct)&&+b.liquidationDistancePct<30?'red':'green')}
   </div>
   <div class="grid-action-box ${action.cls}"><b>${action.label}</b><span>${action.reason}</span></div>
   <div class="grid-meta"><span>4H Frequenz <b>${g.frequency||'—'}/100</b></span><span>Swing <b>${fmt(g.ampPct,1)}%</b></span><span>ATR <b>${g.atrPct?fmt(g.atrPct,2)+'%':'—'}</b></span><span>Confidence <b>${gridConfidence(g)}/100</b></span></div>
   <p class="footer-note">Quelle: ${g.source}${st?.error?` · Fallback-Grund: ${st.error}`:''}. Botparameter/P&L bleiben Pionex-Snapshot.</p>`);
}
function liqGuard(b){
 const x=Number(b.liquidationDistancePct||0);
 if(x<8)return {label:'CRITICAL',cls:'red'};
 if(x<15)return {label:'DANGER',cls:'red'};
 if(x<30)return {label:'TIGHT',cls:'amber'};
 return {label:'SAFE',cls:'green'};
}
function entryReadiness(g,sym){
 let s=scannerScore(g,sym);
 if(g.state==='WAIT') s-=18;
 if(g.state==='WATCH') s-=10;
 if(g.px>g.entryHigh) s-=10;
 return Math.max(0,Math.min(100,Math.round(s)));
}
function scannerCard(sym){
 const g=fibFromSwing(sym); if(!g)return '';
 const setup=scannerScore(g,sym), ready=entryReadiness(g,sym),grids=scannerGrids(sym,g);
 return `<details class="commander-detail" data-detail-key="scanner-${sym}"><summary><span><b>${sym}</b><small>${g.state} · ${g.source}</small></span><span><b class="${setup>=82?'green':setup>=72?'amber':'red'}">${setup}</b><small>SETUP</small></span><span><b class="${ready>=75?'green':ready>=55?'amber':'red'}">${ready}</b><small>ENTRY</small></span></summary>
 <div class="scanner-grid"><div><span>LIVE</span><b>$${gridFmt(g.px,sym)}</b></div><div><span>ENTRY</span><b>$${gridFmt(g.entryLow,sym)}–$${gridFmt(g.entryHigh,sym)}</b></div><div><span>RANGE</span><b>$${gridFmt(g.rangeLow,sym)}–$${gridFmt(g.rangeHigh,sym)}</b></div><div><span>GRIDS</span><b>~${grids}</b></div><div><span>TP1</span><b>$${gridFmt(g.hi,sym)}</b></div><div><span>TP2</span><b>$${gridFmt(g.fib.ext1272,sym)}</b></div></div>
 <div class="scanner-foot">Setup Quality ${setup}/100 · Entry Readiness ${ready}/100 · Swing ${fmt(g.ampPct,1)}%</div></details>`;
}
function commanderBot(b){
 const guard=liqGuard(b), liq=Number(b.liquidationDistancePct||0);
 const priority=b.status==='CRITICAL'?'RISK ACTION':b.id.includes('HBAR')?'NO ADD':b.id.includes('XRP')?'HOLD':'WATCH';
 return `<details class="commander-detail ${guard.cls}" data-detail-key="bot-${b.id}"><summary><span><b>${b.id}</b><small>${b.side.toUpperCase()} ${b.leverage}x</small></span><span><b class="${guard.cls}">${guard.label}</b><small>LIQ GUARD</small></span><span><b>${fmt(liq,1)}%</b><small>BUFFER</small></span></summary>
 <div class="commander-priority ${guard.cls}">${priority} · ${b.action}</div>
 <div class="grid2">${metric('HEALTH',b.healthScore+'/100',guard.cls)}${metric('BREAK-EVEN','$'+gridFmt(b.breakEven,b.symbol))}${metric('LIQ.','$'+gridFmt(b.liquidation,b.symbol),'red')}${metric('FUNDING',fmt(b.fundingPct||0,4)+'%')}</div><p class="footer-note">${b.reason}</p></details>`;
}
function gridView(){
 const r=DATA.pionexRisk||{}, bots=r.bots||[];
 const order=[...bots].sort((a,b)=>Number(a.liquidationDistancePct||99)-Number(b.liquidationDistancePct||99));
 const critical=order.filter(b=>liqGuard(b).label==='CRITICAL').length;
 return card(`<div class="eyebrow">GRID COMMANDER 3.0 ${snapshotBadge('PIONEX VERIFIED')}</div><div class="forecast-main">RISK FIRST</div><div class="sub">Liquidation Guard · Bot Health · Entry Readiness</div>
 <div class="grid2">${metric('FUTURES RISK',r.riskLevel||'—','red')}${metric('CRITICAL BOTS',critical,critical?'red':'green')}</div><p class="footer-note">${r.riskNote||''}</p>`)+
 card(`<div class="section-title">BOT PRIORITY QUEUE</div>${order.map(commanderBot).join('')}<p class="footer-note">SAFE ≥30% · TIGHT 15–30% · DANGER 8–15% · CRITICAL &lt;8% Liq.-Puffer. Details per Tap.</p>`)+
 card(`<div class="eyebrow">FIB GRID ENGINE 1.3 ${liveBadge('LIVE')}</div><div class="forecast-main">ENTRY READINESS</div><button class="mini-grid-btn" onclick="refreshGridEngine(true)">4H SWINGS JETZT NEU LADEN</button><p class="footer-note">Setup Quality bewertet die Struktur. Entry Readiness bewertet, ob der Einstieg JETZT sinnvoll ist.</p>`)+
 card(`<div class="section-title">OPPORTUNITY SCANNER</div>${['SOL','ETH','PEPE'].map(scannerCard).join('')||'<p class="footer-note">Scanner lädt 4H-Daten …</p>'}<p class="footer-note">Keine automatische Bot-Ausführung.</p>`);
}
function settings(){
 const cached=DATA.forecastCoins.filter(c=>loadCache(c)).length,r=DATA.pionexRisk||{},fh=feedHealth();
 return card(`<div class="section-title">LIVE DATA STATUS</div><div class="row"><span>App-Version</span><b>${DATA.appVersion}</b></div><div class="row"><span>Build</span><b>${DATA.build}</b></div><div class="row"><span>BTC Feed</span><b>${sourceBadge(fh.status)} ${fh.source}</b></div><div class="row"><span>Feed-Alter</span><b>${fh.age==null?'—':fh.age+' Sek.'}</b></div><div class="row"><span>WebSocket</span><b class="${FEED.ws==='CONNECTED'?'green':'amber'}">${FEED.ws}</b></div><div class="row"><span>Binance REST</span><b>${FEED.binanceRest}</b></div><div class="row"><span>CoinGecko</span><b>${FEED.coinGecko}</b></div><div class="row"><span>Day-Trade Technik</span><b>${DATA.dayTrade.technicalUpdatedAt?'Binance Futures Browser Live':'Fallback / Snapshot'}</b></div><div class="row"><span>Pionex</span><b>${r.status||'—'} · 09:12</b></div><div class="row"><span>History-Cache</span><b>${cached}/${DATA.forecastCoins.length}</b></div><div class="row"><span>Portfolio-Historie</span><b>${PORTFOLIO_SERIES.length} Punkte</b></div><div class="row"><span>Cashflows</span><b>${CASHFLOWS.length} Einträge</b></div><div class="row"><span>Decision Engine</span><b class="cyan">1.0 · MODEL</b></div>`)+
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
 // Preserve expanded GRID Commander / Opportunity Scanner details across live WebSocket re-renders.
 // Without this, renderAll() replaces the DOM every ~1s and native <details> immediately collapses.
 const openGridDetails=view==='grid'
   ? [...el.querySelectorAll('details[data-detail-key][open]')].map(d=>d.dataset.detailKey)
   : [];
 try{
   if(view==='forecast') renderForecast();
   else el.innerHTML=item[1]();
   if(view==='grid' && openGridDetails.length){
     const openSet=new Set(openGridDetails);
     el.querySelectorAll('details[data-detail-key]').forEach(d=>{if(openSet.has(d.dataset.detailKey))d.open=true});
   }
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
 if(view==='grid') refreshGridEngine(false);
}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>openView(b.dataset.view,b));
$('#settingsBtn').onclick=()=>openView('settings',null);
/* v5.0.4 lazy view recovery: service worker disabled during recovery */
load();
