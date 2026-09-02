// MERIDIAN v7.65 — Disjoint historical robustness validation
// Research-only. Evaluates pre-specified v7.64 candidate interactions on non-overlapping periods.
import { extractRawFeatures } from './feature-attribution.js';

const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const outcome=r=>Number.isFinite(Number(r?.outcomeR))?Number(r.outcomeR):Number.isFinite(Number(r?.normalizedR))?Number(r.normalizedR):null;

export const V765_CANDIDATES=Object.freeze([
  {id:'SHORT_TRANSITION_VOL_065_1',match:{volume15:'0.65-1',side:'SHORT',regime:'TRANSITION'}},
  {id:'VOL_GE15_RSI_50_58',match:{volume15:'>=1.5',rsi15:'50-58'}},
  {id:'VOL_GE15_ADX_18_25',match:{volume15:'>=1.5',adx15:'18-25'}},
  {id:'VOL_GE15_ADX_LT18',match:{volume15:'>=1.5',adx15:'<18'}},
  {id:'VOL_GE15_NO_SETUP',match:{volume15:'>=1.5',baselineStatus:'NO_SETUP'}},
  {id:'VOL_GE15_RSI_42_50',match:{volume15:'>=1.5',rsi15:'42-50'}},
  {id:'VOL_1_115_RSI_50_58',match:{volume15:'1-1.15',rsi15:'50-58'}},
  {id:'VOL_1_115_READY',match:{volume15:'1-1.15',baselineStatus:'READY'}}
]);

function summarize(rows){
  const rs=rows.map(outcome).filter(Number.isFinite),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0);
  const gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0)),total=rs.reduce((a,b)=>a+b,0);
  return {samples:rs.length,totalR:round(total),avgR:rs.length?round(total/rs.length):null,winRate:rs.length?round(wins.length/rs.length*100,1):null,pf:gl>0?round(gp/gl):(gp>0?99:0)};
}
function matches(raw,match){return Object.entries(match).every(([k,v])=>String(raw?.[k]??'UNKNOWN')===String(v));}

export function validateDisjointPeriods(periodRows={},options={}){
  const candidates=options.candidates||V765_CANDIDATES,minSamples=Math.max(1,Number(options.minSamples)||30);
  const periodNames=Object.keys(periodRows);
  const prepared={};
  for(const name of periodNames)prepared[name]=(periodRows[name]||[]).filter(r=>outcome(r)!=null).map(r=>({...r,__raw:extractRawFeatures(r,options.bins)}));
  const results=[];
  for(const candidate of candidates){
    const periods=periodNames.map(period=>{
      const rows=prepared[period].filter(r=>matches(r.__raw,candidate.match));
      const stats=summarize(rows);return{period,...stats,adequate:stats.samples>=minSamples,positive:stats.samples>=minSamples&&stats.avgR>0};
    });
    const adequate=periods.filter(x=>x.adequate),positive=adequate.filter(x=>x.positive),weightedN=adequate.reduce((a,b)=>a+b.samples,0);
    const weightedAvgR=weightedN?round(adequate.reduce((a,b)=>a+(b.avgR||0)*b.samples,0)/weightedN):null;
    results.push({id:candidate.id,match:candidate.match,periods,adequatePeriods:adequate.length,positivePeriods:positive.length,positivePeriodPct:adequate.length?round(positive.length/adequate.length*100,1):null,weightedAvgR,totalSamples:weightedN,robust:adequate.length>=3&&positive.length/adequate.length>=0.75&&weightedAvgR>0});
  }
  return {schemaVersion:'7.65-DISJOINT-HISTORY-V1',researchOnly:true,executionImpact:false,minSamples,periods:periodNames,candidates:results.sort((a,b)=>Number(b.robust)-Number(a.robust)||(b.positivePeriodPct??-1)-(a.positivePeriodPct??-1)||(b.weightedAvgR??-999)-(a.weightedAvgR??-999))};
}
