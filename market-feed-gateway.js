const MARKET_INTERVAL_MS={
  '15m':15*60*1000,
  '1h':60*60*1000,
  '4h':4*60*60*1000,
  '1d':24*60*60*1000
};
const MARKET_ALLOWED_INTERVALS=new Set(Object.keys(MARKET_INTERVAL_MS));
const MARKET_CACHE_TTL_MS=45*1000;
const MARKET_STALE_FALLBACK_MS=90*1000;
const candleCache=new Map();

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function safeSymbol(v){
  const symbol=String(v||'').trim().toUpperCase();
  return /^[A-Z0-9]{2,20}$/.test(symbol)?symbol:null;
}
function safeInterval(v){
  const interval=String(v||'').trim();
  return MARKET_ALLOWED_INTERVALS.has(interval)?interval:null;
}
function safeLimit(v){
  const n=Math.floor(Number(v)||0);
  return Math.max(20,Math.min(300,n||160));
}
function cacheKey(symbol,interval,limit){return symbol+'|'+interval+'|'+limit}
async function fetchJsonTimed(url,{fetchImpl=globalThis.fetch,timeoutMs=7000}={}){
  if(typeof fetchImpl!=='function')throw new Error('fetch_unavailable');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||7000));
  try{
    const r=await fetchImpl(url,{cache:'no-store',headers:{accept:'application/json'},signal:controller.signal});
    if(!r?.ok)throw new Error('HTTP '+String(r?.status||0));
    return await r.json();
  }finally{clearTimeout(timer)}
}
function normalizeRows(rows){
  return (Array.isArray(rows)?rows:[]).map(x=>({
    openTime:finite(x?.openTime),
    high:finite(x?.high),
    low:finite(x?.low),
    close:finite(x?.close),
    closeTime:finite(x?.closeTime)
  })).filter(x=>x.openTime!=null&&x.high!=null&&x.low!=null&&x.close!=null&&x.closeTime!=null);
}
async function fetchOkx(symbol,interval,limit,opts){
  const barMap={'15m':'15m','1h':'1H','4h':'4H','1d':'1D'},bar=barMap[interval],span=MARKET_INTERVAL_MS[interval];
  const url='https://www.okx.com/api/v5/market/candles?instId='+encodeURIComponent(symbol+'-USDT-SWAP')+'&bar='+encodeURIComponent(bar)+'&limit='+limit;
  const j=await fetchJsonTimed(url,opts);
  if(String(j?.code)!=='0'||!Array.isArray(j?.data)||!j.data.length)throw new Error('OKX_INVALID_DATA');
  return normalizeRows(j.data.map(x=>({openTime:+x[0],high:+x[2],low:+x[3],close:+x[4],closeTime:+x[0]+Math.max(1,span)-1})).reverse());
}
async function fetchBinance(symbol,interval,limit,opts){
  const url='https://fapi.binance.com/fapi/v1/klines?symbol='+encodeURIComponent(symbol+'USDT')+'&interval='+encodeURIComponent(interval)+'&limit='+limit;
  const j=await fetchJsonTimed(url,opts);
  if(!Array.isArray(j)||!j.length)throw new Error('BINANCE_INVALID_DATA');
  return normalizeRows(j.map(x=>({openTime:+x[0],high:+x[2],low:+x[3],close:+x[4],closeTime:+x[6]})));
}
export async function marketKlinesSnapshot(query={},opts={}){
  const symbol=safeSymbol(query.symbol),interval=safeInterval(query.interval),limit=safeLimit(query.limit),now=Number(opts.now)||Date.now();
  if(!symbol)return{ok:false,status:400,error:'invalid_symbol'};
  if(!interval)return{ok:false,status:400,error:'invalid_interval'};
  const key=cacheKey(symbol,interval,limit),cached=candleCache.get(key);
  if(cached&&now-cached.fetchedAt<=MARKET_CACHE_TTL_MS)return{...cached,cache:'HIT',ageMs:Math.max(0,now-cached.fetchedAt)};
  const errors=[];
  for(const source of ['OKX','BINANCE']){
    try{
      const rows=source==='OKX'?await fetchOkx(symbol,interval,limit,opts):await fetchBinance(symbol,interval,limit,opts);
      if(rows.length<Math.min(20,limit))throw new Error(source+'_INSUFFICIENT_ROWS');
      const snapshot={ok:true,status:200,symbol,interval,limit,source:source==='OKX'?'OKX USDT-SWAP':'BINANCE USD-M FUTURES',transport:'MERIDIAN_GATEWAY',fetchedAt:now,rows,cache:'MISS',ageMs:0};
      candleCache.set(key,snapshot);
      return snapshot;
    }catch(e){errors.push(source+' '+String(e?.message||e))}
  }
  if(cached&&now-cached.fetchedAt<=MARKET_STALE_FALLBACK_MS){
    return{...cached,cache:'STALE_FALLBACK',ageMs:Math.max(0,now-cached.fetchedAt),upstreamError:errors.join(' / ')};
  }
  return{ok:false,status:502,error:'market_upstream_unavailable',symbol,interval,limit,details:errors.slice(0,2)};
}
export function clearMarketFeedCache(){candleCache.clear()}
export const MARKET_FEED_POLICY=Object.freeze({
  cacheTtlMs:MARKET_CACHE_TTL_MS,
  staleFallbackMs:MARKET_STALE_FALLBACK_MS,
  intervals:[...MARKET_ALLOWED_INTERVALS]
});
