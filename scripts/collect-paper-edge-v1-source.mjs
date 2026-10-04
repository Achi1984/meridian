import fs from 'node:fs/promises';
import {EDGE_V1_SOURCE,validateSource} from '../research/paper-edge-v1-data-contract.js';

const BASE='https://fapi.binance.com';
const start=Date.parse(EDGE_V1_SOURCE.start), end=Date.parse(EDGE_V1_SOURCE.end);
async function get(path,params){
 const u=new URL(path,BASE); for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
 const r=await fetch(u,{headers:{'user-agent':'MERIDIAN-PAPER-EDGE-V1-RESEARCH'}});
 if(!r.ok)throw new Error(`HTTP ${r.status} ${u.pathname}`); return r.json();
}
async function bars(symbol){
 const out=[]; let cursor=start;
 while(cursor<=end){
  const rows=await get('/fapi/v1/klines',{symbol,interval:'4h',startTime:cursor,endTime:end,limit:1500});
  if(!rows.length)break;
  for(const r of rows){const [openTime,o,h,l,c,v,closeTime]=r;if(closeTime>end)continue;out.push({openTime,closeTime,open:+o,high:+h,low:+l,close:+c,volume:+v});}
  const next=Number(rows.at(-1)[6])+1;if(next<=cursor)throw new Error('NON_ADVANCING_KLINES');cursor=next;
 }
 return out;
}
async function funding(symbol){
 const out=[]; let cursor=start;
 while(cursor<=end){
  const rows=await get('/fapi/v1/fundingRate',{symbol,startTime:cursor,endTime:end,limit:1000});
  if(!rows.length)break;
  for(const r of rows)if(Number(r.fundingTime)<=end)out.push({time:Number(r.fundingTime),rate:Number(r.fundingRate),markPrice:r.markPrice==null?null:Number(r.markPrice),rateType:r.rateType??null});
  const next=Number(rows.at(-1).fundingTime)+1;if(next<=cursor)throw new Error('NON_ADVANCING_FUNDING');cursor=next;
 }
 return out;
}
export async function collect(){
 const barsBySymbol={},fundingBySymbol={};
 for(const symbol of EDGE_V1_SOURCE.symbols){barsBySymbol[symbol]=await bars(symbol);fundingBySymbol[symbol]=await funding(symbol);}
 const provenance={provider:'Binance USD-M Futures',base:BASE,klines:'/fapi/v1/klines',funding:'/fapi/v1/fundingRate',paginationComplete:true,fundingComplete:Object.fromEntries(EDGE_V1_SOURCE.symbols.map(s=>[s,true]))};
 const validation=validateSource({barsBySymbol,fundingBySymbol,provenance});if(!validation.ok)throw new Error(JSON.stringify(validation));
 return{schema:'PAPER-EDGE-V1-SOURCE-PACKAGE-1',researchOnly:true,executionImpact:false,collectedAt:new Date().toISOString(),provenance,receipt:validation.receipt,barsBySymbol,fundingBySymbol};
}
if(import.meta.url===`file://${process.argv[1]}`){const out=await collect();await fs.mkdir('research/data',{recursive:true});await fs.writeFile('research/data/paper-edge-v1-source.json',JSON.stringify(out));console.log(JSON.stringify(out.receipt,null,2));}
