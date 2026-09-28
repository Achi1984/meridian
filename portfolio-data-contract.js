// MERIDIAN v7.63 — Canonical Portfolio Data Contract
// Pure helpers used to keep headline total, chart endpoint and 1D math on one valuation basis.

export const PORTFOLIO_CONTRACT_VERSION='7.63-PORTFOLIO-DATA-CONTRACT-V1';
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

export function portfolioPriceCoverage(data={}){
  const holdings=Array.isArray(data?.portfolio?.holdings)?data.portfolio.holdings.filter(h=>String(h?.venue||'').toLowerCase()!=='pionex'):[];
  const meta=data?.livePriceMeta||{},requestedRaw=finite(meta.requestedCount),resolvedRaw=finite(meta.resolvedCount);
  const requested=requestedRaw==null?holdings.length:Math.max(0,Math.floor(requestedRaw));
  const resolved=resolvedRaw==null?holdings.filter(h=>finite(data?.livePrices?.[h?.symbol]?.price)>0).length:Math.max(0,Math.floor(resolvedRaw));
  const feedFresh=meta.fresh===true,complete=holdings.length>0&&feedFresh&&requested===holdings.length&&resolved===requested,partial=holdings.length>0&&feedFresh&&resolved>0&&!complete;
  return{holdingCount:holdings.length,requested,resolved,feedFresh,complete,partial};
}

export function canonicalPortfolioSnapshot(data={},timestamp=Date.now()){
  const holdings=Array.isArray(data?.portfolio?.holdings)?data.portfolio.holdings:[],priceCoverage=portfolioPriceCoverage(data);
  const spotUsd=holdings
    .filter(h=>String(h?.venue||'').toLowerCase()!=='pionex')
    .reduce((s,h)=>s+holdingUsd(data,h),0);
  const tradingSnapshot=pionexEquitySnapshot(data),tradingUsd=tradingSnapshot.value;
  const totalUsd=spotUsd+tradingUsd;
  return{
    version:PORTFOLIO_CONTRACT_VERSION,
    timestamp:num(timestamp,Date.now()),
    spotUsd:round(spotUsd),
    tradingUsd:round(tradingUsd),
    totalUsd:round(totalUsd),
    priceCoverage,
    sourceStatus:{spot:holdings.length?'HOLDINGS_PLUS_LIVE_PRICE':'MISSING',trading:tradingUsd>0?'PIONEX_EQUITY':'MISSING'},
    sourceDetail:{spot:priceCoverage.complete?'LIVE_PRICE_COMPLETE':priceCoverage.partial?'LIVE_PRICE_PARTIAL':holdings.length?'SNAPSHOT_FALLBACK':'MISSING',trading:tradingSnapshot.found?tradingSnapshot.source:'MISSING'}
  };
}

export function latestPortfolioHistorySnapshot(history={},now=Date.now(),maxAgeMs=15*60*1000){
  const points=Array.isArray(history?.points)?history.points:[];
  const point=[...points].reverse().find(x=>finite(x?.timestamp)!=null&&finite(x?.spotUsd)!=null&&finite(x?.tradingUsd)!=null&&finite(x?.totalUsd)!=null);
  if(!point)return{found:false,fresh:false,complete:false,consistent:false,ageMs:null,timestamp:null,spotUsd:null,tradingUsd:null,totalUsd:null,source:String(history?.source||'MISSING')};
  const timestamp=finite(point.timestamp),spotUsd=finite(point.spotUsd),tradingUsd=finite(point.tradingUsd),totalUsd=finite(point.totalUsd);
  const nowMs=finite(now)??Date.now(),future=timestamp!=null&&timestamp>nowMs+30000,ageMs=timestamp==null?null:Math.max(0,nowMs-timestamp);
  const complete=[spotUsd,tradingUsd,totalUsd].every(x=>x!=null&&x>=0);
  const consistent=complete&&Math.abs(totalUsd-(spotUsd+tradingUsd))<=1;
  const fresh=consistent&&!future&&ageMs!=null&&ageMs<=Math.max(0,finite(maxAgeMs)??0);
  return{found:true,fresh,complete,consistent,ageMs,timestamp,spotUsd,tradingUsd,totalUsd,source:String(history?.source||'POSTGRES_CANONICAL_HISTORY')};
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
