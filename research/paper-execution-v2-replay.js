// MERIDIAN Paper Execution V2 replay core. Research only; no state writes or order submission.
export const PAPER_EXECUTION_V2_REPLAY='PAPER-EXECUTION-V2-REPLAY-1';
const num=v=>Number(v);
const finite=v=>Number.isFinite(num(v));
export function validateReplayTrade(t){
  const errors=[];
  if(!t||typeof t!=='object')return['INVALID_TRADE'];
  if(!t.id)errors.push('MISSING_ID');
  if(!['LONG','SHORT'].includes(t.side))errors.push('INVALID_SIDE');
  for(const k of ['entry','qty','sl'])if(!finite(t[k])||num(t[k])<=0)errors.push('INVALID_'+k.toUpperCase());
  if(finite(t.entry)&&finite(t.sl)&&['LONG','SHORT'].includes(t.side)&&
    (t.side==='LONG'?num(t.sl)>=num(t.entry):num(t.sl)<=num(t.entry)))errors.push('STOP_WRONG_SIDE');
  if(!Number.isFinite(Date.parse(t.openedAt||'')))errors.push('INVALID_OPEN_TIME');
  if(t.closedAt&&!Number.isFinite(Date.parse(t.closedAt)))errors.push('INVALID_CLOSE_TIME');
  if(t.closedAt&&Number.isFinite(Date.parse(t.openedAt||''))&&Date.parse(t.closedAt)<Date.parse(t.openedAt))errors.push('CLOSE_BEFORE_OPEN');
  return errors;
}
export function initialRisk(t){return Math.abs(num(t.entry)-num(t.sl))*num(t.qty)}
export function executionCosts({entry,exit,qty,feeBps=5,slippageBps=3}){
  const q=num(qty),e=num(entry),x=num(exit),fee=(e+x)*q*num(feeBps)/10000,slip=(e+x)*q*num(slippageBps)/10000;
  return{feeUsd:fee,slippageUsd:slip,totalUsd:fee+slip};
}
export function conservativeStopFill(t,candle){
  const side=t.side,sl=num(t.sl),open=num(candle.open),high=num(candle.high),low=num(candle.low);
  const stopTouched=side==='LONG'?low<=sl:high>=sl;
  if(!stopTouched)return null;
  return side==='LONG'?Math.min(sl,open):Math.max(sl,open);
}
export function targetTouched(t,candle){
  const targets=['tp1','tp2'].map(k=>num(t[k])).filter(Number.isFinite);
  return targets.some(tp=>t.side==='LONG'?num(candle.high)>=tp:num(candle.low)<=tp);
}
export function replayClosedTrade(t,candles,{feeBps=5,slippageBps=3}={}){
  const errors=validateReplayTrade(t);if(errors.length)return{eligible:false,errors};
  const opened=Date.parse(t.openedAt),closed=Date.parse(t.closedAt||'');
  if(!Number.isFinite(closed))return{eligible:false,errors:['MISSING_CLOSE']};
  const xs=(candles||[]).filter(c=>Number.isFinite(Date.parse(c.openTime||c.time))&&Date.parse(c.openTime||c.time)>=opened&&Date.parse(c.openTime||c.time)<=closed);
  if(!xs.length)return{eligible:false,errors:['NO_MARKET_COVERAGE']};
  let replayExit=null,sameBarAmbiguous=false,gapThrough=false;
  for(const c of xs){
    const sf=conservativeStopFill(t,c),tt=targetTouched(t,c);
    if(sf!=null&&tt)sameBarAmbiguous=true;
    if(sf!=null){replayExit=sf;gapThrough=sf!==num(t.sl);break}
  }
  if(replayExit==null&&finite(t.exit))replayExit=num(t.exit);
  if(replayExit==null)return{eligible:false,errors:['NO_REPLAY_EXIT']};
  const dir=t.side==='LONG'?1:-1,q=num(t.qty),gross=(replayExit-num(t.entry))*dir*q,costs=executionCosts({entry:t.entry,exit:replayExit,qty:q,feeBps,slippageBps}),risk=initialRisk(t),net=gross-costs.totalUsd;
  return{eligible:true,replayExit,grossPnlUsd:gross,netPnlUsd:net,netR:risk>0?net/risk:null,costR:risk>0?costs.totalUsd/risk:null,sameBarAmbiguous,gapThrough,costs};
}
export function summarizeReplay(rows){
  const ok=rows.filter(x=>x?.eligible),stops=ok.filter(x=>Number.isFinite(x.netR)&&x.netR<0).map(x=>x.netR).sort((a,b)=>a-b);
  const percentile=(a,p)=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*p))]:null;
  return{eligible:rows.length,replayed:ok.length,coveragePct:rows.length?ok.length/rows.length*100:0,sameBarAmbiguous:ok.filter(x=>x.sameBarAmbiguous).length,gapThrough:ok.filter(x=>x.gapThrough).length,stopWorseThan1R:stops.filter(x=>x<-1).length,stopWorseThan1_1R:stops.filter(x=>x<-1.1).length,stopWorseThan1_25R:stops.filter(x=>x<-1.25).length,p90NetStopR:stops.length?percentile(stops.map(x=>-x).sort((a,b)=>a-b),.9):null,worstNetStopR:stops.length?Math.min(...stops):null};
}
