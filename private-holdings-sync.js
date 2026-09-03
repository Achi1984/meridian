// MERIDIAN private holdings venue sync helpers.
// Accepts compact private text from an authenticated client; no private quantities live in the repo.

const ALIASES={BETH:'ETH',OKSOL:'SOL'};
const clean=s=>String(s||'').trim();
const clone=x=>JSON.parse(JSON.stringify(x));

export function parseHoldingsText(text){
  const raw=clean(text);
  if(!raw)return {ok:false,error:'holdings_text_required'};
  const rows=raw.split(/[\n;]+/).map(clean).filter(Boolean);
  const parsed=[];
  for(const row of rows){
    const m=row.match(/^([^:]{1,40}):(.+)$/);
    if(!m)return {ok:false,error:'invalid_row',row};
    const venue=clean(m[1]);
    const items=m[2].split(',').map(clean).filter(Boolean);
    if(!venue||!items.length)return {ok:false,error:'invalid_row',row};
    for(const item of items){
      const p=item.match(/^([A-Za-z0-9._-]{1,20})=([-+]?\d+(?:\.\d+)?)$/);
      if(!p)return {ok:false,error:'invalid_holding',item,venue};
      const sourceSymbol=p[1].toUpperCase();
      const symbol=ALIASES[sourceSymbol]||sourceSymbol;
      const quantity=Number(p[2]);
      if(!Number.isFinite(quantity)||quantity<0)return {ok:false,error:'invalid_quantity',item,venue};
      parsed.push({venue,symbol,sourceSymbol,quantity});
    }
  }
  if(!parsed.length)return {ok:false,error:'no_holdings'};
  return {ok:true,parsed,venues:[...new Set(parsed.map(x=>x.venue))]};
}

export function mergeVenueHoldings(current,text,{now=new Date().toISOString()}={}){
  const check=parseHoldingsText(text);
  if(!check.ok)return check;
  const base=current&&typeof current==='object'?clone(current):{};
  base.portfolio=base.portfolio&&typeof base.portfolio==='object'?base.portfolio:{};
  const existing=Array.isArray(base.portfolio.holdings)?base.portfolio.holdings:[];
  const replaceVenues=new Set(check.venues.map(v=>v.toLowerCase()));
  const kept=existing.filter(h=>!replaceVenues.has(clean(h?.venue).toLowerCase()));
  const incoming=check.parsed.filter(x=>x.quantity>0).map(x=>({
    symbol:x.symbol,
    quantity:x.quantity,
    venue:x.venue,
    ...(x.sourceSymbol!==x.symbol?{sourceSymbol:x.sourceSymbol}:{}),
    updatedAt:now
  }));
  base.portfolio.holdings=[...kept,...incoming];
  const currentRevision=Number.isInteger(base.privateRevision)?base.privateRevision:0;
  base.privateRevision=currentRevision+1;
  base.privateStorageVersion=String(base.privateStorageVersion||'1');
  base.privateUpdatedAt=now;
  base.privateUpdateSource='authenticated_holdings_sync';
  base.portfolio.holdingsUpdatedAt=now;
  return {ok:true,data:base,currentRevision,nextRevision:base.privateRevision,venues:check.venues,holdingCount:incoming.length};
}
