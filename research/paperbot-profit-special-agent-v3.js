import {normalizeDaily} from './documented-edge-v1.js';

export const PAPERBOT_PROFIT_AGENT_V3_RULESET='PAPERBOT-PROFIT-SPECIAL-AGENT-V3-FROZEN';
export const PAPERBOT_PROFIT_AGENT_V3_ASSETS=Object.freeze(['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);
export const PAPERBOT_PROFIT_V3_CONFIG=Object.freeze({
  entryBars:40,
  exitBars:20,
  regimeMaBars:200,
  regimeReturnBars:120,
  atrBars:20,
  trailingAtrMult:3,
  volLookbackBars:60,
  targetVolAnnual:.10,
  annualizationBars:1460,
  maxLeverage:2,
  costBps:10,
  startEquity:10000
});
export const PAPERBOT_PROFIT_V3_GATE=Object.freeze({
  minPeriods:100,
  minProfitFactor:1.20,
  maxDrawdownPct:20,
  minPositiveWindows:4,
  minPositiveAssets:5,
  maxPositivePnlConcentrationPct:40
});

const n=v=>Number(v);
const finite=v=>Number.isFinite(n(v));
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
function sma(series,i,bars){
  if(i-bars+1<0)return null;
  const xs=series.rows.slice(i-bars+1,i+1).map(x=>x.close).filter(finite);
  return xs.length===bars?mean(xs):null;
}
function persistentUp(series,i,cfg){
  const d=cfg.regimeReturnBars,cur=at(series,i),p1=at(series,i-d),p2=at(series,i-2*d),ma=sma(series,i,cfg.regimeMaBars);
  if(!(cur?.close>0&&p1?.close>0&&p2?.close>0&&ma>0))return false;
  return cur.close>ma&&cur.close/p1.close-1>0&&p1.close/p2.close-1>0;
}
function channel(rows,endExclusive,bars,field,op){
  const start=endExclusive-bars;
  if(start<0)return null;
  const xs=rows.slice(start,endExclusive).map(x=>n(x[field])).filter(finite);
  return xs.length===bars?op(...xs):null;
}
function atr(series,i,bars){
  if(i-bars+1<1)return null;
  const xs=[];
  for(let k=i-bars+1;k<=i;k++){
    const r=series.rows[k],prev=series.rows[k-1];
    if(!(r?.high>0&&r?.low>0&&prev?.close>0))return null;
    xs.push(Math.max(r.high-r.low,Math.abs(r.high-prev.close),Math.abs(r.low-prev.close)));
  }
  return mean(xs);
}
function realizedVol(series,i,bars,annualizationBars){
  if(i-bars<0)return null;
  const rs=[];
  for(let k=i-bars+1;k<=i;k++){
    const a=series.rows[k-1]?.close,b=series.rows[k]?.close;
    if(a>0&&b>0)rs.push(Math.log(b/a));
  }
  const sd=stdev(rs);
  return sd>0?sd*Math.sqrt(annualizationBars):null;
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
    windows.push({i:i+1,from:slice[0]?.at??null,to:slice.at(-1)?.nextAt??null,...s,positive:s.totalReturnPct>0});
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
function turnover(prev,next){
  const keys=new Set([...prev.keys(),...next.keys()]);
  let x=0;
  for(const k of keys)x+=Math.abs((next.get(k)||0)-(prev.get(k)||0));
  return x;
}
export function evaluateProfitV3Gate(s,stability,assets,positivePnlConcentrationPct=concentration(assets)){
  const g=PAPERBOT_PROFIT_V3_GATE,reasons=[];
  if((s?.periods||0)<g.minPeriods)reasons.push('PERIODS_LT_'+g.minPeriods);
  if((s?.totalReturnPct||0)<=0)reasons.push('RETURN_NOT_POSITIVE');
  if((s?.profitFactor||0)<g.minProfitFactor)reasons.push('PF_LT_'+g.minProfitFactor);
  if((s?.maxDrawdownPct??Infinity)>g.maxDrawdownPct)reasons.push('DD_GT_'+g.maxDrawdownPct+'PCT');
  if((stability?.positiveWindows||0)<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);
  const positiveAssets=(assets||[]).filter(x=>x.summary?.pnl>0).length;
  if(positiveAssets<g.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+g.minPositiveAssets);
  if(positivePnlConcentrationPct>g.maxPositivePnlConcentrationPct)reasons.push('POSITIVE_PNL_CONCENTRATION_GT_'+g.maxPositivePnlConcentrationPct+'PCT');
  return{pass:reasons.length===0,reasons,positiveAssets,positivePnlConcentrationPct,autoPromotion:false,label:reasons.length?'PROFIT_V3_GATE_FAIL':'PROFIT_V3_GATE_PASS'};
}

export function runAdaptiveUpTrend6hV3(dataset,config={}){
  const cfg={...PAPERBOT_PROFIT_V3_CONFIG,...config},series=Object.fromEntries(Object.entries(dataset||{}).map(([k,v])=>[k,indexSeries(v)]).filter(([,v])=>v.rows.length));
  const master=series.BTC;
  if(!master)return empty(cfg,'BTC_REGIME_SOURCE_MISSING');
  const tradeAssets=Array.isArray(config.tradeAssets)&&config.tradeAssets.length?new Set(config.tradeAssets.map(x=>String(x).toUpperCase())):null;
  const warm=Math.max(cfg.entryBars,cfg.exitBars,cfg.regimeMaBars,cfg.regimeReturnBars*2,cfg.atrBars,cfg.volLookbackBars)+1;
  const state=new Map(),prevWeights=new Map(),periods=[];
  for(let i=warm;i+1<master.rows.length;i++){
    const atTs=master.rows[i].openTime,nextTs=master.rows[i+1].openTime,btcIdx=master.by.get(atTs),btcUp=btcIdx!=null&&persistentUp(master,btcIdx,cfg),active=[];
    for(const [symbol,ser] of Object.entries(series)){
      if(tradeAssets&&!tradeAssets.has(symbol))continue;
      const idx=ser.by.get(atTs),nextIdx=ser.by.get(nextTs);
      if(idx==null||nextIdx==null){state.delete(symbol);continue}
      const cur=at(ser,idx),future=at(ser,nextIdx),vol=realizedVol(ser,idx,cfg.volLookbackBars,cfg.annualizationBars),atrNow=atr(ser,idx,cfg.atrBars);
      if(!(cur?.close>0&&future?.close>0&&vol>0&&atrNow>0)){state.delete(symbol);continue}
      const assetUp=persistentUp(ser,idx,cfg),allowLong=btcUp&&assetUp,entryHigh=channel(ser.rows,idx,cfg.entryBars,'high',Math.max),exitLow=channel(ser.rows,idx,cfg.exitBars,'low',Math.min);
      let st=state.get(symbol)||{open:false,highestClose:null,trailingStop:null};
      if(st.open){
        st.highestClose=Math.max(n(st.highestClose)||cur.close,cur.close);
        const nextStop=st.highestClose-cfg.trailingAtrMult*atrNow;
        st.trailingStop=st.trailingStop==null?nextStop:Math.max(st.trailingStop,nextStop);
        if(!allowLong||!(exitLow>0)||cur.close<exitLow||cur.close<=st.trailingStop)st={open:false,highestClose:null,trailingStop:null};
      }
      if(!st.open&&allowLong&&entryHigh>0&&cur.close>entryHigh){
        st={open:true,highestClose:cur.close,trailingStop:cur.close-cfg.trailingAtrMult*atrNow};
      }
      state.set(symbol,st);
      if(!st.open)continue;
      const leverage=Math.min(cfg.maxLeverage,cfg.targetVolAnnual/vol),assetReturn=future.close/cur.close-1;
      active.push({symbol,signal:1,leverage,assetReturn,trailingStop:st.trailingStop,atr:atrNow,btcUp,assetUp});
    }
    const weights=new Map(active.map(x=>[x.symbol,x.leverage/Math.max(1,active.length)]));
    const turn=turnover(prevWeights,weights);
    if(!weights.size&&!prevWeights.size)continue;
    const grossReturn=active.reduce((sum,x)=>sum+(weights.get(x.symbol)||0)*x.assetReturn,0),costReturn=turn*cfg.costBps/10000,legs=[];
    for(const x of active){
      const w=weights.get(x.symbol)||0,prev=prevWeights.get(x.symbol)||0,cost=Math.abs(w-prev)*cfg.costBps/10000;
      legs.push({symbol:x.symbol,position:w,signal:1,leverage:x.leverage,grossReturn:w*x.assetReturn,costReturn:cost,netReturn:w*x.assetReturn-cost,trailingStop:x.trailingStop,atr:x.atr});
    }
    for(const [symbol,w] of prevWeights)if(!weights.has(symbol)){
      const cost=Math.abs(w)*cfg.costBps/10000;
      legs.push({symbol,position:0,signal:0,leverage:0,grossReturn:0,costReturn:cost,netReturn:-cost,exitOnly:true});
    }
    periods.push({at:atTs,nextAt:nextTs,activeAssets:active.length,turnover:turn,grossReturn,costReturn,netReturn:grossReturn-costReturn,btcRegimeUp:btcUp,legs});
    prevWeights.clear();for(const [k,v] of weights)prevWeights.set(k,v);
  }
  if(periods.length&&prevWeights.size){
    const closeCost=[...prevWeights.values()].reduce((a,x)=>a+Math.abs(x),0)*cfg.costBps/10000;
    periods.at(-1).costReturn+=closeCost;periods.at(-1).netReturn-=closeCost;
    for(const [symbol,w] of prevWeights){
      const cost=Math.abs(w)*cfg.costBps/10000;
      periods.at(-1).legs.push({symbol,position:0,signal:0,leverage:0,grossReturn:0,costReturn:cost,netReturn:-cost,exitOnly:true});
    }
  }
  const s=summary(periods.map(x=>x.netReturn),cfg.startEquity),stability=chronologicalWindows(periods,5,cfg.startEquity),assets=assetSummaries(periods,cfg.startEquity),positivePnlConcentrationPct=concentration(assets),gate=evaluateProfitV3Gate(s,stability,assets,positivePnlConcentrationPct);
  return{
    ruleset:PAPERBOT_PROFIT_AGENT_V3_RULESET,
    strategy:'ADAPTIVE_UP_TREND_6H_V3',
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false,
    config:cfg,
    summary:s,
    stability,
    assets,
    periods,
    positivePnlConcentrationPct,
    gate
  };
}
function empty(cfg,reason='NO_DATA'){
  return{
    ruleset:PAPERBOT_PROFIT_AGENT_V3_RULESET,
    strategy:'ADAPTIVE_UP_TREND_6H_V3',
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false,
    config:cfg,
    summary:summary([],cfg.startEquity),
    stability:{windows:[],positiveWindows:0},
    assets:[],
    periods:[],
    positivePnlConcentrationPct:0,
    gate:{pass:false,reasons:[reason],positiveAssets:0,positivePnlConcentrationPct:0,autoPromotion:false,label:'PROFIT_V3_GATE_FAIL'}
  };
}
