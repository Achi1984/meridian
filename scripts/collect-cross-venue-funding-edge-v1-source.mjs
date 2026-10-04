import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  CROSS_VENUE_FUNDING_EDGE_V1_SOURCE as CONTRACT,
  validateCrossVenueSource
} from '../research/cross-venue-funding-edge-v1-data-contract.js';

const execFileAsync=promisify(execFile);
const BINANCE_ARCHIVE='https://data.binance.vision';
const BYBIT_API='https://api.bybit.com';
const START=Date.parse(CONTRACT.start),END=Date.parse(CONTRACT.end);
const HOUR=60*60*1000,DAY=24*HOUR;

const sha256=x=>crypto.createHash('sha256').update(x).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dayStamp=ms=>new Date(ms).toISOString().slice(0,10);

async function fetchRetry(url,options={},attempts=5){
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const r=await fetch(url,{...options,headers:{accept:'application/json','user-agent':'MERIDIAN-Cross-Venue-Edge-V1/1.0',...(options.headers||{})},signal:AbortSignal.timeout(30000)});
      if(r.ok)return r;
      last=new Error('HTTP '+r.status+' '+url);
      if(![418,429,500,502,503,504].includes(r.status))throw last;
    }catch(e){last=e}
    if(i<attempts-1)await sleep(1000*(i+1));
  }
  throw last;
}

async function archiveCsv(rel,name,{missingOk=false}={}){
  const [zr,cr]=await Promise.all([
    fetchRetry(`${BINANCE_ARCHIVE}/${rel}`,{},3).catch(e=>e),
    fetchRetry(`${BINANCE_ARCHIVE}/${rel}.CHECKSUM`,{},3).catch(e=>e)
  ]);
  if(zr instanceof Error||cr instanceof Error){
    const z404=String(zr?.message||'').includes('HTTP 404'),c404=String(cr?.message||'').includes('HTTP 404');
    if(missingOk&&z404&&c404)return null;
    throw zr instanceof Error?zr:cr;
  }
  const bytes=Buffer.from(await zr.arrayBuffer()),checksumText=(await cr.text()).trim();
  const match=checksumText.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
  if(!match||path.basename(match[2].trim())!==name)throw new Error('BINANCE_CHECKSUM_FORMAT '+rel);
  const expected=match[1].toLowerCase(),actual=sha256(bytes);
  if(actual!==expected)throw new Error('BINANCE_CHECKSUM_MISMATCH '+rel);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cross-venue-v1-')),zip=path.join(dir,name);
  try{
    await fs.writeFile(zip,bytes);
    const {stdout}=await execFileAsync('unzip',['-p',zip],{maxBuffer:64*1024*1024});
    return{csv:stdout,checksum:expected,rel};
  }finally{await fs.rm(dir,{recursive:true,force:true})}
}

function parseMarkCsv(csv){
  return String(csv||'').trim().split(/\r?\n/).filter(Boolean).filter(x=>/^\d/.test(x)).map(line=>{
    const r=line.split(',');
    return{openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])};
  });
}

function parseFundingCsv(csv){
  const lines=String(csv||'').trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length)return[];
  const first=lines[0].split(',').map(x=>x.trim()),lower=first.map(x=>x.toLowerCase());
  let ti=0,ri=2,data=lines;
  if(!/^\d/.test(lines[0])){
    ti=lower.indexOf('calc_time');if(ti<0)ti=lower.indexOf('fundingtime');
    ri=lower.indexOf('last_funding_rate');if(ri<0)ri=lower.indexOf('fundingrate');
    if(ti<0||ri<0)throw new Error('BINANCE_FUNDING_ARCHIVE_SCHEMA');
    data=lines.slice(1);
  }
  return data.map(line=>{
    const r=line.split(','),fundingTime=Number(r[ti]),fundingRate=Number(r[ri]);
    if(!Number.isFinite(fundingTime)||!Number.isFinite(fundingRate))throw new Error('BINANCE_FUNDING_ARCHIVE_ROW');
    return{fundingTime,fundingRate};
  });
}

function markMonthCoverageOk(rows,year,month){
  const monthStart=Date.UTC(year,month-1,1),monthEnd=Date.UTC(year,month,1)-1;
  const from=Math.max(START,monthStart),to=Math.min(END,monthEnd);
  const first=Math.ceil(from/HOUR)*HOUR,last=Math.floor(to/HOUR)*HOUR;
  if(first>last)return true;
  const times=(rows||[]).filter(x=>x.openTime>=from&&x.openTime<=to).map(x=>x.openTime).sort((a,b)=>a-b);
  const expected=Math.floor((last-first)/HOUR)+1;
  return times.length===expected&&times.every((t,i)=>t===first+i*HOUR);
}

function fundingMonthCoverageOk(rows,year,month){
  const monthStart=Date.UTC(year,month-1,1),monthEnd=Date.UTC(year,month,1)-1;
  const from=Math.max(START,monthStart),to=Math.min(END,monthEnd);
  const xs=(rows||[]).filter(x=>x.fundingTime>=from&&x.fundingTime<=to).sort((a,b)=>a.fundingTime-b.fundingTime);
  if(!xs.length)return false;
  if(xs[0].fundingTime>from+CONTRACT.nominalFundingIntervalMs)return false;
  if(xs.at(-1).fundingTime<to-CONTRACT.nominalFundingIntervalMs)return false;
  for(let i=1;i<xs.length;i++)if(xs[i].fundingTime-xs[i-1].fundingTime>CONTRACT.nominalFundingIntervalMs+CONTRACT.timestampToleranceMs)return false;
  return true;
}

async function binanceDaily({year,month,kind,parse,receipts}){
  const monthStart=Date.UTC(year,month-1,1),monthEnd=Date.UTC(year,month,1)-1;
  const from=Math.max(START,monthStart),to=Math.min(END,monthEnd),out=[];
  for(let d=Math.floor(from/DAY)*DAY;d<=to;d+=DAY){
    const ds=dayStamp(d);
    const stem=kind==='marks'?`BTCUSDT-1h-${ds}`:`BTCUSDT-fundingRate-${ds}`;
    const rel=kind==='marks'
      ?`data/futures/um/daily/markPriceKlines/BTCUSDT/1h/${stem}.zip`
      :`data/futures/um/daily/fundingRate/BTCUSDT/${stem}.zip`;
    const a=await archiveCsv(rel,`${stem}.zip`);
    receipts.push({kind,scope:'daily',rel:a.rel,sha256:a.checksum});
    out.push(...parse(a.csv));
  }
  return out;
}

async function binanceMonth({year,month,kind,parse,receipts}){
  const ym=`${year}-${String(month).padStart(2,'0')}`;
  const stem=kind==='marks'?`BTCUSDT-1h-${ym}`:`BTCUSDT-fundingRate-${ym}`;
  const rel=kind==='marks'
    ?`data/futures/um/monthly/markPriceKlines/BTCUSDT/1h/${stem}.zip`
    :`data/futures/um/monthly/fundingRate/BTCUSDT/${stem}.zip`;
  const a=await archiveCsv(rel,`${stem}.zip`,{missingOk:true});
  if(a){
    const parsed=parse(a.csv),complete=kind==='marks'?markMonthCoverageOk(parsed,year,month):fundingMonthCoverageOk(parsed,year,month);
    if(complete){receipts.push({kind,scope:'monthly',rel:a.rel,sha256:a.checksum});return parsed}
  }
  return binanceDaily({year,month,kind,parse,receipts});
}

async function collectBinance(){
  const funding=[],marks=[],receipts=[],sd=new Date(START),ed=new Date(END);
  for(let y=sd.getUTCFullYear(),m=sd.getUTCMonth()+1;y<ed.getUTCFullYear()||(y===ed.getUTCFullYear()&&m<=ed.getUTCMonth()+1);){
    const [mm,ff]=await Promise.all([
      binanceMonth({year:y,month:m,kind:'marks',parse:parseMarkCsv,receipts}),
      binanceMonth({year:y,month:m,kind:'funding',parse:parseFundingCsv,receipts})
    ]);
    marks.push(...mm);funding.push(...ff);
    if(++m===13){m=1;y++}
  }
  const f=funding.filter(x=>x.fundingTime>=START&&x.fundingTime<=END).sort((a,b)=>a.fundingTime-b.fundingTime);
  const m=marks.filter(x=>x.openTime>=START&&x.openTime<=END).sort((a,b)=>a.openTime-b.openTime);
  return{funding:f,marks:m,receipts};
}

async function bybitPage(endpoint,params){
  const u=new URL(BYBIT_API+endpoint);
  for(const [k,v] of Object.entries(params))if(v!=null)u.searchParams.set(k,String(v));
  const r=await fetchRetry(u.toString());
  const raw=await r.text(),json=JSON.parse(raw);
  if(Number(json?.retCode)!==0)throw new Error('BYBIT_API '+json?.retCode+' '+json?.retMsg);
  return{json,receipt:{endpoint,params:Object.fromEntries([...u.searchParams]),sha256:sha256(raw),responseTime:json?.time??null}};
}

async function collectBybitFunding(){
  const out=[],receipts=[];let cursor=END,guard=0;
  while(cursor>=START&&guard++<200){
    const page=await bybitPage('/v5/market/funding/history',{category:'linear',symbol:'BTCUSDT',startTime:START,endTime:cursor,limit:200});
    receipts.push(page.receipt);
    const rows=Array.isArray(page.json?.result?.list)?page.json.result.list:[];
    if(!rows.length)break;
    const parsed=rows.map(x=>({fundingRateTimestamp:Number(x.fundingRateTimestamp),fundingRate:Number(x.fundingRate)})).filter(x=>Number.isFinite(x.fundingRateTimestamp)&&Number.isFinite(x.fundingRate));
    out.push(...parsed);
    const min=Math.min(...parsed.map(x=>x.fundingRateTimestamp));
    if(!Number.isFinite(min)||min>cursor)throw new Error('BYBIT_FUNDING_PAGINATION_NONPROGRESS');
    if(min<=START)break;
    cursor=min-1;
    await sleep(100);
  }
  if(guard>=200)throw new Error('BYBIT_FUNDING_PAGINATION_GUARD');
  return{rows:out.filter(x=>x.fundingRateTimestamp>=START&&x.fundingRateTimestamp<=END).sort((a,b)=>a.fundingRateTimestamp-b.fundingRateTimestamp),receipts};
}

async function collectBybitMarks(){
  const out=[],receipts=[];let cursor=END,guard=0;
  while(cursor>=START&&guard++<200){
    const page=await bybitPage('/v5/market/mark-price-kline',{category:'linear',symbol:'BTCUSDT',interval:'60',start:START,end:cursor,limit:1000});
    receipts.push(page.receipt);
    const rows=Array.isArray(page.json?.result?.list)?page.json.result.list:[];
    if(!rows.length)break;
    const parsed=rows.map(x=>({startTime:Number(x[0]),openPrice:Number(x[1]),highPrice:Number(x[2]),lowPrice:Number(x[3]),closePrice:Number(x[4])})).filter(x=>[x.startTime,x.openPrice,x.highPrice,x.lowPrice,x.closePrice].every(Number.isFinite));
    out.push(...parsed);
    const min=Math.min(...parsed.map(x=>x.startTime));
    if(!Number.isFinite(min)||min>cursor)throw new Error('BYBIT_MARK_PAGINATION_NONPROGRESS');
    if(min<=START)break;
    cursor=min-1;
    await sleep(100);
  }
  if(guard>=200)throw new Error('BYBIT_MARK_PAGINATION_GUARD');
  return{rows:out.filter(x=>x.startTime>=START&&x.startTime<=END).sort((a,b)=>a.startTime-b.startTime),receipts};
}

export async function collectCrossVenueFundingEdgeV1Source(){
  const [binance,bybitFunding,bybitMarks]=await Promise.all([collectBinance(),collectBybitFunding(),collectBybitMarks()]);
  const provenance={
    collectedAt:new Date().toISOString(),
    binance:{provider:'Binance Vision',archive:BINANCE_ARCHIVE,receipts:binance.receipts},
    bybit:{provider:'Bybit V5 public market API',baseUrl:BYBIT_API,fundingPageReceipts:bybitFunding.receipts,markPageReceipts:bybitMarks.receipts},
    binanceChecksumsVerified:true,
    bybitPagesHashed:true,
    strategyPnlCalculated:false
  };
  const packageData={
    schema:'CROSS-VENUE-FUNDING-EDGE-V1-SOURCE-PACKAGE-1',
    researchOnly:true,
    executionImpact:false,
    stage:'SOURCE_AUDIT',
    contract:CONTRACT,
    provenance,
    binanceFunding:binance.funding,
    bybitFunding:bybitFunding.rows,
    binanceMarks:binance.marks,
    bybitMarks:bybitMarks.rows
  };
  const validation=validateCrossVenueSource(packageData);
  if(!validation.ok)throw new Error('CROSS_VENUE_V1_SOURCE_INVALID '+JSON.stringify(validation));
  packageData.receipt=validation.receipt;
  return packageData;
}

if(import.meta.url===`file://${process.argv[1]}`){
  const out=await collectCrossVenueFundingEdgeV1Source();
  await fs.mkdir('research/data',{recursive:true});
  await fs.writeFile('research/data/cross-venue-funding-edge-v1-source.json',JSON.stringify(out));
  console.log(JSON.stringify({
    schema:out.receipt.schema,
    commonFundingDecisions:out.receipt.commonFundingDecisions,
    split:out.receipt.split,
    symbols:out.receipt.symbols,
    digest:out.receipt.digest,
    strategyPnlCalculated:false
  },null,2));
}
