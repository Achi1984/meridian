// MERIDIAN v7.63 — Canonical Portfolio Data Contract
// Pure helpers used to keep headline total, chart endpoint and 1D math on one valuation basis.

export const PORTFOLIO_CONTRACT_VERSION='7.63-PORTFOLIO-DATA-CONTRACT-V2';
export const PORTFOLIO_AUTHORITY_MAX_AGE_MS=24*60*60*1000;
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const round=(v,d=2)=>Math.round(num(v)*10**d)/10**d;
const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);

export function holdingUsd(data={},holding={}){
  const q=finite(holding.quantity);
  const live=finite(data?.livePrices?.[holding.symbol]?.price);
  const own=finite(holding.price);
  const stored=finite(holding.value)??finite(holding.valueUsd)??finite(holding.usdValue);
  if(q!=null&&q>=0&&live!=null&&live>0)return q*live;
  if(q!=null&&q>=0&&own!=null&&own>0)return q*own;
  return stored??0;
}

export function pionexEquitySnapshot(data={}){
  const raw=data?.portfolio?.pionexEquityUsd,direct=Number(raw);
  if(raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(direct)&&direct>=0){
    return{found:true,value:direct,source:String(data?.portfolio?.pionexEquitySource||'PRIVATE_PORTFOLIO_SNAPSHOT'),updatedAt:data?.portfolio?.pionexEquityUpdatedAt||null};
  }
  const rows=Array.isArray(data?.portfolio?.manualVenueBalances)?data.portfolio.manualVenueBalances:[];
  const row=rows.find(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex'),rowRaw=row?.valueUsd??row?.value,value=Number(rowRaw);
  if(rowRaw!==null&&rowRaw!==undefined&&rowRaw!==''&&Number.isFinite(value)&&value>=0){
    return{found:true,value,source:String(row?.source||'PRIVATE_VENUE_BALANCE'),updatedAt:row?.updatedAt||null};
  }
  return{found:false,value:0,source:'MISSING',updatedAt:null};
}
export function pionexEquityUsd(data={}){return pionexEquitySnapshot(data).value}

export function sourceTimestampAge(updatedAt,now=Date.now()){
  let timestampMs=finite(updatedAt);
  if(timestampMs==null&&updatedAt!==null&&updatedAt!==undefined&&updatedAt!==''){
    const parsed=Date.parse(String(updatedAt));timestampMs=Number.isFinite(parsed)?parsed:null;
  }
  const nowMs=finite(now)??Date.now();
  if(timestampMs==null)return{known:false,future:false,timestampMs:null,ageMs:null};
  const future=timestampMs>nowMs+30000,ageMs=Math.max(0,nowMs-timestampMs);
  return{known:true,future,timestampMs,ageMs};
}

function venueKey(v){return String(v||'').trim().toLowerCase()}
function rowTimestamp(row={}){
  const raw=row?.updatedAt??row?.snapshotAt??row?.asOf??null;
  if(raw==null||raw==='')return null;
  const n=finite(raw);if(n!=null)return n;
  const parsed=Date.parse(String(raw));return Number.isFinite(parsed)?parsed:null;
}
function rowValueUsd(row={}){
  return finite(row?.valueUsd)??finite(row?.value)??finite(row?.totalUsd)??finite(row?.equityUsd);
}
function currentTimestamp(timestamp,now,maxAgeMs){
  if(!Number.isFinite(timestamp))return false;
  if(timestamp>now+30000)return false;
  return now-timestamp<=Math.max(0,finite(maxAgeMs)??PORTFOLIO_AUTHORITY_MAX_AGE_MS);
}

export function externalVenueBalanceSnapshot(data={},now=Date.now(),maxAgeMs=PORTFOLIO_AUTHORITY_MAX_AGE_MS){
  const nowMs=finite(now)??Date.now(),rows=Array.isArray(data?.portfolio?.manualVenueBalances)?data.portfolio.manualVenueBalances:[];
  const normalized=rows
    .map((row,index)=>{
      const venue=String(row?.venue||row?.name||'').trim(),key=venueKey(venue),valueUsd=rowValueUsd(row),timestamp=rowTimestamp(row);
      return{index,venue,key,valueUsd,timestamp,updatedAt:row?.updatedAt||row?.snapshotAt||row?.asOf||null,source:String(row?.source||'PRIVATE_VENUE_BALANCE')};
    })
    .filter(x=>x.key&&x.key!=='pionex'&&x.valueUsd!=null&&x.valueUsd>=0);
  const newest=new Map();
  for(const row of normalized){
    const prev=newest.get(row.key);
    const rowTs=Number.isFinite(row.timestamp)?row.timestamp:-Infinity,prevTs=Number.isFinite(prev?.timestamp)?prev.timestamp:-Infinity;
    if(!prev||rowTs>=prevTs)newest.set(row.key,row);
  }
  const selected=[...newest.values()],current=selected.filter(x=>currentTimestamp(x.timestamp,nowMs,maxAgeMs)),stale=selected.filter(x=>!currentTimestamp(x.timestamp,nowMs,maxAgeMs));
  const totalUsd=current.reduce((sum,x)=>sum+x.valueUsd,0),ages=current.map(x=>Math.max(0,nowMs-x.timestamp)),currentKeys=new Set(current.map(x=>x.key));
  const expectedVenues=Array.isArray(data?.portfolio?.externalVenueExpectedVenues)?data.portfolio.externalVenueExpectedVenues.map(x=>String(x||'').trim()).filter(Boolean):[],expectedKeys=[...new Set(expectedVenues.map(venueKey).filter(Boolean))];
  const declaredComplete=data?.portfolio?.externalVenueSnapshotComplete===true,complete=declaredComplete&&(expectedKeys.length?expectedKeys.every(k=>currentKeys.has(k)):current.length>0);
  return{
    rows:current,staleRows:stale,venueCount:current.length,venues:current.map(x=>x.venue),
    expectedVenues,missingExpectedVenues:expectedVenues.filter(v=>!currentKeys.has(venueKey(v))),
    totalUsd:round(totalUsd),complete,
    maxAgeMs:ages.length?Math.max(...ages):null,minAgeMs:ages.length?Math.min(...ages):null
  };
}

export function authoritativeSpotHoldings(data={},now=Date.now(),maxAgeMs=PORTFOLIO_AUTHORITY_MAX_AGE_MS){
  const holdings=Array.isArray(data?.portfolio?.holdings)?data.portfolio.holdings.filter(h=>venueKey(h?.venue)!=='pionex'):[];
  const strict=String(data?.portfolio?.authorityMode||'').toUpperCase()==='STRICT_VENUE_SNAPSHOT';
  if(!strict)return{strict:false,current:holdings,stale:[],superseded:[],external:externalVenueBalanceSnapshot(data,now,maxAgeMs),requiredHoldingVenues:[],missingRequiredHoldingVenues:[]};
  const external=externalVenueBalanceSnapshot(data,now,maxAgeMs),covered=new Set(external.rows.map(x=>x.key)),current=[],stale=[],superseded=[];
  const nowMs=finite(now)??Date.now();
  for(const h of holdings){
    const key=venueKey(h?.venue);
    if(covered.has(key)){superseded.push(h);continue}
    const ts=rowTimestamp(h);
    if(currentTimestamp(ts,nowMs,maxAgeMs))current.push(h);else stale.push(h);
  }
  const requiredHoldingVenues=Array.isArray(data?.portfolio?.requiredHoldingVenues)?data.portfolio.requiredHoldingVenues.map(x=>String(x||'').trim()).filter(Boolean):[],currentHoldingKeys=new Set(current.map(h=>venueKey(h?.venue)));
  const missingRequiredHoldingVenues=requiredHoldingVenues.filter(v=>!currentHoldingKeys.has(venueKey(v)));
  return{strict:true,current,stale,superseded,external,requiredHoldingVenues,missingRequiredHoldingVenues};
}

export function portfolioPriceCoverage(data={},now=Date.now()){
  const auth=authoritativeSpotHoldings(data,now),holdings=auth.current,meta=data?.livePriceMeta||{},strict=auth.strict;
  const requestedRaw=strict?null:finite(meta.requestedCount),resolvedRaw=strict?null:finite(meta.resolvedCount);
  const requested=requestedRaw==null?holdings.length:Math.max(0,Math.floor(requestedRaw));
  const resolved=resolvedRaw==null?holdings.filter(h=>finite(data?.livePrices?.[h?.symbol]?.price)>0).length:Math.max(0,Math.floor(resolvedRaw));
  const feedFresh=holdings.length===0?true:meta.fresh===true,complete=holdings.length===0?true:feedFresh&&requested===holdings.length&&resolved===requested,partial=holdings.length>0&&feedFresh&&resolved>0&&!complete;
  return{holdingCount:holdings.length,requested,resolved,feedFresh,complete,partial,strict,excludedStaleHoldings:auth.stale.length,supersededHoldings:auth.superseded.length,externalVenueCount:auth.external.venueCount};
}

export function canonicalPortfolioSnapshot(data={},timestamp=Date.now()){
  const nowMs=num(timestamp,Date.now()),auth=authoritativeSpotHoldings(data,nowMs),priceCoverage=portfolioPriceCoverage(data,nowMs),strict=auth.strict;
  const holdingsUsd=auth.current.reduce((sum,h)=>sum+holdingUsd(data,h),0);
  const externalUsd=strict?auth.external.totalUsd:0;
  const spotUsd=strict?externalUsd+holdingsUsd:holdingsUsd;
  const tradingSnapshot=pionexEquitySnapshot(data),tradingUsd=tradingSnapshot.value,totalUsd=spotUsd+tradingUsd;
  const requiredHoldingsComplete=!strict||auth.missingRequiredHoldingVenues.length===0;
  const holdingsPricingComplete=!strict||priceCoverage.complete;
  const strictComplete=strict&&auth.external.complete&&requiredHoldingsComplete&&holdingsPricingComplete;
  const spotAuthority={
    strict,
    complete:strict?strictComplete:false,
    venueCount:strict?auth.external.venueCount:0,
    venues:strict?auth.external.venues:[],
    externalRows:strict?auth.external.rows.map(x=>({venue:x.venue,valueUsd:round(x.valueUsd),updatedAt:x.updatedAt,source:x.source})):[],
    externalUsd:round(externalUsd),
    holdingsUsd:round(holdingsUsd),
    currentHoldings:auth.current.length,
    currentHoldingVenues:[...new Set(auth.current.map(h=>String(h?.venue||'').trim()).filter(Boolean))],
    requiredHoldingVenues:auth.requiredHoldingVenues||[],
    missingRequiredHoldingVenues:auth.missingRequiredHoldingVenues||[],
    holdingsPricingComplete,
    excludedStaleHoldings:auth.stale.length,
    supersededHoldings:auth.superseded.length,
    maxAgeMs:strict?Math.max(auth.external.maxAgeMs||0,...auth.current.map(h=>{const ts=rowTimestamp(h);return Number.isFinite(ts)?Math.max(0,nowMs-ts):0})):null
  };
  const spotDetail=strict
    ?(auth.external.venueCount&&auth.current.length?'VENUE_BALANCE_PLUS_FRESH_HOLDINGS':auth.external.venueCount?'VENUE_BALANCE_SNAPSHOT':auth.current.length?(priceCoverage.complete?'FRESH_HOLDINGS':'PARTIAL_HOLDINGS'):'MISSING')
    :(priceCoverage.complete?'LIVE_PRICE_COMPLETE':priceCoverage.partial?'LIVE_PRICE_PARTIAL':auth.current.length?'SNAPSHOT_FALLBACK':'MISSING');
  return{
    version:PORTFOLIO_CONTRACT_VERSION,
    timestamp:nowMs,
    spotUsd:round(spotUsd),
    tradingUsd:round(tradingUsd),
    totalUsd:round(totalUsd),
    priceCoverage,
    spotAuthority,
    sourceStatus:{spot:strict?(spotAuthority.complete?'STRICT_AUTHORITY':'STRICT_PARTIAL'):(auth.current.length?'HOLDINGS_PLUS_LIVE_PRICE':'MISSING'),trading:tradingUsd>0?'PIONEX_EQUITY':'MISSING'},
    sourceDetail:{spot:spotDetail,trading:tradingSnapshot.found?tradingSnapshot.source:'MISSING'}
  };
}

export function latestPortfolioHistorySnapshot(history={},now=Date.now(),maxAgeMs=15*60*1000){
  const points=Array.isArray(history?.points)?history.points:[];
  const point=[...points].reverse().find(x=>finite(x?.timestamp)!=null&&finite(x?.spotUsd)!=null&&finite(x?.tradingUsd)!=null&&finite(x?.totalUsd)!=null);
  if(!point)return{found:false,fresh:false,complete:false,consistent:false,ageMs:null,timestamp:null,spotUsd:null,tradingUsd:null,totalUsd:null,sourceStatus:null,source:String(history?.source||'MISSING')};
  const timestamp=finite(point.timestamp),spotUsd=finite(point.spotUsd),tradingUsd=finite(point.tradingUsd),totalUsd=finite(point.totalUsd);
  const nowMs=finite(now)??Date.now(),future=timestamp!=null&&timestamp>nowMs+30000,ageMs=timestamp==null?null:Math.max(0,nowMs-timestamp);
  const complete=[spotUsd,tradingUsd,totalUsd].every(x=>x!=null&&x>=0);
  const consistent=complete&&Math.abs(totalUsd-(spotUsd+tradingUsd))<=1;
  const fresh=consistent&&!future&&ageMs!=null&&ageMs<=Math.max(0,finite(maxAgeMs)??0);
  return{found:true,fresh,complete,consistent,ageMs,timestamp,spotUsd,tradingUsd,totalUsd,sourceStatus:point?.sourceStatus||null,source:String(history?.source||'POSTGRES_CANONICAL_HISTORY')};
}

export function alignSeriesToSnapshot(series=[],snapshot={},opts={}){
  const xs=Array.isArray(series)?series.filter(x=>Array.isArray(x)&&x.length>=2&&Number.isFinite(Number(x[1]))).map(x=>[...x]):[];
  const t=num(snapshot.timestamp,Date.now()),total=Number(snapshot.totalUsd);
  if(!Number.isFinite(total)||total<0)return xs;
  const toleranceMs=Math.max(0,num(opts.replaceWithinMs,5*60*1000));
  if(!xs.length)return [[t,total]];
  const parseT=v=>Number.isFinite(Number(v))?Number(v):Date.parse(v);
  const last=xs[xs.length-1],lastT=parseT(last[0]);
  if(Number.isFinite(lastT)&&Math.abs(t-lastT)<=toleranceMs){
    xs[xs.length-1]=[last[0],total,...last.slice(2)];
  }else{
    xs.push([t,total]);
  }
  return xs;
}

export function portfolioConsistency(series=[],snapshot={},toleranceUsd=1){
  const last=Array.isArray(series)&&series.length?Number(series.at(-1)?.[1]):NaN;
  const current=Number(snapshot?.totalUsd);
  const delta=Number.isFinite(last)&&Number.isFinite(current)?last-current:NaN;
  return{
    ok:Number.isFinite(delta)&&Math.abs(delta)<=Math.max(0,num(toleranceUsd,1)),
    chartLastUsd:Number.isFinite(last)?round(last):null,
    currentUsd:Number.isFinite(current)?round(current):null,
    deltaUsd:Number.isFinite(delta)?round(delta):null,
    status:Number.isFinite(delta)&&Math.abs(delta)<=Math.max(0,num(toleranceUsd,1))?'OK':'PORTFOLIO_DATA_MISMATCH'
  };
}

export function oneDayPerformance(currentAdjustedUsd,previousAdjustedUsd){
  const current=Number(currentAdjustedUsd),previous=Number(previousAdjustedUsd);
  if(!Number.isFinite(current)||!Number.isFinite(previous)||previous===0)return{deltaUsd:null,pct:null};
  const delta=current-previous;
  return{deltaUsd:round(delta),pct:round(delta/previous*100,2)};
}
