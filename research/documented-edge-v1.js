import {
  FUNDING_CARRY_V2_RULESET,
  FUNDING_CARRY_V2_NEW_ENTRIES_ALLOWED,
  FUNDING_CARRY_V2_RETIREMENT_REASON
} from '../funding-carry-paper-v2.js';

export const DOCUMENTED_EDGE_V1_RULESET='DOCUMENTED-EDGE-LAB-V1-FROZEN';
export const TSMOM_ENGINE_REVISION='WEIGHTED-TURNOVER-R2';
export const DOCUMENTED_EDGE_ASSETS=Object.freeze(['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);

export const TSMOM_CLASSIC_CONFIG=Object.freeze({
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

export const XSMOM_3W_CONFIG=Object.freeze({
  formationDays:21,
  skipDays:1,
  rebalanceDays:7,
  topBottomFraction:.30,
  costBps:8,
  startEquity:10000,
  minAssets:5,
  exactReplication:false,
  limitation:'PRICE_ONLY_EQUAL_WEIGHT_NO_HISTORICAL_MARKET_CAP'
});

export const DOCUMENTED_EDGE_GATE=Object.freeze({
  tsmom:Object.freeze({minPeriods:24,minProfitFactor:1.10,minPositiveWindows:3,maxDrawdownPct:25,minPositiveAssets:4}),
  xsmom:Object.freeze({minPeriods:52,minProfitFactor:1.10,minPositiveWindows:3,maxDrawdownPct:30})
});

const DAY=86400000;
const finite=v=>Number.isFinite(Number(v));
const n=v=>Number(v);
const round=(v,d=6)=>finite(v)?Math.round(n(v)*10**d)/10**d:null;
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

export function normalizeDaily(rows){
  return (Array.isArray(rows)?rows:[])
    .map((r,i)=>({
      openTime:n(r.openTime??r.ts??i),
      closeTime:n(r.closeTime??r.openTime??r.ts??i),
      open:n(r.open??r.close),high:n(r.high),low:n(r.low),close:n(r.close),volume:finite(r.volume)?n(r.volume):null
    }))
    .filter(r=>r.openTime>0&&r.close>0&&finite(r.close))
    .sort((a,b)=>a.openTime-b.openTime);
}

function indexSeries(rows){
  const xs=normalizeDaily(rows),by=new Map(xs.map((r,i)=>[r.openTime,i]));
  return{rows:xs,by};
}
function getAt(series,ts){
  const i=series.by.get(ts);return i==null?null:series.rows[i];
}
function getBack(series,ts,days){
  const i=series.by.get(ts);if(i==null||i-days<0)return null;
  return series.rows[i-days];
}
function getForward(series,ts,days){
  const i=series.by.get(ts);if(i==null||i+days>=series.rows.length)return null;
  return series.rows[i+days];
}
function realizedVol(series,ts,days,annualizationDays){
  const i=series.by.get(ts);if(i==null||i<days)return null;
  const rs=[];
  for(let k=i-days+1;k<=i;k++){
    const a=series.rows[k-1]?.close,b=series.rows[k]?.close;
    if(a>0&&b>0)rs.push(Math.log(b/a));
  }
  const sd=stdev(rs);
  return sd>0?sd*Math.sqrt(annualizationDays):null;
}
function windowStats(returns,startEquity=10000){
  let eq=startEquity,peak=startEquity,maxDD=0;
  for(const r of returns){eq*=1+r;peak=Math.max(peak,eq);if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak*100)}
  return{
    periods:returns.length,
    totalReturnPct:(eq/startEquity-1)*100,
    pnl:eq-startEquity,
    endEquity:eq,
    profitFactor:pf(returns),
    avgReturnPct:mean(returns)*100,
    maxDrawdownPct:maxDD,
    positivePeriods:returns.filter(x=>x>0).length
  };
}
function chronoWindows(periods,parts=5){
  if(!periods.length)return{windows:[],positiveWindows:0};
  const out=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts);
    const slice=periods.slice(a,b),s=windowStats(slice.map(x=>x.netReturn),10000);
    out.push({i:i+1,from:slice[0]?.at??null,to:slice.at(-1)?.at??null,...s,positive:s.totalReturnPct>0});
  }
  return{windows:out,positiveWindows:out.filter(x=>x.positive).length};
}
function positiveAssetConcentration(assetRows){
  const pos=assetRows.filter(x=>x.summary.pnl>0),tot=pos.reduce((a,x)=>a+x.summary.pnl,0);
  return tot>0?Math.max(...pos.map(x=>x.summary.pnl/tot*100)):0;
}

export function tsmomSignal(series,ts,cfg=TSMOM_CLASSIC_CONFIG){
  const cur=getAt(series,ts);if(!cur)return null;
  const signs=[];
  for(const d of cfg.lookbacks){
    const old=getBack(series,ts,d);if(!old)return null;
    const r=cur.close/old.close-1;signs.push(r>0?1:r<0?-1:0);
  }
  return{signal:mean(signs),signs};
}

export function runTsmomClassic(dataset,config={}){
  const cfg={...TSMOM_CLASSIC_CONFIG,...config,lookbacks:[...(config.lookbacks||TSMOM_CLASSIC_CONFIG.lookbacks)]};
  const series=Object.fromEntries(Object.entries(dataset||{}).map(([k,v])=>[k,indexSeries(v)]).filter(([,v])=>v.rows.length));
  const master=series.BTC||Object.values(series).sort((a,b)=>b.rows.length-a.rows.length)[0];
  if(!master)return emptyTsmom(cfg);
  const warm=Math.max(...cfg.lookbacks,cfg.volLookbackDays),periods=[],perAsset={},prevRawPos=new Map(),prevWeights=new Map();
  for(const symbol of Object.keys(series))perAsset[symbol]=[];
  for(let i=warm;i+cfg.rebalanceDays<master.rows.length;i+=cfg.rebalanceDays){
    const at=master.rows[i].openTime,nextAt=master.rows[i+cfg.rebalanceDays].openTime,candidates=[];
    for(const [symbol,ser] of Object.entries(series)){
      const cur=getAt(ser,at),future=getAt(ser,nextAt),sig=tsmomSignal(ser,at,cfg),vol=realizedVol(ser,at,cfg.volLookbackDays,cfg.annualizationDays);
      if(!cur||!future||!sig||!(vol>0))continue;
      const leverage=Math.min(cfg.maxLeverage,cfg.targetVolAnnual/vol),position=sig.signal*leverage,assetReturn=future.close/cur.close-1,gross=position*assetReturn;
      candidates.push({symbol,at,nextAt,signal:sig.signal,signs:sig.signs,vol,leverage,position,assetReturn,grossReturn:gross});
    }
    if(candidates.length<cfg.minActiveAssets)continue;

    const nActive=candidates.length,currentRaw=new Map(candidates.map(x=>[x.symbol,x.position])),currentWeights=new Map(candidates.map(x=>[x.symbol,x.position/nActive]));
    const weightKeys=new Set([...prevWeights.keys(),...currentWeights.keys()]);
    let turnover=0;for(const symbol of weightKeys)turnover+=Math.abs((currentWeights.get(symbol)||0)-(prevWeights.get(symbol)||0));
    const grossReturn=candidates.reduce((sum,x)=>sum+(currentWeights.get(x.symbol)||0)*x.assetReturn,0),costReturn=turnover*cfg.costBps/10000,netReturn=grossReturn-costReturn;

    const currentSymbols=new Set(currentRaw.keys()),exitLegs=[];
    for(const oldSymbol of prevRawPos.keys()){
      if(currentSymbols.has(oldSymbol))continue;
      const exitCost=Math.abs(prevRawPos.get(oldSymbol)||0)*cfg.costBps/10000,exitLeg={symbol:oldSymbol,at,nextAt,signal:0,signs:[],vol:null,leverage:0,position:0,grossReturn:0,costReturn:exitCost,netReturn:-exitCost,exitOnly:true};
      perAsset[oldSymbol]?.push(exitLeg);exitLegs.push(exitLeg);
    }
    const legs=candidates.map(x=>{
      const prev=prevRawPos.get(x.symbol)||0,cost=Math.abs(x.position-prev)*cfg.costBps/10000,leg={...x,costReturn:cost,netReturn:x.grossReturn-cost};
      perAsset[x.symbol].push(leg);return leg;
    });
    periods.push({at,nextAt,activeAssets:nActive,turnover,grossReturn,costReturn,netReturn,legs:[...legs,...exitLegs]});
    prevRawPos.clear();for(const [symbol,pos] of currentRaw)prevRawPos.set(symbol,pos);
    prevWeights.clear();for(const [symbol,w] of currentWeights)prevWeights.set(symbol,w);
  }
  if(periods.length){
    const last=periods.at(-1),closeCost=[...prevWeights.values()].reduce((sum,x)=>sum+Math.abs(x),0)*cfg.costBps/10000;
    last.costReturn+=closeCost;last.netReturn-=closeCost;
    for(const [symbol,pos] of prevRawPos){
      const exitCost=Math.abs(pos)*cfg.costBps/10000,exitLeg={symbol,at:last.nextAt,nextAt:last.nextAt,signal:0,signs:[],vol:null,leverage:0,position:0,grossReturn:0,costReturn:exitCost,netReturn:-exitCost,exitOnly:true};
      perAsset[symbol]?.push(exitLeg);last.legs.push(exitLeg);
    }
  }
  const assets=Object.entries(perAsset).map(([symbol,rows])=>({symbol,summary:windowStats(rows.map(x=>x.netReturn),cfg.startEquity),periods:rows.length})).filter(x=>x.periods);
  const summary=windowStats(periods.map(x=>x.netReturn),cfg.startEquity),stability=chronoWindows(periods,5);
  const gate=evaluateTsmomGate(summary,stability,assets,cfg);
  return{ruleset:DOCUMENTED_EDGE_V1_RULESET,engineRevision:TSMOM_ENGINE_REVISION,strategy:'TSMOM_CLASSIC',researchOnly:true,executionImpact:false,autoPromotion:false,config:cfg,summary,stability,assets,periods,gate,positivePnlConcentrationPct:round(positiveAssetConcentration(assets),2)};
}
function emptyTsmom(cfg){
  return{ruleset:DOCUMENTED_EDGE_V1_RULESET,engineRevision:TSMOM_ENGINE_REVISION,strategy:'TSMOM_CLASSIC',researchOnly:true,executionImpact:false,autoPromotion:false,config:cfg,summary:windowStats([],cfg.startEquity),stability:{windows:[],positiveWindows:0},assets:[],periods:[],gate:{pass:false,reasons:['NO_DATA'],autoPromotion:false}};
}
export function evaluateTsmomGate(summary,stability,assets,cfg=TSMOM_CLASSIC_CONFIG){
  const g=DOCUMENTED_EDGE_GATE.tsmom,reasons=[];
  if((summary?.periods||0)<g.minPeriods)reasons.push('PERIODS_LT_'+g.minPeriods);
  if((summary?.profitFactor||0)<g.minProfitFactor)reasons.push('PF_LT_'+g.minProfitFactor);
  if((summary?.totalReturnPct||0)<=0)reasons.push('RETURN_NOT_POSITIVE');
  if((summary?.maxDrawdownPct??Infinity)>g.maxDrawdownPct)reasons.push('DD_GT_'+g.maxDrawdownPct+'PCT');
  if((stability?.positiveWindows||0)<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);
  const positiveAssets=(assets||[]).filter(x=>x.summary.pnl>0).length;
  if(positiveAssets<g.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+g.minPositiveAssets);
  return{pass:reasons.length===0,reasons,positiveAssets,autoPromotion:false,label:reasons.length?'TSMOM_GATE_FAIL':'TSMOM_GATE_PASS'};
}

function exactAt(series,ts){return getAt(series,ts)?.close??null}
function xsFormation(series,ts,cfg){
  const i=series.by.get(ts);if(i==null)return null;
  const end=i-cfg.skipDays,start=end-cfg.formationDays;
  if(start<0||end<0)return null;
  const a=series.rows[start]?.close,b=series.rows[end]?.close;
  return a>0&&b>0?b/a-1:null;
}
function weightTurnover(prev,next){
  const keys=new Set([...prev.keys(),...next.keys()]);let x=0;
  for(const k of keys)x+=Math.abs((next.get(k)||0)-(prev.get(k)||0));
  return x;
}

export function runXsmom3wPriceProxy(dataset,config={}){
  const cfg={...XSMOM_3W_CONFIG,...config};
  const series=Object.fromEntries(Object.entries(dataset||{}).map(([k,v])=>[k,indexSeries(v)]).filter(([,v])=>v.rows.length));
  const master=series.BTC||Object.values(series).sort((a,b)=>b.rows.length-a.rows.length)[0];
  if(!master)return emptyXsmom(cfg);
  const periods=[],prevWeights=new Map(),warm=cfg.formationDays+cfg.skipDays+1;
  for(let i=warm;i+cfg.rebalanceDays<master.rows.length;i+=cfg.rebalanceDays){
    const at=master.rows[i].openTime,nextAt=master.rows[i+cfg.rebalanceDays].openTime,candidates=[];
    for(const [symbol,ser] of Object.entries(series)){
      const score=xsFormation(ser,at,cfg),p0=exactAt(ser,at),p1=exactAt(ser,nextAt);
      if(finite(score)&&p0>0&&p1>0)candidates.push({symbol,score,forward:p1/p0-1});
    }
    if(candidates.length<cfg.minAssets)continue;
    candidates.sort((a,b)=>b.score-a.score);
    const k=Math.max(1,Math.floor(candidates.length*cfg.topBottomFraction)),longs=candidates.slice(0,k),shorts=candidates.slice(-k);
    const weights=new Map();for(const x of longs)weights.set(x.symbol,.5/k);for(const x of shorts)weights.set(x.symbol,-.5/k);
    const gross=[...weights.entries()].reduce((a,[symbol,w])=>a+w*candidates.find(x=>x.symbol===symbol).forward,0);
    const turnover=weightTurnover(prevWeights,weights),cost=turnover*cfg.costBps/10000,net=gross-cost;
    periods.push({at,nextAt,universe:candidates.length,longs:longs.map(x=>x.symbol),shorts:shorts.map(x=>x.symbol),turnover,grossReturn:gross,costReturn:cost,netReturn:net,scores:Object.fromEntries(candidates.map(x=>[x.symbol,x.score]))});
    prevWeights.clear();for(const [k2,v] of weights)prevWeights.set(k2,v);
  }
  if(periods.length){
    const closeCost=[...prevWeights.values()].reduce((a,x)=>a+Math.abs(x),0)*cfg.costBps/10000;
    periods.at(-1).costReturn+=closeCost;periods.at(-1).netReturn-=closeCost;
  }
  const summary=windowStats(periods.map(x=>x.netReturn),cfg.startEquity),stability=chronoWindows(periods,5),gate=evaluateXsmomGate(summary,stability);
  return{ruleset:DOCUMENTED_EDGE_V1_RULESET,strategy:'XSMOM_3W_PRICE_PROXY',researchOnly:true,executionImpact:false,autoPromotion:false,exactReplication:false,limitation:cfg.limitation,config:cfg,summary,stability,periods,gate};
}
function emptyXsmom(cfg){
  return{ruleset:DOCUMENTED_EDGE_V1_RULESET,strategy:'XSMOM_3W_PRICE_PROXY',researchOnly:true,executionImpact:false,autoPromotion:false,exactReplication:false,limitation:cfg.limitation,config:cfg,summary:windowStats([],cfg.startEquity),stability:{windows:[],positiveWindows:0},periods:[],gate:{pass:false,reasons:['NO_DATA'],autoPromotion:false}};
}
export function evaluateXsmomGate(summary,stability){
  const g=DOCUMENTED_EDGE_GATE.xsmom,reasons=[];
  if((summary?.periods||0)<g.minPeriods)reasons.push('PERIODS_LT_'+g.minPeriods);
  if((summary?.profitFactor||0)<g.minProfitFactor)reasons.push('PF_LT_'+g.minProfitFactor);
  if((summary?.totalReturnPct||0)<=0)reasons.push('RETURN_NOT_POSITIVE');
  if((summary?.maxDrawdownPct??Infinity)>g.maxDrawdownPct)reasons.push('DD_GT_'+g.maxDrawdownPct+'PCT');
  if((stability?.positiveWindows||0)<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);
  reasons.push('EXACT_FACTOR_REQUIRES_HISTORICAL_MARKET_CAP');
  return{pass:false,reasons,autoPromotion:false,label:'XSMOM_PROXY_ONLY'};
}

export function fundingCarryEvidence(){
  return{
    strategy:'FUNDING_CARRY',
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false,
    ruleset:FUNDING_CARRY_V2_RULESET,
    newEntriesAllowed:FUNDING_CARRY_V2_NEW_ENTRIES_ALLOWED,
    retirementReason:FUNDING_CARRY_V2_RETIREMENT_REASON,
    evidence:[
      {asset:'BTC',window:'30d',netUsd:36.19,capitalReturnPct:.181},
      {asset:'BTC',window:'60d',netUsd:83.99,capitalReturnPct:.420},
      {asset:'BTC',window:'90d',netUsd:118.55,capitalReturnPct:.593},
      {asset:'ETH',window:'90d',netUsd:88.33,capitalReturnPct:.442},
      {asset:'SOL',window:'90d',netUsd:28.16,capitalReturnPct:.141}
    ],
    note:'Historische Screening-Fenster sind überlappend. V2-Neueinstiege bleiben nach späterem Repeatability-Gate gesperrt.'
  };
}
