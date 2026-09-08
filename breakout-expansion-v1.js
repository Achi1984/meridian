// MERIDIAN v7.85 — Breakout / Expansion Bot V1
// Research-only signal engine. No Paper/live execution impact.

export const BREAKOUT_EXPANSION_VERSION='7.85-BREAKOUT-EXPANSION-V1';

export const BREAKOUT_EXPANSION_CONFIG=Object.freeze({
  structureLookback:20,
  atrFastPeriod:5,
  atrSlowPeriod:20,
  compressionReference:.78,
  breakoutBufferAtr:.08,
  expansionReference:1.20,
  volumeReference:1.25,
  minBodyFraction:.48,
  tradeScore:72,
  observeScore:60,
  stopAtrMult:1.20,
  tp1R:1.50,
  tp2R:2.50,
  fullRiskPct:1.00,
  reducedRiskPct:.50,
  exploratoryRiskPct:.25
});

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const last=a=>a[a.length-1];

function ema(values,period){
  if(!Array.isArray(values)||!values.length)return[];
  const k=2/(period+1),out=[Number(values[0])];
  for(let i=1;i<values.length;i++)out.push(Number(values[i])*k+out[i-1]*(1-k));
  return out;
}

export function trueRanges(candles=[]){
  const out=[];
  for(let i=1;i<candles.length;i++){
    const c=candles[i],p=candles[i-1];
    out.push(Math.max(
      Number(c.high)-Number(c.low),
      Math.abs(Number(c.high)-Number(p.close)),
      Math.abs(Number(c.low)-Number(p.close))
    ));
  }
  return out.filter(Number.isFinite);
}

export function atr(candles=[],period=14){
  const tr=trueRanges(candles);
  if(tr.length<period)return null;
  let a=tr.slice(0,period).reduce((x,y)=>x+y,0)/period;
  for(let i=period;i<tr.length;i++)a=(a*(period-1)+tr[i])/period;
  return a;
}

function volumeRatio(candles=[],period=20){
  if(candles.length<period+1)return 1;
  const cur=Number(last(candles)?.volume)||0;
  const base=candles.slice(-(period+1),-1).reduce((s,c)=>s+(Number(c.volume)||0),0)/period;
  return base>0?cur/base:1;
}

function structure(candles=[],lookback=20){
  if(candles.length<lookback+1)return null;
  const prior=candles.slice(-(lookback+1),-1);
  return{
    high:Math.max(...prior.map(c=>Number(c.high))),
    low:Math.min(...prior.map(c=>Number(c.low)))
  };
}

function trendAlignment(candles=[],side){
  if(candles.length<55)return 50;
  const closes=candles.map(c=>Number(c.close));
  const e20=last(ema(closes,20)),e50=last(ema(closes,50)),price=last(closes);
  const long=side==='LONG';
  let score=50;
  if(Number.isFinite(e20)&&Number.isFinite(e50))score+=(long?e20>e50:e20<e50)?25:-25;
  if(Number.isFinite(price)&&Number.isFinite(e20))score+=(long?price>e20:price<e20)?25:-25;
  return clamp(score,0,100);
}

export function breakoutFeatures(candles15m=[],candles1h=[],cfg=BREAKOUT_EXPANSION_CONFIG){
  const need=Math.max(cfg.structureLookback+2,cfg.atrSlowPeriod+2);
  if(!Array.isArray(candles15m)||candles15m.length<need)return{ready:false,reason:'INSUFFICIENT_15M_HISTORY'};
  const c=last(candles15m),s=structure(candles15m,cfg.structureLookback);
  const atrFast=atr(candles15m,cfg.atrFastPeriod),atrSlow=atr(candles15m,cfg.atrSlowPeriod);
  if(!(atrFast>0)||!(atrSlow>0)||!s)return{ready:false,reason:'INVALID_ATR_OR_STRUCTURE'};

  const close=Number(c.close),open=Number(c.open),high=Number(c.high),low=Number(c.low);
  const buffer=atrSlow*cfg.breakoutBufferAtr;
  const longBreak=close>s.high+buffer;
  const shortBreak=close<s.low-buffer;
  const side=longBreak&&!shortBreak?'LONG':shortBreak&&!longBreak?'SHORT':'NONE';
  const tr=Math.max(high-low,Math.abs(high-Number(candles15m.at(-2).close)),Math.abs(low-Number(candles15m.at(-2).close)));
  const body=Math.abs(close-open),range=Math.max(high-low,1e-12);
  const compressionRatio=atrFast/atrSlow;
  const expansionRatio=tr/atrSlow;
  const volRatio=volumeRatio(candles15m,cfg.structureLookback);
  const closeLocation=side==='LONG'?(close-low)/range:side==='SHORT'?(high-close)/range:.5;
  const bodyFraction=body/range;
  const trendScore=side==='NONE'?50:trendAlignment(candles1h.length?candles1h:candles15m,side);

  return{
    ready:true,side,entry:close,structureHigh:s.high,structureLow:s.low,atrFast,atrSlow,
    compressionRatio,expansionRatio,volumeRatio:volRatio,bodyFraction,closeLocation,trendScore,
    longBreak,shortBreak
  };
}

function componentScores(f,cfg){
  if(!f.ready)return null;
  const structureScore=f.side==='NONE'?0:100;
  const compressionScore=clamp((1.18-f.compressionRatio)/(1.18-cfg.compressionReference)*100,0,100);
  const expansionScore=clamp((f.expansionRatio-.75)/(cfg.expansionReference-.75)*100,0,100);
  const volumeScore=clamp((f.volumeRatio-.75)/(cfg.volumeReference-.75)*100,0,100);
  const candleScore=clamp(((f.bodyFraction-cfg.minBodyFraction)/(.85-cfg.minBodyFraction))*60+f.closeLocation*40,0,100);
  return{
    structure:round(structureScore,1),
    compression:round(compressionScore,1),
    expansion:round(expansionScore,1),
    volume:round(volumeScore,1),
    candle:round(candleScore,1),
    trend:round(f.trendScore,1)
  };
}

export function breakoutExpansionDecision({symbol='UNKNOWN',candles15m=[],candles1h=[]}={},cfg=BREAKOUT_EXPANSION_CONFIG){
  const f=breakoutFeatures(candles15m,candles1h,cfg);
  if(!f.ready)return{
    version:BREAKOUT_EXPANSION_VERSION,researchOnly:true,executionImpact:false,symbol,
    decision:'WAIT',side:'NONE',score:null,riskPct:0,reasons:[f.reason],features:f
  };

  const components=componentScores(f,cfg);
  const score=round(
    components.structure*.35+
    components.compression*.15+
    components.expansion*.18+
    components.volume*.12+
    components.candle*.10+
    components.trend*.10,1
  );

  const reasons=[];
  if(f.side==='NONE')reasons.push('NO_CONFIRMED_STRUCTURE_BREAK');
  if(f.compressionRatio<=cfg.compressionReference)reasons.push('VOLATILITY_COMPRESSION');
  if(f.expansionRatio>=cfg.expansionReference)reasons.push('RANGE_EXPANSION');
  if(f.volumeRatio>=cfg.volumeReference)reasons.push('VOLUME_EXPANSION');
  if(f.bodyFraction>=cfg.minBodyFraction)reasons.push('DECISIVE_CANDLE_BODY');
  if(f.trendScore>=75)reasons.push('TREND_ALIGNED');
  else if(f.trendScore<=25)reasons.push('TREND_CONFLICT');

  let decision='SKIP',riskPct=0;
  if(f.side!=='NONE'){
    if(score>=cfg.tradeScore){
      decision='TRADE';
      riskPct=(f.trendScore>=75&&f.volumeRatio>=cfg.volumeReference)?cfg.fullRiskPct:cfg.reducedRiskPct;
    }else if(score>=cfg.observeScore){
      decision='OBSERVE';riskPct=cfg.exploratoryRiskPct;
    }else reasons.push('SCORE_BELOW_OBSERVE');
  }

  const entry=f.entry;
  const sl=f.side==='LONG'?entry-f.atrSlow*cfg.stopAtrMult:f.side==='SHORT'?entry+f.atrSlow*cfg.stopAtrMult:null;
  const R=sl==null?null:Math.abs(entry-sl);
  const tp1=f.side==='LONG'?entry+R*cfg.tp1R:f.side==='SHORT'?entry-R*cfg.tp1R:null;
  const tp2=f.side==='LONG'?entry+R*cfg.tp2R:f.side==='SHORT'?entry-R*cfg.tp2R:null;

  return{
    version:BREAKOUT_EXPANSION_VERSION,researchOnly:true,executionImpact:false,symbol,
    decision,side:f.side,score,riskPct,entry:round(entry),sl:round(sl),tp1:round(tp1),tp2:round(tp2),
    reasons,components,features:{
      ...f,
      atrFast:round(f.atrFast),atrSlow:round(f.atrSlow),compressionRatio:round(f.compressionRatio),
      expansionRatio:round(f.expansionRatio),volumeRatio:round(f.volumeRatio),bodyFraction:round(f.bodyFraction),
      closeLocation:round(f.closeLocation),trendScore:round(f.trendScore,1)
    }
  };
}
