// MERIDIAN TREND PULLBACK V1 — research-only, frozen hypothesis.
// Independent of Baseline READY and all production/Paper execution paths.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;

export const TREND_PULLBACK_V1_RULESET='8.0-RESEARCH-TREND-PULLBACK-V1';
export const TREND_PULLBACK_V1_CONFIG=Object.freeze({
  riskPct:.5,
  minAdx4h:20,
  minAdx1h:18,
  maxPullbackAtr:.65,
  minVolumeRatio:.7,
  stopAtr:1.5,
  targetR:2
});

function frame(signal,key){return signal?.frames?.[key]||{};}
function alignedSide(h4,h1){
  const up=num(h4.ema20)>num(h4.ema50)&&num(h1.ema20)>num(h1.ema50);
  const down=num(h4.ema20)<num(h4.ema50)&&num(h1.ema20)<num(h1.ema50);
  return up?'LONG':down?'SHORT':null;
}

export function trendPullbackDecision(signal,overrides={}){
  const cfg={...TREND_PULLBACK_V1_CONFIG,...overrides};
  const m15=frame(signal,'15m'),h1=frame(signal,'1h'),h4=frame(signal,'4h');
  const side=alignedSide(h4,h1),entry=num(m15.price,num(signal?.entry,NaN)),atr=num(m15.atr,NaN);
  const distanceAtr=Number.isFinite(entry)&&Number.isFinite(atr)&&atr>0?Math.abs(entry-num(m15.ema20,entry))/atr:Infinity;
  const hist=num(h1?.macd?.hist??h1?.macdHist,0),rsi=num(m15.rsi,50),volumeRatio=num(m15.volumeRatio,1);
  const reasons=[];
  if(!side)reasons.push('HTF_TREND_NOT_ALIGNED');
  if(num(h4.adx)<cfg.minAdx4h||num(h1.adx)<cfg.minAdx1h)reasons.push('TREND_STRENGTH_LOW');
  if(distanceAtr>cfg.maxPullbackAtr)reasons.push('OUTSIDE_PULLBACK_ZONE');
  if(volumeRatio<cfg.minVolumeRatio)reasons.push('VOLUME_TOO_LOW');
  if(side==='LONG'&&!(entry>=num(m15.ema50,Infinity)&&rsi>=45&&rsi<=68&&hist>0))reasons.push('LONG_RESUMPTION_UNCONFIRMED');
  if(side==='SHORT'&&!(entry<=num(m15.ema50,-Infinity)&&rsi>=32&&rsi<=55&&hist<0))reasons.push('SHORT_RESUMPTION_UNCONFIRMED');
  if(!Number.isFinite(entry)||!Number.isFinite(atr)||!(atr>0))reasons.push('INVALID_GEOMETRY');
  const stopDistance=Number.isFinite(atr)?atr*cfg.stopAtr:0;
  const sl=side==='SHORT'?entry+stopDistance:entry-stopDistance;
  const tp1=side==='SHORT'?entry-stopDistance*cfg.targetR:entry+stopDistance*cfg.targetR;
  return{
    symbol:String(signal?.symbol||'').toUpperCase(),side,decision:reasons.length?'SKIP':'TRADE',riskPct:reasons.length?0:cfg.riskPct,
    entry,sl,tp1,tp2:tp1,distanceAtr:clamp(distanceAtr,0,999),technical:signal?.technical??null,candidate:signal?.candidate??null,
    regime:side==='LONG'?'TREND_UP':side==='SHORT'?'TREND_DOWN':'UNALIGNED',reasons,
    researchOnly:true,executionImpact:false,baselineGateIndependent:true,ruleset:TREND_PULLBACK_V1_RULESET
  };
}
