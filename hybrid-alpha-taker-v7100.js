// MERIDIAN v7.100 — relative OKX taker-flow opposition attenuation.
// RESEARCH ONLY. Hourly flow is usable only after the interval closes.
export const HYBRID_ALPHA_V7100_TAKER=Object.freeze({hourMs:3600000,lookbackHours:24,maxAgeHours:2,zThreshold:1.5,factor:.60});
const round=(v,d=6)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
export function takerImbalanceAt(series=[],decisionTime,config=HYBRID_ALPHA_V7100_TAKER){
  const usable=series.filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.sell)&&x.sell>=0&&Number.isFinite(x.buy)&&x.buy>=0&&x.time+config.hourMs<=decisionTime),rows=usable.slice(-config.lookbackHours),current=rows.at(-1);
  if(rows.length<config.lookbackHours||!current||decisionTime-(current.time+config.hourMs)>config.maxAgeHours*config.hourMs)return null;
  const gaps=rows.slice(1).map((x,i)=>x.time-rows[i].time),span=current.time-rows[0].time;if(span<23*config.hourMs||span>25*config.hourMs||gaps.some(x=>x>2*config.hourMs))return null;
  const buy=rows.reduce((a,x)=>a+x.buy,0),sell=rows.reduce((a,x)=>a+x.sell,0),total=buy+sell;if(!(total>0))return null;
  return {imbalance:(buy-sell)/total,currentTime:current.time,buy,sell};
}
export function relativeTakerState(symbol,seriesBySymbol,decisionTime,symbols=Object.keys(seriesBySymbol),config=HYBRID_ALPHA_V7100_TAKER){
  const states=Object.fromEntries(symbols.map(s=>[s,takerImbalanceAt(seriesBySymbol[s]||[],decisionTime,config)]));
  if(symbols.some(s=>!Number.isFinite(states[s]?.imbalance)))return {available:false,z:null,imbalance:states[symbol]?.imbalance??null,currentTime:states[symbol]?.currentTime??null};
  const values=symbols.map(s=>states[s].imbalance),mean=values.reduce((a,x)=>a+x,0)/values.length,sd=Math.sqrt(values.reduce((a,x)=>a+(x-mean)**2,0)/values.length);if(!(sd>0))return {available:false,z:null,imbalance:states[symbol].imbalance,currentTime:states[symbol].currentTime};
  return {available:true,z:round((states[symbol].imbalance-mean)/sd),imbalance:round(states[symbol].imbalance),currentTime:states[symbol].currentTime};
}
export function applyTakerOpposition(row,seriesBySymbol,symbols=Object.keys(seriesBySymbol),config=HYBRID_ALPHA_V7100_TAKER){
  const state=relativeTakerState(row.symbol,seriesBySymbol,Date.parse(row.timestamp),symbols,config),opposed=state.available&&((row.side==='LONG'&&state.z<=-config.zThreshold)||(row.side==='SHORT'&&state.z>=config.zThreshold)),factor=opposed?config.factor:1;
  return {...row,riskMultiplier:round(Number(row.riskMultiplier)*factor,3),grossR:round(Number(row.grossR)*factor,3),costR:round(Number(row.costR)*factor,3),netR:round(Number(row.netR)*factor,3),takerRiskFactor:factor,takerCrossSectionZ:state.z,takerImbalance24h:state.imbalance,takerCurrentTime:state.currentTime,takerEvidenceAvailable:state.available,takerOpposed:opposed};
}
