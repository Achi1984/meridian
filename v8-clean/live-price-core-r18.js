// MERIDIAN v8 R18 — pure live-price overlay helpers.
// Public market data only. No quantities, venues, tokens or private state leave the browser.
const ALIASES=Object.freeze({BETH:'ETH',OKSOL:'SOL'});
const STABLES=new Set(['USD','USDT','USDC','FDUSD','DAI']);

export function pricingAsset(raw){
  const s=String(raw||'').trim().toUpperCase();
  return ALIASES[s]||s;
}

export function spotHoldingsForPricing(data={}){
  const hs=data?.portfolio?.holdings;
  return Array.isArray(hs)?hs.filter(h=>String(h?.venue||'').toLowerCase()!=='pionex'):[];
}

export function buildLivePriceOverlay(data={},tickerRows=[],fetchedAt=Date.now()){
  const byPair=new Map();
  for(const row of Array.isArray(tickerRows)?tickerRows:[]){
    const symbol=String(row?.symbol||'').toUpperCase();
    const price=Number(row?.price);
    if(symbol&&Number.isFinite(price)&&price>0)byPair.set(symbol,price);
  }
  const livePrices={};let resolved=0,requested=0;
  for(const h of spotHoldingsForPricing(data)){
    const raw=String(h?.symbol||'').trim().toUpperCase();
    if(!raw)continue;
    requested++;
    const asset=pricingAsset(raw);
    const price=STABLES.has(asset)?1:byPair.get(`${asset}USDT`);
    if(Number.isFinite(price)&&price>0){livePrices[raw]={price,ts:fetchedAt,source:'BINANCE_SPOT'};resolved++}
  }
  return {
    ...data,
    livePrices,
    livePriceMeta:{source:'BINANCE_SPOT',fetchedAt,fresh:true,requestedCount:requested,resolvedCount:resolved,privacyMode:'ALL_TICKERS_NO_HOLDING_QUERY'}
  };
}

export function clearStaleLivePrices(data={},fetchedAt=Date.now(),reason='MARKET_FEED_UNAVAILABLE'){
  return {...data,livePrices:{},livePriceMeta:{source:'FALLBACK',fetchedAt,fresh:false,reason}};
}
