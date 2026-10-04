import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
import {EDGE_V1_SOURCE,validateSource} from '../research/paper-edge-v1-data-contract.js';

const BASE='https://fapi.binance.com';
const ARCHIVE='https://data.binance.vision';
const start=Date.parse(EDGE_V1_SOURCE.start), end=Date.parse(EDGE_V1_SOURCE.end);
async function get(path,params){
 const u=new URL(path,BASE); for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
 const r=await fetch(u,{headers:{'user-agent':'MERIDIAN-PAPER-EDGE-V1-RESEARCH'}});
 if(!r.ok)throw new Error(`HTTP ${r.status} ${u.pathname}`); return r.json();
}
async function archiveMonth(symbol,year,month){
 const ym=`${year}-${String(month).padStart(2,'0')}`, name=`${symbol}-4h-${ym}.zip`;
 const rel=`data/futures/um/monthly/klines/${symbol}/4h/${name}`;
 const [zr,cr]=await Promise.all([fetch(`${ARCHIVE}/${rel}`),fetch(`${ARCHIVE}/${rel}.CHECKSUM`)]);
 if(zr.status===404)return[]; if(!zr.ok||!cr.ok)throw new Error(`ARCHIVE_HTTP ${zr.status}/${cr.status} ${rel}`);
 const bytes=Buffer.from(await zr.arrayBuffer()), expected=(await cr.text()).trim().split(/\\s+/)[0].toLowerCase();
 const actual=crypto.createHash('sha256').update(bytes).digest('hex'); if(actual!==expected)throw new Error(`ARCHIVE_CHECKSUM ${rel}`);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'edge-v1-')); const zip=path.join(dir,name);
 try{await fs.writeFile(zip,bytes);const {stdout}=await execFileAsync('unzip',['-p',zip],{maxBuffer:32*1024*1024});
  return stdout.trim().split(/\\r?\\n/).filter(Boolean).filter(x=>/^\\d/.test(x)).map(line=>{const r=line.split(',');return{openTime:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:+r[6]};});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
export async function bars(symbol){
 const out=[]; const sd=new Date(start),ed=new Date(end);
 for(let y=sd.getUTCFullYear(),m=sd.getUTCMonth()+1;y<ed.getUTCFullYear()||(y===ed.getUTCFullYear()&&m<=ed.getUTCMonth()+1);){
  out.push(...await archiveMonth(symbol,y,m)); if(++m===13){m=1;y++;}
 }
 const rows=out.filter(r=>r.openTime>=start&&r.closeTime<=end);
 return{rows,complete:rows.length>0&&Number(rows.at(-1).closeTime)>=end-(EDGE_V1_SOURCE.intervalMs-1)};
}
export async function funding(symbol){
 const out=[]; let cursor=start;
 while(cursor<=end){
  const rows=await get('/fapi/v1/fundingRate',{symbol,startTime:cursor,endTime:end,limit:1000});
  if(!rows.length)break;
  for(const r of rows)if(Number(r.fundingTime)<=end)out.push({time:Number(r.fundingTime),rate:Number(r.fundingRate),markPrice:r.markPrice==null?null:Number(r.markPrice),rateType:r.rateType??null});
  const next=Number(rows.at(-1).fundingTime)+1;if(next<=cursor)throw new Error('NON_ADVANCING_FUNDING');cursor=next;
 }
 return{rows:out,complete:out.length>0&&Number(out[0].time)>=start&&Number(out.at(-1).time)>=end-(8*60*60*1000)};
}
export async function collect(){
 const barsBySymbol={},fundingBySymbol={};
 const barComplete={},fundComplete={};
 for(const symbol of EDGE_V1_SOURCE.symbols){const b=await bars(symbol),f=await funding(symbol);barsBySymbol[symbol]=b.rows;fundingBySymbol[symbol]=f.rows;barComplete[symbol]=b.complete;fundComplete[symbol]=f.complete;}
 const provenance={provider:'Binance USD-M Futures',base:BASE,archive:ARCHIVE,klines:'official monthly archive sourced from /fapi/v1/klines; SHA256 CHECKSUM verified',funding:'/fapi/v1/fundingRate',barComplete,fundingComplete:fundComplete,paginationComplete:EDGE_V1_SOURCE.symbols.every(s=>barComplete[s]&&fundComplete[s])};
 const validation=validateSource({barsBySymbol,fundingBySymbol,provenance});if(!validation.ok)throw new Error(JSON.stringify(validation));
 return{schema:'PAPER-EDGE-V1-SOURCE-PACKAGE-1',researchOnly:true,executionImpact:false,collectedAt:new Date().toISOString(),provenance,receipt:validation.receipt,barsBySymbol,fundingBySymbol};
}
if(import.meta.url===`file://${process.argv[1]}`){const out=await collect();await fs.mkdir('research/data',{recursive:true});await fs.writeFile('research/data/paper-edge-v1-source.json',JSON.stringify(out));console.log(JSON.stringify(out.receipt,null,2));}
