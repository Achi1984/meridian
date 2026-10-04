// PAPER-EDGE-V1 deterministic research foundation. No PnL evaluation.
export const EDGE_V1_FOUNDATION='PAPER-EDGE-V1-FOUNDATION-1';
const finite=v=>Number.isFinite(Number(v));
export function orderedBars(rows=[]){
 return [...new Map(rows.filter(r=>r&&finite(r.openTime)&&finite(r.open)&&finite(r.high)&&finite(r.low)&&finite(r.close)&&finite(r.closeTime))
  .map(r=>[Number(r.openTime),{openTime:Number(r.openTime),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),closeTime:Number(r.closeTime),volume:finite(r.volume)?Number(r.volume):0}])).values()]
  .filter(r=>r.openTime>=0&&r.closeTime>r.openTime&&r.open>0&&r.high>=r.low&&r.low>0&&r.close>0).sort((a,b)=>a.openTime-b.openTime);
}
export function assertClosedBars(rows=[],cutoff=Date.now()){
 const xs=orderedBars(rows);
 if(xs.length!==rows.length)throw new Error('EDGE_V1_INVALID_OR_DUPLICATE_BAR');
 if(xs.some(r=>r.closeTime>cutoff))throw new Error('EDGE_V1_UNCLOSED_BAR');
 return xs;
}
export function aggregateDaily(rows=[]){
 const xs=orderedBars(rows),days=new Map();
 for(const r of xs){
  const key=Math.floor(r.openTime/86400000)*86400000;
  const d=days.get(key);
  if(!d)days.set(key,{openTime:key,open:r.open,high:r.high,low:r.low,close:r.close,closeTime:r.closeTime,volume:r.volume});
  else {d.high=Math.max(d.high,r.high);d.low=Math.min(d.low,r.low);d.close=r.close;d.closeTime=Math.max(d.closeTime,r.closeTime);d.volume+=r.volume}
 }
 return [...days.values()].sort((a,b)=>a.openTime-b.openTime);
}
export function dailyContextForTrigger(daily=[],triggerOpenTime){
 const xs=(daily||[]).filter(r=>r&&finite(r.openTime)&&finite(r.closeTime)&&Number(r.closeTime)<Number(triggerOpenTime))
  .map(r=>({...r,openTime:Number(r.openTime),closeTime:Number(r.closeTime)}))
  .sort((a,b)=>a.openTime-b.openTime);
 return xs.length?xs.at(-1):null;
}
export function splitEdgeV1(timestamps=[]){
 const xs=[...new Set(timestamps.map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
 if(xs.length<5)return{ok:false,reason:'INSUFFICIENT_TIMESTAMPS'};
 const a=Math.floor(xs.length*.6),b=Math.floor(xs.length*.8);
 return{ok:true,total:xs.length,discovery:{from:xs[0],to:xs[a-1],count:a},validation:{from:xs[a],to:xs[b-1],count:b-a},holdout:{from:xs[b],to:xs.at(-1),count:xs.length-b}};
}
export function fundingCoverage(rows=[],from,to){
 const xs=(rows||[]).filter(x=>finite(x?.time)&&finite(x?.rate)).map(x=>({time:Number(x.time),rate:Number(x.rate)})).filter(x=>x.time>=from&&x.time<=to).sort((a,b)=>a.time-b.time);
 return{ok:xs.length>0,rows:xs.length,first:xs[0]?.time??null,last:xs.at(-1)?.time??null};
}
export function executionCost(notional,{feeBps=5,slippageBps=3}={}){
 if(!(Number(notional)>=0))throw new Error('EDGE_V1_INVALID_NOTIONAL');
 return Number(notional)*(Number(feeBps)+Number(slippageBps))/10000;
}
export function conservativeFill({side,stop},bar){
 if(!['LONG','SHORT'].includes(side)||!(Number(stop)>0)||!bar)throw new Error('EDGE_V1_INVALID_FILL_INPUT');
 return side==='LONG'?Math.min(Number(stop),Number(bar.open)):Math.max(Number(stop),Number(bar.open));
}
export function sameBarDecision({stopTouched,targetTouched}={}){return stopTouched?'STOP':targetTouched?'TARGET':'NONE'}
