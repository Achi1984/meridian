// MERIDIAN v7.86 — Retest / Hold Breakout Bot V2
// Research-only. No Paper/live execution impact.

export const RETEST_HOLD_VERSION='7.86-RETEST-HOLD-BREAKOUT-V2';

export const RETEST_HOLD_CONFIG=Object.freeze({
  structureLookback:20,
  breakoutBufferAtr:.08,
  retestToleranceAtr:.30,
  maxRetestBars:8,
  minImpulseBodyFraction:.45,
  minHoldCloseLocation:.55,
  volumeReference:1.10,
  tradeScore:70,
  observeScore:58,
  stopAtrMult:1.00,
  tp1R:1.50,
  tp2R:2.50,
  fullRiskPct:1.00,
  reducedRiskPct:.50,
  exploratoryRiskPct:.25
});

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const last=a=>a[a.length-1];

function trueRange(c,p){return Math.max(Number(c.high)-Number(c.low),Math.abs(Number(c.high)-Number(p.close)),Math.abs(Number(c.low)-Number(p.close)))}
function atr(candles=[],period=14){if(candles.length<period+1)return null;const tr=[];for(let i=1;i<candles.length;i++)tr.push(trueRange(candles[i],candles[i-1]));let a=tr.slice(0,period).reduce((x,y)=>x+y,0)/period;for(let i=period;i<tr.length;i++)a=(a*(period-1)+tr[i])/period;return a}
function ema(values,period){if(!values.length)return[];const k=2/(period+1),out=[Number(values[0])];for(let i=1;i<values.length;i++)out.push(Number(values[i])*k+out[i-1]*(1-k));return out}
function structure(rows,lookback,endExclusive){const from=Math.max(0,endExclusive-lookback),slice=rows.slice(from,endExclusive);if(slice.length<lookback)return null;return{high:Math.max(...slice.map(c=>+c.high)),low:Math.min(...slice.map(c=>+c.low))}}
function volumeRatio(rows,index,period=20){if(index<period)return 1;const cur=+rows[index].volume||0,base=rows.slice(index-period,index).reduce((s,c)=>s+(+c.volume||0),0)/period;return base>0?cur/base:1}
function trendScore(rows,side){if(rows.length<55)return 50;const closes=rows.map(c=>+c.close),e20=last(ema(closes,20)),e50=last(ema(closes,50)),p=last(closes),L=side==='LONG';let s=50;s+=(L?e20>e50:e20<e50)?25:-25;s+=(L?p>e20:p<e20)?25:-25;return clamp(s,0,100)}

export function findRetestHoldSetup(candles15m=[],candles1h=[],cfg=RETEST_HOLD_CONFIG){
  if(candles15m.length<Math.max(80,cfg.structureLookback+cfg.maxRetestBars+20))return{ready:false,reason:'INSUFFICIENT_HISTORY'};
  const currentIndex=candles15m.length-1,current=candles15m[currentIndex],A=atr(candles15m.slice(0,currentIndex+1),20);
  if(!(A>0))return{ready:false,reason:'INVALID_ATR'};
  const start=Math.max(cfg.structureLookback,currentIndex-cfg.maxRetestBars-1);
  for(let breakoutIndex=currentIndex-1;breakoutIndex>=start;breakoutIndex--){
    const s=structure(candles15m,cfg.structureLookback,breakoutIndex);
    if(!s)continue;
    const b=candles15m[breakoutIndex],prev=candles15m[breakoutIndex-1];if(!prev)continue;
    const localAtr=atr(candles15m.slice(0,breakoutIndex+1),20);if(!(localAtr>0))continue;
    const buffer=localAtr*cfg.breakoutBufferAtr;
    const longBreak=+b.close>s.high+buffer,shortBreak=+b.close<s.low-buffer;
    if(!longBreak&&!shortBreak)continue;
    const side=longBreak?'LONG':'SHORT',level=side==='LONG'?s.high:s.low;
    const between=candles15m.slice(breakoutIndex+1,currentIndex+1);
    if(!between.length||between.length>cfg.maxRetestBars)continue;
    const tol=A*cfg.retestToleranceAtr;
    let retestSeen=false,invalidated=false;
    for(const c of between){
      if(side==='LONG'){
        if(+c.low<=level+tol)retestSeen=true;
        if(+c.close<level-tol)invalidated=true;
      }else{
        if(+c.high>=level-tol)retestSeen=true;
        if(+c.close>level+tol)invalidated=true;
      }
    }
    if(!retestSeen||invalidated)continue;
    const range=Math.max(+current.high-+current.low,1e-12),body=Math.abs(+current.close-+current.open),bodyFraction=body/range;
    const closeLocation=side==='LONG'?(+current.close-+current.low)/range:(+current.high-+current.close)/range;
    const impulse=side==='LONG'?+current.close>+current.open:+current.close<+current.open;
    const holds=side==='LONG'?+current.close>=level:+current.close<=level;
    const vRatio=volumeRatio(candles15m,currentIndex,cfg.structureLookback);
    const tScore=trendScore(candles1h.length?candles1h:candles15m,side);
    return{ready:true,side,level,breakoutIndex,retestBars:between.length,entry:+current.close,atr:A,retestSeen,invalidated,holds,impulse,bodyFraction,closeLocation,volumeRatio:vRatio,trendScore:tScore};
  }
  return{ready:true,side:'NONE',reason:'NO_VALID_BREAKOUT_RETEST_HOLD'};
}

export function retestHoldDecision({symbol='UNKNOWN',candles15m=[],candles1h=[]}={},cfg=RETEST_HOLD_CONFIG){
  const f=findRetestHoldSetup(candles15m,candles1h,cfg);
  if(!f.ready)return{version:RETEST_HOLD_VERSION,researchOnly:true,executionImpact:false,symbol,decision:'WAIT',side:'NONE',score:null,riskPct:0,reasons:[f.reason],features:f};
  if(f.side==='NONE')return{version:RETEST_HOLD_VERSION,researchOnly:true,executionImpact:false,symbol,decision:'SKIP',side:'NONE',score:0,riskPct:0,reasons:[f.reason],features:f};

  const holdScore=f.holds?100:0;
  const impulseScore=f.impulse?clamp(f.bodyFraction/cfg.minImpulseBodyFraction*100,0,100):0;
  const locationScore=clamp(f.closeLocation/cfg.minHoldCloseLocation*100,0,100);
  const volumeScore=clamp(f.volumeRatio/cfg.volumeReference*100,0,100);
  const trend=clamp(f.trendScore,0,100);
  const freshness=clamp((cfg.maxRetestBars-f.retestBars+1)/cfg.maxRetestBars*100,0,100);
  const score=round(holdScore*.30+impulseScore*.22+locationScore*.16+volumeScore*.12+trend*.10+freshness*.10,1);
  const reasons=['BREAKOUT_RETEST_CONFIRMED'];
  if(f.holds)reasons.push('LEVEL_HOLDS');else reasons.push('LEVEL_NOT_HELD');
  if(f.impulse&&f.bodyFraction>=cfg.minImpulseBodyFraction)reasons.push('RENEWED_IMPULSE');
  if(f.volumeRatio>=cfg.volumeReference)reasons.push('VOLUME_SUPPORT');
  if(f.trendScore>=75)reasons.push('TREND_ALIGNED');else if(f.trendScore<=25)reasons.push('TREND_CONFLICT');

  let decision='SKIP',riskPct=0;
  if(f.holds&&f.impulse&&score>=cfg.tradeScore){decision='TRADE';riskPct=(f.volumeRatio>=cfg.volumeReference&&f.trendScore>=75)?cfg.fullRiskPct:cfg.reducedRiskPct;}
  else if(f.holds&&score>=cfg.observeScore){decision='OBSERVE';riskPct=cfg.exploratoryRiskPct;}
  else reasons.push('QUALITY_BELOW_OBSERVE');

  const entry=f.entry,sl=f.side==='LONG'?Math.min(f.level-f.atr*.15,entry-f.atr*cfg.stopAtrMult):Math.max(f.level+f.atr*.15,entry+f.atr*cfg.stopAtrMult),R=Math.abs(entry-sl),tp1=f.side==='LONG'?entry+R*cfg.tp1R:entry-R*cfg.tp1R,tp2=f.side==='LONG'?entry+R*cfg.tp2R:entry-R*cfg.tp2R;
  return{version:RETEST_HOLD_VERSION,researchOnly:true,executionImpact:false,symbol,decision,side:f.side,score,riskPct,entry:round(entry),sl:round(sl),tp1:round(tp1),tp2:round(tp2),reasons,components:{hold:holdScore,impulse:round(impulseScore,1),location:round(locationScore,1),volume:round(volumeScore,1),trend:round(trend,1),freshness:round(freshness,1)},features:{...f,level:round(f.level),atr:round(f.atr),bodyFraction:round(f.bodyFraction),closeLocation:round(f.closeLocation),volumeRatio:round(f.volumeRatio),trendScore:round(f.trendScore,1)}};
}
