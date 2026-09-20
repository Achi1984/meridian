/**
 * MERIDIAN multi-timeframe confirmation primitives.
 * Closed candles only. No future candle may enter a decision.
 */
export function ema(values,n){
 if(!values.length)return [];
 const k=2/(n+1),out=[]; let e=values[0];
 for(let i=0;i<values.length;i++){if(i)e=values[i]*k+e*(1-k);out.push(e)}
 return out;
}
export function wilderRsi(values,n=14){
 if(values.length<n+1)return null;
 let gain=0,loss=0;
 for(let i=1;i<=n;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}
 let ag=gain/n,al=loss/n;
 for(let i=n+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(n-1)+Math.max(d,0))/n;al=(al*(n-1)+Math.max(-d,0))/n}
 if(al===0)return 100;
 return 100-100/(1+ag/al);
}
export function macd(values,{fast=12,slow=26,signal=9}={}){
 if(values.length<slow+signal)return null;
 const f=ema(values,fast),s=ema(values,slow),line=values.map((_,i)=>f[i]-s[i]),sig=ema(line,signal),i=values.length-1;
 return {line:line[i],signal:sig[i],hist:line[i]-sig[i],prevHist:line[i-1]-sig[i-1]};
}
export function confirmationScore(candles,{emaFast=20,emaTrend=50}={}){
 if(candles.length<emaTrend+2)return {pass:false,score:0,reasons:["insufficient-history"]};
 const closes=candles.map(x=>x.close),ef=ema(closes,emaFast),et=ema(closes,emaTrend),i=closes.length-1;
 const rr=wilderRsi(closes,14),prevR=wilderRsi(closes.slice(0,-1),14),m=macd(closes);
 const c=candles[i],p=candles[i-1];let score=0,reasons=[];
 if(c.close>ef[i]){score++;reasons.push("close>EMA20")}
 if(ef[i]>et[i]){score++;reasons.push("EMA20>EMA50")}
 if(rr!==null&&prevR!==null&&rr>prevR&&rr>=40){score++;reasons.push("RSI-recovery")}
 if(m&&m.hist>m.prevHist){score++;reasons.push("MACD-hist-improving")}
 if(c.close>c.open&&c.close>p.close){score++;reasons.push("bullish-followthrough")}
 return {pass:score>=3,score,reasons,rsi:rr,ema20:ef[i],ema50:et[i],macd:m};
}
export function historyUntil(candles,ts,n=120){return candles.filter(x=>x.ts<=ts).slice(-n)}
export function mtfGateAt({h4,h1,m15,ts}){
 const a=confirmationScore(historyUntil(h4,ts)),b=confirmationScore(historyUntil(h1,ts)),c=confirmationScore(historyUntil(m15,ts));
 return {pass:a.pass&&b.pass&&c.score>=2,h4:a,h1:b,m15:c};
}
export function mtfGate({h4,h1,m15}){const ts=Math.min(h4.at(-1)?.ts??0,h1.at(-1)?.ts??0,m15.at(-1)?.ts??0);return mtfGateAt({h4,h1,m15,ts})}
