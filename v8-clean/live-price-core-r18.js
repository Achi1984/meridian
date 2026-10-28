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
  const livePrices={};let resolved=0,requested=0,policyAssumptionCount=0;
  for(const h of spotHoldingsForPricing(data)){
    const original=h?.symbol,raw=String(original||'').trim().toUpperCase();
    if(!raw)continue;
    requested++;
    if(typeof original!=='string'||raw!==original)continue;
    const asset=pricingAsset(raw);
    const marketPrice=byPair.get(`${asset}USDT`),policyAssumption=marketPrice===undefined&&STABLES.has(asset),price=policyAssumption?1:marketPrice;
    if(Number.isFinite(price)&&price>0){
      const source=policyAssumption?'STABLE_VALUE_POLICY':'BINANCE_SPOT',sourceQuality=policyAssumption?'POLICY_ASSUMPTION':'PUBLIC_LIVE_FETCH',providerObservedAt=null;
      livePrices[raw]={price,source,sourceQuality,providerObservedAt};
      if(!policyAssumption){livePrices[raw].ts=fetchedAt;livePrices[raw].fetchedAt=fetchedAt}
      if(policyAssumption)policyAssumptionCount++;else resolved++;
    }
  }
  const perSymbol=Object.fromEntries(Object.entries(livePrices).map(([symbol,quote])=>[symbol,{price:quote.price,source:quote.source,sourceQuality:quote.sourceQuality,fetchedAt:quote.fetchedAt,providerObservedAt:quote.providerObservedAt}]));
  return {
    ...data,
    livePrices,
    livePriceMeta:{source:'BINANCE_SPOT',fetchedAt,fresh:resolved===requested,requestedCount:requested,resolvedCount:resolved,policyAssumptionCount,perSymbol,privacyMode:'ALL_TICKERS_NO_HOLDING_QUERY'}
  };
}

export function clearStaleLivePrices(data={},fetchedAt=Date.now(),reason='MARKET_FEED_UNAVAILABLE'){
  return {...data,livePrices:{},livePriceMeta:{source:'FALLBACK',fetchedAt,fresh:false,reason}};
}
