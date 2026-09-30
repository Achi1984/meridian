import fs from 'node:fs';
import path from 'node:path';
import {TSMOM_V2_PREREGISTRATION} from './paper-profit-tsmom-v2-preregistration.js';
import {runTsmomV2Discovery} from './paper-profit-tsmom-v2-evaluator.js';

const DAYS=1460;
const WARMUP=420;
const BARS=DAYS+WARMUP;
const OUT_DIR=path.resolve('research/results');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function getJson(url){
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'MERIDIAN-research-only'}});
  if(!r.ok)throw new Error('HTTP '+r.status+' '+url);
  return r.json();
}
async function page(symbol,limit,endTime){
  const qs=new URLSearchParams({symbol:symbol+'USDT',interval:'1d',limit:String(limit),endTime:String(Math.floor(endTime))});
  let last;
  for(const base of ['https://api.binance.com/api/v3/klines','https://data-api.binance.vision/api/v3/klines']){
    try{
      const rows=await getJson(base+'?'+qs.toString());
      if(Array.isArray(rows))return rows;
      last=new Error('INVALID '+base);
    }catch(e){last=e}
  }
  throw last||new Error('NO SOURCE');
}
async function history(symbol,want=BARS){
  const out=[];let end=Date.now(),guard=0;
  while(out.length<want&&guard++<12){
    const limit=Math.min(1000,want-out.length),raw=await page(symbol,limit,end);
    if(!raw.length)break;
    const rows=raw.map(x=>({openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closeTime:+x[6]}))
      .filter(x=>[x.openTime,x.open,x.high,x.low,x.close,x.closeTime].every(Number.isFinite));
    if(!rows.length)break;
    out.unshift(...rows);end=rows[0].openTime-1;
    if(out.length<want)await sleep(150);
  }
  const now=Date.now();
  return [...new Map(out.map(x=>[x.openTime,x])).values()]
    .filter(x=>x.closeTime<now-1000)
    .sort((a,b)=>a.openTime-b.openTime)
    .slice(-want);
}

const data={},sources={};
for(const symbol of TSMOM_V2_PREREGISTRATION.universe){
  process.stdout.write('load '+symbol+' ... ');
  const rows=await history(symbol);
  if(rows.length<500)throw new Error(symbol+' source gate <500 bars: '+rows.length);
  data[symbol]=rows;
  sources[symbol]={bars:rows.length,first:new Date(rows[0].openTime).toISOString(),last:new Date(rows.at(-1).openTime).toISOString()};
  console.log(rows.length);
  await sleep(200);
}

const result=runTsmomV2Discovery(data);
const evidence={
  generatedAt:new Date().toISOString(),
  dataContract:{
    source:'Binance spot 1d klines',
    primary:'https://api.binance.com/api/v3/klines',
    fallback:'https://data-api.binance.vision/api/v3/klines',
    requestedDays:DAYS,warmupDays:WARMUP,requestedBars:BARS,
    closedBarsOnly:true
  },
  sources,
  result
};
fs.mkdirSync(OUT_DIR,{recursive:true});
fs.writeFileSync(path.join(OUT_DIR,'paper-profit-tsmom-v2-result.json'),JSON.stringify(evidence,null,2)+'\n');
const d=result.discovery||null,h=result.holdout||null;
const md=`# Paper Profit TSMOM V2 — First Untouched Result

Generated: ${evidence.generatedAt}

Decision: **${result.decision}**

Split: ${result.split?.ok?`${new Date(result.split.discoveryFrom).toISOString()} → ${new Date(result.split.discoveryTo).toISOString()} / holdout ${new Date(result.split.holdoutFrom).toISOString()} → ${new Date(result.split.holdoutTo).toISOString()}`:'unavailable'}

Discovery: ${d?JSON.stringify(d):'not evaluated'}

Holdout: ${h?JSON.stringify(h):'not evaluated'}

Research only. No auto-promotion. No live execution impact.
`;
fs.writeFileSync(path.join(OUT_DIR,'paper-profit-tsmom-v2-result.md'),md);
console.log(JSON.stringify({decision:result.decision,split:result.split,discovery:result.discovery,holdout:result.holdout},null,2));
