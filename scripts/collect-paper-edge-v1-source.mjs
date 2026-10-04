import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
import {EDGE_V1_SOURCE,validateSource} from '../research/paper-edge-v1-data-contract.js';

const ARCHIVE='https://data.binance.vision';
const start=Date.parse(EDGE_V1_SOURCE.start),end=Date.parse(EDGE_V1_SOURCE.end),DAY=24*60*60*1000;
function stampDay(ms){return new Date(ms).toISOString().slice(0,10)}
async function archiveCsv(rel,name,{missingOk=false}={}){
 const [zr,cr]=await Promise.all([fetch(`${ARCHIVE}/${rel}`),fetch(`${ARCHIVE}/${rel}.CHECKSUM`)]);
 if(zr.status===404&&cr.status===404&&missingOk)return null;
 if(!zr.ok||!cr.ok)throw new Error(`ARCHIVE_HTTP ${zr.status}/${cr.status} ${rel}`);
 const bytes=Buffer.from(await zr.arrayBuffer()),checksumText=(await cr.text()).trim();
 const match=checksumText.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);if(!match||path.basename(match[2].trim())!==name)throw new Error(`ARCHIVE_CHECKSUM_FORMAT ${rel}`);
 const expected=match[1].toLowerCase(),actual=crypto.createHash('sha256').update(bytes).digest('hex');if(actual!==expected)throw new Error(`ARCHIVE_CHECKSUM ${rel}`);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'edge-v1-')),zip=path.join(dir,name);
 try{await fs.writeFile(zip,bytes);const {stdout}=await execFileAsync('unzip',['-p',zip],{maxBuffer:32*1024*1024});return stdout;}
 finally{await fs.rm(dir,{recursive:true,force:true});}
}
function parseKlineCsv(csv){
 return String(csv||'').trim().split(/\r?\n/).filter(Boolean).filter(x=>/^\d/.test(x)).map(line=>{const r=line.split(',');return{openTime:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:+r[6]};});
}
export function parseFundingCsv(csv){
 const lines=String(csv||'').trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!lines.length)return[];
 const first=lines[0].split(',').map(x=>x.trim().toLowerCase());let timeIndex=0,rateIndex=2,data=lines;
 if(!/^\d/.test(lines[0])){
  timeIndex=first.indexOf('calc_time');if(timeIndex<0)timeIndex=first.indexOf('fundingtime');
  rateIndex=first.indexOf('last_funding_rate');if(rateIndex<0)rateIndex=first.indexOf('fundingrate');
  if(timeIndex<0||rateIndex<0)throw new Error('FUNDING_ARCHIVE_SCHEMA');data=lines.slice(1);
 }
 return data.map(line=>{const r=line.split(','),time=Number(r[timeIndex]),rate=Number(r[rateIndex]);if(!Number.isFinite(time)||!Number.isFinite(rate))throw new Error('FUNDING_ARCHIVE_ROW');return{time,rate,markPrice:null,rateType:null};});
}
async function monthlyOrDaily({symbol,year,month,kind,interval,parse}){
 const ym=`${year}-${String(month).padStart(2,'0')}`;
 const stem=kind==='klines'?`${symbol}-${interval}-${ym}`:`${symbol}-fundingRate-${ym}`;
 const monthlyRel=kind==='klines'?`data/futures/um/monthly/klines/${symbol}/${interval}/${stem}.zip`:`data/futures/um/monthly/fundingRate/${symbol}/${stem}.zip`;
 const monthly=await archiveCsv(monthlyRel,`${stem}.zip`,{missingOk:true});if(monthly!=null)return parse(monthly);
 const monthStart=Date.UTC(year,month-1,1),monthEnd=Date.UTC(year,month,1)-1,from=Math.max(start,monthStart),to=Math.min(end,monthEnd),out=[];
 for(let d=Date.UTC(year,month-1,new Date(from).getUTCDate());d<=to;d+=DAY){
  const ds=stampDay(d),dayStem=kind==='klines'?`${symbol}-${interval}-${ds}`:`${symbol}-fundingRate-${ds}`;
  const rel=kind==='klines'?`data/futures/um/daily/klines/${symbol}/${interval}/${dayStem}.zip`:`data/futures/um/daily/fundingRate/${symbol}/${dayStem}.zip`;
  const csv=await archiveCsv(rel,`${dayStem}.zip`);out.push(...parse(csv));
 }
 return out;
}
export async function bars(symbol){
 const out=[],sd=new Date(start),ed=new Date(end);
 for(let y=sd.getUTCFullYear(),m=sd.getUTCMonth()+1;y<ed.getUTCFullYear()||(y===ed.getUTCFullYear()&&m<=ed.getUTCMonth()+1);){out.push(...await monthlyOrDaily({symbol,year:y,month:m,kind:'klines',interval:'4h',parse:parseKlineCsv}));if(++m===13){m=1;y++;}}
 const rows=out.filter(r=>r.openTime>=start&&r.closeTime<=end);return{rows,complete:rows.length>0&&Number(rows.at(-1).closeTime)>=end-(EDGE_V1_SOURCE.intervalMs-1)};
}
export async function funding(symbol){
 const out=[],sd=new Date(start),ed=new Date(end);
 for(let y=sd.getUTCFullYear(),m=sd.getUTCMonth()+1;y<ed.getUTCFullYear()||(y===ed.getUTCFullYear()&&m<=ed.getUTCMonth()+1);){out.push(...await monthlyOrDaily({symbol,year:y,month:m,kind:'fundingRate',parse:parseFundingCsv}));if(++m===13){m=1;y++;}}
 const rows=out.filter(r=>r.time>=start&&r.time<=end);return{rows,complete:rows.length>0&&Number(rows.at(-1).time)>=end-(8*60*60*1000)};
}
export async function collect(){
 const barsBySymbol={},fundingBySymbol={},barComplete={},fundComplete={};
 for(const symbol of EDGE_V1_SOURCE.symbols){const b=await bars(symbol),f=await funding(symbol);barsBySymbol[symbol]=b.rows;fundingBySymbol[symbol]=f.rows;barComplete[symbol]=b.complete;fundComplete[symbol]=f.complete;}
 const provenance={provider:'Binance USD-M Futures',archive:ARCHIVE,klines:'official monthly archive with daily fallback; SHA256 CHECKSUM verified',funding:'official fundingRate monthly archive with daily fallback; SHA256 CHECKSUM verified',barComplete,fundingComplete:fundComplete,paginationComplete:EDGE_V1_SOURCE.symbols.every(s=>barComplete[s]&&fundComplete[s])};
 const validation=validateSource({barsBySymbol,fundingBySymbol,provenance});if(!validation.ok)throw new Error(JSON.stringify(validation));
 return{schema:'PAPER-EDGE-V1-SOURCE-PACKAGE-1',researchOnly:true,executionImpact:false,collectedAt:new Date().toISOString(),provenance,receipt:validation.receipt,barsBySymbol,fundingBySymbol};
}
if(import.meta.url===`file://${process.argv[1]}`){const out=await collect();await fs.mkdir('research/data',{recursive:true});await fs.writeFile('research/data/paper-edge-v1-source.json',JSON.stringify(out));console.log(JSON.stringify(out.receipt,null,2));}
