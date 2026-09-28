import {
  DOCUMENTED_EDGE_ASSETS,
  TSMOM_CLASSIC_CONFIG,
  runTsmomClassic,
  normalizeDaily
} from './documented-edge-v1.js';

export const PAPERBOT_PROFIT_AGENT_V1_RULESET='PAPERBOT-PROFIT-SPECIAL-AGENT-V1-FROZEN';
export const PAPERBOT_PROFIT_AGENT_V1_ASSETS=Object.freeze([...DOCUMENTED_EDGE_ASSETS]);
export const PAPERBOT_PROFIT_GATE=Object.freeze({
  minPeriods:24,
  minProfitFactor:1.15,
  maxDrawdownPct:25,
  minPositiveWindows:3,
  minPositiveAssets:4,
  maxPositivePnlConcentrationPct:50
});
export const PERSISTENT_TSMOM_V1_CONFIG=Object.freeze({
  lookbacks:Object.freeze([30,90,365]),
  rebalanceDays:30,
  volLookbackDays:60,
  targetVolAnnual:.10,
  annualizationDays:365,
  maxLeverage:2,
  costBps:8,
  startEquity:10000,
  minActiveAssets:3
});
export const DONCHIAN_TREND_V1_CONFIG=Object.freeze({
  entryDays:55,
  exitDays:20,
  rebalanceDays:7,
  volLookbackDays:60,
  targetVolAnnual:.10,
  annualizationDays:365,
  maxLeverage:2,
  costBps:8,
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
function atIndex(series,i){return i>=0&&i<series.rows.length?series.rows[i]:null}
function realizedVolAt(series,i,days,annualizationDays){
  if(i<days)return null;
  const rs=[];
  for(let k=i-days+1;k<=i;k++){
    const a=series.rows[k-1]?.close,b=series.rows[k]?.close;
    if(a>0&&b>0)rs.push(Math.log(b/a));
  }
  const sd=stdev(rs);
  return sd>0?sd*Math.sqrt(annualizationDays):null;
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
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts);
    const slice=periods.slice(a,b),s=summary(slice.map(x=>x.netReturn),startEquity);
    windows.push({i:i+1,from:slice[0]?.at??null,to:slice.at(-1)?.at??null,...s,positive:s.totalReturnPct>0});
  }
  return{windows,positiveWindows:windows.filter(x=>x.positive).length};
}
function summarizeAssets(periods,startEquity=10000){
  const by=new Map();
  for(const p of periods){
    for(const leg of p.legs||[]){
      if(!by.has(leg.symbol))by.set(leg.symbol,[]);
      by.get(leg.symbol).push(n(leg.netReturn)||0);
    }
  }
  return [...by.entries()].map(([symbol,rs])=>({
    symbol,
    periods:rs.length,
    summary:summary(rs,startEquity)
  })).sort((a,b)=>a.symbol.localeCompare(b.symbol));
}
function positivePnlConcentrationPct(assets){
  const pos=(assets||[]).filter(x=>x.summary?.pnl>0),total=pos.reduce((a,x)=>a+x.summary.pnl,0);
  return total>0?Math.max(...pos.map(x=>x.summary.pnl/total*100)):0;
}
function finalize(strategy,cfg,periods,extra={}){
  const s=summary(periods.map(x=>x.netReturn),cfg.startEquity),stability=chronologicalWindows(periods,5,cfg.startEquity),assets=summarizeAssets(periods,cfg.startEquity),concentration=positivePnlConcentrationPct(assets),gate=evaluateProfitCandidate(s,stability,assets,concentration);
  return{
    ruleset:PAPERBOT_PROFIT_AGENT_V1_RULESET,
    strategy,
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false,
    config:cfg,
    summary:s,
    stability,
    assets,
    periods,
    positivePnlConcentrationPct:concentration,
    gate,
    ...extra
  };
}
function empty(strategy,cfg,reason='NO_DATA'){
  return{
    ruleset:PAPERBOT_PROFIT_AGENT_V1_RULESET,
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
    gate:{pass:false,reasons:[reason],label:'PROFIT_GATE_FAIL',autoPromotion:false}
  };
}
export function evaluateProfitCandidate(s,stability,assets,concentration=positivePnlConcentrationPct(assets)){
  const g=PAPERBOT_PROFIT_GATE,reasons=[];
  if((s?.periods||0)<g.minPeriods)reasons.push('PERIODS_LT_'+g.minPeriods);
  if((s?.totalReturnPct||0)<=0)reasons.push('RETURN_NOT_POSITIVE');
  if((s?.profitFactor||0)<g.minProfitFactor)reasons.push('PF_LT_'+g.minProfitFactor);
  if((s?.maxDrawdownPct??Infinity)>g.maxDrawdownPct)reasons.push('DD_GT_'+g.maxDrawdownPct+'PCT');
  if((stability?.positiveWindows||0)<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);
  const positiveAssets=(assets||[]).filter(x=>x.summary?.pnl>0).length;
  if(positiveAssets<g.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+g.minPositiveAssets);
  if(concentration>g.maxPositivePnlConcentrationPct)reasons.push('POSITIVE_PNL_CONCENTRATION_GT_'+g.maxPositivePnlConcentrationPct+'PCT');
  return{
    pass:reasons.length===0,
    reasons,
    positiveAssets,
    positivePnlConcentrationPct:concentration,
    autoPromotion:false,
    label:reasons.length?'PROFIT_GATE_FAIL':'PROFIT_GATE_PASS'
  };
}

export function runPersistentTsmomV1(dataset,config={}){
  const cfg={...PERSISTENT_TSMOM_V1_CONFIG,...config,lookbacks:[...(config.lookbacks||PERSISTENT_TSMOM_V1_CONFIG.lookbacks)]};
  const series=Object.fromEntries(Object.entries(dataset||{}).map(([k,v])=>[k,indexSeries(v)]).filter(([,v])=>v.rows.length));
  const master=series.BTC||Object.values(series).sort((a,b)=>b.rows.length-a.rows.length)[0];
  if(!master)return empty('PERSISTENT_TSMOM_V1',cfg);
  const warm=Math.max(...cfg.lookbacks,cfg.volLookbackDays),periods=[],prevWeights=new Map();
  for(let i=warm;i+cfg.rebalanceDays<master.rows.length;i+=cfg.rebalanceDays){
    const at=master.rows[i].openTime,nextAt=master.rows[i+cfg.rebalanceDays].openTime,candidates=[];
    for(const [symbol,ser] of Object.entries(series)){
      const idx=ser.by.get(at),nextIdx=ser.by.get(nextAt);
      if(idx==null||nextIdx==null)continue;
      const cur=atIndex(ser,idx),future=atIndex(ser,nextIdx),vol=realizedVolAt(ser,idx,cfg.volLookbackDays,cfg.annualizationDays);
      if(!(cur?.close>0&&future?.close>0&&vol>0))continue;
      const signs=[];
      for(const d of cfg.lookbacks){
        const old=atIndex(ser,idx-d);
        if(!(old?.close>0)){signs.length=0;break}
        const r=cur.close/old.close-1;
        signs.push(r>0?1:r<0?-1:0);
      }
      if(signs.length!==cfg.lookbacks.length)continue;
      const signal=signs.every(x=>x===1)?1:signs.every(x=>x===-1)?-1:0;
      if(!signal)continue;
      const leverage=Math.min(cfg.maxLeverage,cfg.targetVolAnnual/vol),rawPosition=signal*leverage,assetReturn=future.close/cur.close-1;
      candidates.push({symbol,at,nextAt,signal,signs,vol,leverage,rawPosition,assetReturn});
    }
    if(candidates.length<cfg.minActiveAssets)continue;
    const weights=new Map(candidates.map(x=>[x.symbol,x.rawPosition/candidates.length]));
    const keys=new Set([...prevWeights.keys(),...weights.keys()]);
    let turnover=0;
    for(const symbol of keys)turnover+=Math.abs((weights.get(symbol)||0)-(prevWeights.get(symbol)||0));
    const grossReturn=candidates.reduce((sum,x)=>sum+(weights.get(x.symbol)||0)*x.assetReturn,0),costReturn=turnover*cfg.costBps/10000,netReturn=grossReturn-costReturn;
    const legs=candidates.map(x=>{
      const prev=prevWeights.get(x.symbol)||0,w=weights.get(x.symbol)||0,cost=Math.abs(w-prev)*cfg.costBps/10000;
      return{symbol:x.symbol,position:w,signal:x.signal,leverage:x.leverage,grossReturn:w*x.assetReturn,costReturn:cost,netReturn:w*x.assetReturn-cost};
    });
    periods.push({at,nextAt,activeAssets:candidates.length,turnover,grossReturn,costReturn,netReturn,legs});
    prevWeights.clear();for(const [k,v] of weights)prevWeights.set(k,v);
  }
  if(periods.length){
    const closeCost=[...prevWeights.values()].reduce((a,x)=>a+Math.abs(x),0)*cfg.costBps/10000;
    periods.at(-1).costReturn+=closeCost;periods.at(-1).netReturn-=closeCost;
  }
  return finalize('PERSISTENT_TSMOM_V1',cfg,periods);
}

function channel(rows,endExclusive,days,field,op){
  const start=endExclusive-days;if(start<0)return null;
  const xs=rows.slice(start,endExclusive).map(x=>n(x[field])).filter(finite);
  return xs.length===days?op(...xs):null;
}
export function runDonchianTrendV1(dataset,config={}){
  const cfg={...DONCHIAN_TREND_V1_CONFIG,...config};
  const series=Object.fromEntries(Object.entries(dataset||{}).map(([k,v])=>[k,indexSeries(v)]).filter(([,v])=>v.rows.length));
  const master=series.BTC||Object.values(series).sort((a,b)=>b.rows.length-a.rows.length)[0];
  if(!master)return empty('DONCHIAN_TREND_V1',cfg);
  const warm=Math.max(cfg.entryDays,cfg.exitDays,cfg.volLookbackDays)+1,periods=[],sideState=new Map(),prevWeights=new Map();
  for(let i=warm;i+cfg.rebalanceDays<master.rows.length;i+=cfg.rebalanceDays){
    const at=master.rows[i].openTime,nextAt=master.rows[i+cfg.rebalanceDays].openTime,candidates=[],states=[];
    for(const [symbol,ser] of Object.entries(series)){
      const idx=ser.by.get(at),nextIdx=ser.by.get(nextAt);
      if(idx==null||nextIdx==null)continue;
      const cur=atIndex(ser,idx),future=atIndex(ser,nextIdx),vol=realizedVolAt(ser,idx,cfg.volLookbackDays,cfg.annualizationDays);
      if(!(cur?.close>0&&future?.close>0&&vol>0))continue;
      const entryHigh=channel(ser.rows,idx,cfg.entryDays,'high',Math.max),entryLow=channel(ser.rows,idx,cfg.entryDays,'low',Math.min),exitHigh=channel(ser.rows,idx,cfg.exitDays,'high',Math.max),exitLow=channel(ser.rows,idx,cfg.exitDays,'low',Math.min);
      if(![entryHigh,entryLow,exitHigh,exitLow].every(finite))continue;
      let side=sideState.get(symbol)||0;
      if(side>0&&cur.close<exitLow)side=0;
      else if(side<0&&cur.close>exitHigh)side=0;
      if(side===0){
        if(cur.close>entryHigh)side=1;
        else if(cur.close<entryLow)side=-1;
      }
      sideState.set(symbol,side);
      states.push({symbol,side});
      if(!side)continue;
      const leverage=Math.min(cfg.maxLeverage,cfg.targetVolAnnual/vol),rawPosition=side*leverage,assetReturn=future.close/cur.close-1;
      candidates.push({symbol,at,nextAt,signal:side,vol,leverage,rawPosition,assetReturn,entryHigh,entryLow,exitHigh,exitLow});
    }
    if(candidates.length<cfg.minActiveAssets){
      if(prevWeights.size){
        const flat=new Map(),keys=new Set(prevWeights.keys());let turnover=0;
        for(const symbol of keys)turnover+=Math.abs(prevWeights.get(symbol)||0);
        const costReturn=turnover*cfg.costBps/10000;
        periods.push({at,nextAt,activeAssets:0,turnover,grossReturn:0,costReturn,netReturn:-costReturn,legs:[...prevWeights].map(([symbol,w])=>({symbol,position:0,signal:0,leverage:0,grossReturn:0,costReturn:Math.abs(w)*cfg.costBps/10000,netReturn:-Math.abs(w)*cfg.costBps/10000,exitOnly:true}))});
        prevWeights.clear();
      }
      continue;
    }
    const weights=new Map(candidates.map(x=>[x.symbol,x.rawPosition/candidates.length]));
    const keys=new Set([...prevWeights.keys(),...weights.keys()]);let turnover=0;
    for(const symbol of keys)turnover+=Math.abs((weights.get(symbol)||0)-(prevWeights.get(symbol)||0));
    const grossReturn=candidates.reduce((sum,x)=>sum+(weights.get(x.symbol)||0)*x.assetReturn,0),costReturn=turnover*cfg.costBps/10000,netReturn=grossReturn-costReturn;
    const legs=candidates.map(x=>{
      const prev=prevWeights.get(x.symbol)||0,w=weights.get(x.symbol)||0,cost=Math.abs(w-prev)*cfg.costBps/10000;
      return{symbol:x.symbol,position:w,signal:x.signal,leverage:x.leverage,grossReturn:w*x.assetReturn,costReturn:cost,netReturn:w*x.assetReturn-cost};
    });
    for(const [symbol,w] of prevWeights)if(!weights.has(symbol))legs.push({symbol,position:0,signal:0,leverage:0,grossReturn:0,costReturn:Math.abs(w)*cfg.costBps/10000,netReturn:-Math.abs(w)*cfg.costBps/10000,exitOnly:true});
    periods.push({at,nextAt,activeAssets:candidates.length,turnover,grossReturn,costReturn,netReturn,legs});
    prevWeights.clear();for(const [k,v] of weights)prevWeights.set(k,v);
  }
  if(periods.length&&prevWeights.size){
    const closeCost=[...prevWeights.values()].reduce((a,x)=>a+Math.abs(x),0)*cfg.costBps/10000;
    periods.at(-1).costReturn+=closeCost;periods.at(-1).netReturn-=closeCost;
  }
  return finalize('DONCHIAN_TREND_V1',cfg,periods);
}

function baselineView(result){
  const s=result?.summary||{},assets=result?.assets||[],stability=result?.stability||{positiveWindows:0};
  const concentration=positivePnlConcentrationPct(assets),gate=evaluateProfitCandidate(s,stability,assets,concentration);
  return{...result,ruleset:PAPERBOT_PROFIT_AGENT_V1_RULESET,strategy:'TSMOM_CLASSIC',positivePnlConcentrationPct:concentration,profitGate:gate};
}
export function runPaperBotProfitAgentV1(dataset){
  const classicRaw=runTsmomClassic(dataset),classic=baselineView(classicRaw),persistent=runPersistentTsmomV1(dataset),donchian=runDonchianTrendV1(dataset);
  const candidates=[
    {name:'TSMOM_CLASSIC',result:classic,gate:classic.profitGate},
    {name:'PERSISTENT_TSMOM_V1',result:persistent,gate:persistent.gate},
    {name:'DONCHIAN_TREND_V1',result:donchian,gate:donchian.gate}
  ];
  const passed=candidates.filter(x=>x.gate?.pass).sort((a,b)=>(b.result.summary?.totalReturnPct||-Infinity)-(a.result.summary?.totalReturnPct||-Infinity)||(a.result.summary?.maxDrawdownPct??Infinity)-(b.result.summary?.maxDrawdownPct??Infinity));
  return{
    ruleset:PAPERBOT_PROFIT_AGENT_V1_RULESET,
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false,
    universe:[...PAPERBOT_PROFIT_AGENT_V1_ASSETS],
    candidates:Object.fromEntries(candidates.map(x=>[x.name,x.result])),
    discoveryLeader:passed[0]?.name||null,
    discoveryLeaderReturnPct:passed[0]?.result?.summary?.totalReturnPct??null,
    passedCandidates:passed.map(x=>x.name),
    decision:passed.length?'DISCOVERY_LEADER_ONLY':'NO_CANDIDATE_PASSES',
    nextStage:passed.length?'INDEPENDENT_HOLDOUT_THEN_PAPER_SHADOW':'RESEARCH_REDESIGN',
    note:'Highest net return is considered only after the frozen profit/risk gate. No live promotion is allowed.'
  };
}
