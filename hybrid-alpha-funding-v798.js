// MERIDIAN v7.98 — OKX funding crowding attenuation.
// RESEARCH ONLY. Uses only realized funding available at decision time.
export const HYBRID_ALPHA_V798_FUNDING=Object.freeze({lookback:30,zThreshold:2,factor:.60});

const round=(v,d=6)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
export function fundingStateAt(series=[],decisionTime,config=HYBRID_ALPHA_V798_FUNDING){
  const available=series.filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.rate)&&x.time<=decisionTime).slice(-config.lookback);
  if(available.length<config.lookback)return {available:false,z:null,latestTime:available.at(-1)?.time??null,observations:available.length};
  const values=available.map(x=>x.rate),mean=values.reduce((a,x)=>a+x,0)/values.length,variance=values.reduce((a,x)=>a+(x-mean)**2,0)/values.length,sd=Math.sqrt(variance);
  if(!(sd>0))return {available:false,z:null,latestTime:available.at(-1).time,observations:available.length};
  return {available:true,z:round((values.at(-1)-mean)/sd),latestTime:available.at(-1).time,observations:available.length};
}
export function fundingCrowdingFactor(side,state,config=HYBRID_ALPHA_V798_FUNDING){
  if(!state?.available||!Number.isFinite(state.z))return 1;
  return (side==='LONG'&&state.z>=config.zThreshold)||(side==='SHORT'&&state.z<=-config.zThreshold)?config.factor:1;
}
export function applyFundingCrowding(row,series,config=HYBRID_ALPHA_V798_FUNDING){
  const state=fundingStateAt(series,Date.parse(row.timestamp),config),factor=fundingCrowdingFactor(row.side,state,config);
  return {...row,riskMultiplier:round(Number(row.riskMultiplier)*factor,3),grossR:round(Number(row.grossR)*factor,3),costR:round(Number(row.costR)*factor,3),netR:round(Number(row.netR)*factor,3),fundingRiskFactor:factor,fundingZ:state.z,fundingLatestTime:state.latestTime,fundingObservations:state.observations,fundingEvidenceAvailable:state.available,fundingCrowding:factor<1};
}
