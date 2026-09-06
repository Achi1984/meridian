import fs from 'node:fs/promises';
import {runHybridAlphaBacktest,walkForwardSlices} from '../hybrid-alpha-backtest-v790.js';

const BASE='https://fapi.binance.com';
const SYMBOLS=(process.env.HYBRID_SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT').split(',').map(x=>x.trim()).filter(Boolean);
const WINDOWS=(process.env.HYBRID_WINDOWS||'30,60,90').split(',').map(Number).filter(x=>x>0);
const INTERVAL='15m';
const BAR_MS=15*60*1000;
const MAX_DAYS=Math.max(...WINDOWS);
const END=Date.now();
const START=END-(MAX_DAYS+12)*86400000;

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const median=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const sd=a=>{if(a.length<2)return null;const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))};
const ret=(a,b)=>a&&b?a/b-1:null;

async function getJson(url){const r=await fetch(url,{headers:{'user-agent':'MERIDIAN-research/7.90'}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json()}
async function klines(symbol){
  let cursor=START,out=[];
  while(cursor<END){
    const url=`${BASE}/fapi/v1/klines?symbol=${symbol}&interval=${INTERVAL}&startTime=${cursor}&endTime=${END}&limit=1500`;
    const xs=await getJson(url);if(!xs.length)break;
    for(const x of xs)out.push({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],q:+x[7],tbq:+x[10]});
    const next=+xs.at(-1)[0]+BAR_MS;if(next<=cursor)break;cursor=next;
  }
  return out.filter((x,i,a)=>!i||x.t!==a[i-1].t);
}
function ema(values,p){const k=2/(p+1),out=[];let e=values[0];for(const v of values){e=e==null?v:e+k*(v-e);out.push(e)}return out}
function closedBucketEma(rows,bucketMs,p){
  const k=2/(p+1),out=[];let e=null;
  for(let i=0;i<rows.length;i++){
    if((rows[i].t+BAR_MS)%bucketMs===0)e=e==null?rows[i].c:e+k*(rows[i].c-e);
    out.push(e);
  }
  return out;
}
function atr(rows,p=14){const tr=rows.map((x,i)=>i?Math.max(x.h-x.l,Math.abs(x.h-rows[i-1].c),Math.abs(x.l-rows[i-1].c)):x.h-x.l);return ema(tr,p)}
function rollingMedian(values,p){return values.map((_,i)=>median(values.slice(Math.max(0,i-p+1),i+1)))}
function regimeOf(btc,i,ema20,ema50,ema200,atr14){
  const c=btc[i].c,a=atr14[i]||0;
  const sep=a?Math.abs(ema20[i]-ema50[i])/a:0;
  if(sep<.35)return 'RANGE';
  if(ema20[i]>ema50[i]&&ema50[i]>ema200[i]&&c>ema20[i])return 'BULL';
  if(ema20[i]<ema50[i]&&ema50[i]<ema200[i]&&c<ema20[i])return 'BEAR';
  return 'TRANSITION';
}
function buildSamples(data,symbol,horizonBars){
  const xs=data[symbol],btc=data.BTCUSDT;
  const closes=xs.map(x=>x.c),e20=ema(closes,20),e50=ema(closes,50),a14=atr(xs,14);
  const h1e20=closedBucketEma(xs,3600000,20),h1e50=closedBucketEma(xs,3600000,50);
  const h4e20=closedBucketEma(xs,14400000,20),h4e50=closedBucketEma(xs,14400000,50);
  const btcCl=btc.map(x=>x.c),b20=ema(btcCl,20),b50=ema(btcCl,50),b200=ema(btcCl,200),ba14=atr(btc,14);
  const volMed=rollingMedian(xs.map(x=>x.q),96*7);
  const byTime=new Map(btc.map((x,i)=>[x.t,i]));
  const out=[];
  // Step by the forward horizon so realized labels do not overlap.
  for(let i=800;i<xs.length-horizonBars;i+=horizonBars){
    const bi=byTime.get(xs[i].t);if(bi==null||bi<200)continue;
    const c=xs[i].c,atrPct=a14[i]/c;if(!(atrPct>0)||h1e20[i]==null||h1e50[i]==null||h4e20[i]==null||h4e50[i]==null)continue;
    const r12=ret(c,xs[i-48]?.c)??0,r48=ret(c,xs[i-192]?.c)??0;
    const btc12=ret(btc[bi].c,btc[bi-48]?.c)??0;
    const trend15=clamp((e20[i]-e50[i])/(a14[i]*2),-1,1);
    const trend1h=clamp((h1e20[i]-h1e50[i])/(a14[i]*4),-1,1);
    const trend4h=clamp((h4e20[i]-h4e50[i])/(a14[i]*8),-1,1);
    const trend=clamp(.25*trend15+.35*trend1h+.40*trend4h,-1,1);
    const momentum=clamp((.65*r12+.35*r48)/(atrPct*4),-1,1);
    const relativeStrength=clamp((r12-btc12)/(atrPct*3),-1,1);
    const meanReversion=clamp(-(c-e20[i])/(a14[i]*2),-1,1);
    const takerRatio=xs[i].q>0?xs[i].tbq/xs[i].q:.5;
    const orderFlow=clamp((takerRatio-.5)*4,-1,1);
    const rv=sd(xs.slice(i-96,i+1).map((x,j,a)=>j?Math.log(x.c/a[j-1].c):0).slice(1))||0;
    const rvLong=sd(xs.slice(Math.max(1,i-96*7),i+1).map((x,j,a)=>j?Math.log(x.c/a[j-1].c):0).slice(1))||rv||1;
    const volatilityRatio=clamp(rv/(rvLong||1),.25,4);
    const liquidityQuality=clamp(xs[i].q/(volMed[i]||xs[i].q||1),0,1);
    // Extension against the prevailing trend raises reversal risk, but never blocks entry by itself.
    const reversalRisk=clamp(Math.abs(meanReversion)*Math.max(0,-trend*meanReversion),0,1);
    const fwd=(xs[i+horizonBars].c-c)/c;
    const forwardR=fwd/atrPct;
    out.push({timestamp:new Date(xs[i].t).toISOString(),symbol,forwardR,features:{regime:regimeOf(btc,bi,b20,b50,b200,ba14),trend,momentum,relativeStrength,meanReversion,orderFlow,volatilityRatio,liquidityQuality,reversalRisk,timeframeEvidence:{trend15m:trend15,trend1h,trend4h}}});
  }
  return out;
}
function sliceDays(samples,days){const cut=END-days*86400000;return samples.filter(x=>Date.parse(x.timestamp)>=cut)}
function summarize(samples,costR){return {result:runHybridAlphaBacktest(samples,{costR}),walkForward:walkForwardSlices(samples,{costR,folds:3})}}

const data={};
for(const s of SYMBOLS){console.log(`fetch ${s}`);data[s]=await klines(s)}
if(!data.BTCUSDT)throw new Error('BTCUSDT required for market regime / relative strength');
const horizons={h4:16,h12:48,h24:96};
const evidence={schemaVersion:'7.90-HYBRID-EVIDENCE-V2',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,source:'BINANCE_FUTURES_PUBLIC_15M',symbols:SYMBOLS,windows:WINDOWS,horizons:{},notes:['Decision-time trend blends closed 15m, 1h and 4h evidence; no future candles enter the feature snapshot.','Forward labels are sampled at the horizon stride, so outcome windows do not overlap.','No funding/carry input in this first public-candle evidence pass; missing evidence is renormalized by Hybrid Alpha V1.','orderFlow uses Binance kline taker-buy quote-volume imbalance as a bar-level proxy, not full order-book OFI.','forwardR is future return divided by decision-time ATR14 percent; it is a normalized research outcome, not Baseline TP/SL R.']};
for(const [name,bars] of Object.entries(horizons)){
  const all=SYMBOLS.flatMap(s=>buildSamples(data,s,bars));
  evidence.horizons[name]={};
  for(const days of WINDOWS)evidence.horizons[name][`${days}d`]=summarize(sliceDays(all,days),0.03);
}
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile('artifacts/hybrid-alpha-v790-evidence.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(evidence.horizons).map(([h,w])=>[h,Object.fromEntries(Object.entries(w).map(([k,v])=>[k,v.result.summary]))])),null,2));
