import {normalizeBasisKlines} from './spot-perp-basis-dislocation-v1.js';

export const SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_RULESET='SPOT-PERP-BASIS-VOLATILITY-REGIME-V1-FROZEN';
export const SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_ASSETS=Object.freeze([
  'APT','APE','CRV','SUSHI','DYDX','LDO','GALA','IMX'
]);

const HOUR=3600000;
const BAR8=8*HOUR;
const DAY=24*HOUR;

export const SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_CONFIG=Object.freeze({
  discoveryStart:Date.UTC(2024,8,1),
  discoveryEndExclusive:Date.UTC(2025,7,31), // anchors through 2025-08-30
  holdoutStart:Date.UTC(2025,8,1),
  holdoutEndExclusive:Date.UTC(2026,7,31),   // anchors through 2026-08-30
  barMs:BAR8,
  anchorMs:DAY,
  minObservationsPerAsset:340,
  discoveryGate:Object.freeze({
    minPooledSpearman:0.10,
    minPooledPartialSpearman:0.05,
    minPooledTopQuartileUplift:1.10,
    minPositiveSpearmanAssets:6,
    minPositivePartialAssets:5,
    minPositiveUpliftAssets:6,
    minPositiveWindows:4
  }),
  holdoutGate:Object.freeze({
    minPooledSpearman:0.05,
    minPooledPartialSpearman:0,
    minPooledTopQuartileUplift:1.05,
    minPositiveSpearmanAssets:5,
    minPositivePartialAssets:5,
    minPositiveUpliftAssets:5,
    minPositiveWindows:3
  })
});

const finite=x=>Number.isFinite(Number(x));
const sum=a=>a.reduce((s,x)=>s+x,0);
const mean=a=>a.length?sum(a)/a.length:null;

function dailyAnchors(start,endExclusive){
  const out=[];
  for(let t=start;t<endExclusive;t+=DAY)out.push(t);
  return out;
}

export function averageRanks(values){
  const rows=values.map((v,i)=>({v:Number(v),i})).sort((a,b)=>a.v-b.v||a.i-b.i);
  const ranks=new Array(values.length);
  let p=0;
  while(p<rows.length){
    let q=p+1;
    while(q<rows.length&&rows[q].v===rows[p].v)q++;
    const avg=((p+1)+q)/2;
    for(let k=p;k<q;k++)ranks[rows[k].i]=avg;
    p=q;
  }
  return ranks;
}

function percentileRanks(values){
  const r=averageRanks(values),n=r.length;
  return n<=1?r.map(()=>0.5):r.map(x=>(x-1)/(n-1));
}

export function pearson(x,y){
  if(x.length!==y.length||x.length<2)return null;
  const mx=mean(x),my=mean(y);
  let num=0,dx=0,dy=0;
  for(let i=0;i<x.length;i++){
    const a=x[i]-mx,b=y[i]-my;
    num+=a*b;dx+=a*a;dy+=b*b;
  }
  if(!(dx>0&&dy>0))return 0;
  return num/Math.sqrt(dx*dy);
}

export function spearman(x,y){
  if(x.length!==y.length||x.length<2)return null;
  return pearson(averageRanks(x),averageRanks(y));
}

export function partialSpearman(x,y,z){
  const xy=spearman(x,y),xz=spearman(x,z),yz=spearman(y,z);
  if(![xy,xz,yz].every(finite))return null;
  const den=Math.sqrt(Math.max(0,(1-xz*xz)*(1-yz*yz)));
  if(!(den>0))return 0;
  return (xy-xz*yz)/den;
}

function rvFromCloses(closes){
  if(closes.length!==4||closes.some(x=>!finite(x)||x<=0))return null;
  let ss=0;
  for(let i=1;i<closes.length;i++){
    const r=Math.log(closes[i]/closes[i-1]);
    ss+=r*r;
  }
  return Math.sqrt(ss);
}

function indexByCloseAnchor(rows,cfg){
  const m=new Map();
  for(const r of rows)m.set(r.time+cfg.barMs,r.close);
  return m;
}

function syncIntegrity(spot,perp,cfg){
  const reasons=[];
  if(spot.length!==perp.length)reasons.push('ROW_COUNT_MISMATCH');
  const n=Math.min(spot.length,perp.length);
  for(let i=0;i<n;i++){
    if(spot[i].time!==perp[i].time){reasons.push('TIMESTAMP_MISMATCH');break}
    if(i&&spot[i].time-spot[i-1].time!==cfg.barMs){reasons.push('SPOT_NON_8H_CADENCE');break}
    if(i&&perp[i].time-perp[i-1].time!==cfg.barMs){reasons.push('PERP_NON_8H_CADENCE');break}
  }
  return reasons;
}

function observationsForAsset(asset,data,anchors,cfg){
  let spot,perp;
  try{
    spot=normalizeBasisKlines(data?.spot||[]);
    perp=normalizeBasisKlines(data?.perp||[]);
  }catch(e){
    return{asset,observations:[],errors:[{asset,reason:'NORMALIZATION:'+String(e?.message||e)}]};
  }
  const sync=syncIntegrity(spot,perp,cfg);
  if(sync.length)return{asset,observations:[],errors:sync.map(reason=>({asset,reason}))};

  const sm=indexByCloseAnchor(spot,cfg),pm=indexByCloseAnchor(perp,cfg);
  const obs=[],errors=[];
  for(const t of anchors){
    const s=sm.get(t),p=pm.get(t);
    const lagTimes=[t-24*HOUR,t-16*HOUR,t-8*HOUR,t];
    const fwdTimes=[t,t+8*HOUR,t+16*HOUR,t+24*HOUR];
    const lag=lagTimes.map(x=>pm.get(x));
    const fwd=fwdTimes.map(x=>pm.get(x));
    if(!finite(s)||s<=0||!finite(p)||p<=0||lag.some(x=>!finite(x)||x<=0)||fwd.some(x=>!finite(x)||x<=0)){
      errors.push({asset,anchor:t,reason:'MISSING_EXACT_DAILY_CHAIN'});
      continue;
    }
    const absLogBasis=Math.abs(Math.log(p/s));
    const lagRv24=rvFromCloses(lag),fwdRv24=rvFromCloses(fwd);
    if(![absLogBasis,lagRv24,fwdRv24].every(finite)){
      errors.push({asset,anchor:t,reason:'NON_FINITE_FEATURE'});
      continue;
    }
    obs.push({asset,anchor:t,absLogBasis,lagRv24,fwdRv24});
  }
  return{asset,observations:obs,errors};
}

function topQuartileMetrics(obs){
  if(obs.length<4)return{topCount:0,topMean:null,restMean:null,uplift:null,topAnchors:new Set()};
  const count=Math.ceil(obs.length*.25);
  const sorted=[...obs].sort((a,b)=>b.absLogBasis-a.absLogBasis||a.anchor-b.anchor);
  const top=sorted.slice(0,count),rest=sorted.slice(count);
  const topMean=mean(top.map(x=>x.fwdRv24)),restMean=mean(rest.map(x=>x.fwdRv24));
  return{
    topCount:count,topMean,restMean,
    uplift:restMean>0?topMean/restMean:null,
    topAnchors:new Set(top.map(x=>x.anchor))
  };
}

function assetMetrics(asset,obs){
  const x=obs.map(o=>o.absLogBasis),y=obs.map(o=>o.fwdRv24),z=obs.map(o=>o.lagRv24);
  const tq=topQuartileMetrics(obs);
  return{
    asset,observations:obs.length,
    spearmanBasisForward:spearman(x,y),
    spearmanLagForward:spearman(z,y),
    partialSpearmanBasisForwardControllingLag:partialSpearman(x,y,z),
    topQuartileForwardRvMean:tq.topMean,
    restForwardRvMean:tq.restMean,
    topQuartileUpliftRatio:tq.uplift,
    medianAbsLogBasis:median(x),
    medianForwardRv:median(y)
  };
}

function median(values){
  if(!values.length)return null;
  const x=[...values].sort((a,b)=>a-b),m=Math.floor(x.length/2);
  return x.length%2?x[m]:(x[m-1]+x[m])/2;
}

function pooledRankRows(byAssetObs){
  const pooled=[];
  for(const [asset,obs] of Object.entries(byAssetObs)){
    const bx=percentileRanks(obs.map(x=>x.absLogBasis));
    const fy=percentileRanks(obs.map(x=>x.fwdRv24));
    const lz=percentileRanks(obs.map(x=>x.lagRv24));
    const tq=topQuartileMetrics(obs);
    obs.forEach((o,i)=>pooled.push({
      asset,anchor:o.anchor,
      basisRank:bx[i],forwardRank:fy[i],lagRank:lz[i],
      isTopBasisQuartile:tq.topAnchors.has(o.anchor)
    }));
  }
  return pooled;
}

function pooledMetrics(byAssetObs){
  const rows=pooledRankRows(byAssetObs);
  const x=rows.map(r=>r.basisRank),y=rows.map(r=>r.forwardRank),z=rows.map(r=>r.lagRank);
  const top=rows.filter(r=>r.isTopBasisQuartile),rest=rows.filter(r=>!r.isTopBasisQuartile);
  const topMean=mean(top.map(r=>r.forwardRank)),restMean=mean(rest.map(r=>r.forwardRank));
  return{
    observations:rows.length,
    spearmanBasisForward:pearson(x,y),
    partialSpearmanBasisForwardControllingLag:(()=>{
      const xy=pearson(x,y),xz=pearson(x,z),yz=pearson(y,z);
      const den=Math.sqrt(Math.max(0,(1-xz*xz)*(1-yz*yz)));
      return den>0?(xy-xz*yz)/den:0;
    })(),
    topQuartileForwardRankMean:topMean,
    restForwardRankMean:restMean,
    topQuartileUpliftRatio:restMean>0?topMean/restMean:null
  };
}

function stabilityMetrics(byAssetObs,anchors){
  const out=[];
  for(let i=0;i<5;i++){
    const a=Math.floor(anchors.length*i/5),b=Math.floor(anchors.length*(i+1)/5);
    const set=new Set(anchors.slice(a,b));
    const slice={};
    for(const [asset,obs] of Object.entries(byAssetObs))slice[asset]=obs.filter(x=>set.has(x.anchor));
    const p=pooledMetrics(slice);
    out.push({index:i+1,anchors:b-a,spearmanBasisForward:p.spearmanBasisForward});
  }
  return{windows:out,positiveWindows:out.filter(x=>x.spearmanBasisForward>0).length};
}

function evaluateGate(result,gate,cfg){
  const reasons=[];
  if(result.dataIntegrityFailure)reasons.push('DATA_INTEGRITY_FAILURE');
  for(const a of result.byAsset){
    if(a.observations<cfg.minObservationsPerAsset)reasons.push(a.asset+':OBS_LT_'+cfg.minObservationsPerAsset);
  }
  if(result.pooled.spearmanBasisForward<gate.minPooledSpearman)reasons.push('POOLED_SPEARMAN_LT_'+gate.minPooledSpearman);
  if(result.pooled.partialSpearmanBasisForwardControllingLag<gate.minPooledPartialSpearman)reasons.push('POOLED_PARTIAL_LT_'+gate.minPooledPartialSpearman);
  if(result.pooled.topQuartileUpliftRatio<gate.minPooledTopQuartileUplift)reasons.push('POOLED_UPLIFT_LT_'+gate.minPooledTopQuartileUplift);
  const posS=result.byAsset.filter(x=>x.spearmanBasisForward>0).length;
  const posP=result.byAsset.filter(x=>x.partialSpearmanBasisForwardControllingLag>0).length;
  const posU=result.byAsset.filter(x=>x.topQuartileUpliftRatio>1).length;
  if(posS<gate.minPositiveSpearmanAssets)reasons.push('POSITIVE_SPEARMAN_ASSETS_LT_'+gate.minPositiveSpearmanAssets);
  if(posP<gate.minPositivePartialAssets)reasons.push('POSITIVE_PARTIAL_ASSETS_LT_'+gate.minPositivePartialAssets);
  if(posU<gate.minPositiveUpliftAssets)reasons.push('POSITIVE_UPLIFT_ASSETS_LT_'+gate.minPositiveUpliftAssets);
  if(result.stability.positiveWindows<gate.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+gate.minPositiveWindows);
  return{pass:reasons.length===0,reasons};
}

export function runSpotPerpBasisVolatilityRegimeV1(dataset,{stage='DISCOVERY',config={}}={}){
  const cfg={...SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_CONFIG,...config};
  const start=stage==='HOLDOUT'?cfg.holdoutStart:cfg.discoveryStart;
  const end=stage==='HOLDOUT'?cfg.holdoutEndExclusive:cfg.discoveryEndExclusive;
  const anchors=dailyAnchors(start,end);
  const byAssetObs={},errors=[];
  for(const asset of SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_ASSETS){
    const r=observationsForAsset(asset,dataset?.[asset]||{},anchors,cfg);
    byAssetObs[asset]=r.observations;
    errors.push(...r.errors);
  }
  const byAsset=SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_ASSETS.map(a=>assetMetrics(a,byAssetObs[a]));
  const pooled=pooledMetrics(byAssetObs);
  const stability=stabilityMetrics(byAssetObs,anchors);
  const result={
    ruleset:SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_RULESET,
    researchOnly:true,executionImpact:false,autoPromotion:false,strategyPnlCalculated:false,
    stage,start,end,anchors:anchors.length,
    dataIntegrityFailure:errors.length>0,
    dataIntegrityErrors:errors,
    byAsset,pooled,stability
  };
  const gate=stage==='HOLDOUT'?cfg.holdoutGate:cfg.discoveryGate;
  const verdict=evaluateGate(result,gate,cfg);
  const passDecision=stage==='HOLDOUT'?'FEATURE_HOLDOUT_PASS_STRATEGY_PREREGISTRATION_ONLY':'FEATURE_DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED';
  const failDecision=stage==='HOLDOUT'?'FEATURE_HOLDOUT_FAIL_RESEARCH_REDESIGN':'FEATURE_DISCOVERY_FAIL_RESEARCH_REDESIGN';
  result.gate={...verdict,decision:verdict.pass?passDecision:failDecision};
  result.decision=result.gate.decision;
  return result;
}
