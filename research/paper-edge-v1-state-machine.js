// PAPER-EDGE-V1 frozen signal/state machine. Research only; no dataset PnL.
const ema=(prev,x,n)=>prev==null?x:(x*(2/(n+1))+prev*(1-2/(n+1)));
export function indicators(rows=[]){
 let e20=null,e50=null,atr=null;let prev=null;
 return rows.map((r,i)=>{e20=ema(e20,r.close,20);e50=ema(e50,r.close,50);const tr=prev?Math.max(r.high-r.low,Math.abs(r.high-prev.close),Math.abs(r.low-prev.close)):r.high-r.low;atr=atr==null?tr:(atr*13+tr)/14;prev=r;return{...r,ema20:e20,ema50:e50,atr14:atr,warm:i>=49}});
}
export function dailyRegime(rows=[]){
 let e50=null,e200=null;
 return rows.map((r,i)=>{e50=ema(e50,r.close,50);e200=ema(e200,r.close,200);const regime=i<199?'FLAT':r.close>e200&&e50>e200?'LONG':r.close<e200&&e50<e200?'SHORT':'FLAT';return{...r,ema50:e50,ema200:e200,regime}});
}
export function pullbackCandidate(row,regime){
 if(!row?.warm||!['LONG','SHORT'].includes(regime))return false;
 if(regime==='LONG')return row.ema20>row.ema50&&row.low<=row.ema20&&row.close>=row.ema50;
 return row.ema20<row.ema50&&row.high>=row.ema20&&row.close<=row.ema50;
}
export function triggerFromPullback(pullback,bar,regime,barsSince){
 if(!pullback||barsSince<1||barsSince>3)return false;
 return regime==='LONG'?bar.close>pullback.high:regime==='SHORT'?bar.close<pullback.low:false;
}
export function initialStop({side,entry,pullback,atr14}){
 if(!(entry>0&&atr14>0&&pullback))throw new Error('EDGE_V1_INVALID_STOP_INPUT');
 return side==='LONG'?Math.min(pullback.low,entry-1.5*atr14):Math.max(pullback.high,entry+1.5*atr14);
}
export function newPosition({side,entry,stop,equity}){
 const risk=Math.abs(entry-stop);if(!(risk>0&&equity>0))throw new Error('EDGE_V1_INVALID_RISK');
 const riskCash=equity*.005;return{side,entry,stop,qty:riskCash/risk,initialRisk:risk,tp1:side==='LONG'?entry+risk:entry-risk,tp2:side==='LONG'?entry+2*risk:entry-2*risk,remaining:1,tp1Done:false,tp2Done:false};
}
export function exitEvents(p,bar){
 const long=p.side==='LONG',stop=long?bar.low<=p.stop:bar.high>=p.stop,tp1=!p.tp1Done&&(long?bar.high>=p.tp1:bar.low<=p.tp1),tp2=!p.tp2Done&&(long?bar.high>=p.tp2:bar.low<=p.tp2);
 if(stop)return[{type:'STOP',fraction:p.remaining}];
 const out=[];if(tp1)out.push({type:'TP1',fraction:Math.min(.33,p.remaining)});if(tp2)out.push({type:'TP2',fraction:Math.min(.33,Math.max(0,p.remaining-(tp1?.33:0)))});return out;
}
export function applyEvent(p,event){
 const n={...p};n.remaining=Math.max(0,n.remaining-event.fraction);
 if(event.type==='TP1'){n.tp1Done=true;n.stop=n.entry}
 if(event.type==='TP2')n.tp2Done=true;
 return n;
}
export function atrTrail(p,bar,atr14){
 if(!(p.tp2Done&&atr14>0))return p;
 const candidate=p.side==='LONG'?bar.close-2*atr14:bar.close+2*atr14;
 return{...p,stop:p.side==='LONG'?Math.max(p.stop,candidate):Math.min(p.stop,candidate)};
}
export function aggregateRisk(openPositions=[]){return openPositions.reduce((a,p)=>a+Math.abs((p.entry-p.stop)*p.qty),0)}
export function canOpen(openPositions,equity){return aggregateRisk(openPositions)+equity*.005<equity*.015-1e-9}
