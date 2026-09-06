// MERIDIAN v7.99 — relative OKX open-interest expansion attenuation.
// RESEARCH ONLY. Hourly rows are usable only after the interval closes.
export const HYBRID_ALPHA_V799_OI=Object.freeze({hourMs:3600000,lagHours:24,maxAgeHours:2,zThreshold:1.5,factor:.60});
const round=(v,d=6)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
export function oiChangeAt(series=[],decisionTime,config=HYBRID_ALPHA_V799_OI){
  const usable=series.filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.oiUsd)&&x.oiUsd>0&&x.time+config.hourMs<=decisionTime);
  const current=usable.at(-1);if(!current||decisionTime-(current.time+config.hourMs)>config.maxAgeHours*config.hourMs)return null;
  const target=current.time-config.lagHours*config.hourMs,lag=[...usable].reverse().find(x=>x.time<=target),distance=lag?current.time-lag.time:null;
  if(!lag||distance<23*config.hourMs||distance>25*config.hourMs)return null;
  return {change:current.oiUsd/lag.oiUsd-1,currentTime:current.time,lagTime:lag.time};
}
export function relativeOiState(symbol,seriesBySymbol,decisionTime,symbols=Object.keys(seriesBySymbol),config=HYBRID_ALPHA_V799_OI){
  const changes=Object.fromEntries(symbols.map(s=>[s,oiChangeAt(seriesBySymbol[s]||[],decisionTime,config)]));
  if(symbols.some(s=>!Number.isFinite(changes[s]?.change)))return {available:false,z:null,change:changes[symbol]?.change??null,currentTime:changes[symbol]?.currentTime??null};
  const values=symbols.map(s=>changes[s].change),mean=values.reduce((a,x)=>a+x,0)/values.length,sd=Math.sqrt(values.reduce((a,x)=>a+(x-mean)**2,0)/values.length);
  if(!(sd>0))return {available:false,z:null,change:changes[symbol].change,currentTime:changes[symbol].currentTime};
  return {available:true,z:round((changes[symbol].change-mean)/sd),change:round(changes[symbol].change),currentTime:changes[symbol].currentTime};
}
export function applyRelativeOiExpansion(row,seriesBySymbol,symbols=Object.keys(seriesBySymbol),config=HYBRID_ALPHA_V799_OI){
  const state=relativeOiState(row.symbol,seriesBySymbol,Date.parse(row.timestamp),symbols,config),factor=state.available&&state.z>=config.zThreshold?config.factor:1;
  return {...row,riskMultiplier:round(Number(row.riskMultiplier)*factor,3),grossR:round(Number(row.grossR)*factor,3),costR:round(Number(row.costR)*factor,3),netR:round(Number(row.netR)*factor,3),oiRiskFactor:factor,oiCrossSectionZ:state.z,oiChange24h:state.change,oiCurrentTime:state.currentTime,oiEvidenceAvailable:state.available,oiExpansion:factor<1};
}
