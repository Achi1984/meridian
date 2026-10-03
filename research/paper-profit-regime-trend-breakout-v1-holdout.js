import {createHash} from 'node:crypto';
import {REGIME_TREND_BREAKOUT_V1} from './paper-profit-regime-trend-breakout-v1-preregistration.js';
import {evaluateStageBGate} from './paperbot-profit-control-v2-stage-b.js';
import {
  commonRegimeTrendBreakoutTimestamps,
  freezeRegimeTrendBreakoutSplit,
  indicatorRows,
  nextRegimeTrendBreakoutDirection,
  targetWeightsFromStates,
  runRegimeTrendBreakoutV1Discovery
} from './paper-profit-regime-trend-breakout-v1-evaluator.js';

const finite=v=>Number.isFinite(Number(v));
const num=v=>Number(v);

function orderedRows(rows=[]){
  return [...new Map((rows||[]).map(r=>[Number(r.openTime),r])).values()]
    .filter(r=>[r?.openTime,r?.open,r?.high,r?.low,r?.close,r?.closeTime].every(finite))
    .map(r=>({openTime:num(r.openTime),open:num(r.open),high:num(r.high),low:num(r.low),close:num(r.close),volume:finite(r.volume)?num(r.volume):0,closeTime:num(r.closeTime)}))
    .filter(r=>r.openTime>=0&&r.closeTime>r.openTime&&r.high>=r.low&&r.open>0&&r.high>0&&r.low>0&&r.close>0)
    .sort((a,b)=>a.openTime-b.openTime);
}

function backtest(dataset={},costBps=REGIME_TREND_BREAKOUT_V1.costs.baselineBps){
  const universe=REGIME_TREND_BREAKOUT_V1.universe;
  const indicators=Object.fromEntries(universe.map(s=>[s,indicatorRows(dataset?.[s])]));
  const maps=Object.fromEntries(universe.map(s=>[s,new Map(indicators[s].map(r=>[r.openTime,r]))]));
  const common=commonRegimeTrendBreakoutTimestamps(dataset);
  const directions=Object.fromEntries(universe.map(s=>[s,0]));
  let weights=Object.fromEntries(universe.map(s=>[s,0])),equity=10000,started=false;
  const periods=[];
  let prevTs=null;

  for(const ts of common){
    const current=Object.fromEntries(universe.map(s=>[s,maps[s].get(ts)]));
    const allReady=universe.every(s=>{
      const r=current[s];
      return r&&finite(r.adx)&&finite(r.sma200)&&finite(r.realizedVolAnnual)&&finite(r.entryHigh)&&finite(r.entryLow)&&finite(r.exitHigh)&&finite(r.exitLow);
    });
    const equityBefore=equity,grossByAsset={};
    for(const s of universe){
      const now=current[s],prev=prevTs==null?null:maps[s].get(prevTs);
      const ret=prev&&prev.close>0&&now?.close>0?now.close/prev.close-1:0;
      grossByAsset[s]=equityBefore*Number(weights[s]||0)*ret;
    }
    const grossPnl=Object.values(grossByAsset).reduce((a,b)=>a+b,0),markedEquity=equityBefore+grossPnl;

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
      const turnoverNotional=Math.max(0,markedEquity)*turnoverWeight,cost=turnoverNotional*Number(costBps)/10000;
      const legs=universe.map(s=>{
        const costShare=turnoverWeight>0?cost*deltas[s]/turnoverWeight:0;
        const netPnl=(grossByAsset[s]||0)-costShare;
        return{symbol:s,netPnl,netReturn:equityBefore>0?netPnl/equityBefore:0,grossPnl:grossByAsset[s]||0,cost:costShare,weightBefore:Number(weights[s]||0),weightAfter:Number(nextWeights[s]||0)};
      });
      equity=markedEquity-cost;
      periods.push({
        at:ts,netPnl:equity-equityBefore,netReturn:equityBefore>0?equity/equityBefore-1:0,
        grossPnl,cost,turnoverNotional,turnoverWeight,
        grossExposure:Object.values(nextWeights).reduce((a,b)=>a+Math.abs(b),0),
        activeMarkets:Object.values(nextWeights).filter(x=>Math.abs(x)>0).length,
        legs
      });
      weights=nextWeights;
    }
    prevTs=ts;
  }
  return{costBps:Number(costBps),periods,researchOnly:true,executionImpact:false,autoPromotion:false};
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
  const assets=[...assetMap.values()],pos=assets.filter(x=>x.pnl>0),positiveTotal=pos.reduce((a,x)=>a+x.pnl,0);
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

function almostEqual(a,b,tol=1e-10){
  const x=Number(a),y=Number(b);
  if(!Number.isFinite(x)||!Number.isFinite(y))return false;
  return Math.abs(x-y)<=tol*Math.max(1,Math.abs(x),Math.abs(y));
}

export function verifyFrozenDiscoveryParity(dataset={},frozenResult={}){
  const expected=frozenResult?.result||frozenResult;
  if(expected?.decision!=='REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED')return{ok:false,reason:'FROZEN_DISCOVERY_NOT_PASS'};
  if(expected?.holdout!==null)return{ok:false,reason:'FROZEN_HOLDOUT_NOT_NULL'};
  const now=runRegimeTrendBreakoutV1Discovery(dataset);
  if(now?.decision!=='REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED'||now?.holdout!==null)return{ok:false,reason:'DISCOVERY_REPLAY_NOT_PASS'};
  const es=expected.split||{},ns=now.split||{};
  for(const key of ['totalTimestamps','discoveryCount','holdoutCount','discoveryFrom','discoveryTo','holdoutFrom','holdoutTo','splitTimestamp']){
    if(Number(es[key])!==Number(ns[key]))return{ok:false,reason:'SPLIT_MISMATCH_'+key};
  }
  const ed=expected.discovery||{},nd=now.discovery||{};
  for(const key of ['periods','positiveWindows','positiveAssets']){
    if(Number(ed[key])!==Number(nd[key]))return{ok:false,reason:'DISCOVERY_MISMATCH_'+key};
  }
  for(const key of ['totalReturnPct','pnl','profitFactor','maxDrawdownPct','positivePnlConcentrationPct','stress16BpsReturnPct','turnoverNotional','maxGrossExposure']){
    if(!almostEqual(ed[key],nd[key]))return{ok:false,reason:'DISCOVERY_MISMATCH_'+key,expected:ed[key],actual:nd[key]};
  }
  if(nd?.gate?.pass!==true)return{ok:false,reason:'DISCOVERY_GATE_NOT_PASS'};
  return{ok:true,split:ns,discovery:nd};
}

export function runRegimeTrendBreakoutV1Holdout(dataset={},frozenResult={}){
  const parity=verifyFrozenDiscoveryParity(dataset,frozenResult);
  if(!parity.ok)return{ruleset:REGIME_TREND_BREAKOUT_V1.ruleset,decision:'HOLDOUT_BLOCKED_DISCOVERY_PARITY_FAIL',parity,holdout:null,researchOnly:true,executionImpact:false,autoPromotion:false};

  const base=backtest(dataset,REGIME_TREND_BREAKOUT_V1.costs.baselineBps);
  const stress=backtest(dataset,REGIME_TREND_BREAKOUT_V1.costs.stressBps);
  const h=view(base,{start:parity.split.holdoutFrom,end:parity.split.holdoutTo});
  const hs=view(stress,{start:parity.split.holdoutFrom,end:parity.split.holdoutTo});
  const gate=evaluateStageBGate({
    evaluationPeriods:h.summary.periods,
    netCompoundedReturnPct:h.summary.totalReturnPct,
    profitFactor:h.summary.profitFactor,
    maxDrawdownPct:h.summary.maxDrawdownPct,
    positiveWindows:h.stability.positiveWindows,
    positiveAssets:h.positiveAssets,
    positivePnlConcentrationPct:h.positivePnlConcentrationPct,
    stressNetCompoundedReturnPct:hs.summary.totalReturnPct,
    provenanceOk:true,
    holdoutUntouched:true
  });
  return{
    ruleset:REGIME_TREND_BREAKOUT_V1.ruleset,
    discoveryParity:true,
    split:parity.split,
    discovery:parity.discovery,
    holdout:concise(h,hs,gate),
    decision:gate.pass?'REGIME_TREND_BREAKOUT_V1_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED':'REGIME_TREND_BREAKOUT_V1_HOLDOUT_FAIL',
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false
  };
}

export function sha256Buffer(buffer){return createHash('sha256').update(buffer).digest('hex')}
