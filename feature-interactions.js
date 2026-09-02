// MERIDIAN v7.63 — Raw Feature Interaction Lab
// Research-only. Measures conditional feature combinations without changing execution.
import { extractRawFeatures } from './feature-attribution.js';
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const outcome=r=>Number.isFinite(Number(r?.outcomeR))?Number(r.outcomeR):Number.isFinite(Number(r?.normalizedR))?Number(r.normalizedR):null;

export const DEFAULT_INTERACTIONS=Object.freeze([
  ['volume15','side'],['volume15','regime'],['volume15','mtfAlignment'],['volume15','baselineStatus'],
  ['volume15','rsi15'],['volume15','adx15'],['side','regime'],['volume15','side','regime']
]);
function summarize(rows){const rs=rows.map(outcome).filter(Number.isFinite),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));return{samples:rs.length,totalR:round(rs.reduce((a,b)=>a+b,0)),avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,winRate:rs.length?round(wins.length/rs.length*100,1):null,pf:gl>0?round(gp/gl):(gp>0?99:0)}}
export function interactionEdgeMap(rows=[],options={}){
  const minSamples=Math.max(1,Number(options.minSamples)||40),specs=options.interactions||DEFAULT_INTERACTIONS;
  const clean=rows.filter(r=>outcome(r)!=null).map(r=>({...r,__raw:extractRawFeatures(r,options.bins)}));
  const interactions={};
  for(const spec of specs){const name=spec.join(' × '),groups=new Map();for(const r of clean){const key=spec.map(k=>String(r.__raw[k]??'UNKNOWN')).join(' × ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}const buckets=[...groups.entries()].map(([bucket,x])=>({bucket,...summarize(x),adequate:x.length>=minSamples})).sort((a,b)=>b.samples-a.samples);interactions[name]={fields:spec,buckets,adequateBuckets:buckets.filter(x=>x.adequate).length,positiveBuckets:buckets.filter(x=>x.adequate&&x.avgR>0).length}}
  return{schemaVersion:'7.63-FEATURE-INTERACTIONS-V1',researchOnly:true,executionImpact:false,samples:clean.length,minSamples,interactions};
}
export function crossWindowInteractionStability(windowMaps={}){
  const windows=Object.keys(windowMaps),names=[...new Set(windows.flatMap(w=>Object.keys(windowMaps[w]?.interactions||{})))],out={};
  for(const name of names){const buckets=[...new Set(windows.flatMap(w=>(windowMaps[w]?.interactions?.[name]?.buckets||[]).map(x=>x.bucket)))];out[name]=buckets.map(bucket=>{const observations=windows.map(window=>{const x=(windowMaps[window]?.interactions?.[name]?.buckets||[]).find(b=>b.bucket===bucket);return x&&x.adequate?{window,avgR:x.avgR,samples:x.samples,pf:x.pf,winRate:x.winRate}:null}).filter(Boolean),signs=observations.map(x=>Math.sign(x.avgR)),consistent=signs.length>=2&&signs.every(s=>s===signs[0]&&s!==0);return{bucket,windows:observations.length,consistentDirection:consistent,direction:consistent?(signs[0]>0?'POSITIVE':'NEGATIVE'):'MIXED',observations}}).sort((a,b)=>b.windows-a.windows||Number(b.consistentDirection)-Number(a.consistentDirection));}
  return{schemaVersion:'7.63-FEATURE-INTERACTION-STABILITY-V1',researchOnly:true,windows,interactions:out};
}
