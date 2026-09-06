import fs from 'node:fs/promises';
import {runFibLevelBot} from '../fib-level-bot-v1.js';

const BASE='https://api.binance.com/api/v3/klines';
const SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT'];
const WINDOWS=[90,180,365];
const BAR_MS=15*60*1000,MAX_DAYS=365,WARMUP_DAYS=45;
const END=Math.floor(Date.now()/BAR_MS)*BAR_MS-BAR_MS;
const START=END-(MAX_DAYS+WARMUP_DAYS)*86400000;
const round=(v,d=3)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function getJson(url){const r=await fetch(url,{headers:{'user-agent':'MERIDIAN-FIB-research/1.0','accept':'application/json'}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json()}
async function candles(symbol){
  const out=[];let cursor=START;
  while(cursor<=END){
    const url=`${BASE}?symbol=${symbol}&interval=15m&startTime=${cursor}&endTime=${END}&limit=1000`;
    const rows=await getJson(url);if(!Array.isArray(rows)||!rows.length)break;
    for(const x of rows){const t=Number(x[0]);if(t>=START&&t<=END)out.push({t,o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]})}
    const next=Number(rows.at(-1)[0])+BAR_MS;if(next<=cursor)break;cursor=next;await sleep(80);
  }
  out.sort((a,b)=>a.t-b.t);return out.filter((x,i,a)=>!i||x.t!==a[i-1].t);
}
function resample(rows,bucketMs){
  const m=new Map();for(const r of rows){const t=Math.floor(r.t/bucketMs)*bucketMs;const b=m.get(t);if(!b)m.set(t,{t,o:r.o,h:r.h,l:r.l,c:r.c,v:r.v});else{b.h=Math.max(b.h,r.h);b.l=Math.min(b.l,r.l);b.c=r.c;b.v+=r.v}}
  return [...m.values()].sort((a,b)=>a.t-b.t).filter(x=>x.t+bucketMs<=END+BAR_MS);
}
function stats(rows=[]){
  const ordered=[...rows].sort((a,b)=>a.closedAt-b.closedAt),wins=ordered.filter(x=>x.netR>0),losses=ordered.filter(x=>x.netR<0);
  const gp=wins.reduce((a,x)=>a+x.netR,0),gl=Math.abs(losses.reduce((a,x)=>a+x.netR,0)),net=ordered.reduce((a,x)=>a+x.netR,0);
  let eq=0,peak=0,dd=0;for(const x of ordered){eq+=x.netR;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq)}
  return {closedBaskets:ordered.length,netR:round(net),expectancy:ordered.length?round(net/ordered.length):null,profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),winRate:ordered.length?round(wins.length/ordered.length*100,1):null,maxDrawdownR:round(dd),medianBarsInMarket:ordered.length?round([...ordered].sort((a,b)=>a.timeInMarketBars-b.timeInMarketBars)[Math.floor(ordered.length/2)].timeInMarketBars):null};
}
function group(rows,keyFn){const m={};for(const r of rows){const k=String(keyFn(r)??'UNKNOWN');(m[k]||(m[k]=[])).push(r)}return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,stats(v)]))}
function fold(rows,count=3){const xs=[...rows].sort((a,b)=>a.closedAt-b.closedAt),size=Math.ceil(xs.length/count),out=[];for(let i=0;i<count;i++){const part=xs.slice(i*size,(i+1)*size);if(part.length)out.push({fold:i+1,start:new Date(part[0].closedAt).toISOString(),end:new Date(part.at(-1).closedAt).toISOString(),summary:stats(part)})}return out}
function windowResult(runs,days){
  const cut=END-days*86400000,closed=runs.flatMap(x=>x.closed.map(b=>({...b,symbol:x.symbol,timeframe:x.timeframe}))).filter(x=>x.closedAt>=cut);
  const setups=runs.flatMap(x=>x._setups||[]).filter(x=>x.createdAt>=cut);
  const filled=setups.filter(x=>x.fills.length),barsInMarket=closed.reduce((a,x)=>a+x.timeInMarketBars,0);
  return {summary:stats(closed),opportunity:{setups:setups.length,filledBaskets:filled.length,closedBaskets:closed.length,unfilledSetups:setups.filter(x=>!x.fills.length).length,openBaskets:runs.reduce((a,x)=>a+x.open.filter(b=>b.createdAt>=cut).length,0),fillRatePct:setups.length?round(filled.length/setups.length*100,1):null,timeInMarketBars:barsInMarket},bySide:group(closed,x=>x.side),byRegime:group(closed,x=>x.regime),bySymbol:group(closed,x=>x.symbol),byFirstLevel:group(closed,x=>x.firstRatio?.toFixed(3)||'UNKNOWN'),byDeepestLevel:group(closed,x=>x.deepestRatio?.toFixed(3)||'UNKNOWN'),walkForward:days===365?fold(closed):[],rows:closed};
}

const raw={};for(const s of SYMBOLS){console.log(`fetch ${s}`);raw[s]=await candles(s)}
const frames={m15:BAR_MS,h1:4*BAR_MS,h4:16*BAR_MS},out={schemaVersion:'FIB-LEVEL-BOT-V1-EVIDENCE',generatedAt:new Date().toISOString(),cutoff:new Date(END).toISOString(),researchOnly:true,executionImpact:false,source:'BINANCE_SPOT_PUBLIC_KLINES',symbols:SYMBOLS,windows:WINDOWS,timeframes:{},notes:['Entries and exits use frozen FIB prices only.','Pivots become available only after three right bars close.','ATR only rejects micro-swings; regime is descriptive and has zero decision impact.','Open baskets are not force-closed at cutoff.']};
for(const [tf,ms] of Object.entries(frames)){
  const runs=[];for(const symbol of SYMBOLS){const bars=ms===BAR_MS?raw[symbol]:resample(raw[symbol],ms);const run=runFibLevelBot(bars,{symbol,timeframe:tf});run._setups=run.setups;runs.push(run)}
  out.timeframes[tf]={};for(const days of WINDOWS)out.timeframes[tf][`${days}d`]=windowResult(runs,days);
}
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/fib-level-bot-v1-evidence.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.timeframes).map(([tf,ws])=>[tf,Object.fromEntries(Object.entries(ws).map(([w,b])=>[w,{summary:b.summary,opportunity:b.opportunity,folds:b.walkForward}]))])),null,2));
