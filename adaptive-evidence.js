// ACHI MERIDIAN Adaptive Evidence Lab — v7.74
// Research-only. No Paper/live execution integration.
// Evidence is learned from normalized-R cohorts and applied as soft context, never as a fixed LONG/SHORT/regime bonus.

export const ADAPTIVE_EVIDENCE_VERSION='7.74-ADAPTIVE-EVIDENCE-V1';

export const ADAPTIVE_EVIDENCE_OPTIONS=Object.freeze({
  shrinkageSamples:48,
  minReliableSamples:24,
  minStableWindows:2,
  tradeEdgeR:0.12,
  cautionEdgeR:0.02,
  skipEdgeR:-0.08,
  maxAbsEdgeR:1.5
});

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=(v,fallback=null)=>Number.isFinite(Number(v))?Number(v):fallback;
const upper=v=>String(v??'UNKNOWN').toUpperCase();

function sideAligned(frame,side){
  if(!frame)return false;
  const price=num(frame.price),e20=num(frame.ema20),e50=num(frame.ema50),hist=num(frame.macd?.hist);
  if(price==null||e20==null||e50==null)return false;
  const long=side==='LONG';
  const emaOk=long?(price>=e20&&e20>=e50):(price<=e20&&e20<=e50);
  const macdOk=hist==null?true:(long?hist>=0:hist<=0);
  return emaOk&&macdOk;
}

function momentumBucket(frame,side){
  if(!frame)return'UNKNOWN';
  const r=num(frame.rsi),hist=num(frame.macd?.hist);
  if(r==null&&hist==null)return'UNKNOWN';
  const long=side==='LONG';
  const rStrong=r==null?false:(long?r>=55&&r<=75:r<=45&&r>=25);
  const rWeak=r==null?false:(long?r<45||r>80:r>55||r<20);
  const mStrong=hist==null?false:(long?hist>0:hist<0);
  if(rStrong&&mStrong)return'STRONG';
  if(rWeak||(hist!=null&&!mStrong))return'WEAK';
  return'NEUTRAL';
}

function volumeBucket(frame){
  const r=num(frame?.volumeRatio);
  if(r==null)return'UNKNOWN';
  if(r>=1.35)return'HIGH';
  if(r<0.75)return'LOW';
  return'NORMAL';
}

function volatilityBucket(frame){
  const price=num(frame?.price),atr=num(frame?.atr);
  if(!(price>0)||!(atr>=0))return'UNKNOWN';
  const pct=atr/price;
  if(pct>=0.03)return'EXPANSION';
  if(pct<=0.008)return'COMPRESSION';
  return'NORMAL';
}

export function observationsFromSignal(signal={}){
  const side=upper(signal.side)==='SHORT'?'SHORT':'LONG';
  const regime=upper(signal.regime);
  const frames=signal.frames||{};
  const aligned=['15m','1h','4h'].filter(tf=>sideAligned(frames[tf],side)).length;
  return{
    side,
    regime,
    mtfAlignment:String(aligned),
    momentum:momentumBucket(frames['15m'],side),
    volume:volumeBucket(frames['15m']),
    volatility:volatilityBucket(frames['15m']),
    asset:upper(signal.symbol||signal.asset),
    baselineStatus:upper(signal.status)
  };
}

function stableWindows(stats){
  const w=Array.isArray(stats?.windows)?stats.windows:[];
  const vals=w.map(x=>num(typeof x==='object'?x.avgR:x)).filter(x=>x!=null);
  if(!vals.length)return{count:0,agreement:0};
  const positive=vals.filter(x=>x>0).length,negative=vals.filter(x=>x<0).length;
  return{count:vals.length,agreement:Math.max(positive,negative)/vals.length};
}

export function cohortEvidence(stats={},options=ADAPTIVE_EVIDENCE_OPTIONS){
  const n=Math.max(0,num(stats.n,0));
  const avgR=num(stats.avgR,0);
  const shrink=n/(n+Math.max(1,options.shrinkageSamples));
  const windows=stableWindows(stats);
  const sampleReliability=clamp(n/Math.max(1,options.minReliableSamples),0,1);
  const windowReliability=windows.count>=options.minStableWindows?windows.agreement:0.5;
  const reliability=clamp(sampleReliability*windowReliability,0,1);
  const edgeR=clamp(avgR*shrink*reliability,-options.maxAbsEdgeR,options.maxAbsEdgeR);
  return{n,avgR,edgeR,reliability,windowCount:windows.count,windowAgreement:windows.agreement};
}

const dimensionKeys=obs=>({
  side:obs.side,
  regime:`${obs.side}|${obs.regime}`,
  mtfAlignment:`${obs.side}|${obs.mtfAlignment}`,
  momentum:`${obs.side}|${obs.momentum}`,
  volume:`${obs.side}|${obs.volume}`,
  volatility:`${obs.side}|${obs.volatility}`,
  asset:`${obs.asset}|${obs.side}`,
  baselineStatus:`${obs.side}|${obs.baselineStatus}`
});

export function evaluateAdaptiveEvidence(signal,evidenceMap={},options=ADAPTIVE_EVIDENCE_OPTIONS){
  const obs=observationsFromSignal(signal);
  const keys=dimensionKeys(obs);
  const components=[];
  for(const [dimension,key] of Object.entries(keys)){
    const stats=evidenceMap?.[dimension]?.[key];
    if(!stats)continue;
    const e=cohortEvidence(stats,options);
    if(e.n<=0)continue;
    components.push({dimension,key,...e});
  }
  const weightSum=components.reduce((a,x)=>a+x.reliability,0);
  const edgeR=weightSum>0?components.reduce((a,x)=>a+x.edgeR*x.reliability,0)/weightSum:0;
  const reliability=components.length?components.reduce((a,x)=>a+x.reliability,0)/components.length:0;
  const confidence=Math.round(clamp(50+edgeR*30,0,100));
  let decision='OBSERVE';
  if(weightSum>0){
    if(edgeR>=options.tradeEdgeR)decision='TRADE';
    else if(edgeR>=options.cautionEdgeR)decision='CAUTION';
    else if(edgeR<=options.skipEdgeR)decision='SKIP';
    else decision='NEUTRAL';
  }
  return{
    version:ADAPTIVE_EVIDENCE_VERSION,
    researchOnly:true,
    observations:obs,
    edgeR:Number(edgeR.toFixed(4)),
    confidence,
    reliability:Number(reliability.toFixed(4)),
    decision,
    components
  };
}

export function summarizeMarketCapture(rows=[]){
  const valid=rows.filter(Boolean);
  let traded=0,skipped=0,realizedR=0,counterfactualTradedR=0,missedWinnerR=0,avoidedLoserR=0,positiveOpportunityR=0,capturedPositiveR=0;
  for(const row of valid){
    const took=Boolean(row.traded),cf=num(row.counterfactualR,0),rr=num(row.realizedR,0);
    if(cf>0)positiveOpportunityR+=cf;
    if(took){
      traded++;
      realizedR+=rr;
      counterfactualTradedR+=cf;
      if(cf>0)capturedPositiveR+=Math.max(0,Math.min(cf,rr));
    }else{
      skipped++;
      if(cf>0)missedWinnerR+=cf;
      if(cf<0)avoidedLoserR+=Math.abs(cf);
    }
  }
  const total=traded+skipped;
  const skippedNetR=missedWinnerR-avoidedLoserR;
  return{
    opportunities:total,
    traded,
    skipped,
    coveragePct:total?Number((traded/total*100).toFixed(2)):0,
    realizedR:Number(realizedR.toFixed(4)),
    counterfactualTradedR:Number(counterfactualTradedR.toFixed(4)),
    positiveOpportunityR:Number(positiveOpportunityR.toFixed(4)),
    capturedPositiveR:Number(capturedPositiveR.toFixed(4)),
    marketCapturePct:positiveOpportunityR?Number((capturedPositiveR/positiveOpportunityR*100).toFixed(2)):0,
    missedWinnerR:Number(missedWinnerR.toFixed(4)),
    avoidedLoserR:Number(avoidedLoserR.toFixed(4)),
    opportunityCostR:Number(skippedNetR.toFixed(4))
  };
}
