import {REGIME_TREND_BREAKOUT_V1} from './paper-profit-regime-trend-breakout-v1-preregistration.js';
import {evaluateStageBGate} from './paperbot-profit-control-v2-stage-b.js';

const DAY_MS=86400000;
const finite=v=>Number.isFinite(Number(v));
const num=v=>Number(v);
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;

function orderedRows(rows=[]){
  const out=[...new Map((rows||[]).map(r=>[Number(r.openTime),r])).values()]
    .filter(r=>[r?.openTime,r?.open,r?.high,r?.low,r?.close,r?.closeTime].every(finite))
    .map(r=>({openTime:num(r.openTime),open:num(r.open),high:num(r.high),low:num(r.low),close:num(r.close),volume:finite(r.volume)?num(r.volume):0,closeTime:num(r.closeTime)}))
    .filter(r=>r.openTime>=0&&r.closeTime>r.openTime&&r.high>=r.low&&r.open>0&&r.high>0&&r.low>0&&r.close>0)
    .sort((a,b)=>a.openTime-b.openTime);
  return out;
}

export function commonRegimeTrendBreakoutTimestamps(dataset={}){
  const sets=REGIME_TREND_BREAKOUT_V1.universe.map(symbol=>new Set(orderedRows(dataset?.[symbol]).map(r=>r.openTime)));
  if(!sets.length)return[];
  return [...sets[0]].filter(ts=>sets.every(s=>s.has(ts))).sort((a,b)=>a-b);
}

export function freezeRegimeTrendBreakoutSplit(commonTimestamps=[]){
  const xs=[...new Set((commonTimestamps||[]).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(xs.length<2)return Object.freeze({ok:false,reason:'INSUFFICIENT_TIMESTAMPS'});
  const cut=Math.max(1,Math.min(xs.length-1,Math.floor(xs.length*REGIME_TREND_BREAKOUT_V1.split.discoveryFraction)));
  return Object.freeze({
    ok:true,
    method:REGIME_TREND_BREAKOUT_V1.split.method,
    totalTimestamps:xs.length,
    discoveryCount:cut,
    holdoutCount:xs.length-cut,
    discoveryFrom:xs[0],
    discoveryTo:xs[cut-1],
    holdoutFrom:xs[cut],
    holdoutTo:xs.at(-1),
    splitTimestamp:xs[cut]
  });
}

export function wilderAdx(rows=[],period=REGIME_TREND_BREAKOUT_V1.regime.adxPeriod){
  const xs=orderedRows(rows),n=xs.length,out=Array(n).fill(null);
  if(n<period*2)return out;
  const tr=Array(n).fill(0),plus=Array(n).fill(0),minus=Array(n).fill(0),dx=Array(n).fill(null);
  for(let i=1;i<n;i++){
    const up=xs[i].high-xs[i-1].high,down=xs[i-1].low-xs[i].low;
    tr[i]=Math.max(xs[i].high-xs[i].low,Math.abs(xs[i].high-xs[i-1].close),Math.abs(xs[i].low-xs[i-1].close));
    plus[i]=up>down&&up>0?up:0;
    minus[i]=down>up&&down>0?down:0;
  }
  let trSm=0,pSm=0,mSm=0;
  for(let i=1;i<=period;i++){trSm+=tr[i];pSm+=plus[i];mSm+=minus[i]}
  for(let i=period;i<n;i++){
    if(i>period){
      trSm=trSm-trSm/period+tr[i];
      pSm=pSm-pSm/period+plus[i];
      mSm=mSm-mSm/period+minus[i];
    }
    if(trSm<=0){dx[i]=0;continue}
    const pdi=100*pSm/trSm,mdi=100*mSm/trSm,den=pdi+mdi;
    dx[i]=den>0?100*Math.abs(pdi-mdi)/den:0;
  }
  const first=period*2-1;
  const seed=dx.slice(period,first+1).filter(finite);
  if(seed.length!==period)return out;
  out[first]=mean(seed);
  for(let i=first+1;i<n;i++)out[i]=((out[i-1]*(period-1))+(finite(dx[i])?dx[i]:0))/period;
  return out;
}

function smaAt(xs,i,period){
  if(i<period-1)return null;
  let s=0;for(let j=i-period+1;j<=i;j++)s+=xs[j].close;
  return s/period;
}
function realizedVolAt(xs,i,lookback){
  if(i<lookback)return null;
  const rs=[];
  for(let j=i-lookback+1;j<=i;j++){
    const a=xs[j-1]?.close,b=xs[j]?.close;
    if(!(a>0&&b>0))return null;
    rs.push(Math.log(b/a));
  }
  const m=mean(rs),variance=mean(rs.map(x=>(x-m)**2));
  return Math.sqrt(Math.max(0,variance))*Math.sqrt(365);
}
function channel(xs,i,period,field,mode){
  if(i<period)return null;
  const vals=[];for(let j=i-period;j<i;j++)vals.push(xs[j][field]);
  return mode==='max'?Math.max(...vals):Math.min(...vals);
}

export function indicatorRows(rows=[]){
  const xs=orderedRows(rows),adx=wilderAdx(xs);
  return xs.map((r,i)=>({
    ...r,
    adx:adx[i],
    sma200:smaAt(xs,i,REGIME_TREND_BREAKOUT_V1.regime.smaPeriod),
    realizedVolAnnual:realizedVolAt(xs,i,REGIME_TREND_BREAKOUT_V1.sizing.realizedVolDays),
    entryHigh:channel(xs,i,REGIME_TREND_BREAKOUT_V1.breakout.entryChannelDays,'high','max'),
    entryLow:channel(xs,i,REGIME_TREND_BREAKOUT_V1.breakout.entryChannelDays,'low','min'),
    exitHigh:channel(xs,i,REGIME_TREND_BREAKOUT_V1.breakout.exitChannelDays,'high','max'),
    exitLow:channel(xs,i,REGIME_TREND_BREAKOUT_V1.breakout.exitChannelDays,'low','min')
  }));
}

export function nextRegimeTrendBreakoutDirection(previous=0,row={}){
  const adx=Number(row?.adx),close=Number(row?.close),sma=Number(row?.sma200);
  const longEligible=Number.isFinite(adx)&&adx>=REGIME_TREND_BREAKOUT_V1.regime.minAdx&&Number.isFinite(close)&&Number.isFinite(sma)&&close>sma;
  const shortEligible=Number.isFinite(adx)&&adx>=REGIME_TREND_BREAKOUT_V1.regime.minAdx&&Number.isFinite(close)&&Number.isFinite(sma)&&close<sma;
  if(previous===1)return(!longEligible||!(Number(row?.exitLow)>0)||close<Number(row.exitLow))?0:1;
  if(previous===-1)return(!shortEligible||!(Number(row?.exitHigh)>0)||close>Number(row.exitHigh))?0:-1;
  if(longEligible&&Number(row?.entryHigh)>0&&close>Number(row.entryHigh))return 1;
  if(shortEligible&&Number(row?.entryLow)>0&&close<Number(row.entryLow))return -1;
  return 0;
}

export function targetWeightsFromStates(states={}){
  const active=Object.entries(states).filter(([,x])=>Math.abs(Number(x?.direction))===1&&Number(x?.realizedVolAnnual)>0);
  if(!active.length)return Object.fromEntries(Object.keys(states).map(k=>[k,0]));
  const n=active.length,target=REGIME_TREND_BREAKOUT_V1.sizing.targetVolAnnual,maxLev=REGIME_TREND_BREAKOUT_V1.sizing.maxLeverage;
  const out=Object.fromEntries(Object.keys(states).map(k=>[k,0]));
  for(const [symbol,x] of active){
    const scale=Math.min(maxLev,target/Number(x.realizedVolAnnual));
    out[symbol]=Number(x.direction)*scale/n;
  }
  return out;
}

function backtest(dataset={},costBps=REGIME_TREND_BREAKOUT_V1.costs.baselineBps){
  const universe=REGIME_TREND_BREAKOUT_V1.universe;
  const indicators=Object.fromEntries(universe.map(s=>[s,indicatorRows(dataset?.[s])]));
  const maps=Object.fromEntries(universe.map(s=>[s,new Map(indicators[s].map(r=>[r.openTime,r]))]));
  const common=commonRegimeTrendBreakoutTimestamps(dataset);
  const directions=Object.fromEntries(universe.map(s=>[s,0]));
  let weights=Object.fromEntries(universe.map(s=>[s,0])),equity=10000,peak=10000,maxDD=0,started=false;
  const periods=[];
  let prevTs=null;

  for(const ts of common){
    const current=Object.fromEntries(universe.map(s=>[s,maps[s].get(ts)]));
    const allReady=universe.every(s=>{
      const r=current[s];
      return r&&finite(r.adx)&&finite(r.sma200)&&finite(r.realizedVolAnnual)&&finite(r.entryHigh)&&finite(r.entryLow)&&finite(r.exitHigh)&&finite(r.exitLow);
    });
    const equityBefore=equity;
    const grossByAsset={};
    for(const s of universe){
      const now=current[s],prev=prevTs==null?null:maps[s].get(prevTs);
      const ret=prev&&prev.close>0&&now?.close>0?now.close/prev.close-1:0;
      grossByAsset[s]=equityBefore*Number(weights[s]||0)*ret;
    }
    const grossPnl=Object.values(grossByAsset).reduce((a,b)=>a+b,0);
    const markedEquity=equityBefore+grossPnl;

    if(allReady)started=true;
    if(started&&allReady){
      const stateForWeights={};
      for(const s of universe){
        directions[s]=nextRegimeTrendBreakoutDirection(directions[s],current[s]);
        stateForWeights[s]={direction:directions[s],realizedVolAnnual:current[s].realizedVolAnnual};
      }
      const nextWeights=targetWeightsFromStates(stateForWeights);
      const deltas=Object.fromEntries(universe.map(s=>[s,Math.abs(Number(nextWeights[s]||0)-Number(weights[s]||0))]));
      const turnoverWeight=Object.values(deltas).reduce((a,b)=>a+b,0);
      const turnoverNotional=Math.max(0,markedEquity)*turnoverWeight;
      const cost=turnoverNotional*Number(costBps)/10000;
      const legs=universe.map(s=>{
        const costShare=turnoverWeight>0?cost*deltas[s]/turnoverWeight:0;
        const netPnl=(grossByAsset[s]||0)-costShare;
        return{symbol:s,netPnl,netReturn:equityBefore>0?netPnl/equityBefore:0,grossPnl:grossByAsset[s]||0,cost:costShare,weightBefore:Number(weights[s]||0),weightAfter:Number(nextWeights[s]||0)};
      });
      equity=markedEquity-cost;
      peak=Math.max(peak,equity);
      if(peak>0)maxDD=Math.max(maxDD,(peak-equity)/peak*100);
      periods.push({
        at:ts,
        netPnl:equity-equityBefore,
        netReturn:equityBefore>0?equity/equityBefore-1:0,
        grossPnl,cost,turnoverNotional,turnoverWeight,
        grossExposure:Object.values(nextWeights).reduce((a,b)=>a+Math.abs(b),0),
        activeMarkets:Object.values(nextWeights).filter(x=>Math.abs(x)>0).length,
        legs
      });
      weights=nextWeights;
    }
    prevTs=ts;
  }
  return{ruleset:REGIME_TREND_BREAKOUT_V1.ruleset,costBps:Number(costBps),startEquity:10000,endEquity:equity,maxDrawdownPct:maxDD,periods,commonTimestamps:common,researchOnly:true,executionImpact:false,autoPromotion:false};
}

function view(backtestResult,{start=null,end=null}={}){
  const xs=(backtestResult?.periods||[]).filter(p=>(start==null||p.at>=start)&&(end==null||p.at<=end));
  let eq=10000,peak=10000,maxDD=0;
  const pnls=[];
  for(const p of xs){eq*=1+Number(p.netReturn||0);peak=Math.max(peak,eq);if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak*100);pnls.push(Number(p.netPnl||0))}
  const wins=pnls.filter(x=>x>0).reduce((a,b)=>a+b,0),loss=Math.abs(pnls.filter(x=>x<0).reduce((a,b)=>a+b,0));
  const profitFactor=loss>0?wins/loss:(wins>0?99:0);
  const windows=[];
  for(let i=0;i<5;i++){
    const a=Math.floor(xs.length*i/5),b=Math.floor(xs.length*(i+1)/5),slice=xs.slice(a,b);
    let wEq=1;for(const p of slice)wEq*=1+Number(p.netReturn||0);
    windows.push({i:i+1,from:slice[0]?.at??null,to:slice.at(-1)?.at??null,totalReturnPct:(wEq-1)*100,positive:wEq>1});
  }
  const assetMap=new Map(REGIME_TREND_BREAKOUT_V1.universe.map(s=>[s,{symbol:s,pnl:0,periods:0}]));
  for(const p of xs)for(const leg of p.legs||[]){const x=assetMap.get(leg.symbol);if(x){x.pnl+=Number(leg.netPnl||0);x.periods++}}
  const assets=[...assetMap.values()];
  const pos=assets.filter(x=>x.pnl>0),positiveTotal=pos.reduce((a,x)=>a+x.pnl,0);
  const concentration=positiveTotal>0?Math.max(...pos.map(x=>x.pnl/positiveTotal*100)):0;
  return{
    periods:xs,
    summary:{periods:xs.length,totalReturnPct:(eq/10000-1)*100,pnl:eq-10000,profitFactor,maxDrawdownPct:maxDD},
    stability:{windows,positiveWindows:windows.filter(x=>x.positive).length},
    assets,
    positiveAssets:assets.filter(x=>x.pnl>0).length,
    positivePnlConcentrationPct:concentration
  };
}

function gateView(baseView,stressView,{holdoutUntouched=true}={}){
  return evaluateStageBGate({
    evaluationPeriods:baseView.summary.periods,
    netCompoundedReturnPct:baseView.summary.totalReturnPct,
    profitFactor:baseView.summary.profitFactor,
    maxDrawdownPct:baseView.summary.maxDrawdownPct,
    positiveWindows:baseView.stability.positiveWindows,
    positiveAssets:baseView.positiveAssets,
    positivePnlConcentrationPct:baseView.positivePnlConcentrationPct,
    stressNetCompoundedReturnPct:stressView.summary.totalReturnPct,
    provenanceOk:true,
    holdoutUntouched
  });
}
function concise(baseView,stressView,gate){
  return{
    periods:baseView.summary.periods,
    totalReturnPct:baseView.summary.totalReturnPct,
    pnl:baseView.summary.pnl,
    profitFactor:baseView.summary.profitFactor,
    maxDrawdownPct:baseView.summary.maxDrawdownPct,
    positiveWindows:baseView.stability.positiveWindows,
    positiveAssets:baseView.positiveAssets,
    positivePnlConcentrationPct:baseView.positivePnlConcentrationPct,
    stress16BpsReturnPct:stressView.summary.totalReturnPct,
    turnoverNotional:baseView.periods.reduce((a,p)=>a+Number(p.turnoverNotional||0),0),
    maxGrossExposure:Math.max(0,...baseView.periods.map(p=>Number(p.grossExposure||0))),
    gate
  };
}

export function runRegimeTrendBreakoutV1Discovery(dataset={}){
  const common=commonRegimeTrendBreakoutTimestamps(dataset),split=freezeRegimeTrendBreakoutSplit(common);
  if(!split.ok)return{ruleset:REGIME_TREND_BREAKOUT_V1.ruleset,split,decision:'INSUFFICIENT_SPLIT_SAMPLE',discovery:null,holdout:null,researchOnly:true,executionImpact:false,autoPromotion:false};

  const discoveryData=Object.fromEntries(REGIME_TREND_BREAKOUT_V1.universe.map(s=>[s,orderedRows(dataset?.[s]).filter(r=>r.openTime<=split.discoveryTo)]));
  const baseline=backtest(discoveryData,REGIME_TREND_BREAKOUT_V1.costs.baselineBps);
  const stress=backtest(discoveryData,REGIME_TREND_BREAKOUT_V1.costs.stressBps);
  const d=view(baseline),ds=view(stress);
  if(d.summary.periods<REGIME_TREND_BREAKOUT_V1.gate.minEvaluationPeriods||split.holdoutCount<2){
    return{ruleset:REGIME_TREND_BREAKOUT_V1.ruleset,split,discovery:concise(d,ds,{pass:false,label:'STAGE_B_GATE_FAIL',reasons:['INSUFFICIENT_SPLIT_SAMPLE'],researchOnly:true,executionImpact:false,autoPromotion:false}),holdout:null,decision:'INSUFFICIENT_SPLIT_SAMPLE',researchOnly:true,executionImpact:false,autoPromotion:false};
  }
  const discoveryGate=gateView(d,ds,{holdoutUntouched:true}),discovery=concise(d,ds,discoveryGate);
  if(!discoveryGate.pass)return{ruleset:REGIME_TREND_BREAKOUT_V1.ruleset,split,discovery,holdout:null,decision:'REGIME_TREND_BREAKOUT_V1_DISCOVERY_FAIL',researchOnly:true,executionImpact:false,autoPromotion:false};

  return{
    ruleset:REGIME_TREND_BREAKOUT_V1.ruleset,
    split,
    discovery,
    holdout:null,
    decision:'REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED',
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false
  };
}
