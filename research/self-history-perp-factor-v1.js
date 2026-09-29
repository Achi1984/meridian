export const SELF_HISTORY_PERP_FACTOR_V1_RULESET='SELF-HISTORY-PERP-FACTOR-V1-FROZEN';

export const SELF_HISTORY_DISCOVERY_ASSETS=Object.freeze([
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT',
  'DOGEUSDT','LINKUSDT','AVAXUSDT','DOTUSDT','LTCUSDT','BCHUSDT'
]);

export const SELF_HISTORY_TRANSFER_ASSETS=Object.freeze([
  'TRXUSDT','ETCUSDT','XLMUSDT','ATOMUSDT','UNIUSDT','AAVEUSDT','FILUSDT','NEARUSDT'
]);

export const SELF_HISTORY_PERP_FACTOR_V1_CONFIG=Object.freeze({
  barMs:8*60*60*1000,
  weekMs:7*24*60*60*1000,
  momentumWeeks:12,
  ownHistoryWeeks:52,
  longPercentile:0.80,
  shortPercentile:0.20,
  minLongs:2,
  minShorts:2,
  minEligibleAssets:8,
  grossExposure:1.0,
  longGross:0.50,
  shortGross:0.50,
  baseCostBps:8,
  stressCostBps:32,
  maxFundingGapMs:12*60*60*1000,
  discoveryGate:Object.freeze({
    minPeriods:120,
    minActiveWeeks:80,
    minProfitFactor:1.15,
    minSharpe:0.75,
    maxDrawdownPct:20,
    minPositiveWindows:4,
    minPositiveAssets:7,
    maxPositivePnlConcentrationPct:35
  }),
  temporalGate:Object.freeze({
    minPeriods:75,
    minActiveWeeks:45,
    minProfitFactor:1.05,
    minSharpe:0.50,
    maxDrawdownPct:20,
    minPositiveWindows:3,
    minPositiveAssets:6,
    maxPositivePnlConcentrationPct:50
  }),
  transferGate:Object.freeze({
    minPeriods:120,
    minActiveWeeks:70,
    minProfitFactor:1.05,
    minSharpe:0.50,
    maxDrawdownPct:25,
    minPositiveWindows:3,
    minPositiveAssets:4,
    maxPositivePnlConcentrationPct:50
  })
});

const finite=x=>Number.isFinite(Number(x));
const num=x=>Number(x);
const sum=a=>a.reduce((s,x)=>s+x,0);
const mean=a=>a.length?sum(a)/a.length:0;
const round=(x,d=10)=>finite(x)?Number(num(x).toFixed(d)):null;

function stdev(a){
  if(a.length<2)return 0;
  const m=mean(a);
  return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));
}
function compound(rs){
  let e=1;
  for(const r of rs)e*=1+r;
  return e-1;
}
function profitFactor(rs){
  const wins=sum(rs.filter(x=>x>0));
  const losses=Math.abs(sum(rs.filter(x=>x<0)));
  return losses>0?wins/losses:(wins>0?99:0);
}
function sharpeWeekly(rs){
  if(rs.length<2)return 0;
  const sd=stdev(rs);
  return sd>0?mean(rs)/sd*Math.sqrt(52):0;
}
function maxDrawdownPct(rs){
  let eq=1,peak=1,dd=0;
  for(const r of rs){
    eq*=1+r;
    peak=Math.max(peak,eq);
    if(peak>0)dd=Math.max(dd,(peak-eq)/peak*100);
  }
  return dd;
}
function chronologicalWindows(periods,parts=5){
  const windows=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts);
    const b=Math.floor(periods.length*(i+1)/parts);
    const rs=periods.slice(a,b).map(x=>x.netReturn);
    windows.push({index:i+1,periods:rs.length,returnPct:compound(rs)*100});
  }
  return{windows,positiveWindows:windows.filter(x=>x.returnPct>0).length};
}
function mondayAnchors(start,endExclusive,weekMs){
  const out=[];
  for(let t=start;t<=endExclusive;t+=weekMs)out.push(t);
  return out;
}
function normalizeBars(rows,barMs){
  const out=(rows||[]).map(x=>({
    openTime:num(x?.openTime??x?.t??(Array.isArray(x)?x[0]:NaN)),
    closeTime:num(x?.closeTime??x?.T??(Array.isArray(x)?x[6]:NaN)),
    open:num(x?.open??x?.o??(Array.isArray(x)?x[1]:NaN)),
    high:num(x?.high??x?.h??(Array.isArray(x)?x[2]:NaN)),
    low:num(x?.low??x?.l??(Array.isArray(x)?x[3]:NaN)),
    close:num(x?.close??x?.c??(Array.isArray(x)?x[4]:NaN))
  })).filter(x=>[x.openTime,x.open,x.high,x.low,x.close].every(finite))
    .sort((a,b)=>a.openTime-b.openTime);
  if(!out.length)throw new Error('NO_BARS');
  const seen=new Set();
  for(let i=0;i<out.length;i++){
    const b=out[i];
    if(seen.has(b.openTime))throw new Error('DUPLICATE_BAR_TIMESTAMP');
    seen.add(b.openTime);
    if(!(b.open>0&&b.high>0&&b.low>0&&b.close>0))throw new Error('NON_POSITIVE_OHLC');
    if(b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))throw new Error('INVALID_OHLC');
    if(i&&b.openTime-out[i-1].openTime!==barMs)throw new Error('BAR_GAP');
  }
  return out;
}
function normalizeFunding(rows,maxGapMs){
  const out=(rows||[]).map(x=>({
    time:num(x?.fundingTime??x?.time??x?.ts),
    rate:num(x?.fundingRate??x?.rate)
  })).filter(x=>finite(x.time)&&finite(x.rate)).sort((a,b)=>a.time-b.time);
  if(!out.length)throw new Error('NO_FUNDING');
  const seen=new Set();
  for(let i=0;i<out.length;i++){
    const x=out[i];
    if(seen.has(x.time))throw new Error('DUPLICATE_FUNDING_TIMESTAMP');
    seen.add(x.time);
    if(i&&x.time-out[i-1].time>maxGapMs)throw new Error('FUNDING_GAP');
  }
  return out;
}
function indexAsset(raw,cfg){
  const bars=normalizeBars(raw?.bars,cfg.barMs);
  const funding=normalizeFunding(raw?.funding,cfg.maxFundingGapMs);
  return{
    bars,
    funding,
    byOpen:new Map(bars.map(x=>[x.openTime,x]))
  };
}
function percentileAgainstHistory(value,history){
  if(!finite(value)||!history.length||history.some(x=>!finite(x)))return null;
  const le=history.filter(x=>x<=value).length;
  return le/history.length;
}
function factorAt(asset,anchor,cfg){
  const last=asset.byOpen.get(anchor-cfg.barMs);
  const prior=asset.byOpen.get(anchor-cfg.momentumWeeks*cfg.weekMs-cfg.barMs);
  if(!last||!prior||!(last.close>0&&prior.close>0))return null;
  return last.close/prior.close-1;
}
function entryPrice(asset,anchor){
  const b=asset.byOpen.get(anchor);
  return b?.open>0?b.open:null;
}
function fundingSum(asset,startExclusive,endInclusive){
  let s=0,count=0,first=null,last=null;
  for(const x of asset.funding){
    if(x.time<=startExclusive)continue;
    if(x.time>endInclusive)break;
    s+=x.rate;count++;
    if(first==null)first=x.time;
    last=x.time;
  }
  return{sum:s,count,first,last};
}
function equalSideWeights(longs,shorts,cfg){
  const w=new Map();
  if(longs.length<cfg.minLongs||shorts.length<cfg.minShorts)return w;
  for(const a of longs)w.set(a,cfg.longGross/longs.length);
  for(const a of shorts)w.set(a,-cfg.shortGross/shorts.length);
  return w;
}
function ownHistoryWeights(feature,cfg){
  const longs=[],shorts=[];
  for(const [asset,x] of Object.entries(feature.assets)){
    if(!x.eligible)continue;
    if(x.percentile>=cfg.longPercentile)longs.push(asset);
    else if(x.percentile<=cfg.shortPercentile)shorts.push(asset);
  }
  return equalSideWeights(longs,shorts,cfg);
}
function crossSectionWeights(feature,cfg){
  const rows=Object.entries(feature.assets).filter(([,x])=>x.eligible).map(([asset,x])=>({asset,momentum:x.momentum}));
  if(rows.length<cfg.minEligibleAssets)return new Map();
  rows.sort((a,b)=>a.momentum-b.momentum||a.asset.localeCompare(b.asset));
  const k=Math.max(2,Math.floor(rows.length/4));
  const shorts=rows.slice(0,k).map(x=>x.asset);
  const longs=rows.slice(-k).map(x=>x.asset);
  return equalSideWeights(longs,shorts,cfg);
}
function weightsObject(w,assets){
  return Object.fromEntries(assets.map(a=>[a,w.get(a)||0]));
}
function buildFeatures(indexed,assets,start,endExclusive,cfg){
  const anchors=mondayAnchors(start,endExclusive,cfg.weekMs);
  const allAnchors=[];
  const warmStart=start-(cfg.ownHistoryWeeks+cfg.momentumWeeks+2)*cfg.weekMs;
  for(let t=warmStart;t<=endExclusive;t+=cfg.weekMs)allAnchors.push(t);
  const rawHistory=Object.fromEntries(assets.map(a=>[a,[]]));
  const featureMap=new Map();
  for(const anchor of allAnchors){
    const fa={anchor,assets:{}};
    for(const asset of assets){
      const idx=indexed[asset];
      const momentum=idx?factorAt(idx,anchor,cfg):null;
      const prior=rawHistory[asset].slice(-cfg.ownHistoryWeeks);
      const eligible=finite(momentum)&&prior.length===cfg.ownHistoryWeeks&&prior.every(finite);
      const percentile=eligible?percentileAgainstHistory(momentum,prior):null;
      fa.assets[asset]={momentum,percentile,eligible};
      if(finite(momentum))rawHistory[asset].push(momentum);
    }
    if(anchor>=start)featureMap.set(anchor,fa);
  }
  return anchors.map(anchor=>featureMap.get(anchor)).filter(Boolean);
}
function emptyAttribution(assets){return Object.fromEntries(assets.map(a=>[a,0]));}

function simulate(features,indexed,assets,weightFn,cfg,costBps){
  let prevWeights=new Map();
  const periods=[],attribution=emptyAttribution(assets);
  let totalFunding=0,totalPrice=0,totalCosts=0,totalTurnover=0,longGrossContribution=0,shortGrossContribution=0;
  let activeWeeks=0,flatWeeks=0,rejectedWeeks=0,dataIntegrityFailure=false;

  const closePreviousAtCurrentAnchor=()=>{
    if(!prevWeights.size||!periods.length){prevWeights=new Map();return}
    const closeTurnover=sum([...prevWeights.values()].map(Math.abs));
    const closeCost=closeTurnover*costBps/10000;
    const last=periods.at(-1);
    last.netReturn-=closeCost;
    last.priceOnlyReturn-=closeCost;
    last.costReturn+=closeCost;
    last.turnover+=closeTurnover;
    totalCosts+=closeCost;totalTurnover+=closeTurnover;
    for(const [asset,w] of prevWeights)attribution[asset]-=Math.abs(w)*costBps/10000;
    prevWeights=new Map();
  };

  for(let pi=0;pi<features.length-1;pi++){
    const feature=features[pi],anchor=feature.anchor,next=features[pi+1].anchor;
    const eligible=Object.values(feature.assets).filter(x=>x.eligible).length;
    if(eligible<cfg.minEligibleAssets){
      rejectedWeeks++;
      closePreviousAtCurrentAnchor();
      continue;
    }
    const weights=weightFn(feature,cfg);
    const active=weights.size>0;
    if(active)activeWeeks++;else flatWeeks++;

    let turnover=0,cost=0,priceRet=0,fundingRet=0,longGross=0,shortGross=0,valid=true;
    for(const asset of assets){
      const oldW=prevWeights.get(asset)||0,newW=weights.get(asset)||0;
      const delta=Math.abs(newW-oldW);
      turnover+=delta;
      const assetCost=delta*costBps/10000;
      cost+=assetCost;
      attribution[asset]-=assetCost;
      if(newW===0)continue;
      const idx=indexed[asset],p0=entryPrice(idx,anchor),p1=entryPrice(idx,next);
      if(!(p0>0&&p1>0)){valid=false;break}
      const f=fundingSum(idx,anchor,next);
      if(!f.count||f.first==null||f.last==null){valid=false;break}
      const pr=newW*(p1/p0-1);
      const fr=-newW*f.sum;
      const gross=pr+fr;
      priceRet+=pr;fundingRet+=fr;
      attribution[asset]+=gross;
      if(newW>0)longGross+=gross;else shortGross+=gross;
    }
    if(!valid){
      dataIntegrityFailure=true;rejectedWeeks++;closePreviousAtCurrentAnchor();continue;
    }
    const net=priceRet+fundingRet-cost;
    periods.push({
      anchor,next,active,eligible,
      netReturn:net,priceOnlyReturn:priceRet-cost,
      priceReturn:priceRet,fundingReturn:fundingRet,costReturn:cost,turnover,
      longGrossContribution:longGross,shortGrossContribution:shortGross,
      weights:weightsObject(weights,assets)
    });
    totalPrice+=priceRet;totalFunding+=fundingRet;totalCosts+=cost;totalTurnover+=turnover;
    longGrossContribution+=longGross;shortGrossContribution+=shortGross;
    prevWeights=weights;
  }

  if(periods.length&&prevWeights.size){
    const closeTurnover=sum([...prevWeights.values()].map(Math.abs));
    const closeCost=closeTurnover*costBps/10000;
    const last=periods.at(-1);
    last.netReturn-=closeCost;
    last.priceOnlyReturn-=closeCost;
    last.costReturn+=closeCost;
    last.turnover+=closeTurnover;
    totalCosts+=closeCost;totalTurnover+=closeTurnover;
    for(const [asset,w] of prevWeights)attribution[asset]-=Math.abs(w)*costBps/10000;
  }

  const netRs=periods.map(x=>x.netReturn),priceOnlyRs=periods.map(x=>x.priceOnlyReturn);
  const stability=chronologicalWindows(periods);
  const positives=Object.entries(attribution).filter(([,v])=>v>0);
  const positiveTotal=sum(positives.map(([,v])=>v));
  const concentration=positiveTotal>0?Math.max(...positives.map(([,v])=>v/positiveTotal*100)):0;
  return{
    periods,completedPeriods:periods.length,activeWeeks,flatWeeks,rejectedWeeks,dataIntegrityFailure,
    totalReturnPct:compound(netRs)*100,
    priceOnlyReturnPct:compound(priceOnlyRs)*100,
    profitFactor:profitFactor(netRs),
    sharpe:sharpeWeekly(netRs),
    maxDrawdownPct:maxDrawdownPct(netRs),
    positiveWindows:stability.positiveWindows,
    windows:stability.windows,
    fundingContributionPct:totalFunding*100,
    priceContributionPct:totalPrice*100,
    costContributionPct:totalCosts*100,
    turnover:totalTurnover,
    longGrossContributionPct:longGrossContribution*100,
    shortGrossContributionPct:shortGrossContribution*100,
    attributionPct:Object.fromEntries(Object.entries(attribution).map(([a,v])=>[a,v*100])),
    positiveAssets:positives.length,
    positivePnlConcentrationPct:concentration
  };
}
function chooseGate(phase,cfg){
  if(phase==='DISCOVERY')return cfg.discoveryGate;
  if(phase==='TEMPORAL_HOLDOUT')return cfg.temporalGate;
  if(phase==='TRANSFER_HOLDOUT')return cfg.transferGate;
  throw new Error('unknown phase');
}
function evaluate(summary,benchmark,stress,phase,cfg){
  const g=chooseGate(phase,cfg),reasons=[];
  if(summary.completedPeriods<g.minPeriods)reasons.push('PERIODS_LT_'+g.minPeriods);
  if(summary.activeWeeks<g.minActiveWeeks)reasons.push('ACTIVE_WEEKS_LT_'+g.minActiveWeeks);
  if(!(summary.totalReturnPct>0))reasons.push('RETURN_NOT_POSITIVE');
  if(!(summary.priceOnlyReturnPct>0))reasons.push('PRICE_ONLY_RETURN_NOT_POSITIVE');
  if(!(summary.profitFactor>=g.minProfitFactor))reasons.push('PF_LT_'+g.minProfitFactor);
  if(!(summary.sharpe>=g.minSharpe))reasons.push('SHARPE_LT_'+g.minSharpe);
  if(!(summary.maxDrawdownPct<=g.maxDrawdownPct))reasons.push('DD_GT_'+g.maxDrawdownPct+'PCT');
  if(summary.positiveWindows<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);
  if(!(summary.longGrossContributionPct>0))reasons.push('LONG_CONTRIBUTION_NOT_POSITIVE');
  if(!(summary.shortGrossContributionPct>0))reasons.push('SHORT_CONTRIBUTION_NOT_POSITIVE');
  if(summary.positiveAssets<g.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+g.minPositiveAssets);
  if(summary.positivePnlConcentrationPct>g.maxPositivePnlConcentrationPct)reasons.push('POSITIVE_PNL_CONCENTRATION_GT_'+g.maxPositivePnlConcentrationPct+'PCT');
  if(!(stress.totalReturnPct>0))reasons.push('STRESS_RETURN_NOT_POSITIVE');
  if(!(summary.totalReturnPct>benchmark.totalReturnPct))reasons.push('NOT_ABOVE_CROSS_SECTIONAL_BENCHMARK');
  if(summary.dataIntegrityFailure||benchmark.dataIntegrityFailure||stress.dataIntegrityFailure)reasons.push('DATA_INTEGRITY_FAILURE');
  return{pass:reasons.length===0,reasons};
}

export function runSelfHistoryPerpFactorV1(dataset,{
  assets=SELF_HISTORY_DISCOVERY_ASSETS,
  start,
  endExclusive,
  phase='DISCOVERY',
  config={}
}={}){
  const cfg={...SELF_HISTORY_PERP_FACTOR_V1_CONFIG,...config};
  if(!Number.isFinite(start)||!Number.isFinite(endExclusive)||!(endExclusive>start))throw new Error('invalid window');
  const indexed={};
  const dataErrors=[];
  for(const asset of assets){
    try{indexed[asset]=indexAsset(dataset?.[asset],cfg)}
    catch(e){dataErrors.push(asset+':'+String(e?.message||e))}
  }
  if(dataErrors.length){
    return{
      ruleset:SELF_HISTORY_PERP_FACTOR_V1_RULESET,researchOnly:true,executionImpact:false,autoPromotion:false,
      phase,assets:[...assets],dataErrors,gate:{pass:false,reasons:['DATA_INTEGRITY_FAILURE']},
      decision:phase==='DISCOVERY'?'DISCOVERY_FAIL_RESEARCH_REDESIGN':'HOLDOUT_FAIL_RESEARCH_REDESIGN'
    };
  }
  const features=buildFeatures(indexed,assets,start,endExclusive,cfg);
  const own=simulate(features,indexed,assets,ownHistoryWeights,cfg,cfg.baseCostBps);
  const benchmark=simulate(features,indexed,assets,crossSectionWeights,cfg,cfg.baseCostBps);
  const stress=simulate(features,indexed,assets,ownHistoryWeights,cfg,cfg.stressCostBps);
  const gate=evaluate(own,benchmark,stress,phase,cfg);
  const decision=phase==='DISCOVERY'
    ?(gate.pass?'DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED':'DISCOVERY_FAIL_RESEARCH_REDESIGN')
    :phase==='TEMPORAL_HOLDOUT'
      ?(gate.pass?'TEMPORAL_HOLDOUT_PASS_TRANSFER_HOLDOUT_REQUIRED':'HOLDOUT_FAIL_RESEARCH_REDESIGN')
      :(gate.pass?'TRANSFER_HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY':'HOLDOUT_FAIL_RESEARCH_REDESIGN');
  return{
    ruleset:SELF_HISTORY_PERP_FACTOR_V1_RULESET,
    researchOnly:true,executionImpact:false,autoPromotion:false,
    phase,assets:[...assets],
    config:{
      momentumWeeks:cfg.momentumWeeks,ownHistoryWeeks:cfg.ownHistoryWeeks,
      longPercentile:cfg.longPercentile,shortPercentile:cfg.shortPercentile,
      minEligibleAssets:cfg.minEligibleAssets,baseCostBps:cfg.baseCostBps,stressCostBps:cfg.stressCostBps
    },
    ownHistory:own,crossSectionalBenchmark:benchmark,costStress:stress,
    gate,decision
  };
}

export const _test=Object.freeze({
  percentileAgainstHistory,
  ownHistoryWeights,
  crossSectionWeights,
  indexAsset,
  buildFeatures,
  simulate
});
