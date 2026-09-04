// ACHI MERIDIAN Adaptive Evidence Market Source — v7.74
// Research-only adapter. Reuses the canonical cloud-backtest candidate constructor while keeping Paper execution untouched.

import { CLOUD_BT_CONFIG, __test as cloudResearch } from './cloud-backtest.js';

export const ADAPTIVE_SOURCE_VERSION='7.74-ADAPTIVE-SOURCE-V1';
const BINANCE='https://api.binance.com';
const MS={'15m':900000,'1h':3600000,'4h':14400000};
const DAY=86400000;
const last=a=>a[a.length-1];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function ema(v,p){if(!v.length)return[];const k=2/(p+1),o=[v[0]];for(let i=1;i<v.length;i++)o.push(v[i]*k+o[i-1]*(1-k));return o}
function rsi(v,p=14){if(v.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];d>=0?g+=d:l-=d}g/=p;l/=p;for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}if(l===0)return 100;const rs=g/l;return 100-100/(1+rs)}
function atr(c,p=14){if(c.length<p+1)return null;const tr=[];for(let i=1;i<c.length;i++){const x=c[i],y=c[i-1];tr.push(Math.max(x.high-x.low,Math.abs(x.high-y.close),Math.abs(x.low-y.close)))}let a=tr.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<tr.length;i++)a=(a*(p-1)+tr[i])/p;return a}
function macd(v){if(v.length<35)return null;const a=ema(v,12),b=ema(v,26),m=v.map((_,i)=>(a[i]??0)-(b[i]??0)),s=ema(m,9);return{hist:last(m)-last(s)}}
function adx(c,p=14){if(c.length<p*2+2)return null;const tr=[],pd=[],md=[];for(let i=1;i<c.length;i++){const x=c[i],y=c[i-1],up=x.high-y.high,dn=y.low-x.low;pd.push(up>dn&&up>0?up:0);md.push(dn>up&&dn>0?dn:0);tr.push(Math.max(x.high-x.low,Math.abs(x.high-y.close),Math.abs(x.low-y.close)))}let trp=tr.slice(0,p).reduce((a,b)=>a+b,0),pp=pd.slice(0,p).reduce((a,b)=>a+b,0),mp=md.slice(0,p).reduce((a,b)=>a+b,0),dx=[];for(let i=p;i<tr.length;i++){if(i>p){trp=trp-trp/p+tr[i];pp=pp-pp/p+pd[i];mp=mp-mp/p+md[i]}const pdi=trp?100*pp/trp:0,mdi=trp?100*mp/trp:0;dx.push(pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0)}if(dx.length<p)return null;let a=dx.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<dx.length;i++)a=(a*(p-1)+dx[i])/p;return a}
function vol(c,n=20){if(c.length<n+1)return 1;const v=c.map(x=>x.volume),cur=last(v),base=v.slice(-(n+1),-1).reduce((a,b)=>a+b,0)/n;return base>0?cur/base:1}
function metrics(c){const closes=c.map(x=>x.close),e20=ema(closes,20),e50=ema(closes,50);return{price:last(closes),ema20:last(e20),ema50:last(e50),rsi:rsi(closes),macd:macd(closes),atr:atr(c),adx:adx(c),volumeRatio:vol(c)}}

function lastIndexAt(rows,t){let lo=0,hi=rows.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(rows[m].closeTime<=t){ans=m;lo=m+1}else hi=m-1}return ans}
function windowMetrics(rows,t){const i=lastIndexAt(rows,t);if(i<59)return null;return metrics(rows.slice(Math.max(0,i-179),i+1))}

export function adaptiveSignalAt(symbol,data,t,cfg=CLOUD_BT_CONFIG){
  const m15=windowMetrics(data['15m']||[],t),h1=windowMetrics(data['1h']||[],t),h4=windowMetrics(data['4h']||[],t);
  if(!m15||!h1||!h4)return null;
  return cloudResearch.candidate(symbol,{'15m':m15,'1h':h1,'4h':h4},cfg);
}

export function prepareAdaptiveEventsFromMarket(market,start,end,cfg=CLOUD_BT_CONFIG,onProgress=()=>{}){
  const times=[...new Set(Object.values(market||{}).flatMap(x=>(x?.['15m']||[]).map(c=>c.closeTime).filter(t=>t>=start&&t<=end)))].sort((a,b)=>a-b);
  const maps={};
  for(const [symbol,data] of Object.entries(market||{}))maps[symbol]=new Map((data['15m']||[]).map(c=>[c.closeTime,c]));
  const events=[];
  for(let i=0;i<times.length;i++){
    const t=times[i],candles={},signals={};
    for(const [symbol,data] of Object.entries(market||{})){
      const c=maps[symbol].get(t);if(!c)continue;
      candles[symbol]=c;
      const sig=adaptiveSignalAt(symbol,data,t,cfg);if(sig)signals[symbol]=sig;
    }
    events.push({t,candles,signals});
    if(i&&i%1000===0)onProgress({stage:'prepare',pct:Math.round(i/times.length*100)});
  }
  return events;
}

async function fetchKlines(symbol,interval,start,end,{fetchImpl=globalThis.fetch,onRetry=()=>{}}={}){
  if(typeof fetchImpl!=='function')throw new Error('Adaptive Evidence source requires fetch');
  let out=[],cur=start,guard=0;
  while(cur<end&&guard++<800){
    const url=`${BINANCE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${Math.floor(cur)}&endTime=${Math.floor(end)}&limit=1000`;
    let json,lastErr;
    for(let attempt=0;attempt<6;attempt++){
      try{
        const response=await fetchImpl(url,{headers:{'user-agent':'ACHI-MERIDIAN-ADAPTIVE-EVIDENCE/7.74'}});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        json=await response.json();break;
      }catch(error){lastErr=error;onRetry({symbol,interval,attempt:error?attempt+1:attempt,error:String(error?.message||error)});if(attempt<5)await sleep(Math.min(8000,500*2**attempt))}
    }
    if(!Array.isArray(json))throw lastErr||new Error('Binance load failed');
    if(!json.length)break;
    const rows=json.map(k=>({openTime:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],closeTime:+k[6]}));
    out.push(...rows);
    const next=rows.at(-1).openTime+MS[interval];if(next<=cur)break;cur=next;
    await sleep(75);
  }
  return [...new Map(out.map(x=>[x.openTime,x])).values()].sort((a,b)=>a.openTime-b.openTime);
}

export async function loadAdaptiveMarket({assets,start,end,fetchImpl=globalThis.fetch,onProgress=()=>{}}={}){
  if(!Array.isArray(assets)||!assets.length)throw new Error('Adaptive Evidence source requires assets');
  const market={};
  for(let i=0;i<assets.length;i++){
    const symbol=String(assets[i]).toUpperCase();
    onProgress({stage:'loading',asset:symbol,index:i,total:assets.length,pct:Math.round(i/assets.length*100)});
    const options={fetchImpl,onRetry:x=>onProgress({stage:'retry',...x})};
    const [m15,h1,h4]=await Promise.all([
      fetchKlines(symbol,'15m',start,end,options),
      fetchKlines(symbol,'1h',start,end,options),
      fetchKlines(symbol,'4h',start,end,options)
    ]);
    market[symbol]={'15m':m15,'1h':h1,'4h':h4};
  }
  onProgress({stage:'loaded',pct:100});
  return market;
}

export async function loadPreparedAdaptiveEvents({assets,windowsDays=[30,60,90],horizonDays=14,dataEnd=Date.now(),cfg=CLOUD_BT_CONFIG,fetchImpl=globalThis.fetch,onProgress=()=>{}}={}){
  const maxWindow=Math.max(...windowsDays.map(Number).filter(Number.isFinite));
  if(!(maxWindow>0))throw new Error('Adaptive Evidence source requires at least one positive window');
  const signalEnd=dataEnd+horizonDays*0-DAY*horizonDays;
  const signalStart=signalEnd-maxWindow*DAY;
  const warmStart=signalStart-60*MS['4h'];
  const market=await loadAdaptiveMarket({assets,start:warmStart,end:dataEnd,fetchImpl,onProgress});
  const events=prepareAdaptiveEventsFromMarket(market,signalStart,dataEnd,cfg,p=>onProgress({...p,stage:'prepare'}));
  return{
    version:ADAPTIVE_SOURCE_VERSION,
    researchOnly:true,
    executionImpact:false,
    method:'CANONICAL_CLOUD_CANDIDATE_PLUS_MATCHED_INDICATOR_WINDOWS',
    assets:[...assets],windowsDays:[...windowsDays],horizonDays,dataEnd,signalStart,signalEnd,warmStart,
    market,events
  };
}

export const __test={metrics,windowMetrics,fetchKlines,lastIndexAt};
