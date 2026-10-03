import fs from 'node:fs';
import path from 'node:path';
import {REGIME_TREND_BREAKOUT_V1} from '../research/paper-profit-regime-trend-breakout-v1-preregistration.js';

export const SOURCE_START_UTC='2021-08-08T00:00:00.000Z';
export const SOURCE_END_UTC='2026-09-30T23:59:59.999Z';
const START=Date.parse(SOURCE_START_UTC),END=Date.parse(SOURCE_END_UTC),OUT=path.resolve('research/results/regime-trend-breakout-v1-source.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function getJson(url){
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'MERIDIAN-research-only'}});
  if(!r.ok)throw new Error('HTTP '+r.status+' '+url);
  return r.json();
}
async function page(symbol,startTime){
  const qs=new URLSearchParams({symbol:symbol+'USDT',interval:'1d',limit:'1000',startTime:String(startTime),endTime:String(END)});
  let last;
  for(const base of ['https://api.binance.com/api/v3/klines','https://data-api.binance.vision/api/v3/klines']){
    try{
      const rows=await getJson(base+'?'+qs.toString());
      if(Array.isArray(rows))return rows;
      last=new Error('INVALID '+base);
    }catch(e){last=e}
  }
  throw last||new Error('NO_SOURCE');
}
async function history(symbol){
  const out=[];let cursor=START,guard=0;
  while(cursor<=END&&guard++<8){
    const raw=await page(symbol,cursor);
    if(!raw.length)break;
    const rows=raw.map(x=>({openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closeTime:+x[6]}))
      .filter(x=>[x.openTime,x.open,x.high,x.low,x.close,x.closeTime].every(Number.isFinite))
      .filter(x=>x.openTime>=START&&x.openTime<=END&&x.closeTime<=END&&x.closeTime>x.openTime);
    if(!rows.length)break;
    out.push(...rows);
    const next=rows.at(-1).openTime+86400000;
    if(next<=cursor)throw new Error(symbol+' pagination_not_advancing');
    cursor=next;
    if(raw.length<1000)break;
    await sleep(150);
  }
  return [...new Map(out.map(x=>[x.openTime,x])).values()].sort((a,b)=>a.openTime-b.openTime);
}

const data={},sources={};
for(const symbol of REGIME_TREND_BREAKOUT_V1.universe){
  process.stdout.write('load '+symbol+' ... ');
  const rows=await history(symbol);
  if(rows.length<500)throw new Error(symbol+' source gate <500 bars: '+rows.length);
  data[symbol]=rows;
  sources[symbol]={bars:rows.length,first:new Date(rows[0].openTime).toISOString(),last:new Date(rows.at(-1).openTime).toISOString()};
  console.log(rows.length);
  await sleep(200);
}
const payload={
  schemaVersion:'MERIDIAN-REGIME-TREND-BREAKOUT-V1-SOURCE-1',
  generatedAt:new Date().toISOString(),
  contract:{
    source:'Binance Spot public 1d klines',
    primary:'https://api.binance.com/api/v3/klines',
    fallback:'https://data-api.binance.vision/api/v3/klines',
    sourceStartUtc:SOURCE_START_UTC,
    sourceEndUtc:SOURCE_END_UTC,
    closedBarsOnly:true,
    privateData:false,
    syntheticHistory:false
  },
  sources,data
};
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(payload)+'\n');
console.log(JSON.stringify({schemaVersion:payload.schemaVersion,sources,sourceStartUtc:SOURCE_START_UTC,sourceEndUtc:SOURCE_END_UTC},null,2));
