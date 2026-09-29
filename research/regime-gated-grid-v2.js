export const REGIME_GATED_GRID_V2_RULESET='REGIME-GATED-GRID-V2-FROZEN';

export const REGIME_GATED_GRID_V2_CONFIG=Object.freeze({
  efficiencyDays:30,
  maxEfficiencyRatio:0.30,
  rangeDays:30,
  minRangePosition:0.20,
  maxRangePosition:0.80,
  realizedVolDays:30,
  volReferenceDays:180,
  minVolRatio:0.60,
  maxVolRatio:1.05,
  discoveryGate:Object.freeze({
    minAssetMonthCycles:16,
    minCyclesPerAsset:8,
    minProfitFactor:1.10,
    maxDrawdownPct:25,
    minPositiveWindows:3,
    maxPathSpreadPctPoints:10
  }),
  holdoutGate:Object.freeze({
    minAssetMonthCycles:6,
    minCyclesPerAsset:3,
    minProfitFactor:1.05,
    maxDrawdownPct:25,
    minPositiveWindows:2,
    maxPathSpreadPctPoints:10
  })
});

const DAY=86400000;
const finite=x=>Number.isFinite(Number(x));
const n=x=>Number(x);
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;

function median(values){
  const a=values.filter(finite).map(Number).sort((x,y)=>x-y);
  if(!a.length)return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function stdev(a){
  if(a.length<2)return null;
  const m=mean(a),v=a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1);
  return Math.sqrt(Math.max(0,v));
}
function annualizedRv(closes,endIndex,days){
  if(endIndex-days<0)return null;
  const rs=[];
  for(let i=endIndex-days+1;i<=endIndex;i++){
    const a=closes[i-1],b=closes[i];
    if(!(a>0&&b>0))return null;
    rs.push(Math.log(b/a));
  }
  const sd=stdev(rs);
  return sd==null?null:sd*Math.sqrt(365);
}

export function normalizeDailyBars(raw=[]){
  return raw.map(x=>{
    if(Array.isArray(x))return{
      openTime:n(x[0]),open:n(x[1]),high:n(x[2]),low:n(x[3]),close:n(x[4]),closeTime:n(x[6]??x[0])
    };
    return{
      openTime:n(x?.openTime??x?.t??x?.time),
      open:n(x?.open??x?.o),
      high:n(x?.high??x?.h),
      low:n(x?.low??x?.l),
      close:n(x?.close??x?.c),
      closeTime:n(x?.closeTime??x?.T??x?.time??x?.t)
    };
  }).filter(x=>[x.openTime,x.open,x.high,x.low,x.close,x.closeTime].every(finite)&&x.open>0&&x.high>0&&x.low>0&&x.close>0)
    .sort((a,b)=>a.openTime-b.openTime);
}

export function evaluateRangeRegime(rawDailyBars,monthStartMs,config={}){
  const cfg={...REGIME_GATED_GRID_V2_CONFIG,...config};
  const bars=normalizeDailyBars(rawDailyBars).filter(x=>x.closeTime<monthStartMs);
  const reasons=[];
  const required=cfg.realizedVolDays+cfg.volReferenceDays;
  if(bars.length<required){
    return{eligible:false,reasons:['INSUFFICIENT_HISTORY'],observations:bars.length,required,ruleset:REGIME_GATED_GRID_V2_RULESET};
  }
  const closes=bars.map(x=>x.close),end=bars.length-1;

  const erStart=end-cfg.efficiencyDays;
  let path=0;
  for(let i=erStart+1;i<=end;i++)path+=Math.abs(closes[i]-closes[i-1]);
  const efficiencyRatio=path>0?Math.abs(closes[end]-closes[erStart])/path:null;
  if(!finite(efficiencyRatio)||efficiencyRatio>cfg.maxEfficiencyRatio)reasons.push('EFFICIENCY_RATIO_HIGH');

  const rangeRows=bars.slice(end-cfg.rangeDays+1,end+1);
  const hi=Math.max(...rangeRows.map(x=>x.high)),lo=Math.min(...rangeRows.map(x=>x.low));
  const rangePosition=hi>lo?(closes[end]-lo)/(hi-lo):null;
  if(!finite(rangePosition)||rangePosition<cfg.minRangePosition||rangePosition>cfg.maxRangePosition)reasons.push('RANGE_EDGE');

  const rv30=annualizedRv(closes,end,cfg.realizedVolDays),history=[];
  for(let i=end-cfg.volReferenceDays+1;i<=end;i++){
    const rv=annualizedRv(closes,i,cfg.realizedVolDays);
    if(finite(rv))history.push(rv);
  }
  const ref=median(history),volRatio=ref>0&&finite(rv30)?rv30/ref:null;
  if(history.length<cfg.volReferenceDays)reasons.push('VOL_REFERENCE_INCOMPLETE');
  if(!finite(volRatio)||volRatio<cfg.minVolRatio||volRatio>cfg.maxVolRatio)reasons.push('VOL_RATIO_OUTSIDE_BAND');

  return{
    ruleset:REGIME_GATED_GRID_V2_RULESET,
    eligible:reasons.length===0,
    reasons,
    monthStartMs,
    asOf:bars[end]?.closeTime??null,
    observations:bars.length,
    efficiencyRatio,
    rangePosition,
    rv30,
    medianRv30_180:ref,
    volRatio
  };
}

export function monthStartMs(key){
  const [y,m]=String(key).split('-').map(Number);
  if(!(y>=2000&&m>=1&&m<=12))throw new Error('invalid month key');
  return Date.UTC(y,m-1,1);
}

export function validateDailyContinuity(rawDailyBars,{maxGapMs=2*DAY}={}){
  const bars=normalizeDailyBars(rawDailyBars);
  for(let i=1;i<bars.length;i++){
    if(bars[i].openTime<=bars[i-1].openTime)throw new Error('daily timestamps not strictly increasing');
    if(bars[i].openTime-bars[i-1].openTime>maxGapMs)throw new Error('daily data gap');
  }
  return bars;
}
