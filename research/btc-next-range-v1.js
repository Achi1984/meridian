// MERIDIAN BTC NEXT RANGE / COMPOUND V1 — research only
// Hypothesis: after a profit/TP event, keeping a reload reserve and waiting for a
// technically confirmed pullback improves risk-adjusted results vs immediate re-entry.
// Uses only CLOSED bars. No execution impact.

export const NEXT_RANGE_V1 = Object.freeze({
  symbol:'BTCUSDT', feeBps:5, slippageBps:3,
  fibLevels:[0.382,0.5,0.618,0.786],
  atrRangeMult:3.0, minRangePct:0.12, maxRangePct:0.32,
  rsiMin:42, rsiMax:68, adxTrendMin:18,
  reloadTranches:[0.25,0.30,0.30,0.15],
  maxWaitBars4h:180
});

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const last=a=>a[a.length-1];
function ema(v,p){if(!v.length)return[];const k=2/(p+1),o=[v[0]];for(let i=1;i<v.length;i++)o.push(v[i]*k+o[i-1]*(1-k));return o}
function rsi(v,p=14){if(v.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];g+=Math.max(d,0);l+=Math.max(-d,0)}g/=p;l/=p;for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}return l===0?100:100-100/(1+g/l)}
function atr(c,p=14){if(c.length<p+1)return null;const t=[];for(let i=1;i<c.length;i++){const x=c[i],q=c[i-1];t.push(Math.max(x.high-x.low,Math.abs(x.high-q.close),Math.abs(x.low-q.close)))}let a=t.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<t.length;i++)a=(a*(p-1)+t[i])/p;return a}
function macd(v){if(v.length<35)return null;const a=ema(v,12),b=ema(v,26),m=v.map((_,i)=>a[i]-b[i]),s=ema(m,9);return{line:last(m),signal:last(s),hist:last(m)-last(s),prevHist:m.at(-2)-s.at(-2)}}
function swing(c,n=90){const w=c.slice(-n);return{low:Math.min(...w.map(x=>x.low)),high:Math.max(...w.map(x=>x.high))}}
export function nextRangeDecision({h4,d1},cfg=NEXT_RANGE_V1){
  if(h4.length<100||d1.length<210)return{status:'NO_DATA'};
  const hc=h4.map(x=>x.close),dc=d1.map(x=>x.close),p=last(hc),A=atr(h4),R=rsi(hc),M=macd(hc);
  const d20=last(ema(dc,20)),d50=last(ema(dc,50)),d200=last(ema(dc,200));
  const s=swing(h4),span=s.high-s.low;
  const fib=cfg.fibLevels.map(f=>({f,price:s.high-span*f})).sort((a,b)=>b.price-a.price);
  const nearest=fib.reduce((a,b)=>Math.abs(b.price-p)<Math.abs(a.price-p)?b:a);
  const dailyBull=p>d200&&d20>d50, momentum=R>=cfg.rsiMin&&R<=cfg.rsiMax&&M.hist>0&&M.hist>=M.prevHist;
  const nearFib=Math.abs(p-nearest.price)<=Math.max(A*0.75,p*0.012);
  const structure=p>s.low&&p>d50;
  const score=clamp((dailyBull?30:0)+(momentum?30:0)+(nearFib?25:0)+(structure?15:0),0,100);
  const ready=score>=70&&dailyBull&&nearFib;
  const half=Math.max(A*cfg.atrRangeMult,p*cfg.minRangePct/2);
  const lower=Math.max(s.low,p-half),upper=Math.min(s.high*1.08,p+half);
  return{status:ready?'RE_ENTRY_ZONE':'WAIT_FOR_RETRACE',price:p,score,rsi:R,macdHist:M.hist,
    daily:{ema20:d20,ema50:d50,ema200:d200,bull:dailyBull},swing:s,nearestFib:nearest,
    proposedRange:{lower,upper,widthPct:(upper-lower)/p},reloadTranches:cfg.reloadTranches};
}

// Event study after each supplied TP event. The caller supplies historical closed-bar data
// and TP timestamps from the baseline grid ledger; this prevents look-ahead.
export function replayNextRange({events,h4,d1,forwardBars=90},cfg=NEXT_RANGE_V1){
  const out=[];
  for(const ev of events){
    const start=h4.findIndex(x=>x.closeTime>=ev.ts); if(start<0)continue;
    let entry=null,decision=null;
    for(let i=start;i<Math.min(h4.length,start+cfg.maxWaitBars4h);i++){
      const h=h4.slice(0,i+1), t=h4[i].closeTime, d=d1.filter(x=>x.closeTime<=t);
      const q=nextRangeDecision({h4:h,d1:d},cfg);
      if(q.status==='RE_ENTRY_ZONE'){entry={i,ts:t,price:h4[i].close};decision=q;break}
    }
    if(!entry){out.push({...ev,status:'NO_REENTRY'});continue}
    const end=Math.min(h4.length-1,entry.i+forwardBars), exit=h4[end].close;
    const gross=exit/entry.price-1, costs=(cfg.feeBps+cfg.slippageBps)*2/10000;
    out.push({...ev,status:'REENTERED',entryAt:entry.ts,entry:entry.price,exitAt:h4[end].closeTime,exit,
      netReturn:gross-costs,waitBars:entry.i-start,decision});
  }
  return summarize(out);
}
function summarize(rows){
  const t=rows.filter(x=>x.status==='REENTERED'),r=t.map(x=>x.netReturn),wins=r.filter(x=>x>0);
  const gp=wins.reduce((a,b)=>a+b,0),gl=-r.filter(x=>x<0).reduce((a,b)=>a+b,0);
  return{policy:'BTC-NEXT-RANGE-V1',executionImpact:false,events:rows.length,reentries:t.length,
    skipped:rows.length-t.length,winRate:t.length?wins.length/t.length:null,
    avgReturn:t.length?r.reduce((a,b)=>a+b,0)/t.length:null,profitFactor:gl?gp/gl:null,rows};
}
