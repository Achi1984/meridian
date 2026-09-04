// MERIDIAN v7.63 — Canonical Portfolio Data Contract
// Pure helpers used to keep headline total, chart endpoint and 1D math on one valuation basis.

export const PORTFOLIO_CONTRACT_VERSION='7.63-PORTFOLIO-DATA-CONTRACT-V1';
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const round=(v,d=2)=>Math.round(num(v)*10**d)/10**d;

export function holdingUsd(data={},holding={}){
  const q=Number(holding.quantity);
  const live=Number(data?.livePrices?.[holding.symbol]?.price);
  const own=Number(holding.price);
  const stored=Number(holding.value??holding.valueUsd);
  if(Number.isFinite(q)&&q>=0&&Number.isFinite(live)&&live>0)return q*live;
  if(Number.isFinite(q)&&q>=0&&Number.isFinite(own)&&own>0)return q*own;
  return Number.isFinite(stored)?stored:0;
}

export function pionexEquityUsd(data={}){
  const direct=Number(data?.portfolio?.pionexEquityUsd);
  if(Number.isFinite(direct)&&direct>=0)return direct;
  const rows=Array.isArray(data?.portfolio?.manualVenueBalances)?data.portfolio.manualVenueBalances:[];
  const row=rows.find(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex');
  const value=Number(row?.value??row?.valueUsd);
  return Number.isFinite(value)&&value>=0?value:0;
}

export function canonicalPortfolioSnapshot(data={},timestamp=Date.now()){
  const holdings=Array.isArray(data?.portfolio?.holdings)?data.portfolio.holdings:[];
  const spotUsd=holdings
    .filter(h=>String(h?.venue||'').toLowerCase()!=='pionex')
    .reduce((s,h)=>s+holdingUsd(data,h),0);
  const tradingUsd=pionexEquityUsd(data);
  const totalUsd=spotUsd+tradingUsd;
  return{
    version:PORTFOLIO_CONTRACT_VERSION,
    timestamp:num(timestamp,Date.now()),
    spotUsd:round(spotUsd),
    tradingUsd:round(tradingUsd),
    totalUsd:round(totalUsd),
    sourceStatus:{spot:holdings.length?'HOLDINGS_PLUS_LIVE_PRICE':'MISSING',trading:tradingUsd>0?'PIONEX_EQUITY':'MISSING'}
  };
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
