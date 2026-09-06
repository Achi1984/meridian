import fs from 'node:fs/promises';
import {runHybridAlphaBacktest,walkForwardSlices} from '../hybrid-alpha-backtest-v790.js';
import {runReliabilityRouterBacktest} from '../hybrid-alpha-reliability-v791.js';
import {hybridAlphaMacroDecision} from '../hybrid-alpha-macro-v792.js';
import {hybridAlphaTransitionDecision} from '../hybrid-alpha-transition-v793.js';

const BASE='https://api.exchange.coinbase.com';
const SYMBOLS=(process.env.HYBRID_SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT').split(',').map(x=>x.trim()).filter(Boolean);
const WINDOWS=(process.env.HYBRID_WINDOWS||'30,60,90').split(',').map(Number).filter(x=>x>0);
const BAR_MS=15*60*1000;
const MAX_DAYS=Math.max(...WINDOWS);
const END=Math.floor(Date.now()/BAR_MS)*BAR_MS-BAR_MS;
const START=END-(MAX_DAYS+35)*86400000;

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const median=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const sd=a=>{if(a.length<2)return null;const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))};
const ret=(a,b)=>a&&b?a/b-1:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const product=s=>`${s.replace(/USDT$/,'')}-USD`;

async function getJson(url){const r=await fetch(url,{headers:{'user-agent':'MERIDIAN-research/7.93','accept':'application/json'}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json()}
async function candles(symbol){
  let cursor=START,out=[];const p=product(symbol),chunkMs=299*BAR_MS;
  while(cursor<=END){
    const chunkEnd=Math.min(END,cursor+chunkMs);
    const url=`${BASE}/products/${p}/candles?granularity=900&start=${encodeURIComponent(new Date(cursor).toISOString())}&end=${encodeURIComponent(new Date(chunkEnd+BAR_MS).toISOString())}`;
    const xs=await getJson(url);if(!Array.isArray(xs))throw new Error(`unexpected candle payload for ${p}`);
    for(const x of xs){const t=+x[0]*1000;if(t>=START&&t<=END)out.push({t,l:+x[1],h:+x[2],o:+x[3],c:+x[4],q:+x[5]*+x[4]})}
    cursor=chunkEnd+BAR_MS;await sleep(90);
  }
  out.sort((a,b)=>a.t-b.t);
  return out.filter((x,i,a)=>!i||x.t!==a[i-1].t);
}
function ema(values,p){const k=2/(p+1),out=[];let e=values[0];for(const v of values){e=e==null?v:e+k*(v-e);out.push(e)}return out}
function closedBucketEma(rows,bucketMs,p){const k=2/(p+1),out=[];let e=null;for(let i=0;i<rows.length;i++){if((rows[i].t+BAR_MS)%bucketMs===0)e=e==null?rows[i].c:e+k*(rows[i].c-e);out.push(e)}return out}
function atr(rows,p=14){const tr=rows.map((x,i)=>i?Math.max(x.h-x.l,Math.abs(x.h-rows[i-1].c),Math.abs(x.l-rows[i-1].c)):x.h-x.l);return ema(tr,p)}
function rollingMedian(values,p){return values.map((_,i)=>median(values.slice(Math.max(0,i-p+1),i+1)))}
function regimeOf(btc,i,ema20,ema50,ema200,atr14){const c=btc[i].c,a=atr14[i]||0;const sep=a?Math.abs(ema20[i]-ema50[i])/a:0;if(sep<.35)return 'RANGE';if(ema20[i]>ema50[i]&&ema50[i]>ema200[i]&&c>ema20[i])return 'BULL';if(ema20[i]<ema50[i]&&ema50[i]<ema200[i]&&c<ema20[i])return 'BEAR';return 'TRANSITION'}
function macroTrendOf(btc,bi){
  if(bi<96*30)return 0;
  const r7=ret(btc[bi].c,btc[bi-96*7]?.c)??0;
  const r30=ret(btc[bi].c,btc[bi-96*30]?.c)??0;
  const rs=btc.slice(bi-96*30,bi+1).map((x,j,a)=>j?Math.log(x.c/a[j-1].c):0).slice(1);
  const rv=sd(rs)||0;if(!(rv>0))return 0;
  const z7=r7/(rv*Math.sqrt(96*7));
  const z30=r30/(rv*Math.sqrt(96*30));
  return clamp(.4*z7+.6*z30,-1,1);
}
function buildSamples(data,symbol,horizonBars){
  const xs=data[symbol],btc=data.BTCUSDT,horizonMs=horizonBars*BAR_MS;
  const closes=xs.map(x=>x.c),e20=ema(closes,20),e50=ema(closes,50),a14=atr(xs,14);
  const h1e20=closedBucketEma(xs,3600000,20),h1e50=closedBucketEma(xs,3600000,50);
  const h4e20=closedBucketEma(xs,14400000,20),h4e50=closedBucketEma(xs,14400000,50);
  const btcCl=btc.map(x=>x.c),b20=ema(btcCl,20),b50=ema(btcCl,50),b200=ema(btcCl,200),ba14=atr(btc,14);
  const volMed=rollingMedian(xs.map(x=>x.q),96*7);const byTime=new Map(btc.map((x,i)=>[x.t,i]));const out=[];
  for(let i=3000;i<xs.length-horizonBars;i++){
    if(xs[i].t%horizonMs!==0)continue;
    const bi=byTime.get(xs[i].t);if(bi==null||bi<96*30)continue;
    const c=xs[i].c,atrPct=a14[i]/c;if(!(atrPct>0)||h1e20[i]==null||h1e50[i]==null||h4e20[i]==null||h4e50[i]==null)continue;
    const r12=ret(c,xs[i-48]?.c)??0,r48=ret(c,xs[i-192]?.c)??0;const btc12=ret(btc[bi].c,btc[bi-48]?.c)??0;
    const trend15=clamp((e20[i]-e50[i])/(a14[i]*2),-1,1),trend1h=clamp((h1e20[i]-h1e50[i])/(a14[i]*4),-1,1),trend4h=clamp((h4e20[i]-h4e50[i])/(a14[i]*8),-1,1);
    const trend=clamp(.25*trend15+.35*trend1h+.40*trend4h,-1,1),momentum=clamp((.65*r12+.35*r48)/(atrPct*4),-1,1),relativeStrength=clamp((r12-btc12)/(atrPct*3),-1,1),meanReversion=clamp(-(c-e20[i])/(a14[i]*2),-1,1);
    const rv=sd(xs.slice(i-96,i+1).map((x,j,a)=>j?Math.log(x.c/a[j-1].c):0).slice(1))||0,rvLong=sd(xs.slice(Math.max(1,i-96*7),i+1).map((x,j,a)=>j?Math.log(x.c/a[j-1].c):0).slice(1))||rv||1;
    const volatilityRatio=clamp(rv/(rvLong||1),.25,4),liquidityQuality=clamp(xs[i].q/(volMed[i]||xs[i].q||1),0,1),reversalRisk=clamp(Math.abs(meanReversion)*Math.max(0,-trend*meanReversion),0,1),macroTrend=macroTrendOf(btc,bi);
    const fwd=(xs[i+horizonBars].c-c)/c,forwardR=fwd/atrPct;
    out.push({timestamp:new Date(xs[i].t).toISOString(),symbol,forwardR,features:{regime:regimeOf(btc,bi,b20,b50,b200,ba14),trend,momentum,relativeStrength,meanReversion,volatilityRatio,liquidityQuality,reversalRisk,macroTrend,timeframeEvidence:{trend15m:trend15,trend1h,trend4h}}});
  }
  return out;
}
function sliceDays(samples,days){const cut=END-days*86400000;return samples.filter(x=>Date.parse(x.timestamp)>=cut)}
function summarize(samples,costR,horizonMs){return {
  v1:{result:runHybridAlphaBacktest(samples,{costR}),walkForward:walkForwardSlices(samples,{costR,folds:3})},
  v791:runReliabilityRouterBacktest(samples,{costR,horizonMs,lookbackMs:60*86400000,minSamples:8,priorStrength:20}),
  v792:{result:runHybridAlphaBacktest(samples,{costR,decisionFn:hybridAlphaMacroDecision}),walkForward:walkForwardSlices(samples,{costR,folds:3,decisionFn:hybridAlphaMacroDecision})},
  v793:{result:runHybridAlphaBacktest(samples,{costR,decisionFn:hybridAlphaTransitionDecision}),walkForward:walkForwardSlices(samples,{costR,folds:3,decisionFn:hybridAlphaTransitionDecision})}
}}

const data={};for(const s of SYMBOLS){console.log(`fetch ${s}`);data[s]=await candles(s)}if(!data.BTCUSDT)throw new Error('BTCUSDT required for market regime / relative strength');
const horizons={h4:16,h12:48,h24:96};
const evidence={schemaVersion:'7.93-HYBRID-EVIDENCE-V1',generatedAt:new Date().toISOString(),cutoff:new Date(END).toISOString(),researchOnly:true,executionImpact:false,source:'COINBASE_EXCHANGE_PUBLIC_15M',symbols:SYMBOLS,windows:WINDOWS,horizons:{},notes:['Cutoff is anchored to latest completed 15m candle and decisions to UTC horizon boundaries.','Decision-time trend blends closed 15m,1h,4h evidence.','v7.92 macroTrend uses only prior BTC 7d/30d volatility-normalized drift and only attenuates opposing-side risk.','v7.93 predeclares one soft factor: TRANSITION×SHORT risk is multiplied by 0.60; no trade is blocked and no LONG risk is boosted.','No funding/carry or true order-flow input; missing evidence is not fabricated.','Forward labels do not overlap within each symbol/horizon.']};
for(const [name,bars] of Object.entries(horizons)){const all=SYMBOLS.flatMap(s=>buildSamples(data,s,bars));evidence.horizons[name]={};for(const days of WINDOWS)evidence.horizons[name][`${days}d`]=summarize(sliceDays(all,days),0.03,bars*BAR_MS)}
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/hybrid-alpha-v790-evidence.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(evidence.horizons).map(([h,w])=>[h,Object.fromEntries(Object.entries(w).map(([k,v])=>[k,{v1:v.v1.result.summary,v791:v.v791.summary,v792:v.v792.result.summary,v793:v.v793.result.summary}]))])),null,2));
