import {normalizeDaily} from './documented-edge-v1.js';
import {evaluateProfitCandidate} from './paperbot-profit-special-agent-v1.js';

export const PAPERBOT_PROFIT_AGENT_V2_RULESET='PAPERBOT-PROFIT-SPECIAL-AGENT-V2-FROZEN';
export const UPUP_RM_MOMENTUM_PROXY_V1_CONFIG=Object.freeze({
  stateDays:28,
  formationDays:14,
  skipDays:1,
  rebalanceDays:7,
  topBottomFraction:.25,
  volLookbackWeeks:8,
  targetVolAnnual:.10,
  annualizationWeeks:52,
  maxGrossLeverage:2,
  costBps:8,
  startEquity:10000,
  minAssets:6
});

const finite=v=>Number.isFinite(Number(v));
const n=v=>Number(v);
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const stdev=a=>{
  if(a.length<2)return 0;
  const m=mean(a),v=a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1);
  return Math.sqrt(Math.max(0,v));
};
const pf=rows=>{
  const w=rows.filter(x=>x>0).reduce((a,b)=>a+b,0),l=Math.abs(rows.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return l>0?w/l:(w>0?99:0);
};
function indexSeries(rows){
  const xs=normalizeDaily(rows);
  return{rows:xs,by:new Map(xs.map((r,i)=>[r.openTime,i]))};
}
function summary(returns,startEquity=10000){
  let eq=startEquity,peak=startEquity,maxDD=0;
  for(const r of returns){eq*=1+r;peak=Math.max(peak,eq);if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak*100)}
  return{periods:returns.length,totalReturnPct:(eq/startEquity-1)*100,pnl:eq-startEquity,endEquity:eq,profitFactor:pf(returns),avgReturnPct:mean(returns)*100,maxDrawdownPct:maxDD,positivePeriods:returns.filter(x=>x>0).length};
}
function chrono(periods,parts=5,startEquity=10000){
  if(!periods.length)return{windows:[],positiveWindows:0};
  const windows=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts),slice=periods.slice(a,b),s=summary(slice.map(x=>x.netReturn),startEquity);
    windows.push({i:i+1,from:slice[0]?.at??null,to:slice.at(-1)?.at??null,...s,positive:s.totalReturnPct>0});
  }
  return{windows,positiveWindows:windows.filter(x=>x.positive).length};
}
function assetSummaries(periods,startEquity=10000){
  const by=new Map();
  for(const p of periods)for(const leg of p.legs||[]){
    if(!by.has(leg.symbol))by.set(leg.symbol,[]);
    by.get(leg.symbol).push(n(leg.netReturn)||0);
  }
  return [...by.entries()].map(([symbol,rs])=>({symbol,periods:rs.length,summary:summary(rs,startEquity)})).sort((a,b)=>a.symbol.localeCompare(b.symbol));
}
function concentration(assets){
  const pos=assets.filter(x=>x.summary.pnl>0),tot=pos.reduce((a,x)=>a+x.summary.pnl,0);
  return tot>0?Math.max(...pos.map(x=>x.summary.pnl/tot*100)):0;
}
function closeAt(ser,ts){const i=ser.by.get(ts);return i==null?null:ser.rows[i]?.close??null}
function indexAt(ser,ts){return ser.by.get(ts)}
function universeMarketReturn(series,masterIndex,endOffset,stateDays){
  const end=masterIndex+endOffset,start=end-stateDays;
  if(start<0||end<0)return null;
  const ts0=series.master.rows[start]?.openTime,ts1=series.master.rows[end]?.openTime;
  if(ts0==null||ts1==null)return null;
  const rs=[];
  for(const [symbol,ser] of Object.entries(series.assets)){
    const a=closeAt(ser,ts0),b=closeAt(ser,ts1);
    if(a>0&&b>0)rs.push(b/a-1);
  }
  return rs.length>=6?mean(rs):null;
}
function formationScore(ser,master,masterIndex,cfg){
  const end=masterIndex-cfg.skipDays-1,start=end-cfg.formationDays;
  if(start<0||end<0)return null;
  const a=closeAt(ser,master.rows[start]?.openTime),b=closeAt(ser,master.rows[end]?.openTime);
  return a>0&&b>0?b/a-1:null;
}
function benchmarkReturn(series,master,i,nextI,symbol=null){
  const t0=master.rows[i]?.openTime,t1=master.rows[nextI]?.openTime;
  if(t0==null||t1==null)return null;
  if(symbol){
    const ser=series.assets[symbol],a=ser&&closeAt(ser,t0),b=ser&&closeAt(ser,t1);
    return a>0&&b>0?b/a-1:null;
  }
  const rs=[];
  for(const ser of Object.values(series.assets)){
    const a=closeAt(ser,t0),b=closeAt(ser,t1);
    if(a>0&&b>0)rs.push(b/a-1);
  }
  return rs.length>=6?mean(rs):null;
}
function compound(rs){return summary(rs,10000).totalReturnPct}

export function runUpUpRiskManagedMomentumProxyV1(dataset,config={}){
  const cfg={...UPUP_RM_MOMENTUM_PROXY_V1_CONFIG,...config};
  const assets=Object.fromEntries(Object.entries(dataset||{}).map(([k,v])=>[k,indexSeries(v)]).filter(([,v])=>v.rows.length));
  const master=assets.BTC||Object.values(assets).sort((a,b)=>b.rows.length-a.rows.length)[0];
  if(!master)return{ruleset:PAPERBOT_PROFIT_AGENT_V2_RULESET,strategy:'UPUP_RM_MOMENTUM_PROXY_V1',researchOnly:true,executionImpact:false,autoPromotion:false,config:cfg,periods:[],summary:summary([],cfg.startEquity),stability:{windows:[],positiveWindows:0},assets:[],gate:{pass:false,reasons:['NO_DATA']},benchmarks:{}};
  const series={assets,master},warm=Math.max(cfg.stateDays+cfg.rebalanceDays,cfg.formationDays+cfg.skipDays+2),periods=[],rawHistory=[],prevWeights=new Map(),benchEW=[],benchBTC=[];
  let activeWeeks=0,totalTurnover=0,totalCost=0,longContribution=0,shortContribution=0;

  for(let i=warm;i+cfg.rebalanceDays<master.rows.length;i+=cfg.rebalanceDays){
    const nextI=i+cfg.rebalanceDays,at=master.rows[i].openTime,nextAt=master.rows[nextI].openTime;
    const stateNow=universeMarketReturn(series,i,-1,cfg.stateDays),statePrev=universeMarketReturn(series,i-cfg.rebalanceDays,-1,cfg.stateDays),upup=stateNow!=null&&statePrev!=null&&stateNow>=0&&statePrev>=0;
    const candidates=[];
    for(const [symbol,ser] of Object.entries(assets)){
      const score=formationScore(ser,master,i,cfg),p0=closeAt(ser,at),p1=closeAt(ser,nextAt);
      if(finite(score)&&p0>0&&p1>0)candidates.push({symbol,score,forward:p1/p0-1});
    }
    const ew=benchmarkReturn(series,master,i,nextI),btc=benchmarkReturn(series,master,i,nextI,'BTC');
    if(finite(ew))benchEW.push(ew);if(finite(btc))benchBTC.push(btc);

    let rawWeights=new Map(),rawReturn=0,longs=[],shorts=[];
    if(upup&&candidates.length>=cfg.minAssets){
      candidates.sort((a,b)=>b.score-a.score);
      const k=Math.max(1,Math.floor(candidates.length*cfg.topBottomFraction));
      longs=candidates.slice(0,k);shorts=candidates.slice(-k);
      for(const x of longs)rawWeights.set(x.symbol,.5/k);
      for(const x of shorts)rawWeights.set(x.symbol,-.5/k);
      rawReturn=[...rawWeights].reduce((sum,[symbol,w])=>sum+w*candidates.find(x=>x.symbol===symbol).forward,0);
    }

    let scale=0,realizedVol=null;
    if(rawHistory.length>=cfg.volLookbackWeeks){
      const hist=rawHistory.slice(-cfg.volLookbackWeeks),sd=stdev(hist);
      realizedVol=sd*Math.sqrt(cfg.annualizationWeeks);
      if(upup&&rawWeights.size&&realizedVol>0)scale=Math.min(cfg.maxGrossLeverage,cfg.targetVolAnnual/realizedVol);
    }
    const weights=scale>0?new Map([...rawWeights].map(([symbol,w])=>[symbol,w*scale])):new Map();
    const keys=new Set([...prevWeights.keys(),...weights.keys()]);let turnover=0;
    for(const symbol of keys)turnover+=Math.abs((weights.get(symbol)||0)-(prevWeights.get(symbol)||0));
    const costReturn=turnover*cfg.costBps/10000;
    const grossReturn=[...weights].reduce((sum,[symbol,w])=>sum+w*candidates.find(x=>x.symbol===symbol)?.forward,0);
    const netReturn=(finite(grossReturn)?grossReturn:0)-costReturn;
    const legs=[];
    for(const [symbol,w] of weights){
      const x=candidates.find(y=>y.symbol===symbol),prev=prevWeights.get(symbol)||0,cost=Math.abs(w-prev)*cfg.costBps/10000,gross=w*(x?.forward||0),net=gross-cost;
      legs.push({symbol,position:w,signal:Math.sign(w),formationScore:x?.score??null,grossReturn:gross,costReturn:cost,netReturn:net});
      if(w>0)longContribution+=net;else if(w<0)shortContribution+=net;
    }
    for(const [symbol,w] of prevWeights)if(!weights.has(symbol)){
      const cost=Math.abs(w)*cfg.costBps/10000;legs.push({symbol,position:0,signal:0,grossReturn:0,costReturn:cost,netReturn:-cost,exitOnly:true});
    }
    periods.push({at,nextAt,upup,stateNow,statePrev,active:weights.size>0,scale,realizedVol,rawReturn,turnover,grossReturn:finite(grossReturn)?grossReturn:0,costReturn,netReturn,longs:longs.map(x=>x.symbol),shorts:shorts.map(x=>x.symbol),legs});
    if(weights.size)activeWeeks++;totalTurnover+=turnover;totalCost+=costReturn;
    rawHistory.push(rawReturn);
    prevWeights.clear();for(const [k,v] of weights)prevWeights.set(k,v);
  }
  if(periods.length&&prevWeights.size){
    const closeCost=[...prevWeights.values()].reduce((sum,w)=>sum+Math.abs(w),0)*cfg.costBps/10000;
    periods.at(-1).costReturn+=closeCost;periods.at(-1).netReturn-=closeCost;totalCost+=closeCost;
  }
  const s=summary(periods.map(x=>x.netReturn),cfg.startEquity),stability=chrono(periods,5,cfg.startEquity),assetRows=assetSummaries(periods,cfg.startEquity),conc=concentration(assetRows),gate=evaluateProfitCandidate(s,stability,assetRows,conc);
  return{
    ruleset:PAPERBOT_PROFIT_AGENT_V2_RULESET,
    strategy:'UPUP_RM_MOMENTUM_PROXY_V1',
    exactReplication:false,
    limitation:'EQUAL_WEIGHT_8_ASSET_PRICE_ONLY_PROXY_WITHOUT_HISTORICAL_MARKET_CAP',
    researchOnly:true,executionImpact:false,autoPromotion:false,
    config:cfg,summary:s,stability,assets:assetRows,positivePnlConcentrationPct:conc,gate,periods,
    diagnostics:{
      activeWeeks,totalWeeks:periods.length,activeWeekSharePct:periods.length?activeWeeks/periods.length*100:0,
      totalTurnover,totalModeledCostReturn:totalCost,longContributionPct:longContribution*100,shortContributionPct:shortContribution*100
    },
    benchmarks:{
      equalWeightBuyHoldReturnPct:compound(benchEW),
      btcBuyHoldReturnPct:compound(benchBTC)
    }
  };
}
