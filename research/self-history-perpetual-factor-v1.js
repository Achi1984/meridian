export const SELF_HISTORY_PERPETUAL_FACTOR_V1_RULESET='SELF-HISTORY-PERPETUAL-FACTOR-V1-FROZEN';

export const SELF_HISTORY_PERPETUAL_ASSETS=Object.freeze([
  'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LINK','DOT','LTC','BCH','AVAX','HBAR','SUI'
]);

export const SELF_HISTORY_PERPETUAL_FACTORS=Object.freeze([
  'MOM7_SKIP4H','REV4H','FUND_CROWD','PREMIUM_MR'
]);

const UTC=(y,m,d=1)=>Date.UTC(y,m-1,d);
export const SELF_HISTORY_PERPETUAL_ELIGIBILITY=Object.freeze({
  BTC:UTC(2023,1),ETH:UTC(2023,1),BNB:UTC(2023,1),SOL:UTC(2023,1),
  XRP:UTC(2023,1),ADA:UTC(2023,1),DOGE:UTC(2023,1),LINK:UTC(2023,1),
  DOT:UTC(2023,1),LTC:UTC(2023,1),BCH:UTC(2023,1),AVAX:UTC(2023,1),
  HBAR:UTC(2023,3),SUI:UTC(2025,5)
});

export const SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG=Object.freeze({
  barMs:4*60*60*1000,
  weekMs:7*24*60*60*1000,
  ownHistoryWeeks:52,
  zLong:1,
  zShort:-1,
  minSideAssets:2,
  selfLongGross:.5,
  selfShortGross:.5,
  crossFraction:.30,
  baseCostBps:8,
  stressCostBps:32,
  maxFundingGapMs:12*60*60*1000,
  discoveryGate:Object.freeze({
    minPeriods:100,minSharpe:.75,minProfitFactor:1.15,maxDrawdownPct:25,
    minPositiveWindows:4,minPositiveFactorBooks:3,maxPositiveFactorConcentrationPct:60,
    minPositiveAnchors:5
  }),
  holdoutGate:Object.freeze({
    minPeriods:26,minSharpe:0,minProfitFactor:1.05,maxDrawdownPct:25,
    minPositiveFactorBooks:2,minPositiveAnchors:4
  })
});

const finite=x=>Number.isFinite(Number(x));
const num=x=>Number(x);
const sum=a=>a.reduce((s,x)=>s+x,0);
const mean=a=>a.length?sum(a)/a.length:0;
const WEEKDAYS=Object.freeze(['MON','TUE','WED','THU','FRI','SAT','SUN']);

function sampleSd(a){
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
  const w=sum(rs.filter(x=>x>0)),l=Math.abs(sum(rs.filter(x=>x<0)));
  return l>0?w/l:(w>0?99:0);
}
function sharpeWeekly(rs){
  const sd=sampleSd(rs);
  return rs.length>1&&sd>0?mean(rs)/sd*Math.sqrt(52):0;
}
function drawdownPct(rs){
  let eq=1,peak=1,dd=0;
  for(const r of rs){
    eq*=1+r;peak=Math.max(peak,eq);
    if(peak>0)dd=Math.max(dd,(peak-eq)/peak*100);
  }
  return dd;
}
function chronologicalWindows(periods,parts=5){
  const windows=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts);
    const rs=periods.slice(a,b).map(x=>x.netReturn);
    windows.push({index:i+1,periods:rs.length,returnPct:compound(rs)*100});
  }
  return{windows,positiveWindows:windows.filter(x=>x.returnPct>0).length};
}
function zscore(v,h){
  if(!finite(v)||h.length<2||h.some(x=>!finite(x)))return null;
  const sd=sampleSd(h);
  return sd>0?(v-mean(h))/sd:null;
}
function normalizePriceBars(rows,barMs,{allowNegative=false}={}){
  const out=(rows||[]).map(x=>({
    openTime:num(x?.openTime??x?.t??(Array.isArray(x)?x[0]:NaN)),
    open:num(x?.open??x?.o??(Array.isArray(x)?x[1]:NaN)),
    high:num(x?.high??x?.h??(Array.isArray(x)?x[2]:NaN)),
    low:num(x?.low??x?.l??(Array.isArray(x)?x[3]:NaN)),
    close:num(x?.close??x?.c??(Array.isArray(x)?x[4]:NaN))
  })).filter(x=>[x.openTime,x.open,x.high,x.low,x.close].every(finite)).sort((a,b)=>a.openTime-b.openTime);
  if(!out.length)throw new Error('NO_BARS');
  const seen=new Set();
  for(let i=0;i<out.length;i++){
    const b=out[i];
    if(seen.has(b.openTime))throw new Error('DUPLICATE_BAR_TIMESTAMP');
    seen.add(b.openTime);
    if(!allowNegative&&!(b.open>0&&b.high>0&&b.low>0&&b.close>0))throw new Error('NON_POSITIVE_OHLC');
    if(i&&b.openTime-out[i-1].openTime!==barMs)throw new Error('BAR_GAP');
  }
  return out;
}
function normalizePremium(rows,barMs){
  const out=(rows||[]).map(x=>({
    openTime:num(x?.openTime??x?.t??(Array.isArray(x)?x[0]:NaN)),
    close:num(x?.close??x?.c??(Array.isArray(x)?x[4]:NaN))
  })).filter(x=>finite(x.openTime)&&finite(x.close)).sort((a,b)=>a.openTime-b.openTime);
  if(!out.length)throw new Error('NO_PREMIUM');
  const seen=new Set();
  for(let i=0;i<out.length;i++){
    if(seen.has(out[i].openTime))throw new Error('DUPLICATE_PREMIUM_TIMESTAMP');
    seen.add(out[i].openTime);
    if(i&&out[i].openTime-out[i-1].openTime!==barMs)throw new Error('PREMIUM_GAP');
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
    if(seen.has(out[i].time))throw new Error('DUPLICATE_FUNDING_TIMESTAMP');
    seen.add(out[i].time);
    if(i&&out[i].time-out[i-1].time>maxGapMs)throw new Error('FUNDING_GAP');
  }
  return out;
}
function indexAsset(raw,cfg){
  const bars=normalizePriceBars(raw?.bars,cfg.barMs);
  const premium=normalizePremium(raw?.premium,cfg.barMs);
  const funding=normalizeFunding(raw?.funding,cfg.maxFundingGapMs);
  return{
    bars,premium,funding,
    barsByOpen:new Map(bars.map(x=>[x.openTime,x])),
    premiumByOpen:new Map(premium.map(x=>[x.openTime,x]))
  };
}
function completedCloses(asset,anchor,count,cfg){
  const out=[];
  for(let k=count;k>=1;k--){
    const b=asset.barsByOpen.get(anchor-k*cfg.barMs);
    if(!b)return null;
    out.push(b.close);
  }
  return out;
}
function rawFactors(asset,anchor,cfg){
  const c44=completedCloses(asset,anchor,44,cfg);
  const c7=completedCloses(asset,anchor,7,cfg);
  const p6=[];
  for(let k=6;k>=1;k--){
    const p=asset.premiumByOpen.get(anchor-k*cfg.barMs);
    if(!p)return null;
    p6.push(p.close);
  }
  if(!c44||!c7)return null;

  const momCloses=c44.slice(0,43);
  const momReturns=[];
  for(let i=1;i<momCloses.length;i++)momReturns.push(Math.log(momCloses[i]/momCloses[i-1]));
  const momSd=sampleSd(momReturns);
  const mom=momSd>0?Math.log(c44[42]/c44[0])/momSd:null;

  const revReturns=[];
  for(let i=1;i<c7.length;i++)revReturns.push(Math.log(c7[i]/c7[i-1]));
  const revSd=sampleSd(revReturns);
  const rev=revSd>0?-Math.log(c7[6]/c7[5])/revSd:null;

  const from=anchor-cfg.weekMs;
  const fundRows=asset.funding.filter(x=>x.time>=from&&x.time<anchor);
  const fund=fundRows.length?-sum(fundRows.map(x=>x.rate)):null;
  const prem=p6.length===6?-mean(p6):null;

  return{MOM7_SKIP4H:mom,REV4H:rev,FUND_CROWD:fund,PREMIUM_MR:prem};
}
function firstAnchor(start,weekday){
  const d=new Date(start);
  const mondayIndex=(d.getUTCDay()+6)%7;
  const delta=(weekday-mondayIndex+7)%7;
  return start+delta*24*60*60*1000;
}
function periodAnchors(start,endInclusive,weekday,cfg){
  const out=[];
  for(let t=firstAnchor(start,weekday);t+cfg.weekMs<=endInclusive;t+=cfg.weekMs)out.push(t);
  if(out.length)out.push(out.at(-1)+cfg.weekMs);
  return out;
}
function buildFeatures(indexed,assets,start,endInclusive,weekday,cfg){
  const anchors=periodAnchors(start,endInclusive,weekday,cfg);
  if(anchors.length<2)return[];
  const historyStart=anchors[0]-cfg.ownHistoryWeeks*cfg.weekMs;
  const all=[];
  for(let t=historyStart;t<=anchors.at(-1);t+=cfg.weekMs)all.push(t);
  const hist=Object.fromEntries(assets.map(a=>[a,Object.fromEntries(SELF_HISTORY_PERPETUAL_FACTORS.map(f=>[f,[]]))]));
  const map=new Map();

  for(const anchor of all){
    const feature={anchor,assets:{}};
    for(const asset of assets){
      const raw=indexed[asset]?rawFactors(indexed[asset],anchor,cfg):null;
      const objectivelyEligible=anchor>=SELF_HISTORY_PERPETUAL_ELIGIBILITY[asset];
      const frow={};
      for(const factor of SELF_HISTORY_PERPETUAL_FACTORS){
        const v=raw?.[factor]??null;
        const prior=hist[asset][factor].slice(-cfg.ownHistoryWeeks);
        const z=prior.length===cfg.ownHistoryWeeks?zscore(v,prior):null;
        const eligible=objectivelyEligible&&finite(v)&&finite(z);
        frow[factor]={raw:v,z,eligible};
        if(finite(v))hist[asset][factor].push(v);
      }
      feature.assets[asset]=frow;
    }
    if(anchor>=anchors[0])map.set(anchor,feature);
  }
  return anchors.map(x=>map.get(x)).filter(Boolean);
}
function selfWeights(feature,factor,cfg){
  const longs=[],shorts=[];
  for(const [asset,row] of Object.entries(feature.assets)){
    const x=row[factor];
    if(!x?.eligible)continue;
    if(x.z>=cfg.zLong)longs.push(asset);
    else if(x.z<=cfg.zShort)shorts.push(asset);
  }
  if(longs.length<cfg.minSideAssets||shorts.length<cfg.minSideAssets)return new Map();
  const w=new Map();
  for(const a of longs)w.set(a,cfg.selfLongGross/longs.length);
  for(const a of shorts)w.set(a,-cfg.selfShortGross/shorts.length);
  return w;
}
function crossWeights(feature,factor,cfg){
  const rows=[];
  for(const [asset,row] of Object.entries(feature.assets)){
    const x=row[factor];
    if(x?.eligible)rows.push({asset,raw:x.raw});
  }
  if(rows.length<cfg.minSideAssets*2)return new Map();
  rows.sort((a,b)=>a.raw-b.raw||a.asset.localeCompare(b.asset));
  const k=Math.max(cfg.minSideAssets,Math.floor(rows.length*cfg.crossFraction));
  if(k*2>rows.length)return new Map();
  const w=new Map();
  for(const x of rows.slice(0,k))w.set(x.asset,-cfg.selfShortGross/k);
  for(const x of rows.slice(-k))w.set(x.asset,cfg.selfLongGross/k);
  return w;
}
function entryOpen(asset,anchor){
  const b=asset.barsByOpen.get(anchor);
  return b?.open>0?b.open:null;
}
function fundingSum(asset,start,end){
  let s=0,n=0;
  for(const x of asset.funding){
    if(x.time<=start)continue;
    if(x.time>end)break;
    s+=x.rate;n++;
  }
  return{sum:s,count:n};
}
function summarizePeriods(periods){
  const rs=periods.map(x=>x.netReturn),price=periods.map(x=>x.priceOnlyReturn);
  const w=chronologicalWindows(periods);
  return{
    periods:periods.length,
    activeWeeks:periods.filter(x=>x.active).length,
    totalReturnPct:compound(rs)*100,
    priceOnlyReturnPct:compound(price)*100,
    profitFactor:profitFactor(rs),
    sharpe:sharpeWeekly(rs),
    maxDrawdownPct:drawdownPct(rs),
    positiveWindows:w.positiveWindows,
    windows:w.windows,
    fundingContributionPct:sum(periods.map(x=>x.fundingReturn))*100,
    priceContributionPct:sum(periods.map(x=>x.priceReturn))*100,
    costContributionPct:sum(periods.map(x=>x.costReturn))*100,
    turnover:sum(periods.map(x=>x.turnover))
  };
}
function simulateBook(features,indexed,assets,factor,mode,cfg,costBps){
  const weightFn=mode==='SELF'?selfWeights:crossWeights;
  let prev=new Map(),dataFailure=false;
  const periods=[];

  for(let i=0;i<features.length-1;i++){
    const f=features[i],next=features[i+1].anchor;
    const weights=weightFn(f,factor,cfg);
    let turnover=0,cost=0,pr=0,fr=0,valid=true;
    for(const asset of assets){
      const old=prev.get(asset)||0,nw=weights.get(asset)||0;
      const delta=Math.abs(nw-old);
      turnover+=delta;cost+=delta*costBps/10000;
      if(nw===0)continue;
      const p0=entryOpen(indexed[asset],f.anchor),p1=entryOpen(indexed[asset],next);
      if(!(p0>0&&p1>0)){valid=false;break}
      const funding=fundingSum(indexed[asset],f.anchor,next);
      if(!funding.count){valid=false;break}
      pr+=nw*(p1/p0-1);
      fr+=-nw*funding.sum;
    }
    if(!valid){dataFailure=true;break}
    periods.push({
      anchor:f.anchor,next,active:weights.size>0,
      netReturn:pr+fr-cost,priceOnlyReturn:pr-cost,
      priceReturn:pr,fundingReturn:fr,costReturn:cost,turnover
    });
    prev=weights;
  }

  if(!dataFailure&&periods.length&&prev.size){
    const closeTurnover=sum([...prev.values()].map(Math.abs));
    const closeCost=closeTurnover*costBps/10000;
    const last=periods.at(-1);
    last.netReturn-=closeCost;last.priceOnlyReturn-=closeCost;
    last.costReturn+=closeCost;last.turnover+=closeTurnover;
  }
  return{factor,mode,dataFailure,periods,summary:summarizePeriods(periods)};
}
function simulatePortfolio(features,indexed,assets,mode,cfg,costBps){
  const books=Object.fromEntries(SELF_HISTORY_PERPETUAL_FACTORS.map(f=>[f,simulateBook(features,indexed,assets,f,mode,cfg,costBps)]));
  const dataFailure=Object.values(books).some(x=>x.dataFailure);
  const count=Math.min(...Object.values(books).map(x=>x.periods.length));
  const periods=[];
  if(!dataFailure){
    for(let i=0;i<count;i++){
      const rows=SELF_HISTORY_PERPETUAL_FACTORS.map(f=>books[f].periods[i]);
      periods.push({
        anchor:rows[0].anchor,next:rows[0].next,
        active:rows.some(x=>x.active),
        netReturn:mean(rows.map(x=>x.netReturn)),
        priceOnlyReturn:mean(rows.map(x=>x.priceOnlyReturn)),
        priceReturn:mean(rows.map(x=>x.priceReturn)),
        fundingReturn:mean(rows.map(x=>x.fundingReturn)),
        costReturn:mean(rows.map(x=>x.costReturn)),
        turnover:mean(rows.map(x=>x.turnover))
      });
    }
  }
  const summary=summarizePeriods(periods);
  const factorReturns=Object.fromEntries(SELF_HISTORY_PERPETUAL_FACTORS.map(f=>[f,books[f].summary.totalReturnPct]));
  const positives=Object.values(factorReturns).filter(x=>x>0);
  const posTotal=sum(positives);
  const concentration=posTotal>0?Math.max(...positives)/posTotal*100:0;
  return{
    mode,dataFailure,periods,summary,books,factorReturns,
    positiveFactorBooks:positives.length,
    positiveFactorConcentrationPct:concentration
  };
}
function evaluate(primary,benchmark,stress,anchorReturns,phase,cfg){
  const g=phase==='DISCOVERY'?cfg.discoveryGate:cfg.holdoutGate;
  const reasons=[];
  if(primary.summary.periods<g.minPeriods)reasons.push('PERIODS_LT_'+g.minPeriods);
  if(!(primary.summary.totalReturnPct>0))reasons.push('RETURN_NOT_POSITIVE');
  if(!(primary.summary.sharpe>g.minSharpe))reasons.push('SHARPE_NOT_ABOVE_'+g.minSharpe);
  if(!(primary.summary.profitFactor>=g.minProfitFactor))reasons.push('PF_LT_'+g.minProfitFactor);
  if(!(primary.summary.maxDrawdownPct<=g.maxDrawdownPct))reasons.push('DD_GT_'+g.maxDrawdownPct+'PCT');
  if(phase==='DISCOVERY'&&primary.summary.positiveWindows<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);
  if(!(stress.summary.totalReturnPct>0))reasons.push('STRESS_RETURN_NOT_POSITIVE');
  if(!(primary.summary.priceOnlyReturnPct>0))reasons.push('PRICE_ONLY_RETURN_NOT_POSITIVE');
  if(primary.positiveFactorBooks<g.minPositiveFactorBooks)reasons.push('POSITIVE_FACTOR_BOOKS_LT_'+g.minPositiveFactorBooks);
  if(phase==='DISCOVERY'&&primary.positiveFactorConcentrationPct>g.maxPositiveFactorConcentrationPct)reasons.push('FACTOR_CONCENTRATION_GT_'+g.maxPositiveFactorConcentrationPct+'PCT');
  if(!(primary.summary.totalReturnPct>benchmark.summary.totalReturnPct))reasons.push('RETURN_NOT_ABOVE_CROSS_SECTIONAL');
  if(!(primary.summary.sharpe>benchmark.summary.sharpe))reasons.push('SHARPE_NOT_ABOVE_CROSS_SECTIONAL');
  const positiveAnchors=anchorReturns.filter(x=>x.returnPct>0).length;
  if(positiveAnchors<g.minPositiveAnchors)reasons.push('POSITIVE_ANCHORS_LT_'+g.minPositiveAnchors);
  if(primary.dataFailure||benchmark.dataFailure||stress.dataFailure||anchorReturns.some(x=>x.dataFailure))reasons.push('DATA_GATE_FAILURE');
  return{pass:reasons.length===0,reasons,positiveAnchors};
}
export function runSelfHistoryPerpetualFactorV1(dataset,{
  start,
  endInclusive,
  phase='DISCOVERY',
  config={}
}={}){
  const cfg={...SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG,...config};
  if(!finite(start)||!finite(endInclusive)||endInclusive<=start)throw new Error('invalid window');
  const indexed={},dataErrors=[];
  for(const asset of SELF_HISTORY_PERPETUAL_ASSETS){
    try{indexed[asset]=indexAsset(dataset?.[asset],cfg)}
    catch(e){dataErrors.push(asset+':'+String(e?.message||e))}
  }
  if(dataErrors.length){
    return{
      ruleset:SELF_HISTORY_PERPETUAL_FACTOR_V1_RULESET,exactReplication:false,
      researchOnly:true,executionImpact:false,autoPromotion:false,phase,dataErrors,
      gate:{pass:false,reasons:['DATA_GATE_FAILURE']},
      decision:phase==='DISCOVERY'?'DISCOVERY_FAIL_RESEARCH_REDESIGN':'HOLDOUT_FAIL_RESEARCH_REDESIGN'
    };
  }

  const anchorRuns=[];
  let monday=null;
  for(let weekday=0;weekday<7;weekday++){
    const features=buildFeatures(indexed,SELF_HISTORY_PERPETUAL_ASSETS,start,endInclusive,weekday,cfg);
    const self=simulatePortfolio(features,indexed,SELF_HISTORY_PERPETUAL_ASSETS,'SELF',cfg,cfg.baseCostBps);
    anchorRuns.push({
      weekday:WEEKDAYS[weekday],weekdayIndex:weekday,
      returnPct:self.summary.totalReturnPct,sharpe:self.summary.sharpe,
      periods:self.summary.periods,dataFailure:self.dataFailure
    });
    if(weekday===0){
      const benchmark=simulatePortfolio(features,indexed,SELF_HISTORY_PERPETUAL_ASSETS,'CROSS',cfg,cfg.baseCostBps);
      const stress=simulatePortfolio(features,indexed,SELF_HISTORY_PERPETUAL_ASSETS,'SELF',cfg,cfg.stressCostBps);
      monday={features,self,benchmark,stress};
    }
  }

  const gate=evaluate(monday.self,monday.benchmark,monday.stress,anchorRuns,phase,cfg);
  const decision=phase==='DISCOVERY'
    ?(gate.pass?'DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED':'DISCOVERY_FAIL_RESEARCH_REDESIGN')
    :(gate.pass?'HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY':'HOLDOUT_FAIL_RESEARCH_REDESIGN');

  return{
    ruleset:SELF_HISTORY_PERPETUAL_FACTOR_V1_RULESET,exactReplication:false,
    researchOnly:true,executionImpact:false,autoPromotion:false,phase,
    assets:[...SELF_HISTORY_PERPETUAL_ASSETS],
    eligibility:{...SELF_HISTORY_PERPETUAL_ELIGIBILITY},
    primaryWeekday:'MON',
    primary:monday.self,
    crossSectionalBenchmark:monday.benchmark,
    costStress:monday.stress,
    anchorRuns,
    gate,decision
  };
}

export const _test=Object.freeze({
  sampleSd,zscore,rawFactors,selfWeights,crossWeights,indexAsset,buildFeatures,
  simulateBook,simulatePortfolio,periodAnchors
});
