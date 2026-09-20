/**
 * MERIDIAN v0.2 multi-timeframe confirmation.
 * 4H defines swing/regime; 1H confirms setup; 15m times execution.
 */
function ema(values,n){const k=2/(n+1);let e=values[0];return values.map((v,i)=>i?(e=v*k+e*(1-k)):e)}
function rsi(values,n=14){if(values.length<n+1)return null;let g=0,l=0;for(let i=values.length-n;i<values.length;i++){const d=values[i]-values[i-1];g+=Math.max(d,0);l+=Math.max(-d,0)}return l===0?100:100-100/(1+(g/n)/(l/n))}
export function confirmationScore(candles,{emaFast=20,emaTrend=50}={}){
 if(candles.length<emaTrend+2)return {pass:false,score:0,reasons:["insufficient-history"]};
 const closes=candles.map(x=>x.close), ef=ema(closes,emaFast), et=ema(closes,emaTrend), i=closes.length-1;
 const rr=rsi(closes,14), prevR=rsi(closes.slice(0,-1),14);
 const c=candles[i], p=candles[i-1]; let score=0,reasons=[];
 if(c.close>ef[i]){score++;reasons.push("close>EMA20")}
 if(ef[i]>et[i]){score++;reasons.push("EMA20>EMA50")}
 if(rr!==null&&prevR!==null&&rr>prevR&&rr>=40){score++;reasons.push("RSI-recovery")}
 if(c.close>c.open&&c.close>p.close){score++;reasons.push("bullish-followthrough")}
 return {pass:score>=3,score,reasons,rsi:rr,ema20:ef[i],ema50:et[i]};
}
export function mtfGate({h4,h1,m15}){
 const a=confirmationScore(h4),b=confirmationScore(h1),c=confirmationScore(m15);
 return {pass:a.pass&&b.pass&&c.score>=2,h4:a,h1:b,m15:c};
}
