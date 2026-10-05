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
const OKX_API='https://www.okx.com';
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

async function unzipText(bytes,name){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cross-venue-v1-')),zip=path.join(dir,name);
  try{
    await fs.writeFile(zip,bytes);
    const {stdout}=await execFileAsync('unzip',['-p',zip],{maxBuffer:64*1024*1024});
    return stdout;
  }finally{await fs.rm(dir,{recursive:true,force:true})}
}

async function binanceArchiveCsv(rel,name,{missingOk=false}={}){
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
  return{csv:await unzipText(bytes,name),checksum:expected,rel};
}

function parseBinanceMarkCsv(csv){
  return String(csv||'').trim().split(/\r?\n/).filter(Boolean).filter(x=>/^\d/.test(x)).map(line=>{
    const r=line.split(',');
    return{openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])};
  });
}

function parseBinanceFundingCsv(csv){
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
    const a=await binanceArchiveCsv(rel,`${stem}.zip`);
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
  const a=await binanceArchiveCsv(rel,`${stem}.zip`,{missingOk:true});
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
      binanceMonth({year:y,month:m,kind:'marks',parse:parseBinanceMarkCsv,receipts}),
      binanceMonth({year:y,month:m,kind:'funding',parse:parseBinanceFundingCsv,receipts})
    ]);
    marks.push(...mm);funding.push(...ff);
    if(++m===13){m=1;y++}
  }
  return{
    funding:funding.filter(x=>x.fundingTime>=START&&x.fundingTime<=END).sort((a,b)=>a.fundingTime-b.fundingTime),
    marks:marks.filter(x=>x.openTime>=START&&x.openTime<=END).sort((a,b)=>a.openTime-b.openTime),
    receipts
  };
}

export function stableOkxReceiptPayload(endpoint,data){
  if(endpoint==='/api/v5/public/market-data-history'&&Array.isArray(data)){
    return data.map(x=>{
      const y={...(x||{})};
      delete y.ts;
      return y;
    });
  }
  return data??null;
}

async function okxJson(endpoint,params){
  const u=new URL(OKX_API+endpoint);
  for(const [k,v] of Object.entries(params))if(v!=null)u.searchParams.set(k,String(v));
  const r=await fetchRetry(u.toString());
  const raw=await r.text(),json=JSON.parse(raw);
  if(String(json?.code)!=='0')throw new Error('OKX_API '+json?.code+' '+json?.msg);
  return{
    json,
    receipt:{endpoint,params:Object.fromEntries([...u.searchParams]),sha256:sha256(JSON.stringify(stableOkxReceiptPayload(endpoint,json?.data)))}
  };
}

export function parseOkxFundingCsv(csv){
  const lines=String(csv||'').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length)return[];
  const header=lines[0].split(',').map(x=>x.trim().toLowerCase());
  if(header.join(',')!=='instrument_name,funding_rate,funding_time')throw new Error('OKX_FUNDING_ARCHIVE_SCHEMA');
  return lines.slice(1).map(line=>{
    const r=line.split(',').map(x=>x.trim());
    if(r.length!==3||r[0]!=='BTC-USDT-SWAP')throw new Error('OKX_FUNDING_ARCHIVE_SCHEMA');
    const fundingRate=Number(r[1]),fundingTime=Number(r[2]);
    if(!Number.isFinite(fundingRate)||!Number.isFinite(fundingTime))throw new Error('OKX_FUNDING_ARCHIVE_ROW');
    return{fundingTime,fundingRate};
  });
}

async function collectOkxFunding(){
  const rows=[],queryReceipts=[],archiveReceipts=[],sd=new Date(START),ed=new Date(END);
  for(let y=sd.getUTCFullYear(),m=sd.getUTCMonth()+1;y<ed.getUTCFullYear()||(y===ed.getUTCFullYear()&&m<=ed.getUTCMonth()+1);){
    const ym=`${y}-${String(m).padStart(2,'0')}`;
    const calendarTs=Date.parse(`${ym}-01T00:00:00+08:00`);
    const page=await okxJson('/api/v5/public/market-data-history',{
      module:3,instType:'SWAP',dateAggrType:'monthly',begin:calendarTs,end:calendarTs,instFamilyList:'BTC-USDT'
    });
    queryReceipts.push(page.receipt);
    const groups=(page.json?.data||[]).flatMap(x=>(x?.details||[]).flatMap(d=>d?.groupDetails||[]));
    const filename=`BTC-USDT-SWAP-fundingrates-${ym}.zip`;
    const file=groups.find(x=>x?.filename===filename);
    if(!file?.url)throw new Error('OKX_FUNDING_ARCHIVE_MISSING '+ym);
    const response=await fetchRetry(file.url,{},4),bytes=Buffer.from(await response.arrayBuffer());
    const digest=sha256(bytes),csv=await unzipText(bytes,filename),parsed=parseOkxFundingCsv(csv);
    archiveReceipts.push({filename,url:file.url,dateTs:Number(file.dateTs??file.dataTs),sha256:digest});
    rows.push(...parsed);
    await sleep(450);
    if(++m===13){m=1;y++}
  }
  return{
    rows:rows.filter(x=>x.fundingTime>=START&&x.fundingTime<=END).sort((a,b)=>a.fundingTime-b.fundingTime),
    queryReceipts,archiveReceipts
  };
}

async function collectOkxMarks(){
  const rows=[],receipts=[];let cursor=END+1,guard=0,lastMin=Infinity;
  while(cursor>START&&guard++<1000){
    const page=await okxJson('/api/v5/market/history-mark-price-candles',{
      instId:'BTC-USDT-SWAP',bar:'1H',after:cursor,limit:100
    });
    receipts.push(page.receipt);
    const raw=Array.isArray(page.json?.data)?page.json.data:[];
    if(!raw.length)break;
    const parsed=raw.map(x=>({
      openTime:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),confirm:String(x[5])
    })).filter(x=>[x.openTime,x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.confirm==='1');
    if(!parsed.length)throw new Error('OKX_MARK_PAGE_EMPTY_AFTER_PARSE');
    rows.push(...parsed.map(({confirm,...x})=>x));
    const min=Math.min(...parsed.map(x=>x.openTime));
    if(!Number.isFinite(min)||min>=lastMin)throw new Error('OKX_MARK_PAGINATION_NONPROGRESS');
    lastMin=min;
    if(min<=START)break;
    cursor=min;
    await sleep(125);
  }
  if(guard>=1000)throw new Error('OKX_MARK_PAGINATION_GUARD');
  return{
    rows:rows.filter(x=>x.openTime>=START&&x.openTime<=END).sort((a,b)=>a.openTime-b.openTime),
    receipts
  };
}

export async function collectCrossVenueFundingEdgeV1Source(){
  const [binance,okxFunding,okxMarks]=await Promise.all([collectBinance(),collectOkxFunding(),collectOkxMarks()]);
  const provenance={
    collectedAt:new Date().toISOString(),
    binance:{provider:'Binance Vision',archive:BINANCE_ARCHIVE,receipts:binance.receipts},
    okx:{
      provider:'OKX public historical market data',
      baseUrl:OKX_API,
      fundingQueryReceipts:okxFunding.queryReceipts,
      fundingArchiveReceipts:okxFunding.archiveReceipts,
      markPageReceipts:okxMarks.receipts
    },
    binanceChecksumsVerified:true,
    okxFundingArchivesHashed:true,
    okxMarkPagesHashed:true,
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
    okxFunding:okxFunding.rows,
    binanceMarks:binance.marks,
    okxMarks:okxMarks.rows
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
