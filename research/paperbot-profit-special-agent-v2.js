import {normalizeDaily} from './documented-edge-v1.js';

export const PAPERBOT_PROFIT_AGENT_V2_RULESET='PAPERBOT-PROFIT-SPECIAL-AGENT-V2-FROZEN';
export const PAPERBOT_PROFIT_AGENT_V2_ASSETS=Object.freeze(['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);
export const PAPERBOT_PROFIT_V2_GATE=Object.freeze({
  minPeriods:24,
  minProfitFactor:1.15,
  maxDrawdownPct:25,
  minPositiveWindows:3,
  minPositiveAssets:4,
  maxPositivePnlConcentrationPct:50
});
export const ASYMMETRIC_DONCHIAN_V2_CONFIG=Object.freeze({
  entryDays:55,
  exitDays:20,
  rebalanceDays:7,
  volLookbackDays:60,
  targetVolAnnual:.10,
  annualizationDays:365,
  maxLeverage:2,
  costBps:8,
  longBudget:.70,
  shortBudget:.30,
  reallocateSingleSide:true,
  startEquity:10000,
  minActiveAssets:2
});
export const UP_REGIME_DONCHIAN_V2_CONFIG=Object.freeze({
  entryDays:55,
  exitDays:20,
  rebalanceDays:7,
  volLookbackDays:60,
  targetVolAnnual:.10,
  annualizationDays:365,
  maxLeverage:2,
  costBps:8,
  regimeMaDays:200,
  regimeReturnDays:30,
  startEquity:10000,
  minActiveAssets:2
});

const finite=v=>Number.isFinite(Number(v));
const n=v=>Number(v);
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const stdev=a=>{
  if(a.length<2)return 0;
  const m=mean(a);
  return Math.sqrt(Math.max(0,a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1)));
};
const profitFactor=rows=>{
  const wins=rows.filter(x=>x>0).reduce((a,b)=>a+b,0);
  const losses=Math.abs(rows.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return losses>0?wins/losses:(wins>0?99:0);
};
function indexSeries(rows){
  const xs=normalizeDaily(rows);
  return{rows:xs,by:new Map(xs.map((r,i)=>[r.openTime,i]))};
}
function at(series,i){return i>=0&&i<series.rows.length?series.rows[i]:null}
function realizedVol(series,i,days,annualizationDays){
  if(i<days)return null;
  const rs=[];
  for(let k=i-days+1;k<=i;k++){
    const a=series.rows[k-1]?.close,b=series.rows[k]?.close;
    if(a>0&&b>0)rs.push(Math.log(b/a));
  }
  const sd=stdev(rs);
  return sd>0?sd*Math.sqrt(annualizationDays):null;
}
function channel(rows,endExclusive,days,field,op){
  const start=endExclusive-days;if(start<0)return null;
  const xs=rows.slice(start,endExclusive).map(x=>n(x[field])).filter(finite);
  return xs.length===days?op(...xs):null;
}
function sma(series,i,days){
  if(i-days+1<0)return null;
  const xs=series.rows.slice(i-days+1,i+1).map(x=>x.close).filter(finite);
  return xs.length===days?mean(xs):null;
}
function persistentUp(series,i,cfg){
  const d=cfg.regimeReturnDays,cur=at(series,i),m=sma(series,i,cfg.regimeMaDays),p1=at(series,i-d),p2=at(series,i-2*d);
  if(!(cur?.close>0&&m>0&&p1?.close>0&&p2?.close>0))return false;
  return cur.close>m&&cur.close/p1.close-1>0&&p1.close/p2.close-1>0;
}
function summary(returns,startEquity=10000){
  let eq=startEquity,peak=startEquity,maxDD=0;
  for(const r of returns){
    eq*=1+r;
    peak=Math.max(peak,eq);
    if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak*100);
  }
  return{
    periods:returns.length,
    totalReturnPct:(eq/startEquity-1)*100,
    pnl:eq-startEquity,
    endEquity:eq,
    profitFactor:profitFactor(returns),
    avgReturnPct:mean(returns)*100,
    maxDrawdownPct:maxDD,
    positivePeriods:returns.filter(x=>x>0).length
  };
}
function chronologicalWindows(periods,parts=5,startEquity=10000){
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
  const pos=(assets||[]).filter(x=>x.summary?.pnl>0),total=pos.reduce((a,x)=>a+x.summary.pnl,0);
  return total>0?Math.max(...pos.map(x=>x.summary.pnl/total*100)):0;
}
export function evaluateProfitCandidateV2(s,stability,assets,positivePnlConcentrationPct=concentration(assets)){
  const g=PAPERBOT_PROFIT_V2_GATE,reasons=[];
  if((s?.periods||0)<g.minPeriods)reasons.push('PERIODS_LT_'+g.minPeriods);
  if((s?.totalReturnPct||0)<=0)reasons.push('RETURN_NOT_POSITIVE');
  if((s?.profitFactor||0)<g.minProfitFactor)reasons.push('PF_LT_'+g.minProfitFactor);
  if((s?.maxDrawdownPct??Infinity)>g.maxDrawdownPct)reasons.push('DD_GT_'+g.maxDrawdownPct+'PCT');
  if((stability?.positiveWindows||0)<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);
  const positiveAssets=(assets||[]).filter(x=>x.summary?.pnl>0).length;
  if(positiveAssets<g.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+g.minPositiveAssets);
  if(positivePnlConcentrationPct>g.maxPositivePnlConcentrationPct)reasons.push('POSITIVE_PNL_CONCENTRATION_GT_'+g.maxPositivePnlConcentrationPct+'PCT');
  return{pass:reasons.length===0,reasons,positiveAssets,positivePnlConcentrationPct,autoPromotion:false,label:reasons.length?'PROFIT_V2_GATE_FAIL':'PROFIT_V2_GATE_PASS'};
}
function finalize(strategy,cfg,periods,extra={}){
  const s=summary(periods.map(x=>x.netReturn),cfg.startEquity),stability=chronologicalWindows(periods,5,cfg.startEquity),assets=assetSummaries(periods,cfg.startEquity),positivePnlConcentrationPct=concentration(assets),gate=evaluateProfitCandidateV2(s,stability,assets,positivePnlConcentrationPct);
  return{
    ruleset:PAPERBOT_PROFIT_AGENT_V2_RULESET,
    strategy,
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false,
    config:cfg,
    summary:s,
    stability,
    assets,
    periods,
    positivePnlConcentrationPct,
    gate,
    ...extra
  };
}
function empty(strategy,cfg,reason='NO_DATA'){
  return{
    ruleset:PAPERBOT_PROFIT_AGENT_V2_RULESET,
    strategy,
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false,
    config:cfg,
    summary:summary([],cfg.startEquity),
    stability:{windows:[],positiveWindows:0},
    assets:[],
    periods:[],
    positivePnlConcentrationPct:0,
    gate:{pass:false,reasons:[reason],positiveAssets:0,positivePnlConcentrationPct:0,autoPromotion:false,label:'PROFIT_V2_GATE_FAIL'}
  };
}
function buildSeries(dataset){
  return Object.fromEntries(Object.entries(dataset||{}).map(([k,v])=>[k,indexSeries(v)]).filter(([,v])=>v.rows.length));
}
function updateDonchianSide(ser,idx,prior,cfg,{longOnly=false,allowLong=true}={}){
  const cur=at(ser,idx);if(!cur)return 0;
  const entryHigh=channel(ser.rows,idx,cfg.entryDays,'high',Math.max),entryLow=channel(ser.rows,idx,cfg.entryDays,'low',Math.min),exitHigh=channel(ser.rows,idx,cfg.exitDays,'high',Math.max),exitLow=channel(ser.rows,idx,cfg.exitDays,'low',Math.min);
  if(![entryHigh,entryLow,exitHigh,exitLow].every(finite))return 0;
  let side=prior||0;
  if(side>0&&(cur.close<exitLow||!allowLong))side=0;
  else if(side<0&&(cur.close>exitHigh||longOnly))side=0;
  if(side===0){
    if(allowLong&&cur.close>entryHigh)side=1;
    else if(!longOnly&&cur.close<entryLow)side=-1;
  }
  return side;
}
function weightTurnover(prev,next){
  const keys=new Set([...prev.keys(),...next.keys()]);let out=0;
  for(const k of keys)out+=Math.abs((next.get(k)||0)-(prev.get(k)||0));
  return out;
}
function appendExitLegs(legs,prevWeights,nextWeights,costBps){
  for(const [symbol,w] of prevWeights){
    if(nextWeights.has(symbol))continue;
    const cost=Math.abs(w)*costBps/10000;
    legs.push({symbol,position:0,signal:0,leverage:0,grossReturn:0,costReturn:cost,netReturn:-cost,exitOnly:true});
  }
}
export function runAsymmetricDonchianV2(dataset,config={}){
  const cfg={...ASYMMETRIC_DONCHIAN_V2_CONFIG,...config},series=buildSeries(dataset),master=series.BTC||Object.values(series).sort((a,b)=>b.rows.length-a.rows.length)[0];
  if(!master)return empty('ASYMMETRIC_DONCHIAN_V2',cfg);
  const warm=Math.max(cfg.entryDays,cfg.exitDays,cfg.volLookbackDays)+1,periods=[],state=new Map(),prevWeights=new Map();
  for(let i=warm;i+cfg.rebalanceDays<master.rows.length;i+=cfg.rebalanceDays){
    const atTs=master.rows[i].openTime,nextTs=master.rows[i+cfg.rebalanceDays].openTime,candidates=[];
    for(const [symbol,ser] of Object.entries(series)){
      const idx=ser.by.get(atTs),nextIdx=ser.by.get(nextTs);if(idx==null||nextIdx==null)continue;
      const cur=at(ser,idx),future=at(ser,nextIdx),vol=realizedVol(ser,idx,cfg.volLookbackDays,cfg.annualizationDays);if(!(cur?.close>0&&future?.close>0&&vol>0))continue;
      const side=updateDonchianSide(ser,idx,state.get(symbol)||0,cfg);state.set(symbol,side);if(!side)continue;
      const leverage=Math.min(cfg.maxLeverage,cfg.targetVolAnnual/vol),assetReturn=future.close/cur.close-1;
      candidates.push({symbol,signal:side,leverage,rawAbs:leverage,assetReturn});
    }
    if(candidates.length<cfg.minActiveAssets){
      if(prevWeights.size){
        const turnover=[...prevWeights.values()].reduce((a,x)=>a+Math.abs(x),0),costReturn=turnover*cfg.costBps/10000,legs=[];
        appendExitLegs(legs,prevWeights,new Map(),cfg.costBps);
        periods.push({at:atTs,nextAt:nextTs,activeAssets:0,turnover,grossReturn:0,costReturn,netReturn:-costReturn,longGross:0,shortGross:0,legs});
        prevWeights.clear();
      }
      continue;
    }
    const longs=candidates.filter(x=>x.signal>0),shorts=candidates.filter(x=>x.signal<0);
    let longBudget=longs.length?cfg.longBudget:0,shortBudget=shorts.length?cfg.shortBudget:0;
    if(cfg.reallocateSingleSide&&longs.length&&!shorts.length)longBudget=1;
    if(cfg.reallocateSingleSide&&shorts.length&&!longs.length)shortBudget=1;
    const longDen=longs.reduce((a,x)=>a+x.rawAbs,0),shortDen=shorts.reduce((a,x)=>a+x.rawAbs,0),weights=new Map();
    for(const x of longs)weights.set(x.symbol,longDen>0?longBudget*x.rawAbs/longDen:0);
    for(const x of shorts)weights.set(x.symbol,shortDen>0?-shortBudget*x.rawAbs/shortDen:0);
    const turnover=weightTurnover(prevWeights,weights),costReturn=turnover*cfg.costBps/10000,grossReturn=candidates.reduce((a,x)=>a+(weights.get(x.symbol)||0)*x.assetReturn,0),legs=candidates.map(x=>{
      const w=weights.get(x.symbol)||0,prev=prevWeights.get(x.symbol)||0,cost=Math.abs(w-prev)*cfg.costBps/10000;
      return{symbol:x.symbol,position:w,signal:x.signal,leverage:x.leverage,grossReturn:w*x.assetReturn,costReturn:cost,netReturn:w*x.assetReturn-cost};
    });
    appendExitLegs(legs,prevWeights,weights,cfg.costBps);
    periods.push({at:atTs,nextAt:nextTs,activeAssets:candidates.length,turnover,grossReturn,costReturn,netReturn:grossReturn-costReturn,longGross:[...weights.values()].filter(x=>x>0).reduce((a,b)=>a+b,0),shortGross:Math.abs([...weights.values()].filter(x=>x<0).reduce((a,b)=>a+b,0)),legs});
    prevWeights.clear();for(const [k,v] of weights)prevWeights.set(k,v);
  }
  if(periods.length&&prevWeights.size){
    const closeCost=[...prevWeights.values()].reduce((a,x)=>a+Math.abs(x),0)*cfg.costBps/10000;
    periods.at(-1).costReturn+=closeCost;periods.at(-1).netReturn-=closeCost;
    appendExitLegs(periods.at(-1).legs,prevWeights,new Map(),cfg.costBps);
  }
  return finalize('ASYMMETRIC_DONCHIAN_V2',cfg,periods,{allocation:'70_30_WHEN_BOTH_SIDES'});
}
export function runUpRegimeDonchianV2(dataset,config={}){
  const cfg={...UP_REGIME_DONCHIAN_V2_CONFIG,...config},series=buildSeries(dataset),master=series.BTC||Object.values(series).sort((a,b)=>b.rows.length-a.rows.length)[0];
  if(!master||!series.BTC)return empty('UP_REGIME_DONCHIAN_V2',cfg,'BTC_REGIME_SOURCE_MISSING');
  const tradeAssets=Array.isArray(config.tradeAssets)&&config.tradeAssets.length?new Set(config.tradeAssets.map(x=>String(x).toUpperCase())):null;
  const warm=Math.max(cfg.entryDays,cfg.exitDays,cfg.volLookbackDays,cfg.regimeMaDays,cfg.regimeReturnDays*2)+1,periods=[],state=new Map(),prevWeights=new Map();
  for(let i=warm;i+cfg.rebalanceDays<master.rows.length;i+=cfg.rebalanceDays){
    const atTs=master.rows[i].openTime,nextTs=master.rows[i+cfg.rebalanceDays].openTime,btcIdx=series.BTC.by.get(atTs),btcUp=btcIdx!=null&&persistentUp(series.BTC,btcIdx,cfg),candidates=[];
    for(const [symbol,ser] of Object.entries(series)){
      if(tradeAssets&&!tradeAssets.has(symbol))continue;
      const idx=ser.by.get(atTs),nextIdx=ser.by.get(nextTs);if(idx==null||nextIdx==null)continue;
      const cur=at(ser,idx),future=at(ser,nextIdx),vol=realizedVol(ser,idx,cfg.volLookbackDays,cfg.annualizationDays);if(!(cur?.close>0&&future?.close>0&&vol>0))continue;
      const allowLong=btcUp&&persistentUp(ser,idx,cfg),side=updateDonchianSide(ser,idx,state.get(symbol)||0,cfg,{longOnly:true,allowLong});state.set(symbol,side);if(side<=0)continue;
      const leverage=Math.min(cfg.maxLeverage,cfg.targetVolAnnual/vol),assetReturn=future.close/cur.close-1;
      candidates.push({symbol,signal:1,leverage,assetReturn,assetRegimeUp:true,btcRegimeUp:true});
    }
    if(candidates.length<cfg.minActiveAssets){
      if(prevWeights.size){
        const turnover=[...prevWeights.values()].reduce((a,x)=>a+Math.abs(x),0),costReturn=turnover*cfg.costBps/10000,legs=[];
        appendExitLegs(legs,prevWeights,new Map(),cfg.costBps);
        periods.push({at:atTs,nextAt:nextTs,activeAssets:0,turnover,grossReturn:0,costReturn,netReturn:-costReturn,btcRegimeUp:btcUp,legs});
        prevWeights.clear();
      }
      continue;
    }
    const weights=new Map(candidates.map(x=>[x.symbol,x.leverage/candidates.length])),turnover=weightTurnover(prevWeights,weights),costReturn=turnover*cfg.costBps/10000,grossReturn=candidates.reduce((a,x)=>a+(weights.get(x.symbol)||0)*x.assetReturn,0),legs=candidates.map(x=>{
      const w=weights.get(x.symbol)||0,prev=prevWeights.get(x.symbol)||0,cost=Math.abs(w-prev)*cfg.costBps/10000;
      return{symbol:x.symbol,position:w,signal:1,leverage:x.leverage,grossReturn:w*x.assetReturn,costReturn:cost,netReturn:w*x.assetReturn-cost};
    });
    appendExitLegs(legs,prevWeights,weights,cfg.costBps);
    periods.push({at:atTs,nextAt:nextTs,activeAssets:candidates.length,turnover,grossReturn,costReturn,netReturn:grossReturn-costReturn,btcRegimeUp:btcUp,legs});
    prevWeights.clear();for(const [k,v] of weights)prevWeights.set(k,v);
  }
  if(periods.length&&prevWeights.size){
    const closeCost=[...prevWeights.values()].reduce((a,x)=>a+Math.abs(x),0)*cfg.costBps/10000;
    periods.at(-1).costReturn+=closeCost;periods.at(-1).netReturn-=closeCost;
    appendExitLegs(periods.at(-1).legs,prevWeights,new Map(),cfg.costBps);
  }
  return finalize('UP_REGIME_DONCHIAN_V2',cfg,periods,{regime:'BTC_AND_ASSET_PERSISTENT_UP'});
}
export function runPaperBotProfitAgentV2(dataset){
  const asymmetric=runAsymmetricDonchianV2(dataset),upRegime=runUpRegimeDonchianV2(dataset),candidates=[
    {name:'ASYMMETRIC_DONCHIAN_V2',result:asymmetric,gate:asymmetric.gate},
    {name:'UP_REGIME_DONCHIAN_V2',result:upRegime,gate:upRegime.gate}
  ];
  const passed=candidates.filter(x=>x.gate?.pass).sort((a,b)=>(b.result.summary?.totalReturnPct||-Infinity)-(a.result.summary?.totalReturnPct||-Infinity)||(a.result.summary?.maxDrawdownPct??Infinity)-(b.result.summary?.maxDrawdownPct??Infinity));
  return{
    ruleset:PAPERBOT_PROFIT_AGENT_V2_RULESET,
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false,
    universe:[...PAPERBOT_PROFIT_AGENT_V2_ASSETS],
    candidates:Object.fromEntries(candidates.map(x=>[x.name,x.result])),
    discoveryLeader:passed[0]?.name||null,
    discoveryLeaderReturnPct:passed[0]?.result?.summary?.totalReturnPct??null,
    passedCandidates:passed.map(x=>x.name),
    decision:passed.length?'DISCOVERY_LEADER_ONLY':'NO_CANDIDATE_PASSES',
    nextStage:passed.length?'INDEPENDENT_HOLDOUT_THEN_PAPER_SHADOW':'RESEARCH_REDESIGN',
    note:'V2 parameters were frozen before the first real discovery result. No live promotion is allowed.'
  };
}
